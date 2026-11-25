/* Scott Aaronson's blog, Shtetl-Optimized (scottaaronson.blog, WordPress), read in the reader.

   Routes:
     #/~aaronson                             the index: newest posts first, "Load more", search,
                                             category and year filters
     #/~aaronson/cat/<id>/year/<yyyy>/q/<text> the same, filtered (any subset, in any order)
     #/~aaronson/p/<id>[#anchor]             one post, with its comments folded away behind a
                                             "Show comments (N)" button; #comment-<id> opens them
   Any scottaaronson.blog (or scottaaronson.com/blog) address pasted in the jump bar or linked
   from a page opens here: ?p=<id>, ?cat=<id>, ?s=<words>, ?m=<yyyymm>, the home page.

   Content comes from WordPress's own REST API (/?rest_route=/wp/v2/posts, /comments,
   /categories), not the page: the post's markup, cleaned up here (embedded videos become link
   cards with a thumbnail, scripts and share widgets dropped; images, links, tables, quotes
   kept). Comments are fetched 100 at a time (all pages), threaded by their parent, and built
   only when the button is first pressed.

   Fetching: the blog answers cross-origin reads (it echoes the page's origin), so
   - on the website the API is read directly, with the public CORS relays (api.cors.lol,
     allorigins, codetabs) as the fallback when that fails (rate limit, an outage, a firewall);
   - in the Android app it is read natively (CapacitorHttp).
   Responses are kept in this browser's / app's own cache (Cache API) for a short while (posts
   30 min, lists and comments 10 min, categories a day) and used when offline. Nothing is
   bundled, and nothing is saved for offline use. */
(function (global) {
  "use strict";
  const document = global.document;
  const ORIGIN = "https://scottaaronson.blog";
  const NAME = "Shtetl-Optimized";
  const CACHE = "reader-aaronson-v1";
  const POST_FRESH_MS = 30 * 60 * 1000;
  const LIST_FRESH_MS = 10 * 60 * 1000;
  const CATS_FRESH_MS = 24 * 3600 * 1000;
  const TIMEOUT_MS = 20000;
  const PROXY_KEY = "reader-aaronson-relay";
  const PAGE = 20;
  const COMMENT_PAGE = 100;
  const FIRST_YEAR = 2005;

  /* ---- Addresses ----------------------------------------------------------------- */

  const HOST_RE = /^(www\.)?scottaaronson\.(blog|com)$/i;

  function enc(s) {
    return encodeURIComponent(String(s));
  }
  function safeDecode(s) {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  }
  function postUrl(id) {
    return ORIGIN + "/?p=" + enc(id);
  }
  function blogUrl() {
    return ORIGIN + "/";
  }

  function cleanFilters(f) {
    f = f || {};
    const year = /^\d{4}$/.test(String(f.year || "")) ? String(f.year) : "";
    return {
      cat: /^\d+$/.test(String(f.cat || "")) ? String(f.cat) : "",
      year: year && +year >= FIRST_YEAR && +year <= new Date().getFullYear() + 1 ? year : "",
      q: String(f.q || "").replace(/\s+/g, " ").trim().slice(0, 120)
    };
  }
  function isFiltered(f) {
    return !!(f.cat || f.year || f.q);
  }

  function hashFor(id, anchor) {
    return "#/~aaronson" + (id ? "/p/" + enc(id) : "") + (anchor ? "#" + enc(anchor) : "");
  }
  function hashForIndex(f) {
    f = cleanFilters(f);
    return "#/~aaronson" + (f.cat ? "/cat/" + f.cat : "") + (f.year ? "/year/" + f.year : "") + (f.q ? "/q/" + enc(f.q) : "");
  }

  /* { kind: "post", id } | { kind: "index", cat, year, q } | null */
  function parseUrl(href) {
    let u;
    try {
      u = new URL(String(href), ORIGIN + "/");
    } catch (e) {
      return null;
    }
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.toLowerCase();
    if (!HOST_RE.test(host)) return null;
    const path = u.pathname.replace(/\/+$/, "");
    if (/\.com$/.test(host)) {
      if (!/^\/blog(\/index\.php)?$/.test(path)) return null; /* the rest of scottaaronson.com is not the blog */
    } else if (path !== "" && path !== "/index.php") {
      return null;
    }
    const q = u.searchParams;
    const p = q.get("p");
    if (p) return /^\d+$/.test(p) ? { kind: "post", id: p } : null;
    const known = ["cat", "s", "m"];
    let any = false;
    q.forEach(function (v, k) {
      if (known.indexOf(k) === -1) any = true;
    });
    if (any) return null; /* ?page_id=, ?feed= … are not posts */
    const m = (q.get("m") || "").match(/^(\d{4})/);
    return Object.assign({ kind: "index" }, cleanFilters({ cat: q.get("cat"), year: m ? m[1] : "", q: q.get("s") }));
  }

  function fragOf(url, anchor) {
    if (anchor) return anchor;
    const s = String(url);
    const at = s.indexOf("#");
    return at === -1 ? "" : safeDecode(s.slice(at + 1));
  }

  /* The reader route for a blog address, or "" */
  function hashForUrl(url, anchor) {
    const info = parseUrl(url);
    if (!info) return "";
    if (info.kind === "post") return hashFor(info.id, fragOf(url, anchor));
    return hashForIndex(info);
  }

  /* The app's route object for an address (info from parseUrl) or for the parts after
     "#/~aaronson/" in a reader hash. */
  function routeFor(info, anchor) {
    if (info.kind === "post") return { view: "aaronson", id: info.id, cat: "", year: "", q: "", anchor: anchor || "" };
    const f = cleanFilters(info);
    return { view: "aaronson", id: "", cat: f.cat, year: f.year, q: f.q, anchor: anchor || "" };
  }
  function routeFromParts(parts, anchor) {
    if (parts[0] === "p") {
      return /^\d+$/.test(parts[1] || "")
        ? routeFor({ kind: "post", id: parts[1] }, anchor)
        : routeFor({ kind: "index" }, "");
    }
    const f = {};
    for (let i = 0; i + 1 < parts.length; i += 2) {
      if (parts[i] === "cat" || parts[i] === "year" || parts[i] === "q") f[parts[i]] = parts[i + 1];
    }
    return routeFor(Object.assign({ kind: "index" }, f), anchor);
  }
  function routeForUrl(url, anchor) {
    const info = parseUrl(url);
    return info ? routeFor(info, info.kind === "post" ? fragOf(url, anchor) : "") : null;
  }

  /* ---- Fetching ------------------------------------------------------------------- */

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
  function parseJson(bytes) {
    try {
      const v = JSON.parse(new TextDecoder("utf-8").decode(bytes));
      return v && typeof v === "object" ? v : null;
    } catch (e) {
      return null;
    }
  }
  function fail(message, status, code) {
    const err = new Error(message);
    if (status) err.status = status;
    if (code) err.code = code;
    return err;
  }
  function num(v) {
    const n = parseInt(v, 10);
    return n >= 0 ? n : null;
  }
  /* WordPress REST errors: { code: "rest_post_invalid_id", message, data: { status: 404 } } */
  function wpError(v) {
    return v && !Array.isArray(v) && typeof v.code === "string" && /^rest_|^invalid_|^rest-/.test(v.code) && v.data && v.data.status
      ? v : null;
  }
  function finalError(v) {
    const status = v.data.status;
    return Object.assign(
      fail(status === 404 ? "That post isn\u2019t on " + NAME + "." : "Shtetl-Optimized answered: " + (v.message || v.code), status, v.code),
      { final: true }
    );
  }

  async function timed(url) {
    const ctrl = global.AbortController ? new AbortController() : null;
    const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : 0;
    try {
      return await global.fetch(url, Object.assign({ credentials: "omit" }, ctrl ? { signal: ctrl.signal } : {}));
    } finally {
      clearTimeout(timer);
    }
  }

  /* The website: the API answers this page's origin directly. */
  async function viaDirect(url) {
    const res = await timed(url);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const v = parseJson(bytes);
    const err = wpError(v);
    if (err) throw finalError(err);
    if (!res.ok || !v) throw fail("the blog answered " + res.status, res.status);
    return { bytes: bytes, total: num(res.headers.get("x-wp-total")), pages: num(res.headers.get("x-wp-totalpages")) };
  }

  async function viaRelays(url) {
    let first = "";
    try {
      first = localStorage.getItem(PROXY_KEY) || "";
    } catch (e) { /* ignore */ }
    const order = RELAYS.slice().sort(function (a, b) { return (b.id === first) - (a.id === first); });
    for (let i = 0; i < order.length; i++) {
      const relay = order[i];
      try {
        const res = await timed(relay.url(url));
        if (!res.ok) continue;
        let bytes;
        if (relay.json) {
          const j = await res.json();
          if (!j || typeof j.contents !== "string") continue;
          bytes = new TextEncoder().encode(j.contents);
        } else {
          bytes = new Uint8Array(await res.arrayBuffer());
        }
        const v = parseJson(bytes);
        if (!v) continue; /* a relay's or a firewall's page, not the API */
        const err = wpError(v);
        if (err) throw finalError(err);
        try {
          localStorage.setItem(PROXY_KEY, relay.id);
        } catch (e) { /* ignore */ }
        return { bytes: bytes, total: null, pages: null }; /* relays hide the X-WP-* headers */
      } catch (e) {
        if (e && e.final) throw e;
        /* next relay */
      }
    }
    throw fail(
      "Couldn\u2019t reach scottaaronson.blog. The Reader asks it directly, then through public relays, and nothing " +
        "answered just now (the blog may be limiting requests). Try again in a minute."
    );
  }

  function headerOf(headers, name) {
    if (!headers) return null;
    const keys = Object.keys(headers);
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === name) return headers[keys[i]];
    }
    return null;
  }

  /* The app: CapacitorHttp reads it with no CORS at all. */
  async function viaNative(url) {
    const http = httpPlugin();
    if (http && http.request) {
      try {
        const r = await http.request({
          url: url, method: "GET", responseType: "arraybuffer", connectTimeout: TIMEOUT_MS, readTimeout: TIMEOUT_MS,
          headers: { Accept: "application/json" }
        });
        const got = typeof r.data === "string" ? base64Bytes(r.data)
          : r.data && r.data.byteLength !== undefined ? new Uint8Array(r.data)
            : r.data && typeof r.data === "object" ? new TextEncoder().encode(JSON.stringify(r.data)) : null;
        const v = got ? parseJson(got) : null;
        const err = wpError(v);
        if (err) throw finalError(err);
        if (r.status >= 400 || !v) throw fail(r.status === 429 ? "Shtetl-Optimized is limiting requests right now. Try again in a minute." : "scottaaronson.blog answered " + r.status + ".", r.status);
        return { bytes: got, total: num(headerOf(r.headers, "x-wp-total")), pages: num(headerOf(r.headers, "x-wp-totalpages")) };
      } catch (e) {
        if (e && (e.final || e.status)) throw e;
        /* fall back to the patched fetch */
      }
    }
    try {
      return await viaDirect(url);
    } catch (e) {
      if (e && e.final) throw e;
      throw fail("Couldn\u2019t reach scottaaronson.blog (no connection?).", e && e.status);
    }
  }

  async function fromNetwork(url) {
    if (inApp()) return viaNative(url);
    try {
      return await viaDirect(url);
    } catch (e) {
      if (e && e.final) throw e;
    }
    return viaRelays(url);
  }

  async function openCache() {
    try {
      return global.caches ? await global.caches.open(CACHE) : null;
    } catch (e) {
      return null;
    }
  }

  /* { data, total, pages, from: "cache" | "network" | "stale" } of a REST path such as
     "/wp/v2/posts&per_page=20" (everything after rest_route=). */
  async function getJson(path, options) {
    options = options || {};
    const url = ORIGIN + "/?rest_route=" + path;
    const cache = await openCache();
    let hit = null;
    try {
      hit = cache ? await cache.match(url) : null;
    } catch (e) {
      hit = null;
    }
    const at = hit ? Date.parse(hit.headers.get("x-reader-cached") || "") || 0 : 0;
    function fromHit(from) {
      return hit.arrayBuffer().then(function (buf) {
        return {
          data: parseJson(new Uint8Array(buf)), from: from,
          total: num(hit.headers.get("x-reader-total")), pages: num(hit.headers.get("x-reader-pages"))
        };
      });
    }
    if (hit && !options.fresh && Date.now() - at < (options.freshMs || LIST_FRESH_MS)) return fromHit("cache");
    try {
      const r = await fromNetwork(url);
      if (cache) {
        const headers = { "content-type": "application/json", "x-reader-cached": new Date().toISOString() };
        if (r.total !== null) headers["x-reader-total"] = String(r.total);
        if (r.pages !== null) headers["x-reader-pages"] = String(r.pages);
        cache.put(url, new Response(r.bytes, { headers: headers })).catch(function () { /* quota */ });
      }
      return { data: parseJson(r.bytes), total: r.total, pages: r.pages, from: "network" };
    } catch (e) {
      if (hit && !(e && e.final)) return fromHit("stale");
      throw e;
    }
  }

  /* ---- Text helpers ---------------------------------------------------------------- */

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function decode(s) {
    return String(new DOMParser().parseFromString(String(s || ""), "text/html").documentElement.textContent || "").replace(/\s+/g, " ").trim();
  }
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function parts(iso) {
    const m = String(iso || "").match(/^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d))?/);
    return m ? { y: +m[1], mo: +m[2] - 1, d: +m[3], h: m[4] === undefined ? null : +m[4], mi: m[5] === undefined ? null : +m[5] } : null;
  }
  function fmtDate(iso) {
    const p = parts(iso);
    return p ? MONTHS[p.mo] + " " + p.d + ", " + p.y : "";
  }
  function fmtShort(iso) {
    const p = parts(iso);
    return p ? MONTHS[p.mo].slice(0, 3) + " " + p.d + ", " + p.y : "";
  }
  /* Comment dates are the blog's own clock (no zone is given): shown as written. */
  function fmtStamp(iso) {
    const p = parts(iso);
    if (!p) return "";
    if (p.h === null) return fmtShort(iso);
    const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
    return fmtShort(iso) + ", " + h12 + ":" + (p.mi < 10 ? "0" : "") + p.mi + " " + (p.h < 12 ? "AM" : "PM");
  }
  function plain(html) {
    return decode(String(html || "").replace(/<[^>]*>/g, " ")).replace(/\s*\[\u2026\]\s*$/, "\u2026").replace(/\s*\[&hellip;\]\s*$/, "\u2026");
  }
  function fold(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  /* ---- Categories ------------------------------------------------------------------ */

  let catsPromise = null;
  /* [{ id, name, slug, count }] sorted by name; [] when it can't be read (never throws). */
  function categories() {
    if (!catsPromise) {
      catsPromise = getJson("/wp/v2/categories&per_page=100&_fields=id,name,slug,count", { freshMs: CATS_FRESH_MS }).then(function (r) {
        const list = Array.isArray(r.data) ? r.data : [];
        return list.map(function (c) {
          return { id: String(c.id), name: decode(c.name), slug: c.slug, count: c.count || 0 };
        }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      }).catch(function () {
        catsPromise = null;
        return [];
      });
    }
    return catsPromise;
  }
  function catName(cats, id) {
    for (let i = 0; i < cats.length; i++) if (cats[i].id === String(id)) return cats[i].name;
    return "";
  }

  /* ---- Posts ------------------------------------------------------------------------ */

  const POST_FIELDS = "id,date,title,content,categories,comment_status";

  function normalizePost(p) {
    return {
      id: String(p.id),
      title: decode(p.title && p.title.rendered) || "Untitled",
      date: p.date || "",
      url: postUrl(p.id),
      html: (p.content && p.content.rendered) || "",
      cats: (p.categories || []).map(String),
      commentsClosed: p.comment_status === "closed"
    };
  }
  function summary(p) {
    return {
      id: String(p.id),
      title: decode(p.title && p.title.rendered) || "Untitled",
      date: p.date || "",
      excerpt: plain(p.excerpt && p.excerpt.rendered),
      cats: (p.categories || []).map(String)
    };
  }

  const posts = new Map();
  async function post(id, options) {
    id = String(id);
    if (posts.has(id) && !(options && options.fresh)) return posts.get(id);
    const r = await getJson("/wp/v2/posts/" + enc(id) + "&_fields=" + POST_FIELDS, Object.assign({ freshMs: POST_FRESH_MS }, options || {}));
    if (!r.data || r.data.id === undefined) throw fail("That post isn\u2019t on " + NAME + ".", 404);
    const out = { post: normalizePost(r.data), from: r.from };
    posts.set(id, out);
    return out;
  }

  /* The post just newer and just older than this one: { newer, older } (each a summary or
     null; never throws). */
  const neighborCache = new Map();
  function neighbors(p) {
    if (!neighborCache.has(p.id)) {
      const f = "&per_page=1&_fields=id,date,title,excerpt,categories";
      const one = function (q) {
        return getJson("/wp/v2/posts" + f + q, { freshMs: POST_FRESH_MS }).then(function (r) {
          return Array.isArray(r.data) && r.data[0] ? summary(r.data[0]) : null;
        }).catch(function () { return null; });
      };
      neighborCache.set(p.id, Promise.all([
        one("&after=" + enc(p.date) + "&order=asc"),
        one("&before=" + enc(p.date))
      ]).then(function (v) { return { newer: v[0], older: v[1] }; }));
    }
    return neighborCache.get(p.id);
  }

  /* ---- Post body -------------------------------------------------------------------- */

  function youtubeId(src) {
    const m = String(src || "").match(/^https?:\/\/(?:www\.)?(?:youtube(?:-nocookie)?\.com\/embed|youtu\.be)\/([\w-]{6,})/i);
    return m ? m[1] : "";
  }
  function card(doc, kind, html) {
    const el = doc.createElement("aside");
    el.className = "sa-card sa-card-" + kind;
    el.innerHTML = html;
    return el;
  }
  function linkHtml(href, text) {
    return '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(text) + "</a>";
  }

  /* The post's own markup, tidied: embedded players become link cards (no third-party
     frames or scripts), share widgets go. `doc` is an inert document. */
  function cleanBody(html, doc) {
    const body = doc.createElement("div");
    body.className = "sa-body";
    body.innerHTML = html;
    body.querySelectorAll("script, style, noscript, form, .sharedaddy, .jp-relatedposts, .jetpack-likes-widget-wrapper, .wpcnt").forEach(function (el) {
      el.remove();
    });
    body.querySelectorAll("iframe").forEach(function (frame) {
      const src = frame.getAttribute("src") || "";
      const yt = youtubeId(src);
      let host = "";
      try {
        host = new URL(src, ORIGIN).hostname.replace(/^www\./, "");
      } catch (e) { /* none */ }
      const box = frame.closest("figure.wp-block-embed, .wp-block-embed, .embed-youtube") || frame;
      let repl;
      if (yt) {
        const url = "https://www.youtube.com/watch?v=" + yt;
        repl = card(doc, "video",
          '<a class="sa-card-thumb" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer"><img src="https://i.ytimg.com/vi/' + esc(yt) +
          '/hqdefault.jpg" alt="" loading="lazy"><span class="sa-card-play" aria-hidden="true">\u25b6</span></a>' +
          '<p class="sa-card-line"><span class="sa-card-kind">Video</span> ' + linkHtml(url, "Watch on YouTube") + "</p>");
      } else if (/^https?:/i.test(src)) {
        repl = card(doc, "embed", '<p class="sa-card-line"><span class="sa-card-kind">Embedded</span> ' + linkHtml(src, host || src) + "</p>");
      }
      if (repl) box.replaceWith(repl);
      else box.remove();
    });
    body.querySelectorAll("figure.wp-block-embed").forEach(function (fig) {
      if (!fig.textContent.trim() && !fig.querySelector("img, a, blockquote")) fig.remove();
    });
    return body;
  }

  function postDocument(p) {
    const doc = document.implementation.createHTMLDocument(p.title);
    const art = doc.createElement("article");
    /* no-math: KaTeX auto-render leaves the post alone ("$5" is money here). */
    art.className = "sa-article no-math";
    const head = doc.createElement("header");
    head.className = "sa-head";
    head.innerHTML = '<h1></h1><p class="sa-meta"></p>';
    head.querySelector("h1").textContent = p.title;
    art.appendChild(head);
    art.appendChild(cleanBody(p.html, doc));
    doc.body.appendChild(art);
    return doc;
  }

  /* The byline under the title: date, then the categories as links to the index. Built
     after the document is cleaned (the reader would take "#/…" links for in-page ones). */
  function fillMeta(wrap, p, cats) {
    const meta = wrap.querySelector(".sa-meta");
    if (!meta) return;
    meta.textContent = "";
    const time = document.createElement("time");
    time.setAttribute("datetime", p.date);
    time.textContent = fmtDate(p.date);
    meta.appendChild(time);
    const named = p.cats.map(function (id) { return { id: id, name: catName(cats, id) }; }).filter(function (c) { return c.name; });
    named.forEach(function (c, i) {
      meta.appendChild(document.createTextNode(i === 0 ? " \u00b7 " : ", "));
      const a = document.createElement("a");
      a.className = "sa-cat";
      a.href = hashForIndex({ cat: c.id });
      a.textContent = c.name;
      meta.appendChild(a);
    });
    const src = document.createElement("p");
    src.className = "sa-source";
    src.innerHTML = 'From <a href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer">' + NAME + "</a> (scottaaronson.blog).";
    meta.after(src);
  }

  function ctxFor(p) {
    return { owner: "", repo: "", branch: "", path: p.url, web: p.url };
  }

  /* { wrap, post, from, title, url } */
  /* WordPress wraps photos in a link to the full-size file. Reader's link rewriting would turn that
     into a web-page route, so the photo viewer could not tell it from a link away. Remember the real
     file address before finalize, put it back after (the viewer then opens the big picture). */
  const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)(\?|#|$)/i;
  function markImageLinks(wrap) {
    wrap.querySelectorAll("a[href] img").forEach(function (img) {
      const a = img.closest("a[href]");
      if (!a || a.dataset.saImg) return;
      let abs = "";
      try {
        abs = new URL(a.getAttribute("href"), ORIGIN + "/").href;
      } catch (e) { return; }
      if (IMAGE_FILE.test(abs)) a.dataset.saImg = abs;
    });
  }
  function restoreImageLinks(wrap) {
    wrap.querySelectorAll("a[data-sa-img]").forEach(function (a) {
      a.setAttribute("href", a.dataset.saImg);
      a.removeAttribute("data-sa-img");
      a.classList.add("image-link");
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    });
  }

  async function render(id) {
    const r = await post(id);
    const p = r.post;
    const cats = await Promise.race([categories(), new Promise(function (res) { setTimeout(res, 2500, []); })]);
    const doc = postDocument(p);
    const wrap = global.ReaderHTML.clean(doc, doc.querySelector(".sa-article"));
    markImageLinks(wrap);
    global.ReaderDoc.finalize(wrap, ctxFor(p), { keepCodeMarkup: true });
    restoreImageLinks(wrap);
    await global.ReaderHTML.inlineSvgImages(wrap);
    fillMeta(wrap, p, cats);
    wrap.setAttribute("data-doc-title", p.title);
    return { wrap: wrap, post: p, from: r.from, title: p.title, url: p.url };
  }

  /* ---- Comments --------------------------------------------------------------------- */

  const stores = new Map();
  function storeFor(id) {
    id = String(id);
    let s = stores.get(id);
    if (!s) {
      s = { id: id, items: [], seen: new Set(), total: null, nextPage: 1, done: false, loading: null, error: "" };
      stores.set(id, s);
      if (stores.size > 12) stores.delete(stores.keys().next().value);
    }
    return s;
  }

  async function loadCommentPage(s, options) {
    const path = "/wp/v2/comments&post=" + enc(s.id) + "&per_page=" + COMMENT_PAGE + "&page=" + s.nextPage +
      "&order=asc&orderby=date_gmt&_fields=id,parent,author_name,date,content";
    let r;
    try {
      r = await getJson(path, Object.assign({ freshMs: LIST_FRESH_MS }, options || {}));
    } catch (e) {
      if (e && e.code === "rest_post_invalid_page_number") {
        s.done = true; /* past the last page */
        return;
      }
      throw e;
    }
    if (!Array.isArray(r.data)) throw fail("scottaaronson.blog didn\u2019t answer with comments.", 502);
    r.data.forEach(function (c) {
      if (!c || c.id === undefined || s.seen.has(c.id)) return;
      s.seen.add(c.id);
      s.items.push(c);
    });
    if (r.total !== null) s.total = r.total;
    s.nextPage += 1;
    s.done = r.pages !== null ? s.nextPage > r.pages : r.data.length < COMMENT_PAGE;
  }

  /* Loads the next page (or every remaining page with options.all). Never throws: a
     failure lands in s.error and the pages read so far stay. */
  function loadComments(s, options) {
    options = options || {};
    if (s.loading) return s.loading;
    if (s.done) return Promise.resolve(s);
    s.loading = (async function () {
      try {
        do {
          await loadCommentPage(s, options);
          if (options.onProgress) options.onProgress(s);
        } while (options.all && !s.done);
        s.error = "";
      } catch (e) {
        s.error = (e && e.message) || "Couldn\u2019t load the comments.";
      }
      s.loading = null;
      return s;
    })();
    return s.loading;
  }

  function countOf(s) {
    return s.total !== null ? s.total : s.done ? s.items.length : null;
  }

  /* The comments as a threaded <ol>, sanitised like the post. */
  function buildThread(items, p) {
    const doc = document.implementation.createHTMLDocument("");
    const root = doc.createElement("div");
    const byId = new Map();
    items.forEach(function (c) { byId.set(c.id, { c: c, kids: [] }); });
    const roots = [];
    items.forEach(function (c) {
      const n = byId.get(c.id);
      const parent = c.parent && c.parent !== c.id ? byId.get(c.parent) : null;
      (parent || { kids: roots }).kids.push(n);
    });
    const byDate = function (a, b) { return a.c.date < b.c.date ? -1 : a.c.date > b.c.date ? 1 : a.c.id - b.c.id; };
    const out = doc.createElement("ol");
    out.className = "sa-thread";
    const seen = new Set();
    function li(n, depth) {
      seen.add(n.c.id);
      const el = doc.createElement("li");
      el.className = "sa-comment";
      el.id = "comment-" + n.c.id;
      el.setAttribute("data-depth", String(Math.min(depth, 6)));
      el.innerHTML = '<div class="sa-c-head"><span class="sa-c-author"></span> <time class="sa-c-date"></time></div><div class="sa-c-body"></div>';
      el.querySelector(".sa-c-author").textContent = decode(n.c.author_name) || "Anonymous";
      const t = el.querySelector(".sa-c-date");
      t.setAttribute("datetime", n.c.date || "");
      t.textContent = fmtStamp(n.c.date);
      const body = el.querySelector(".sa-c-body");
      body.innerHTML = (n.c.content && n.c.content.rendered) || "";
      body.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach(function (h) {
        const s = doc.createElement("strong");
        s.innerHTML = h.innerHTML;
        h.replaceWith(s);
      });
      if (n.kids.length) {
        const ol = doc.createElement("ol");
        ol.className = "sa-replies";
        n.kids.sort(byDate).forEach(function (k) { if (!seen.has(k.c.id)) ol.appendChild(li(k, depth + 1)); });
        el.appendChild(ol);
      }
      return el;
    }
    roots.sort(byDate).forEach(function (n) { if (!seen.has(n.c.id)) out.appendChild(li(n, 0)); });
    root.appendChild(out);
    const wrap = global.ReaderHTML.clean(doc, root, { autoMath: false });
    markImageLinks(wrap);
    global.ReaderDoc.finalize(wrap, ctxFor(p), { keepCodeMarkup: true });
    restoreImageLinks(wrap);
    return wrap;
  }

  /* The comments block under a post: { el, expand(), collapse(), isOpen(), ready } .
     Everything is folded away until the button is pressed. */
  function commentsSection(p) {
    const s = storeFor(p.id);
    const uid = "sa-comments-" + p.id;
    const el = document.createElement("section");
    el.className = "sa-comments";
    el.setAttribute("aria-labelledby", "comments");
    el.innerHTML = '<h2 id="comments" class="sa-comments-title">Comments</h2>' +
      '<div class="sa-comments-bar"><button type="button" class="sa-comments-toggle" aria-expanded="false" aria-controls="' + uid + '"></button>' +
      '<span class="sa-comments-note" role="status" aria-live="polite"></span></div>' +
      '<div class="sa-comments-panel" id="' + uid + '" role="region" aria-label="Comments" hidden></div>';
    const toggle = el.querySelector(".sa-comments-toggle");
    const note = el.querySelector(".sa-comments-note");
    const panel = el.querySelector(".sa-comments-panel");
    let open = false;
    let built = 0; /* number of comments in the thread on screen */
    let token = 0;

    function paintButton() {
      const n = countOf(s);
      const label = n === null ? (s.items.length ? s.items.length + "+" : "") : String(n);
      if (n === 0) {
        toggle.hidden = true;
        note.textContent = p.commentsClosed ? "Comments are closed." : "No comments yet.";
        return;
      }
      toggle.hidden = false;
      toggle.textContent = (open ? "Hide comments" : "Show comments") + (label ? " (" + label + ")" : "");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }

    function paintPanel() {
      panel.hidden = !open;
      if (!open) return;
      const have = s.items.length;
      if (!s.done && s.loading) {
        note.textContent = "Loading comments\u2026 " + have + (s.total ? " of " + s.total : "");
      } else if (s.error) {
        note.textContent = "Couldn\u2019t load all the comments (" + s.error + ")";
      } else {
        note.textContent = "";
      }
      if (!have && s.error && !s.loading && !panel.querySelector(".sa-comments-retry")) {
        panel.innerHTML = '<p class="sa-comments-end"><button type="button" class="sa-comments-retry">Try again</button></p>';
      }
      if (built !== have && (s.done || s.error) && have) {
        built = have;
        panel.textContent = "";
        panel.appendChild(buildThread(s.items, p));
        const end = document.createElement("p");
        end.className = "sa-comments-end";
        end.innerHTML = '<button type="button" class="sa-comments-toggle sa-comments-hide">Hide comments</button>' +
          (s.error ? ' <button type="button" class="sa-comments-retry">Try again</button>' : "");
        panel.appendChild(end);
      }
    }

    /* Every remaining page, one after another (a page already loading is waited for). */
    async function fill() {
      const mine = ++token;
      const progress = function () {
        if (mine !== token) return;
        paintButton();
        paintPanel();
      };
      do {
        await loadComments(s, { all: true, onProgress: progress });
      } while (!s.done && !s.error && mine === token);
      if (mine !== token) return;
      paintButton();
      paintPanel();
    }

    function setOpen(v) {
      open = v;
      if (v && s.error && !s.done) s.error = ""; /* pressing the button again retries */
      paintButton();
      paintPanel();
      return v && !s.done ? fill() : Promise.resolve();
    }

    toggle.addEventListener("click", function () { setOpen(!open); });
    panel.addEventListener("click", function (ev) {
      if (ev.target.closest(".sa-comments-hide")) {
        setOpen(false);
        if (el.scrollIntoView) el.scrollIntoView({ block: "start" });
      } else if (ev.target.closest(".sa-comments-retry")) {
        s.error = "";
        s.done = false;
        built = -1;
        fill();
      }
    });

    /* The first page is read at once, for the count; the rest only when the button is
       pressed (or straight away when the count is unknown, which is when a relay answered). */
    paintButton();
    const ready = loadComments(s).then(function () {
      paintButton();
      if (s.error && !s.items.length) {
        toggle.hidden = false;
        note.textContent = "Couldn\u2019t load the comments. Press the button to try again.";
        return null;
      }
      if (!s.done && s.total === null && !open) return fill();
      return null;
    });

    return {
      el: el,
      ready: ready,
      isOpen: function () { return open; },
      expand: function () { return open ? Promise.resolve() : setOpen(true); },
      collapse: function () { return setOpen(false); },
      /* Every comment is loaded and built (for a #comment-<id> link). */
      whenBuilt: async function () {
        await setOpen(true);
        await (s.loading || Promise.resolve());
      }
    };
  }

  /* ---- The index -------------------------------------------------------------------- */

  const archives = new Map();
  function archiveKey(f) {
    return [f.cat, f.year, f.q].join("|");
  }

  function archivePath(arc) {
    const f = arc.filters;
    let q = "/wp/v2/posts&per_page=" + PAGE + "&page=" + (arc.page + 1) + "&_fields=id,date,title,excerpt,categories";
    if (f.cat) q += "&categories=" + enc(f.cat);
    if (f.year) q += "&after=" + f.year + "-01-01T00:00:00&before=" + (+f.year + 1) + "-01-01T00:00:00";
    if (f.q) q += "&search=" + enc(f.q);
    return q;
  }

  async function loadArchivePage(arc, options) {
    let r;
    try {
      r = await getJson(archivePath(arc), Object.assign({ freshMs: LIST_FRESH_MS }, options || {}));
    } catch (e) {
      if (e && e.code === "rest_post_invalid_page_number") {
        arc.done = true;
        return;
      }
      throw e;
    }
    if (!Array.isArray(r.data)) throw fail("scottaaronson.blog didn\u2019t answer with a list of posts.", 502);
    r.data.forEach(function (p) {
      if (!p || p.id === undefined || arc.seen.has(String(p.id))) return;
      arc.seen.add(String(p.id));
      arc.items.push(summary(p));
    });
    arc.page += 1;
    if (r.total !== null) arc.total = r.total;
    arc.done = r.pages !== null ? arc.page >= r.pages : r.data.length < PAGE;
    arc.from = r.from;
  }

  /* The posts loaded so far for these filters (the first page on first use); options.more
     loads the next page. Never throws: failures land in arc.error. */
  function archive(filters, options) {
    const f = cleanFilters(filters);
    const k = archiveKey(f);
    let arc = archives.get(k);
    if (!arc) {
      arc = { filters: f, items: [], seen: new Set(), page: 0, total: null, done: false, error: "", loading: null, from: "" };
      archives.set(k, arc);
      if (archives.size > 30) archives.delete(archives.keys().next().value);
    }
    const more = options && options.more;
    if (arc.loading) return arc.loading;
    if (arc.items.length && !more) return Promise.resolve(arc);
    if (arc.done && more) return Promise.resolve(arc);
    arc.loading = loadArchivePage(arc, options).then(function () {
      arc.error = "";
      return arc;
    }, function (e) {
      arc.error = (e && e.message) || "Couldn\u2019t load the posts.";
      return arc;
    }).then(function (a) {
      arc.loading = null;
      return a;
    });
    return arc.loading;
  }
  function archiveFor(filters) {
    return archives.get(archiveKey(cleanFilters(filters))) || null;
  }

  function itemHtml(i, cats) {
    const names = i.cats.map(function (id) { return catName(cats, id); }).filter(Boolean);
    const meta = [fmtDate(i.date)].concat(names.slice(0, 3)).filter(Boolean).join(" \u00b7 ");
    return '<li data-sa-id="' + esc(i.id) + '"><a href="' + esc(hashFor(i.id)) + '"><span class="sa-item-title">' + esc(i.title) + "</span>" +
      '<span class="sa-item-meta">' + esc(meta) + "</span>" +
      (i.excerpt ? '<span class="sa-item-excerpt">' + esc(i.excerpt.length > 240 ? i.excerpt.slice(0, 237).replace(/\s+\S*$/, "") + "\u2026" : i.excerpt) + "</span>" : "") +
      "</a></li>";
  }

  /* The index page (in the article area). hooks.onFilters(filters, arc) runs when the
     filters change (the app puts them in the address); hooks.onMore(arc) after more posts
     load (to refresh the sidebar). */
  function indexView(arc0, cats, hooks) {
    hooks = hooks || {};
    let arc = arc0;
    const wrap = document.createElement("div");
    wrap.className = "markdown-body doc-html doc-aaronson sa-index";
    const thisYear = new Date().getFullYear();
    let years = '<option value="">Any year</option>';
    for (let y = thisYear; y >= FIRST_YEAR; y--) years += '<option value="' + y + '">' + y + "</option>";
    wrap.innerHTML = [
      '<header class="sa-index-head"><h1></h1>',
      '<p class="sa-intro">Scott Aaronson\u2019s blog, newest posts first, read from <a href="' + esc(blogUrl()) +
        '" target="_blank" rel="noopener noreferrer">scottaaronson.blog</a> and shown in the reader\u2019s style, with the comments folded away until you ask for them.</p>',
      '<p class="sa-note" hidden></p></header>',
      '<form class="sa-controls" role="search" action="#" method="get">',
      '<input type="search" class="rp-filter-input sa-search" placeholder="Search all posts" aria-label="Search all posts" enterkeyhint="search" autocomplete="off" spellcheck="false">',
      '<div class="sa-selects"><select class="sa-cat-select" aria-label="Category"><option value="">All categories</option></select>',
      '<select class="sa-year-select" aria-label="Year">' + years + "</select>",
      '<button type="button" class="sa-clear" hidden>Clear filters</button></div></form>',
      '<p class="sa-count" aria-live="polite"></p>',
      '<ol class="sa-list"></ol>',
      '<p class="sa-none" hidden>No post matches.</p>',
      '<p class="sa-more-wrap"><button type="button" class="sa-more">Load more posts</button><span class="sa-more-note"></span></p>'
    ].join("");
    wrap.querySelector("h1").textContent = NAME;
    const input = wrap.querySelector(".sa-search");
    const catSel = wrap.querySelector(".sa-cat-select");
    const yearSel = wrap.querySelector(".sa-year-select");
    const clear = wrap.querySelector(".sa-clear");
    const list = wrap.querySelector(".sa-list");
    const more = wrap.querySelector(".sa-more");
    const moreNote = wrap.querySelector(".sa-more-note");
    const count = wrap.querySelector(".sa-count");
    const none = wrap.querySelector(".sa-none");
    const note = wrap.querySelector(".sa-note");

    cats.filter(function (c) { return c.count > 0; }).forEach(function (c) {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.name + " (" + c.count + ")";
      catSel.appendChild(o);
    });
    function syncControls() {
      const f = arc.filters;
      if (f.cat && !catSel.querySelector('option[value="' + f.cat + '"]')) {
        const o = document.createElement("option");
        o.value = f.cat;
        o.textContent = catName(cats, f.cat) || "Category " + f.cat;
        catSel.appendChild(o);
      }
      catSel.value = f.cat;
      yearSel.value = f.year;
      if (document.activeElement !== input) input.value = f.q;
      clear.hidden = !isFiltered(f);
    }

    let shown = 0;
    function paint(reset) {
      if (reset) {
        list.textContent = "";
        shown = 0;
      }
      list.insertAdjacentHTML("beforeend", arc.items.slice(shown).map(function (i) { return itemHtml(i, cats); }).join(""));
      shown = arc.items.length;
      more.hidden = arc.done || !arc.items.length;
      none.hidden = !!arc.items.length || !!arc.loading || !!arc.error;
      note.hidden = !(arc.error && !arc.items.length);
      note.textContent = arc.error && !arc.items.length ? arc.error : "";
      moreNote.textContent = arc.error && arc.items.length ? " " + arc.error : arc.done && arc.items.length ? "That\u2019s every post." : "";
      const noun = isFiltered(arc.filters) ? "matching post" : "post";
      count.textContent = arc.items.length
        ? (arc.total !== null ? "Showing " + arc.items.length + " of " + arc.total.toLocaleString("en-US") + " " + noun + (arc.total === 1 ? "" : "s")
          : arc.items.length + " " + noun + (arc.items.length === 1 ? "" : "s") + (arc.done ? "" : " so far"))
        : "";
      syncControls();
    }

    let seq = 0;
    async function apply(filters) {
      const mine = ++seq;
      const f = cleanFilters(filters);
      const existing = archiveFor(f);
      if (!existing || !existing.items.length) {
        list.textContent = "";
        shown = 0;
        count.textContent = "Loading\u2026";
        more.hidden = true;
        none.hidden = true;
      }
      const a = await archive(f);
      if (mine !== seq) return;
      arc = a;
      paint(true);
      if (hooks.onFilters) hooks.onFilters(f, a);
    }
    function current() {
      return { cat: catSel.value, year: yearSel.value, q: input.value };
    }
    catSel.addEventListener("change", function () { apply(current()); });
    yearSel.addEventListener("change", function () { apply(current()); });
    let timer = 0;
    input.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () { apply(current()); }, 450);
    });
    wrap.querySelector(".sa-controls").addEventListener("submit", function (ev) {
      ev.preventDefault();
      clearTimeout(timer);
      apply(current());
    });
    clear.addEventListener("click", function () {
      input.value = "";
      apply({});
    });
    more.addEventListener("click", async function () {
      more.disabled = true;
      more.textContent = "Loading\u2026";
      const a = arc;
      await archive(a.filters, { more: true });
      more.disabled = false;
      more.textContent = "Load more posts";
      if (a !== arc) return;
      paint(false);
      if (hooks.onMore) hooks.onMore(a);
    });
    paint(true);
    return wrap;
  }

  /* ---- Sidebar / drawer -------------------------------------------------------------- */

  /* The latest posts loaded so far (the pager follows the list), with the open post's
     contents under it. A post that isn't among them is listed between its neighbours. */
  function sidebarHtml(arc, current, outline, nb) {
    const items = (arc && arc.items) || [];
    const parts = ['<li class="rp-side-filter"><input type="search" placeholder="Filter posts" aria-label="Filter posts" autocomplete="off" spellcheck="false"></li>'];
    if (current) parts.push('<li class="dir-up"><a href="' + esc(hashForIndex({})) + '">\u2190 All posts</a></li>');
    const id = current ? current.id : "";
    function row(i, on, prefix) {
      parts.push('<li class="file-item is-root" data-sa-id="' + esc(i.id) + '"><a class="file-link' + (on ? " active" : "") + '" href="' + esc(hashFor(i.id)) + '"' +
        (on ? ' aria-current="page"' : "") + ">" + esc((prefix || "") + i.title) + "</a></li>");
      if (on && outline && outline.length) {
        const min = Math.min.apply(null, outline.map(function (o) { return o.level; }));
        const top = outline.filter(function (x) { return x.level === min; }).length === 1;
        outline.forEach(function (o) {
          if (o.level === min && top) return; /* the title */
          parts.push('<li class="toc-item rp-side-toc" style="--depth:' + (o.level - min + (top ? 0 : 1)) + '"><a class="file-link" href="' +
            esc(hashFor(i.id, o.id)) + '">' + esc(o.text) + "</a></li>");
        });
      }
    }
    const listed = items.some(function (i) { return i.id === id; });
    if (current && !listed) {
      parts.push('<li class="rp-side-section">This post</li>');
      if (nb && nb.newer) row(nb.newer, false, "Newer: ");
      row(current, true);
      if (nb && nb.older) row(nb.older, false, "Older: ");
      if (items.length) parts.push('<li class="rp-side-section">Latest posts</li>');
    } else if (items.length) {
      parts.push('<li class="rp-side-section">Latest posts</li>');
    }
    items.forEach(function (i) { row(i, i.id === id); });
    if (arc && !arc.done && items.length) {
      parts.push('<li class="dir-up sa-side-all"><a href="' + esc(hashForIndex({})) + '">More in the index\u2026</a></li>');
    }
    return parts.join("");
  }
  function wireSidebar(list) {
    const input = list.querySelector(".rp-side-filter input");
    if (!input) return;
    input.addEventListener("input", function () {
      const words = fold(input.value).split(/\s+/).filter(Boolean);
      list.querySelectorAll("li[data-sa-id]").forEach(function (li) {
        li.hidden = !!words.length && !words.every(function (w) { return fold(li.textContent).indexOf(w) !== -1; });
      });
      list.querySelectorAll(".rp-side-toc, .rp-side-section").forEach(function (li) { li.hidden = !!words.length; });
    });
  }

  global.ReaderAaronson = {
    name: NAME,
    blogUrl: blogUrl,
    postUrl: postUrl,
    parseUrl: parseUrl,
    hashFor: hashFor,
    hashForIndex: hashForIndex,
    hashForUrl: hashForUrl,
    routeFromParts: routeFromParts,
    routeForUrl: routeForUrl,
    cleanFilters: cleanFilters,
    post: post,
    render: render,
    neighbors: neighbors,
    categories: categories,
    commentsSection: commentsSection,
    archive: archive,
    archiveFor: archiveFor,
    indexView: indexView,
    sidebarHtml: sidebarHtml,
    wireSidebar: wireSidebar,
    _buildThread: buildThread
  };
})(window);
