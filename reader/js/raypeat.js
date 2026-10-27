/* Ray Peat's articles (raypeat.com/articles), read in the reader.

   Routes: #/~raypeat (the article index: searchable list) and
   #/~raypeat/<path>[#anchor] for https://raypeat.com/articles/<path>.shtml, e.g.
   #/~raypeat/articles/thyroid. raypeat.com addresses pasted in the jump bar or linked
   from an article open here too (ReaderWeb.hashFor routes them).

   Fetching: raypeat.com doesn't let other sites read its pages (no CORS), so
   - in the Android app the page is fetched natively (CapacitorHttp, raw bytes);
   - on the website it goes through a public CORS relay (api.cors.lol, allorigins,
     codetabs; the last one that worked is tried first).
   Every page read is kept in this browser's / app's own cache (Cache API) for a week and
   used when offline or when the relays are busy; nothing is copied to the site. The app's
   download button saves articles into app data (native.js sets savedSource).
   The pages are windows-1252 (a few are UTF-8, a few have mojibake): bytes are decoded
   here, not by fetch.

   Rendering: the page goes through ReaderHTML in Reader style with the adapter below,
   which rebuilds the 1990s markup (<font>, layout tables, <br><br> paragraphs, bold
   lines as headings, a pasted-from-Gmail layout of one <div> per line) into headings,
   paragraphs and a reference list. */
(function (global) {
  "use strict";
  const document = global.document;
  const ORIGIN = "https://raypeat.com";
  const INDEX_URL = ORIGIN + "/articles/";
  const CACHE = "reader-raypeat-v1";
  const FRESH_MS = 7 * 24 * 3600 * 1000;
  const TIMEOUT_MS = 20000;
  const PROXY_KEY = "reader-raypeat-relay";

  /* ---- Addresses -------------------------------------------------------------- */

  function encPath(path) {
    return String(path).split("/").map(encodeURIComponent).join("/");
  }
  function articleUrl(path) {
    return path ? ORIGIN + "/articles/" + encPath(path) + ".shtml" : INDEX_URL;
  }
  /* Article path ("articles/thyroid") of a raypeat.com address, "" for the index,
     null for anything else. */
  function pathForUrl(href) {
    let u;
    try {
      u = new URL(String(href), ORIGIN + "/articles/");
    } catch (e) {
      return null;
    }
    if (!/^https?:$/.test(u.protocol) || !/^(www\.)?raypeat\.com$/i.test(u.hostname)) return null;
    if (/^\/articles\/?(index\.s?html?)?$/i.test(u.pathname)) return "";
    const m = u.pathname.match(/^\/articles\/(.+)\.shtml$/i);
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]);
    } catch (e) {
      return m[1];
    }
  }
  function hashFor(path, anchor) {
    return "#/~raypeat" + (path ? "/" + encPath(path) : "") + (anchor ? "#" + encodeURIComponent(anchor) : "");
  }
  /* The reader route for a raypeat.com address, or null. */
  function hashForUrl(url, anchor) {
    const path = pathForUrl(url);
    if (path === null) return null;
    let frag = anchor || "";
    if (!frag && String(url).indexOf("#") !== -1) {
      frag = String(url).split("#")[1] || "";
      try {
        frag = decodeURIComponent(frag);
      } catch (e) { /* keep */ }
    }
    if (frag === "top") frag = "";
    return hashFor(path, frag);
  }

  /* ---- Fetching ----------------------------------------------------------------- */

  const RELAYS = [
    { id: "corslol", url: function (u) { return "https://api.cors.lol/?url=" + encodeURIComponent(u); } },
    { id: "allorigins", url: function (u) { return "https://api.allorigins.win/raw?url=" + encodeURIComponent(u); } },
    { id: "allorigins-json", json: true, url: function (u) { return "https://api.allorigins.win/get?url=" + encodeURIComponent(u); } },
    { id: "codetabs", url: function (u) { return "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u); } }
  ];

  function inApp() {
    return document.documentElement.classList.contains("native-app");
  }
  function httpPlugin() {
    const t = global.__readerNativeTest;
    if (t) return t.CapacitorHttp || null;
    const C = global.Capacitor;
    return (C && C.Plugins && C.Plugins.CapacitorHttp) || null;
  }
  function base64Bytes(b64) {
    const bin = atob(String(b64 || ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function looksLikePage(bytes) {
    const head = new TextDecoder("windows-1252").decode(bytes.subarray(0, 3000));
    return bytes.length > 400 && /<(html|body|head|title|!doctype)\b/i.test(head);
  }
  /* raypeat.com's host answers bursts of requests (and some relays) with a
     "One moment, please..." browser check instead of the page; relays add their own
     rate-limit pages. Neither is the article, and neither may be cached. */
  function challenged(bytes) {
    const head = new TextDecoder("windows-1252").decode(bytes.subarray(0, 4000));
    return /<title>\s*(one moment, please|just a moment|attention required|vercel security checkpoint|[^<]*rate limit)/i.test(head);
  }
  const BLOCKED = "raypeat.com is showing a \u201cOne moment, please\u201d browser check instead of the article " +
    "(it does that after many requests in a short time). Try again in a few minutes, or open the article on raypeat.com.";
  function fail(message, status) {
    const err = new Error(message);
    if (status) err.status = status;
    return err;
  }

  async function timed(url, init) {
    const ctrl = global.AbortController ? new AbortController() : null;
    const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : 0;
    try {
      return await global.fetch(url, Object.assign({ credentials: "omit" }, init || {}, ctrl ? { signal: ctrl.signal } : {}));
    } finally {
      clearTimeout(timer);
    }
  }

  async function viaRelays(url) {
    let first = "";
    try {
      first = localStorage.getItem(PROXY_KEY) || "";
    } catch (e) { /* ignore */ }
    const order = RELAYS.slice().sort(function (a, b) { return (b.id === first) - (a.id === first); });
    let notFound = false;
    let blocked = false;
    for (let i = 0; i < order.length; i++) {
      const relay = order[i];
      try {
        const res = await timed(relay.url(url));
        if (res.status === 404) notFound = true;
        if (!res.ok) continue;
        let bytes;
        if (relay.json) {
          const j = await res.json();
          if (!j || typeof j.contents !== "string") continue;
          if (j.status && j.status.http_code === 404) { notFound = true; continue; }
          bytes = new TextEncoder().encode(j.contents);
        } else {
          bytes = new Uint8Array(await res.arrayBuffer());
        }
        if (!looksLikePage(bytes)) continue;
        if (challenged(bytes)) { blocked = true; continue; }
        try {
          localStorage.setItem(PROXY_KEY, relay.id);
        } catch (e) { /* ignore */ }
        return bytes;
      } catch (e) {
        /* next relay */
      }
    }
    if (notFound) throw fail("raypeat.com has no page at that address.", 404);
    if (blocked) throw fail(BLOCKED, 503);
    throw fail(
      "Couldn't reach raypeat.com. The site doesn't let other web pages read it, so on the website " +
        "the Reader goes through public relays, and none answered just now. Try again in a minute, " +
        "or use the Reader app (it reads raypeat.com directly)."
    );
  }

  async function fromNetwork(url) {
    if (!inApp()) return viaRelays(url);
    const http = httpPlugin();
    if (http && http.request) {
      try {
        const r = await http.request({ url: url, method: "GET", responseType: "arraybuffer", connectTimeout: TIMEOUT_MS, readTimeout: TIMEOUT_MS });
        if (r.status === 404) throw fail("raypeat.com has no page at that address.", 404);
        if (r.status >= 400) throw fail("raypeat.com answered " + r.status + ".", r.status);
        const got = typeof r.data === "string" ? base64Bytes(r.data)
          : r.data && r.data.byteLength !== undefined ? new Uint8Array(r.data) : null;
        if (got && challenged(got)) throw fail(BLOCKED, 503);
        if (got) return got;
      } catch (e) {
        if (e && e.status) throw e;
        /* fall back to the patched fetch */
      }
    }
    let res;
    try {
      res = await timed(url);
    } catch (e) {
      throw fail("Couldn\u2019t reach raypeat.com (no connection?). Articles saved with the download button open offline.");
    }
    if (!res.ok) throw fail(res.status === 404 ? "raypeat.com has no page at that address." : "raypeat.com answered " + res.status + ".", res.status);
    const got = new Uint8Array(await res.arrayBuffer());
    if (challenged(got)) throw fail(BLOCKED, 503);
    return got;
  }

  async function openCache() {
    try {
      return global.caches ? await global.caches.open(CACHE) : null;
    } catch (e) {
      return null;
    }
  }

  /* { bytes, from: "saved" | "cache" | "network" | "stale" } */
  async function fetchBytes(url, options) {
    const fresh = !!(options && options.fresh);
    /* A saved article is read from the device; the saved index only when the live one
       can't be had (it changes). */
    const isIndex = pathForUrl(url) === "";
    async function saved() {
      try {
        return api.savedSource ? await api.savedSource(url) : null;
      } catch (e) {
        return null;
      }
    }
    if (api.savedSource && !fresh && !isIndex) {
      try {
        const b = await api.savedSource(url);
        if (b) return { bytes: b, from: "saved" };
      } catch (e) { /* not saved */ }
    }
    const cache = await openCache();
    let hit = null;
    try {
      hit = cache ? await cache.match(url) : null;
    } catch (e) {
      hit = null;
    }
    const at = hit ? Date.parse(hit.headers.get("x-reader-cached") || "") || 0 : 0;
    if (hit && !fresh && Date.now() - at < FRESH_MS) return { bytes: new Uint8Array(await hit.arrayBuffer()), from: "cache" };
    try {
      const bytes = await fromNetwork(url);
      if (cache) {
        cache.put(url, new Response(bytes, {
          headers: { "content-type": "text/html", "x-reader-cached": new Date().toISOString() }
        })).catch(function () { /* quota */ });
      }
      return { bytes: bytes, from: "network" };
    } catch (e) {
      if (hit && e.status !== 404) return { bytes: new Uint8Array(await hit.arrayBuffer()), from: "stale" };
      const b = isIndex ? await saved() : null;
      if (b) return { bytes: b, from: "saved" };
      throw e;
    }
  }

  /* Most pages are windows-1252 whatever they declare; a few are UTF-8. Some carry
     mojibake of lost quote marks (U+FFFD, or its UTF-8 bytes read as Latin-1). */
  function decode(bytes) {
    let text = null;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (!/[^\x00-\x7f]/.test(text)) text = null;
    } catch (e) {
      text = null;
    }
    if (text === null) text = new TextDecoder("windows-1252").decode(bytes);
    return text.replace(/\u00ef\u00bf\u00bd|\ufffd/g, function (m, at, s) {
      const before = s.charAt(at - 1);
      const after = s.charAt(at + m.length);
      return /[A-Za-z]/.test(before) && /[A-Za-z]/.test(after) ? "\u2019" : "\u0022";
    });
  }

  /* ---- The article index ------------------------------------------------------ */

  /* As of October 2026, used when the live index can't be read: [section, path, title]. */
  const FALLBACK = [
    ["T", "articles/spanish-alzheimers", "El problema de la enfermedad de Alzheimer como una pista para la inmortalidad"],
    ["T", "articles/italian-salt", "Ruolo Fisiologico del Sale (Na-Cl +)"],
    ["L", "articles/dark-side-of-stress-learned-helplessness", "The dark side of stress (learned helplesness)"],
    ["L", "articles/physiology-texts-and-the-real-world", "Physiology texts and the real world"],
    ["L", "articles/cancer-disorder-energy", "Cancer: Disorder and Energy"],
    ["L", "articles/mitochondria-mortality", "Mitochondria and mortality"],
    ["L", "articles/heart-hormones", "Heart and hormones"],
    ["L", "articles/the-cancer-matrix", "The Cancer Matrix"],
    ["L", "articles/serotonin-disease-aging-inflammation", "Serotonin: Effects in disease, aging and inflammation"],
    ["L", "articles/cataracts-water-energy-light-aging", "Cataracts: water, energy, light, and aging"],
    ["L", "articles/fatigue-aging-recuperation", "Fatigue, aging, and recuperation"],
    ["L", "articles/meat-physiology-stress", "Meat physiology, stress, and degenerative physiology"],
    ["L", "articles/multiple-sclerosis-hormone-related-brain-syndromes", "Multiple Sclerosis and other hormone related brain syndromes"],
    ["L", "articles/prostate-cancer", "Prostate Cancer"],
    ["L", "articles/growth-hormone", "Growth hormone: Hormone of Stress, Aging, and Death?"],
    ["L", "articles/phosphate-activation-aging", "Phosphate, activation, and aging"],
    ["L", "articles/rosacea-inflammation-aging", "Rosacea, inflammation, and aging: The inefficiency of stress"],
    ["L", "articles/hot-flashes-energy-aging", "Hot flashes, energy, and aging"],
    ["L", "articles/multiple-sclerosis", "Multiple Sclerosis and other hormone-related brain syndromes"],
    ["L", "articles/edema-heart-failure-hypertension-sarcopenia", "When energy fails: Edema, heart failure, hypertension, sarcopenia, etc."],
    ["L", "articles/fats-functions-malfunctions", "Fats, functions & malfunctions"],
    ["L", "articles/sugar-issues", "Sugar issues"],
    ["L", "articles/glucose-sucrose-diabetes", "Glucose and sucrose for diabetes"],
    ["L", "articles/cascara-energy-cancer-fda-laxative-abuse", "Cascara, energy, cancer and the FDA's laxative abuse"],
    ["L", "articles/osteoporosis-aging", "Osteoporosis, aging, tissue renewal, and product science"],
    ["L", "articles/regeneration-degeneration", "Regeneration and degeneration: Types of inflammation change with aging"],
    ["L", "articles/pathological-science-general-electric", "Pathological Science & General Electric: Threatening the paradigm"],
    ["L", "articles/protective-co2-aging", "Protective CO2 and aging"],
    ["L", "articles/genes-carbon-dioxide-adaptation", "Genes, Carbon Dioxide and Adaptation"],
    ["L", "articles/serotonin-depression-aggression", "Serotonin, depression, and aggression: The problem of brain energy"],
    ["E", "articles/authoritarians", "Academic authoritarians, language, metaphor, animals, and science"],
    ["E", "articles/adaptive-substance", "Adaptive substance, creative regeneration: Mainstream science, repression, and creativity"],
    ["E", "articles/calcium", "Calcium and Disease: Hypertension, organ calcification, & shock, vs. respiratory energy"],
    ["E", "articles/cholesterol-longevity", "Cholesterol, longevity, intelligence, and health."],
    ["E", "articles/imprinting", "Estrogen, memory and heredity: Imprinting and the stress response"],
    ["E", "articles/estrogen-progesterone-cancer", "Estrogen, progesterone, and cancer: Conflicts of interest in regulation and product promotion"],
    ["E", "articles/natural-estrogens", "Natural Estrogens"],
    ["E", "articles/tissue-bound-estrogen", "Tissue-bound estrogen in aging"],
    ["E", "articles/unsuitablefats", "Suitable Fats, Unsuitable Fats: Issues in Nutrition"],
    ["E", "articles/fishoil", "The Great Fish Oil Experiment"],
    ["E", "articles/gelatin", "Gelatin, stress, longevity"],
    ["E", "articles/glycemia", "Glycemia, starch, and sugar in context"],
    ["E", "articles/howdoyouknow", "How do you know? Students, patients, and discovery"],
    ["E", "articles/intelligence", "Intelligence and metabolism"],
    ["E", "articles/intuitive-knowledge", "Intuitive knowledge and its development"],
    ["E", "articles/lactate", "Lactate vs. CO2 in wounds, sickness, and aging; the other approach to cancer"],
    ["E", "articles/milk", "Milk in context: allergies, ecology, and some myths"],
    ["E", "articles/membranes", "Membranes, plasma membranes, and surfaces"],
    ["E", "articles/ms", "Multiple sclerosis, protein, fats, and progesterone"],
    ["E", "articles/progesterone-summaries", "Progesterone Summaries"],
    ["E", "articles/progesterone-deceptions", "Progesterone Deceptions"],
    ["E", "articles/cancer-progesterone", "Preventing and treating cancer with progesterone."],
    ["E", "articles/co2", "Protective CO2 and aging"],
    ["E", "articles/ru486", "RU486, Cancer, Estrogen, and Progesterone"],
    ["E", "articles/salt", "Salt, energy, metabolic rate, and longevity"],
    ["E", "articles/stemcells", "Stem cells, cell culture, and culture: Issues in regeneration"],
    ["E", "articles/thyroid-insanities", "Thyroid, insomnia, and the insanities: Commonalities in disease"],
    ["E", "articles/hypothyroidism", "TSH, temperature, pulse rate, and other indicators in hypothyroidism"],
    ["E", "articles/water", "Water: swelling, tension, pain, fatigue, aging"],
    ["E", "articles/unsaturatedfats", "Unsaturated fatty acids: Nutritionally essential, or toxic?"],
    ["E", "aging/aging-estrogen-progesterone", "Aging, estrogen, and progesterone."],
    ["E", "articles/aging-eyes", "Aging Eyes, Infant Eyes, and Excitable Tissues"],
    ["E", "aging/altitude-mortality", "Altitude and Mortality."],
    ["E", "articles/alzheimers", "Alzheimer's: The problem of Alzheimer's disease as a clue to immortality - part 1."],
    ["E", "articles/alzheimers2", "Alzheimer's: The problem of Alzheimer's disease as a clue to immortality - part 2."],
    ["E", "aging/aspirin-brain-cancer", "Aspirin, brain and cancer."],
    ["E", "other/autonomic-systems", "Autonomic systems."],
    ["E", "aging/bleeding-clotting-cancer", "Bleeding, clotting, cancer."],
    ["E", "articles/tissue-destruction", "Blocking Tissue Destruction."],
    ["E", "aging/bonedensity", "Bone Density: First Do No Harm."],
    ["E", "aging/breastcancer", "Breast Cancer."],
    ["E", "aging/madcow", "BSE (\"mad cow\"), scrapie, etc.: Stimulated amyloid degeneration and the toxic fats."],
    ["E", "articles/caffeine", "Caffeine: A vitamin-like nutrient, or adaptogen. Questions about tea and coffee, cancer and other degenerative diseases, and the hormones."],
    ["E", "articles/coconut-oil", "Coconut Oil."],
    ["E", "articles/diabetes", "Diabetes, scleroderma, oils and hormones."],
    ["E", "aging/eclampsia", "Eclampsia in the Real Organism: A Paradigm of General Distress Applicable in Infants, Adults, Etc."],
    ["E", "articles/epilepsy-progesterone", "Epilepsy and Progesterone."],
    ["E", "aging/estriol-des-ddt", "Estriol, DES, DDT, etc."],
    ["E", "articles/estrogen-age-stress", "Estrogen - Age Stress Hormone."],
    ["E", "articles/estrogen-osteoporosis", "Estrogen and Osteoporosis."],
    ["E", "articles/fats-degeneration3", "Fats and degeneration."],
    ["E", "nutrition/carrageenan", "Food-junk and some mystery ailments: Fatigue, Alzheimer's, Colitis, Immunodeficiency."],
    ["E", "articles/immunodeficiency", "Immunodeficiency, dioxins, stress, and the hormones."],
    ["E", "articles/iron-dangers", "Iron's Dangers."],
    ["E", "articles/leakiness", "Leakiness, aging, and cancer."],
    ["E", "articles/menopause", "Menopause and its causes."],
    ["E", "nutrition/oils-in-context", "Oils in Context."],
    ["E", "articles/osteoporosis", "Osteoporosis, harmful calcification, and nerve/muscle malfunctions."],
    ["E", "articles/three-hormones", "Progesterone Pregnenolone & DHEA - Three Youth-Associated Hormones."],
    ["E", "aging/coronaryprogesterone", "Progesterone, not estrogen, is the coronary protection factor of women."],
    ["E", "articles/thyroid", "Thyroid: Therapies, Confusion, and Fraud."],
    ["E", "aging/transparency-cataracts", "The transparency of life: Cataracts as a model of age-related disease."],
    ["E", "aging/tryptophan-serotonin-aging", "Tryptophan, serotonin, and aging."],
    ["E", "articles/unsaturated-oils", "Unsaturated Vegetable Oils: Toxic."],
    ["E", "articles/vegetables", "Vegetables, etc. - Who Defines Food?"],
    ["E", "articles/vitamin-e", "Vitamin E: Estrogen antagonist, energy promoter, and anti-inflammatory"],
    ["E", "articles/william-blake", "William Blake as biological visionary. Can art instruct science?"]

  ];
  const SECTIONS = { T: "Translations", L: "Latest articles", E: "Earlier articles" };
  const SECTION_TEXT = {
    "TRANSLATIONS": "Translations",
    "LATEST ARTICLES POSTED": "Latest articles",
    "NEWER ARTICLES": "Earlier articles"
  };

  function squash(s) {
    return String(s || "").replace(/[\s\u00a0]+/g, " ").trim();
  }
  function titleCase(s) {
    const lower = s.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }
  function ordered(items) {
    /* Translations last; otherwise the site's order. */
    return items.filter(function (i) { return i.section !== "Translations"; })
      .concat(items.filter(function (i) { return i.section === "Translations"; }));
  }

  function parseIndex(text) {
    const d = new DOMParser().parseFromString(text, "text/html");
    const items = [];
    const seen = new Set();
    let section = "";
    const walker = d.createTreeWalker(d.body || d.documentElement, 1 | 4);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === 3) {
        const t = squash(n.nodeValue);
        if (SECTION_TEXT[t]) section = SECTION_TEXT[t];
        else if (t.length > 6 && t.length < 40 && t === t.toUpperCase() && /[A-Z]{3,}\s+[A-Z]{3,}/.test(t) && !/I N D E X/.test(t)) {
          section = titleCase(t);
        }
        continue;
      }
      if (n.localName !== "a" || !section) continue;
      const path = pathForUrl(n.getAttribute("href") || "");
      if (!path || seen.has(path.toLowerCase())) continue;
      seen.add(path.toLowerCase());
      const title = squash(n.textContent) || squash(n.getAttribute("title")) || path.split("/").pop();
      items.push({ path: path, title: title, section: section });
    }
    return ordered(items);
  }

  function fallbackItems() {
    return ordered(FALLBACK.map(function (r) { return { path: r[1], title: r[2], section: SECTIONS[r[0]] || "Articles" }; }));
  }

  let indexPromise = null;
  /* { items: [{ path, title, section }], live, from } */
  function index(options) {
    if (!indexPromise || (options && options.fresh)) {
      indexPromise = (async function () {
        try {
          const r = await fetchBytes(INDEX_URL, options);
          const items = parseIndex(decode(r.bytes));
          if (items.length < 20) throw new Error("index looks wrong");
          return { items: items, live: true, from: r.from };
        } catch (e) {
          return { items: fallbackItems(), live: false, from: "", error: e && e.message };
        }
      })();
    }
    return indexPromise;
  }

  function titleFor(idx, path) {
    const lower = String(path || "").toLowerCase();
    const hit = (idx && idx.items || []).filter(function (i) { return i.path.toLowerCase() === lower; })[0];
    return hit ? hit.title : "";
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function fold(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }
  function matches(item, words) {
    const hay = fold(item.title + " " + item.path.replace(/[-/_]/g, " "));
    return words.every(function (w) { return hay.indexOf(w) !== -1; });
  }
  function groups(items) {
    const out = [];
    items.forEach(function (item) {
      let g = out[out.length - 1];
      if (!g || g.name !== item.section) {
        g = { name: item.section, items: [] };
        out.push(g);
      }
      g.items.push(item);
    });
    return out;
  }

  /* The index page (in the article area). */
  function indexView(idx) {
    const wrap = document.createElement("div");
    wrap.className = "markdown-body doc-html rp-index";
    const parts = [
      '<header class="rp-head">',
      "<h1>Ray Peat</h1>",
      '<p class="rp-intro">Articles by Raymond Peat, PhD (1936\u20132022), read from ',
      '<a href="' + INDEX_URL + '" target="_blank" rel="noopener noreferrer">raypeat.com/articles</a> and shown in the reader\u2019s style. ',
      "All rights remain with Ray Peat and Ray Peat Publishing; the articles are not copied to this site.</p>",
      idx.live ? "" : '<p class="rp-note">Couldn\u2019t load the live index just now; this is the list as of October 2026.</p>',
      "</header>",
      '<div class="rp-filter"><input type="search" class="rp-filter-input" placeholder="Filter ' + idx.items.length +
        ' articles" aria-label="Filter articles" autocomplete="off" spellcheck="false"></div>',
      '<p class="rp-count" aria-live="polite"></p>'
    ];
    groups(idx.items).forEach(function (g) {
      parts.push('<section class="rp-section"><h2>' + esc(g.name) + ' <span class="rp-n">' + g.items.length + "</span></h2><ol class=\"rp-list\">");
      g.items.forEach(function (item) {
        parts.push('<li data-rp-path="' + esc(item.path) + '"><a href="' + esc(hashFor(item.path)) + '">' + esc(item.title) + "</a></li>");
      });
      parts.push("</ol></section>");
    });
    parts.push('<p class="rp-none" hidden>No article title matches.</p>');
    wrap.innerHTML = parts.join("");
    const input = wrap.querySelector(".rp-filter-input");
    const byPath = {};
    idx.items.forEach(function (i) { byPath[i.path] = i; });
    function apply() {
      const words = fold(input.value).split(/\s+/).filter(Boolean);
      let shown = 0;
      wrap.querySelectorAll(".rp-section").forEach(function (sec) {
        let n = 0;
        sec.querySelectorAll("li[data-rp-path]").forEach(function (li) {
          const ok = !words.length || matches(byPath[li.getAttribute("data-rp-path")], words);
          li.hidden = !ok;
          if (ok) n++;
        });
        sec.hidden = !n;
        sec.querySelector(".rp-n").textContent = String(n);
        shown += n;
      });
      wrap.querySelector(".rp-none").hidden = shown > 0;
      wrap.querySelector(".rp-count").textContent = words.length ? shown + " of " + idx.items.length + " articles" : "";
      try {
        sessionStorage.setItem("reader-raypeat-filter", input.value);
      } catch (e) { /* ignore */ }
    }
    input.addEventListener("input", apply);
    try {
      input.value = sessionStorage.getItem("reader-raypeat-filter") || "";
    } catch (e) { /* ignore */ }
    if (input.value) apply();
    return wrap;
  }

  /* Sidebar / drawer: every article (the pager follows this order), with the open
     article's contents under it. */
  function sidebarHtml(idx, activePath, outline) {
    const active = String(activePath || "").toLowerCase();
    const parts = ['<li class="rp-side-filter"><input type="search" placeholder="Filter articles" aria-label="Filter articles" autocomplete="off" spellcheck="false"></li>'];
    if (activePath !== undefined) {
      parts.push('<li class="dir-up"><a href="' + hashFor("") + '">\u2190 All articles</a></li>');
    }
    groups(idx.items).forEach(function (g) {
      parts.push('<li class="rp-side-section">' + esc(g.name) + "</li>");
      g.items.forEach(function (item) {
        const on = item.path.toLowerCase() === active;
        parts.push(
          '<li class="file-item is-root" data-rp-path="' + esc(item.path) + '"><a class="file-link' + (on ? " active" : "") +
            '" href="' + esc(hashFor(item.path)) + '"' + (on ? ' aria-current="page"' : "") + ">" + esc(item.title) + "</a></li>"
        );
        if (on && outline && outline.length) {
          const min = Math.min.apply(null, outline.map(function (o) { return o.level; }));
          outline.forEach(function (o) {
            if (o.level === min && outline.filter(function (x) { return x.level === min; }).length === 1) return; /* the title */
            parts.push('<li class="toc-item rp-side-toc" style="--depth:' + (o.level - min + 1) + '"><a class="file-link" href="' +
              esc(hashFor(item.path, o.id)) + '">' + esc(o.text) + "</a></li>");
          });
        }
      });
    });
    return parts.join("");
  }
  function wireSidebar(list) {
    const input = list.querySelector(".rp-side-filter input");
    if (!input) return;
    input.addEventListener("input", function () {
      const words = fold(input.value).split(/\s+/).filter(Boolean);
      list.querySelectorAll("li[data-rp-path]").forEach(function (li) {
        const a = li.querySelector("a");
        li.hidden = !!words.length && !words.every(function (w) { return fold(a.textContent + " " + li.getAttribute("data-rp-path")).indexOf(w) !== -1; });
      });
      list.querySelectorAll(".rp-side-toc, .rp-side-section").forEach(function (li) { li.hidden = !!words.length; });
    });
  }

  /* ---- An article ------------------------------------------------------------------ */

  /* { wrap, title, url, from } */
  async function render(path) {
    const url = articleUrl(path);
    const r = await fetchBytes(url);
    const text = decode(r.bytes);
    const ctx = { owner: "", repo: "", branch: "", path: url, web: url };
    const doc = new DOMParser().parseFromString(text, "text/html");
    if (global.ReaderWeb && global.ReaderWeb.absolutize) global.ReaderWeb.absolutize(doc, url);
    const html = "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
    const wrap = await global.ReaderHTML.render(html, ctx, { web: true, sourceText: text });
    return { wrap: wrap, title: wrap.getAttribute("data-doc-title") || path.split("/").pop(), url: url, from: r.from };
  }

  /* ---- Reader-style adapter ---------------------------------------------------------- */

  const SPLIT = "\u0001";
  const SOFT = "\u0002";
  const HOLD = "\u0003";
  const REF_RE = /^(?:(?:additional|other|selected|some|further)\s+)?(?:references|notes and sources|notes and references|sources|bibliography|reading)(?:\s+(?:&|and|with|from)\s+.{1,40})?\s*:?$/i;

  function norm(s) {
    return squash(s).replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
  }
  function key(s) {
    return norm(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
  }
  function unwrap(el) {
    while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
    el.remove();
  }

  /* Split markup into blocks, re-opening inline tags (b, i, …) cut by a split. */
  function balanced(parts) {
    let open = [];
    return parts.map(function (p) {
      const prefix = open.map(function (t) { return "<" + t + ">"; }).join("");
      const stack = open.slice();
      const re = /<(\/?)(b|strong|i|em|u|sup|sub)\b[^>]*>/gi;
      let m;
      while ((m = re.exec(p))) {
        const t = m[2].toLowerCase() === "strong" ? "b" : m[2].toLowerCase() === "em" ? "i" : m[2].toLowerCase();
        if (m[1]) {
          const k = stack.lastIndexOf(t);
          if (k !== -1) stack.splice(k, 1);
        } else {
          stack.push(t);
        }
      }
      open = stack;
      return prefix + p + stack.slice().reverse().map(function (t) { return "</" + t + ">"; }).join("");
    });
  }

  /* Text of a block if it reads as a heading: all bold, short, not a sentence. */
  function headingOf(el) {
    const plain = norm(el.textContent);
    if (!plain || plain.length > 160) return "";
    if (REF_RE.test(plain)) return plain;
    const bold = Array.prototype.filter.call(el.querySelectorAll("b, strong"), function (b) {
      return !b.parentElement.closest("b, strong");
    }).map(function (b) { return b.textContent; }).join(" ");
    if (!bold || key(bold) !== key(plain)) return "";
    const words = plain.split(" ").length;
    if (words > 22) return "";
    if (/\.$/.test(plain) && words > 8) return "";
    return plain;
  }

  function slug(text, used) {
    let s = norm(text).toLowerCase().replace(/^[ivxlc]+\.\s+|^\d+\.\s+/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "section";
    if (/^\d/.test(s)) s = "s-" + s;
    let id = s;
    for (let i = 2; used.has(id); i++) id = s + "-" + i;
    used.add(id);
    return id;
  }

  /* References: one entry per line, or (one <div> per line) one per citation start. */
  const CITE_START = /^[A-Z][A-Za-z.'&\-]*(?:\s+[A-Za-z.'&\-]+){0,6}\.?\s*(?:\d{4}\b|\d+\s*\(\d+\)|\(\d{4}\))/;
  function refItems(doc, html) {
    const pieces = html.split(/<br\s*\/?>/i);
    const out = [];
    pieces.forEach(function (piece) {
      const lines = piece.split(SOFT);
      let cur = "";
      lines.forEach(function (line) {
        const t = document.createElement("div");
        t.innerHTML = line;
        const plain = norm(t.textContent);
        if (!plain) return;
        if (cur && lines.length > 1 && CITE_START.test(plain)) {
          out.push(cur);
          cur = line;
        } else {
          cur = cur ? cur + " " + line : line;
        }
      });
      if (cur) out.push(cur);
    });
    return balanced(out).map(function (h) {
      const li = doc.createElement("li");
      li.innerHTML = h;
      /* "1) Hu ZY…": the list numbers it already. */
      const walker = doc.createTreeWalker(li, NodeFilter.SHOW_TEXT);
      let first = walker.nextNode();
      while (first && !norm(first.nodeValue)) first = walker.nextNode();
      if (first) first.nodeValue = first.nodeValue.replace(/^[\s\u00a0]*\d{1,3}[).][\s\u00a0]+/, "");
      return li;
    }).filter(function (li) { return norm(li.textContent); });
  }

  function prepare(doc, page) {
    const src = doc.querySelector("div.entries") || doc.body;
    const titles = Array.prototype.map.call(doc.querySelectorAll("title"), function (t) { return norm(t.textContent); })
      .filter(function (t) { return t && !/^ray ?peat(\.com)?$/i.test(t); });
    src.querySelectorAll("script, style, noscript, title, meta, link, iframe, form, input, object, embed").forEach(function (el) { el.remove(); });
    src.querySelectorAll('img[src*="rp3.gif"], img[src*="/rotate/"], img[src*="sideback"]').forEach(function (img) {
      const t = img.closest("table");
      if (t && src.contains(t) && norm(t.textContent).length < 40) t.remove();
      else img.remove();
    });
    src.querySelectorAll('a[href$="#top"]').forEach(function (a) {
      const c = a.closest("center");
      (c && src.contains(c) ? c : a).remove();
    });

    /* Data tables, lists and quotations stay as they are (placeholders for now). */
    const kept = [];
    function hold(el) {
      kept.push(el);
      el.replaceWith(doc.createTextNode(SPLIT + HOLD + (kept.length - 1) + HOLD + SPLIT));
    }
    src.querySelectorAll("table").forEach(function (t) {
      if (!t.isConnected || t.querySelector("table")) return;
      const rows = Array.prototype.filter.call(t.rows, function (r) {
        return Array.prototype.filter.call(r.cells, function (c) { return norm(c.textContent); }).length >= 2;
      });
      if (rows.length >= 2) hold(t);
    });
    /* Some CMS-edited pages put every paragraph in its own <blockquote>: those are
       just paragraphs. */
    const quotes = Array.prototype.filter.call(src.querySelectorAll("blockquote"), function (q) { return !q.parentElement.closest("blockquote"); });
    const quoted = quotes.reduce(function (n, q) { return n + norm(q.textContent).length; }, 0);
    if (quotes.length && quoted > norm(src.textContent).length * 0.5) {
      quotes.forEach(function (q) {
        q.before(doc.createTextNode(SPLIT));
        q.after(doc.createTextNode(SPLIT));
        unwrap(q);
      });
      src.querySelectorAll("blockquote").forEach(unwrap);
    }
    /* <ul> without items was used for indenting. */
    src.querySelectorAll("ul, ol").forEach(function (el) {
      if (el.isConnected && !el.querySelector("li")) {
        el.before(doc.createTextNode(SPLIT));
        el.after(doc.createTextNode(SPLIT));
        unwrap(el);
      }
    });
    src.querySelectorAll("ul, ol, blockquote").forEach(function (el) {
      if (el.isConnected && !el.parentElement.closest("ul, ol, blockquote") && norm(el.textContent)) hold(el);
    });
    /* Real headings become bold lines, like the rest of the site's headings. */
    src.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach(function (h) {
      const b = doc.createElement("b");
      while (h.firstChild) b.appendChild(h.firstChild);
      h.replaceWith(doc.createTextNode(SPLIT), b, doc.createTextNode(SPLIT));
    });
    src.querySelectorAll("font, span, center, big, html, body, head, nobr, a[name]:not([href])").forEach(unwrap);

    /* Pasted from an e-mail: one <div> per visual line, empty <div>s between paragraphs. */
    const leaves = Array.prototype.filter.call(src.querySelectorAll("div"), function (d) { return !d.querySelector("div, p, table"); });
    const lineDivs = leaves.filter(function (d) { const n = norm(d.textContent).length; return n > 0 && n < 110; });
    const divLines = lineDivs.length > 40 && lineDivs.length > leaves.length * 0.6;

    let h = src.innerHTML.replace(/<!--[\s\S]*?-->/g, "");
    if (divLines) {
      h = h.replace(/<div\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/div>/gi, SPLIT).replace(/<\/div>\s*<div\b[^>]*>/gi, SOFT);
    }
    /* "=========" rules between epigraphs (often inside one-line divs). */
    h = h.replace(/(?:&nbsp;|\s)*[=_]{8,}(?:&nbsp;|\s)*/g, SPLIT + "==========" + SPLIT);
    h = h
      .replace(/<br\s*\/?>(?:\s|&nbsp;)*(?:<br\s*\/?>(?:\s|&nbsp;)*)+/gi, SPLIT)
      .replace(/<\/?(?:p|div|hr|table|tbody|thead|tfoot|tr|td|th|dl|dt|dd|pre|section|article|li|caption)\b[^>]*>/gi, SPLIT);

    const out = doc.createElement("div");
    out.className = "rp-article";
    const used = new Set();
    const refs = [];
    const headings = [];
    let inRefs = false;
    /* The page's own bold title wins; else the index's title (some <title>s are stale
       copies from other pages or "New Page Title Here"); else <title>. */
    const rpPath = pathForUrl(page.url) || "";
    const listed = FALLBACK.filter(function (r) { return r[1].toLowerCase() === rpPath.toLowerCase(); })[0];
    const fallbackTitle = (listed && listed[2]) || titles.filter(function (t) { return !/new page title|untitled/i.test(t); })[0] || "";
    let title = listed ? listed[2] : "";
    let titleSeen = false;
    function tkey(t) { return key(String(t || "").replace(/&/g, " and ")); }
    function sameAsTitle(t) {
      const k = tkey(t);
      return !!k && [title, fallbackTitle].some(function (x) { const kx = tkey(x); return kx && (kx === k || (k.length > 12 && kx.indexOf(k) === 0) || (kx.length > 12 && k.indexOf(kx) === 0)); });
    }
    let copyright = "";
    let seenParagraph = false;
    let toc = [];

    let hadToc = false;
    function flushToc() {
      if (toc.length >= 2 && !headings.length) {
        hadToc = true;
        const ul = doc.createElement("ul");
        ul.className = "rp-toc";
        toc.forEach(function (t) {
          const li = doc.createElement("li");
          li.textContent = t;
          ul.appendChild(li);
        });
        out.appendChild(ul);
      } else {
        toc.forEach(function (t) {
          const p = doc.createElement("p");
          p.textContent = t;
          out.appendChild(p);
        });
      }
      toc = [];
    }

    /* Long blocks broken only by single <br>s are several paragraphs run together. */
    const blocks = [];
    balanced(h.split(SPLIT)).forEach(function (html) {
      const plain = html.replace(/<[^>]*>/g, "").replace(/&nbsp;|\s+/g, " ").trim();
      if (plain.length > 900 && /<br\b/i.test(html)) {
        balanced(html.split(/<br\s*\/?>/i)).forEach(function (piece) { blocks.push(piece); });
      } else {
        blocks.push(html);
      }
    });
    blocks.forEach(function (html) {
      const box = doc.createElement("div");
      box.innerHTML = html.split(SOFT).join(" ");
      const text = norm(box.textContent);
      const holdMatch = text.match(new RegExp("^" + HOLD + "(\\d+)" + HOLD + "$"));
      if (holdMatch) {
        flushToc();
        const el = kept[Number(holdMatch[1])];
        if (inRefs && /^(ul|ol)$/.test(el.localName)) {
          Array.prototype.forEach.call(el.children, function (li) { refs.push(li); });
        } else {
          out.appendChild(el);
        }
        seenParagraph = true;
        return;
      }
      if (!text) {
        if (box.querySelector("img")) out.appendChild(box);
        return;
      }
      if (/^[=\-_*~\s]{5,}$/.test(text)) {
        flushToc();
        if (out.lastElementChild && out.lastElementChild.localName !== "hr") out.appendChild(doc.createElement("hr"));
        return;
      }
      if (/^A ?R ?T ?I ?C ?L ?E\b/.test(text) && text.replace(/\s/g, "").length < 12) return;
      if (/^(©|\(c\)|copyright)\s*(by\s*)?ray peat/i.test(text) || /^©\s*\d{4}\s*ray peat/i.test(text)) {
        copyright = text.replace(/\s*www\.raypeat\.com\.?$/i, "");
        return;
      }
      if (!seenParagraph && !headings.length && sameAsTitle(text)) { titleSeen = true; return; }
      if (!inRefs) {
        /* "REFERENCES<br>first citation…" in one block. */
        const cut = html.search(/<br\b/i);
        if (cut > 0) {
          const head = doc.createElement("div");
          head.innerHTML = html.slice(0, cut);
          if (REF_RE.test(norm(head.textContent))) {
            flushToc();
            inRefs = true;
            refItems(doc, html.slice(cut).replace(/^<br\s*\/?>/i, "")).forEach(function (li) { refs.push(li); });
            return;
          }
        }
      }
      const heading = headingOf(box);
      if (heading && !inRefs) {
        if (!title && !seenParagraph && !headings.length && !inRefs && !REF_RE.test(heading)) {
          title = heading === heading.toUpperCase() && /[A-Z]{3}/.test(heading) ? titleCase(heading) : heading;
          return;
        }
        flushToc();
        if (REF_RE.test(heading)) {
          inRefs = true;
          return;
        }
        if (!headings.length && sameAsTitle(heading)) { titleSeen = true; return; }
        if (titleSeen && !seenParagraph && !headings.length && !hadToc && !/^([IVXLC]+|\d{1,2})\.\s/.test(heading)) {
          /* A subtitle right under the title. */
          const sub = doc.createElement("p");
          sub.className = "rp-subtitle";
          sub.textContent = heading;
          out.appendChild(sub);
          return;
        }
        const h2 = doc.createElement("h2");
        h2.textContent = heading === heading.toUpperCase() && /[A-Z]{3}/.test(heading) ? titleCase(heading) : heading;
        h2.id = slug(heading, used);
        out.appendChild(h2);
        headings.push(h2);
        return;
      }
      if (inRefs) {
        refItems(doc, html).forEach(function (li) { refs.push(li); });
        return;
      }
      if (!headings.length && /^([IVXLC]+|\d{1,2})\.\s+\S/.test(text) && text.length < 110) {
        toc.push(text);
        return;
      }
      flushToc();
      const p = doc.createElement("p");
      p.innerHTML = html.split(SOFT).join(" ");
      out.appendChild(p);
      seenParagraph = true;
    });
    flushToc();

    /* "I. Respiratory defect" in the opening list → link to that section. */
    out.querySelectorAll(".rp-toc li").forEach(function (li) {
      const num = (li.textContent.match(/^([IVXLC]+|\d{1,2})\./) || [])[1];
      const target = num && headings.filter(function (hd) { return hd.textContent.indexOf(num + ".") === 0; })[0];
      if (!target) return;
      const a = doc.createElement("a");
      a.href = "#" + target.id;
      a.textContent = li.textContent;
      li.textContent = "";
      li.appendChild(a);
    });

    if (copyright) {
      const c = doc.createElement("p");
      c.className = "rp-copyright";
      c.textContent = copyright;
      out.appendChild(c);
    }
    page.title = (title || fallbackTitle || page.title || "").replace(/([a-z)])\.$/, "$1");
    page.byline = "Ray Peat" + (copyright && /\d{4}/.test(copyright) ? " \u00b7 \u00a9 " + copyright.match(/\d{4}/)[0] + ", all rights reserved" : "");
    page.references = refs;
    doc.body.innerHTML = "";
    doc.body.appendChild(out);
  }

  if (global.ReaderRestyle) {
    global.ReaderRestyle.register({
      id: "raypeat",
      name: "Ray Peat article",
      match: function (doc, page) { return pathForUrl(page.url || "") !== null; },
      prepare: prepare,
      root: function (doc) { return doc.querySelector(".rp-article"); },
      drop: []
    });
  }

  const api = {
    INDEX_URL: INDEX_URL,
    articleUrl: articleUrl,
    pathForUrl: pathForUrl,
    hashFor: hashFor,
    hashForUrl: hashForUrl,
    fetchBytes: fetchBytes,
    decode: decode,
    index: index,
    parseIndex: parseIndex,
    titleFor: titleFor,
    indexView: indexView,
    sidebarHtml: sidebarHtml,
    wireSidebar: wireSidebar,
    render: render,
    /* Set by the app: async (url) → Uint8Array of a saved copy, or null. */
    savedSource: null
  };
  global.ReaderRayPeat = api;
})(window);
