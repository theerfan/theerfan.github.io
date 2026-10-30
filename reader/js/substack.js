/* Substack posts and publications, read in the reader.

   Routes:
     #/~substack/<host>                  a publication: its archive (newest first, filter,
                                         "Load more")
     #/~substack/<host>/p/<slug>[#anchor] one post
     #/~substack/~id/<post id>[#anchor]   a post known only by id (substack.com/@user/p-123,
                                         substack.com/home/post/p-123, <host>/i/123/…); looked
                                         up and replaced by its canonical route
   Substack addresses pasted in the jump bar or linked from any page open here
   (ReaderWeb.hashFor and doc.js ask hashForUrl). Publications on their own domain are
   recognised once seen (a post's canonical address, an embedded post), or by asking
   the address for Substack's API (detect / fromHtml).

   Content comes from Substack's public JSON API (/api/v1/posts/<slug>,
   /api/v1/archive), not the page: the post's own markup, cleaned up here (subscribe
   buttons, share widgets and app ads dropped; images, galleries, footnotes, LaTeX,
   code, pull quotes kept; tweets, videos and embedded posts as plain link cards; no
   third-party scripts or iframes). Paid posts show the free preview Substack gives
   everyone and a link to continue on Substack; nothing here gets around a paywall.

   Fetching: Substack doesn't let other sites read its API (no CORS), so
   - in the Android app it is fetched natively (CapacitorHttp);
   - on the website it goes through a public CORS relay (the last one that worked first).
   Responses are kept in this browser's / app's own cache (Cache API) for a short while
   (posts 30 min, archive pages 10 min) and used when offline. The app's download
   button saves a post (and its images) into app data (native.js sets savedSource). */
(function (global) {
  "use strict";
  const document = global.document;
  const CACHE = "reader-substack-v1";
  const POST_FRESH_MS = 30 * 60 * 1000;
  const ARCHIVE_FRESH_MS = 10 * 60 * 1000;
  const TIMEOUT_MS = 20000;
  const PROXY_KEY = "reader-substack-relay";
  const HOSTS_KEY = "reader-substack-hosts";
  const NAMES_KEY = "reader-substack-names";
  const PAGE = 20;

  /* ---- Addresses -------------------------------------------------------------- */

  const SUB_RE = /^([a-z0-9-]+)\.substack\.com$/i;
  const NOT_PUBS = /^(www|open|on|support|cdn|api|email|reader|substack)$/i;

  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") || fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* ignore */ }
  }
  function knownHosts() {
    return readJson(HOSTS_KEY, []);
  }
  /* A publication on its own domain, seen in Substack's own data. */
  function rememberHost(host) {
    host = String(host || "").toLowerCase();
    if (!host || SUB_RE.test(host) || /(^|\.)substack\.com$/.test(host)) return;
    const list = knownHosts().filter(function (h) { return h !== host; });
    list.unshift(host);
    writeJson(HOSTS_KEY, list.slice(0, 300));
  }
  function rememberName(host, name) {
    if (!host || !name) return;
    const names = readJson(NAMES_KEY, {});
    if (names[host] === name) return;
    names[host] = name;
    const keys = Object.keys(names);
    if (keys.length > 300) delete names[keys[0]];
    writeJson(NAMES_KEY, names);
  }
  function nameFor(host) {
    return readJson(NAMES_KEY, {})[String(host || "").toLowerCase()] || "";
  }
  function isPubHost(host) {
    host = String(host || "").toLowerCase();
    const m = host.match(SUB_RE);
    if (m) return !NOT_PUBS.test(m[1]);
    return knownHosts().indexOf(host) !== -1;
  }

  function enc(s) {
    return encodeURIComponent(String(s));
  }
  function postUrl(host, slug) {
    return "https://" + host + "/p/" + enc(slug);
  }
  function pubUrl(host) {
    return "https://" + host + "/";
  }
  function apiPostUrl(host, slug) {
    return "https://" + host + "/api/v1/posts/" + enc(slug);
  }
  function apiArchiveUrl(host, offset, limit) {
    return "https://" + host + "/api/v1/archive?sort=new&search=&offset=" + (offset || 0) + "&limit=" + (limit || PAGE);
  }
  function apiByIdUrl(id) {
    return "https://substack.com/api/v1/posts/by-id/" + enc(id);
  }
  function hashFor(host, slug, anchor) {
    return "#/~substack/" + String(host).toLowerCase() + (slug ? "/p/" + enc(slug) : "") + (anchor ? "#" + enc(anchor) : "");
  }
  function hashForId(id, anchor) {
    return "#/~substack/~id/" + enc(id) + (anchor ? "#" + enc(anchor) : "");
  }

  function safeDecode(s) {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  }

  /* { kind: "post", host, slug } | { kind: "pub", host } | { kind: "id", id } | null */
  function parseUrl(href) {
    let u;
    try {
      u = new URL(String(href));
    } catch (e) {
      return null;
    }
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.toLowerCase();
    const path = u.pathname.replace(/\/+$/, "");
    let m;
    if (host === "substack.com" || host === "www.substack.com") {
      m = path.match(/^\/(?:@[^/]+|home\/post|inbox\/post|profile\/[^/]+)\/p-(\d+)$/) || path.match(/^\/inbox\/post\/(\d+)$/);
      return m ? { kind: "id", id: m[1] } : null;
    }
    if (host === "open.substack.com") {
      m = path.match(/^\/pub\/([a-z0-9-]+)\/p\/([^/]+)/i);
      if (m) return { kind: "post", host: m[1].toLowerCase() + ".substack.com", slug: safeDecode(m[2]) };
      m = path.match(/^\/pub\/([a-z0-9-]+)$/i);
      return m ? { kind: "pub", host: m[1].toLowerCase() + ".substack.com" } : null;
    }
    if (!isPubHost(host)) return null;
    m = path.match(/^\/p\/([^/]+)/);
    if (m) return { kind: "post", host: host, slug: safeDecode(m[1]) };
    m = path.match(/^\/i\/(\d+)(?:\/|$)/);
    if (m) return { kind: "id", id: m[1] };
    if (path === "" || path === "/archive" || path === "/home" || path === "/s") return { kind: "pub", host: host };
    return null;
  }

  function fragOf(url, anchor) {
    if (anchor) return anchor;
    const s = String(url);
    const at = s.indexOf("#");
    if (at !== -1) return safeDecode(s.slice(at + 1));
    /* <host>/i/<id>/<section-anchor> */
    const m = s.match(/\/i\/\d+\/([^/?#]+)/);
    return m ? safeDecode(m[1]) : "";
  }

  /* The reader route for a Substack address, or null. */
  function hashForUrl(url, anchor) {
    const info = parseUrl(url);
    if (!info) return null;
    const frag = fragOf(url, anchor);
    if (info.kind === "id") return hashForId(info.id, frag);
    if (info.kind === "pub") return hashFor(info.host, "");
    return hashFor(info.host, info.slug, frag);
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
  function utf8(bytes) {
    return new TextDecoder("utf-8").decode(bytes);
  }
  function parseJson(bytes) {
    try {
      const v = JSON.parse(utf8(bytes));
      return v && typeof v === "object" ? v : null;
    } catch (e) {
      return null;
    }
  }
  function fail(message, status) {
    const err = new Error(message);
    if (status) err.status = status;
    return err;
  }
  function hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return "Substack";
    }
  }
  const NOT_FOUND = function (url) { return hostOf(url) + " has no Substack post or publication at that address."; };

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
        const v = parseJson(bytes);
        if (!v) continue; /* a relay's or Cloudflare's HTML page, not the API */
        if (!Array.isArray(v) && v.error && !v.id && !v.post) { notFound = true; continue; }
        try {
          localStorage.setItem(PROXY_KEY, relay.id);
        } catch (e) { /* ignore */ }
        return bytes;
      } catch (e) {
        /* next relay */
      }
    }
    if (notFound) throw fail(NOT_FOUND(url), 404);
    throw fail(
      "Couldn't reach " + hostOf(url) + ". Substack doesn't let other web pages read it, so on the website " +
        "the Reader goes through public relays, and none answered just now. Try again in a minute, " +
        "or use the Reader app (it reads Substack directly)."
    );
  }

  async function fromNetwork(url) {
    if (!inApp()) return viaRelays(url);
    const http = httpPlugin();
    if (http && http.request) {
      try {
        const r = await http.request({
          url: url, method: "GET", responseType: "arraybuffer", connectTimeout: TIMEOUT_MS, readTimeout: TIMEOUT_MS,
          headers: { Accept: "application/json" }
        });
        if (r.status === 404) throw fail(NOT_FOUND(url), 404);
        if (r.status >= 400) throw fail(hostOf(url) + " answered " + r.status + ".", r.status);
        const got = typeof r.data === "string" ? base64Bytes(r.data)
          : r.data && r.data.byteLength !== undefined ? new Uint8Array(r.data)
            : r.data && typeof r.data === "object" ? new TextEncoder().encode(JSON.stringify(r.data)) : null;
        if (got && !parseJson(got)) throw fail(hostOf(url) + " didn\u2019t answer with Substack data.", 502);
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
      throw fail("Couldn\u2019t reach " + hostOf(url) + " (no connection?). Posts saved with the download button open offline.");
    }
    if (!res.ok) throw fail(res.status === 404 ? NOT_FOUND(url) : hostOf(url) + " answered " + res.status + ".", res.status);
    const got = new Uint8Array(await res.arrayBuffer());
    if (!parseJson(got)) throw fail(hostOf(url) + " didn\u2019t answer with Substack data.", 502);
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
    options = options || {};
    const fresh = !!options.fresh;
    const freshMs = options.freshMs || POST_FRESH_MS;
    if (api.savedSource && !fresh && !options.noSaved) {
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
    if (hit && !fresh && Date.now() - at < freshMs) return { bytes: new Uint8Array(await hit.arrayBuffer()), from: "cache" };
    try {
      const bytes = await fromNetwork(url);
      if (cache) {
        cache.put(url, new Response(bytes, {
          headers: { "content-type": "application/json", "x-reader-cached": new Date().toISOString() }
        })).catch(function () { /* quota */ });
      }
      return { bytes: bytes, from: "network" };
    } catch (e) {
      if (hit && e.status !== 404) return { bytes: new Uint8Array(await hit.arrayBuffer()), from: "stale" };
      throw e;
    }
  }

  /* ---- Posts ------------------------------------------------------------------- */

  function hostFromUrl(url, fallback) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch (e) {
      return fallback;
    }
  }

  function publicationOf(p) {
    const bylines = p.publishedBylines || [];
    for (let i = 0; i < bylines.length; i++) {
      const pus = bylines[i].publicationUsers || [];
      for (let j = 0; j < pus.length; j++) {
        const pub = pus[j].publication;
        if (pub && pub.id === p.publication_id) return pub;
      }
    }
    return null;
  }

  /* The fields the reader uses, from a post object of the API. */
  function normalize(p, host) {
    const pub = publicationOf(p);
    const url = p.canonical_url || postUrl(host, p.slug);
    const h = hostFromUrl(url, host);
    return {
      id: p.id,
      slug: p.slug,
      host: h,
      url: url,
      title: p.title || p.social_title || p.slug,
      subtitle: /^[\s.\u2026]*$/.test(p.subtitle || "") ? "" : p.subtitle,
      date: p.post_date || "",
      audience: p.audience || "everyone",
      type: p.type || "newsletter",
      authors: (p.publishedBylines || []).map(function (b) { return b.name; }).filter(Boolean),
      pubName: (pub && pub.name) || p.publication_name || nameFor(h) || "",
      cover: p.cover_image || "",
      body: p.body_html || "",
      truncated: p.truncated_body_text || "",
      wordcount: p.wordcount || 0,
      older: p.previous_post_slug || "",
      newer: p.next_post_slug || "",
      podcast: p.podcast_url || "",
      section: p.section_name || ""
    };
  }

  function isPaid(post) {
    return post.audience && post.audience !== "everyone";
  }

  const posts = new Map(); /* "host/slug" → { post, from } */

  async function post(host, slug, options) {
    host = String(host).toLowerCase();
    const key = host + "/" + slug;
    if (posts.has(key) && !(options && options.fresh)) return posts.get(key);
    const r = await fetchBytes(apiPostUrl(host, slug), Object.assign({ freshMs: POST_FRESH_MS }, options || {}));
    const raw = parseJson(r.bytes);
    const obj = raw && raw.post && !raw.slug ? raw.post : raw;
    if (!obj || !obj.slug) throw fail(NOT_FOUND(postUrl(host, slug)), 404);
    const p = normalize(obj, host);
    if (p.host !== host) rememberHost(p.host);
    else rememberHost(host);
    rememberName(p.host, p.pubName);
    const out = { post: p, from: r.from };
    posts.set(key, out);
    posts.set(p.host + "/" + p.slug, out);
    return out;
  }

  /* A post by id → its { host, slug }. */
  async function byId(id) {
    const r = await fetchBytes(apiByIdUrl(id), { freshMs: POST_FRESH_MS, noSaved: true });
    const raw = parseJson(r.bytes);
    const obj = raw && (raw.post || raw);
    if (!obj || !obj.slug) throw fail("Substack has no post with that id.", 404);
    const p = normalize(obj, hostFromUrl(obj.canonical_url || "", ""));
    if (!p.host) throw fail("Couldn\u2019t tell which publication that post belongs to.", 404);
    rememberHost(p.host);
    rememberName(p.host, p.pubName);
    if (p.body) posts.set(p.host + "/" + p.slug, { post: p, from: r.from });
    return { host: p.host, slug: p.slug };
  }

  /* ---- A publication's archive -------------------------------------------------- */

  const archives = new Map(); /* host → { host, name, items, done, error, loading } */

  function summary(p, host) {
    const n = normalize(p, host);
    return {
      slug: n.slug, title: n.title, subtitle: n.subtitle, date: n.date, audience: n.audience,
      type: n.type, authors: n.authors, host: n.host, url: n.url, wordcount: n.wordcount
    };
  }

  async function loadPage(arc, options) {
    const r = await fetchBytes(apiArchiveUrl(arc.host, arc.items.length, PAGE), Object.assign({ freshMs: ARCHIVE_FRESH_MS, noSaved: true }, options || {}));
    const list = parseJson(r.bytes);
    if (!Array.isArray(list)) throw fail(arc.host + " didn\u2019t answer with a Substack archive.", 502);
    const seen = new Set(arc.items.map(function (i) { return i.slug; }));
    list.forEach(function (p) {
      if (!p || !p.slug || seen.has(p.slug)) return;
      seen.add(p.slug);
      const s = summary(p, arc.host);
      arc.items.push(s);
      if (!arc.name) {
        const pub = publicationOf(p);
        if (pub && pub.name) arc.name = pub.name;
      }
      if (s.host !== arc.host) arc.canonicalHost = s.host;
    });
    arc.done = list.length < PAGE;
    arc.from = r.from;
    if (arc.canonicalHost) rememberHost(arc.canonicalHost);
    else rememberHost(arc.host);
    if (arc.name) rememberName(arc.canonicalHost || arc.host, arc.name);
  }

  /* The archive loaded so far (the first page on first use); options.more loads the
     next page. Never throws: failures land in arc.error. */
  function archive(host, options) {
    host = String(host).toLowerCase();
    let arc = archives.get(host);
    if (!arc) {
      arc = { host: host, name: nameFor(host), items: [], done: false, error: "", loading: null, from: "" };
      archives.set(host, arc);
    }
    const more = options && options.more;
    if (arc.loading) return arc.loading;
    if (arc.items.length && !more) return Promise.resolve(arc);
    if (arc.done && more) return Promise.resolve(arc);
    arc.loading = loadPage(arc, options).then(function () {
      arc.error = "";
      return arc;
    }, function (e) {
      arc.error = (e && e.message) || "Couldn\u2019t load the archive.";
      return arc;
    }).then(function (a) {
      arc.loading = null;
      return a;
    });
    return arc.loading;
  }

  /* ---- Recognising publications on their own domain ----------------------------- */

  /* An address on an unknown host that might be Substack's: /p/<slug> (a post) or the
     root (a publication). Asks the API; the route, or "". */
  async function detect(url) {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return "";
    }
    const host = u.hostname.toLowerCase();
    if (isPubHost(host)) return hashForUrl(url) || "";
    const path = u.pathname.replace(/\/+$/, "");
    const m = path.match(/^\/p\/([^/]+)$/);
    try {
      if (m) {
        const slug = safeDecode(m[1]);
        const r = await post(host, slug, { noSaved: true });
        return hashFor(r.post.host, r.post.slug, u.hash ? safeDecode(u.hash.slice(1)) : "");
      }
      if (path === "" || path === "/archive") {
        const arc = { host: host, name: "", items: [], done: false };
        await loadPage(arc, { noSaved: true });
        if (!arc.items.length) return "";
        archives.set(host, Object.assign(arc, { error: "", loading: null }));
        return hashFor(arc.canonicalHost || host, "");
      }
    } catch (e) {
      return "";
    }
    return "";
  }

  /* A page the app fetched itself: if it is a Substack page, its route. */
  function fromHtml(url, text) {
    const head = String(text || "").slice(0, 60000);
    if (!/substackcdn\.com/.test(head) || !/(content=["']Substack["']|substack\.com\/api|"pub":\{|window\._preloads)/i.test(head)) return "";
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return "";
    }
    const path = u.pathname.replace(/\/+$/, "");
    if (!/^\/p\/[^/]+$/.test(path) && path !== "" && path !== "/archive") return "";
    rememberHost(u.hostname);
    return hashForUrl(url) || "";
  }

  /* ---- Cleaning a post's markup -------------------------------------------------- */

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function attrs(el) {
    try {
      return JSON.parse(el.getAttribute("data-attrs") || "null") || {};
    } catch (e) {
      return {};
    }
  }
  /* Tweet text arrives HTML-escaped once more ("&amp;gt;"). */
  function unescapeText(s) {
    const t = document.createElement("textarea");
    t.innerHTML = String(s || "");
    return t.value;
  }
  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }
  function cleanUrl(href) {
    try {
      const u = new URL(href);
      ["utm_source", "utm_medium", "utm_campaign", "utm_content", "embedding_publication_id", "r", "triedRedirect", "s"].forEach(function (k) {
        u.searchParams.delete(k);
      });
      return u.href;
    } catch (e) {
      return href;
    }
  }
  /* Substack's image service: any width of the same image. */
  function cdnImage(src, width) {
    if (!src) return "";
    if (/^data:/.test(src)) return src;
    const m = String(src).match(/^https:\/\/substackcdn\.com\/image\/fetch\/(?:\$s_![^,/]+!,)?[^/]*\/(https?%3A.*)$/);
    const orig = m ? m[1] : encodeURIComponent(src);
    return "https://substackcdn.com/image/fetch/w_" + width + ",c_limit,f_auto,q_auto:good,fl_progressive:steep/" + orig;
  }
  const SIZES = "(max-width: 800px) 100vw, 740px";

  /* <img> as Substack's widest srcset entry up to 1456 px, the rest as srcset. */
  function tidyImage(doc, img) {
    const out = doc.createElement("img");
    const src = img.getAttribute("src") || "";
    const set = img.getAttribute("srcset") || "";
    out.setAttribute("src", src);
    if (set && !/^data:/.test(src)) {
      out.setAttribute("srcset", set);
      out.setAttribute("sizes", SIZES);
    }
    const alt = img.getAttribute("alt") || "";
    out.setAttribute("alt", alt);
    const w = parseInt(img.getAttribute("width"), 10);
    const h = parseInt(img.getAttribute("height"), 10);
    if (w > 0 && h > 0) {
      out.setAttribute("width", String(w));
      out.setAttribute("height", String(h));
    }
    out.setAttribute("decoding", "async");
    return out;
  }

  function card(doc, kind, html) {
    const el = doc.createElement("aside");
    el.className = "ss-card ss-card-" + kind;
    el.innerHTML = html;
    return el;
  }

  function linkHtml(href, text) {
    return '<a href="' + esc(href) + '">' + esc(text) + "</a>";
  }

  /* KaTeX for a LaTeX block. Substack's own renderer is more forgiving: commands
     written inside \text{…} or \fbox{…} are tried again as literal text / math; what
     still doesn't parse is shown as its source. */
  function literalText(expr) {
    let out = "";
    let i = 0;
    const re = /\\text\{/g;
    let m;
    while ((m = re.exec(expr))) {
      let depth = 1;
      let j = m.index + m[0].length;
      while (j < expr.length && depth) {
        if (expr[j] === "\\") j++;
        else if (expr[j] === "{") depth++;
        else if (expr[j] === "}") depth--;
        j++;
      }
      const inner = expr.slice(m.index + m[0].length, j - 1);
      out += expr.slice(i, m.index) + "\\text{" +
        inner.replace(/\\?[{}]/g, function (b) { return b.length === 2 ? b : "\\" + b; }).replace(/\\([A-Za-z]+)/g, "\\textbackslash{}$1") + "}";
      i = j;
      re.lastIndex = j;
    }
    return out + expr.slice(i);
  }
  function texHtml(expr, display) {
    const K = global.katex;
    if (!K) return '<code class="ss-math-src nohighlight">' + esc(expr) + "</code>";
    const opts = { displayMode: display, throwOnError: true, strict: "ignore", trust: false };
    const tries = [
      expr,
      literalText(expr).replace(/\\fbox\{/g, "\\boxed{")
    ];
    for (let i = 0; i < tries.length; i++) {
      try {
        return K.renderToString(tries[i], opts);
      } catch (e) { /* next */ }
    }
    return '<pre class="ss-math-src"><code class="nohighlight">' + esc(expr) + "</code></pre>";
  }

  /* The post's body_html → markup the reader shows; footnotes stay as Substack's
     anchors here (the Reader-style adapter numbers them). */
  function cleanBody(html, post, doc) {
    doc = doc || document.implementation.createHTMLDocument("");
    const box = doc.createElement("div");
    box.innerHTML = String(html || "");

    /* Widgets that are not the article. */
    box.querySelectorAll([
      ".subscription-widget-wrap", ".subscription-widget-wrap-editor", ".subscription-widget", ".subscribe-widget",
      '[data-component-name="SubscribeWidgetToDOM"]', '[data-component-name="ButtonCreateButton"]',
      '[data-component-name="CaptionedButtonToDOM"]', ".captioned-button-wrap", "p.button-wrapper",
      '[data-component-name="InstallSubstackAppToDOM"]', ".install-substack-app-embed",
      ".paywall-jump", '[data-component-name="PaywallToDOM"]', ".paywall", ".image-link-expand",
      ".community-chat", '[data-component-name="CommunityChatRenderPlaceholder"]', ".pullquote-share",
      ".share-dialog", ".post-ufi", ".header-anchor-widget", "form", "button", "input", "script", "style",
      "noscript", "svg.lucide"
    ].join(",")).forEach(function (el) { el.remove(); });

    /* LaTeX blocks: rendered here with KaTeX (the rest of the post is kept away from
       auto-render: "$" in a newsletter is a dollar). */
    box.querySelectorAll(".latex-rendered, [data-component-name='LatexBlockToDOM']").forEach(function (el) {
      const expr = String(attrs(el).persistentExpression || el.textContent || "")
        .split("\n").map(function (line) { return line.replace(/(^|[^\\])%.*$/, "$1"); }).join("\n").trim();
      const inline = el.localName === "span";
      const holder = doc.createElement(inline ? "span" : "div");
      holder.className = inline ? "ss-math" : "ss-math ss-math-block";
      if (!expr) {
        el.remove();
        return;
      }
      holder.innerHTML = texHtml(expr, !inline);
      el.replaceWith(holder);
    });

    /* Captioned images. */
    box.querySelectorAll(".captioned-image-container, [data-component-name='Image2ToDOM']").forEach(function (wrap) {
      if (!box.contains(wrap)) return;
      const outer = wrap.closest(".captioned-image-container") || wrap;
      const img = outer.querySelector("img");
      if (!img) {
        outer.remove();
        return;
      }
      const fig = doc.createElement("figure");
      fig.className = "ss-figure";
      fig.appendChild(tidyImage(doc, img));
      const cap = outer.querySelector("figcaption");
      if (cap && cap.textContent.trim()) {
        const fc = doc.createElement("figcaption");
        fc.innerHTML = cap.innerHTML;
        fig.appendChild(fc);
      }
      outer.replaceWith(fig);
    });

    /* Galleries. */
    box.querySelectorAll(".image-gallery-embed, [data-component-name='ImageGallery']").forEach(function (el) {
      const g = (attrs(el).gallery) || {};
      const imgs = (g.images || []).filter(function (i) { return i && i.src; });
      const found = imgs.length ? [] : Array.prototype.slice.call(el.querySelectorAll("img"));
      if (!imgs.length && !found.length) {
        el.remove();
        return;
      }
      const fig = doc.createElement("figure");
      fig.className = "ss-gallery";
      const grid = doc.createElement("div");
      grid.className = "ss-gallery-grid";
      imgs.forEach(function (i) {
        const im = doc.createElement("img");
        im.setAttribute("src", cdnImage(i.src, 848));
        im.setAttribute("alt", i.alt || "");
        im.setAttribute("decoding", "async");
        grid.appendChild(im);
      });
      found.forEach(function (im) { grid.appendChild(tidyImage(doc, im)); });
      fig.appendChild(grid);
      if (g.caption) {
        const fc = doc.createElement("figcaption");
        fc.textContent = g.caption;
        fig.appendChild(fc);
      }
      el.replaceWith(fig);
    });

    /* Tweets: the text, who and when, and a link (no Twitter script). */
    box.querySelectorAll(".twitter-embed, [data-component-name='Twitter2ToDOM']").forEach(function (el) {
      if (!box.contains(el)) return;
      const a = attrs(el);
      if (!a.url) {
        el.remove();
        return;
      }
      const text = unescapeText(a.full_text || "");
      const who = (a.name ? a.name + " " : "") + (a.username ? "(@" + a.username + ")" : "");
      const when = fmtDate(a.date);
      let quoted = "";
      if (a.quoted_tweet && a.quoted_tweet.full_text) {
        const q = a.quoted_tweet;
        quoted = '<blockquote class="ss-card-quote"><p>' + esc(unescapeText(q.full_text)).replace(/\n/g, "<br>") + "</p>" +
          (q.username ? '<p class="ss-card-meta">\u2014 ' + esc((q.name ? q.name + " " : "") + "(@" + q.username + ")") + "</p>" : "") + "</blockquote>";
      }
      const photo = a.photos && a.photos[0] && a.photos[0].img_url
        ? '<img class="ss-card-photo" src="' + esc(a.photos[0].img_url) + '" alt="" decoding="async">' : "";
      el.replaceWith(card(doc, "tweet",
        '<p class="ss-card-kind">Post on X</p><p class="ss-card-text">' + esc(text).replace(/\n/g, "<br>") + "</p>" + photo + quoted +
        '<p class="ss-card-meta">' + esc(who) + (when ? " \u00b7 " + esc(when) : "") + " \u00b7 " + linkHtml(a.url, "View on X") + "</p>"));
    });

    /* YouTube: a thumbnail and a link (no player). */
    box.querySelectorAll(".youtube-wrap, [data-component-name='Youtube2ToDOM']").forEach(function (el) {
      if (!box.contains(el)) return;
      const id = attrs(el).videoId || ((el.querySelector("iframe") || {}).src || "").split("/embed/")[1];
      const vid = String(id || "").split("?")[0];
      if (!vid) {
        el.remove();
        return;
      }
      const href = "https://www.youtube.com/watch?v=" + encodeURIComponent(vid);
      el.replaceWith(card(doc, "video",
        '<a class="ss-card-thumb" href="' + esc(href) + '"><img src="https://i.ytimg.com/vi/' + esc(vid) + '/hqdefault.jpg" alt="Video thumbnail" decoding="async"><span class="ss-card-play" aria-hidden="true">\u25b6</span></a>' +
        '<p class="ss-card-meta"><span class="ss-card-kind">YouTube</span> \u00b7 ' + linkHtml(href, "Watch on YouTube") + "</p>"));
    });

    /* Substack's own video / audio players. */
    box.querySelectorAll(".native-video-embed, [data-component-name='VideoPlaceholder'], .native-audio-embed, [data-component-name='AudioPlaceholder']").forEach(function (el) {
      if (!box.contains(el)) return;
      const audio = /audio/i.test(el.className + " " + el.getAttribute("data-component-name"));
      el.replaceWith(card(doc, "video", '<p class="ss-card-meta"><span class="ss-card-kind">' + (audio ? "Audio" : "Video") +
        "</span> \u00b7 " + linkHtml(post.url, (audio ? "Listen" : "Watch") + " on Substack") + "</p>"));
    });

    /* Embedded posts (this publication or another). */
    box.querySelectorAll(".embedded-post-wrap, .digest-post-embed, [data-component-name='EmbeddedPostToDOM'], [data-component-name='DigestPostEmbed']").forEach(function (el) {
      if (!box.contains(el)) return;
      const a = attrs(el);
      const link = el.querySelector("a[href]");
      const href = cleanUrl(a.canonical_url || a.url || (link && link.getAttribute("href")) || "");
      if (!href) {
        el.remove();
        return;
      }
      if (a.publication_id || a.canonical_url) rememberHost(hostFromUrl(href, ""));
      const title = a.title || (el.querySelector(".embedded-post-title") || {}).textContent || href;
      const pub = a.publication_name || (el.querySelector(".embedded-post-publication-name") || {}).textContent || hostOf(href);
      const text = a.truncated_body_text || a.caption || (el.querySelector(".embedded-post-body") || {}).textContent || "";
      const by = (a.bylines || a.publishedBylines || []).map(function (b) { return b && b.name; }).filter(Boolean).join(", ");
      const when = fmtDate(a.date || a.post_date);
      el.replaceWith(card(doc, "post",
        '<p class="ss-card-kind">' + esc(pub) + '</p><p class="ss-card-title">' + linkHtml(href, title) + "</p>" +
        (text ? '<p class="ss-card-text">' + esc(text) + "</p>" : "") +
        ((by || when) ? '<p class="ss-card-meta">' + esc([by, when].filter(Boolean).join(" \u00b7 ")) + "</p>" : "")));
    });

    /* Embedded publications, polls, files, comments: a link where there is one. */
    box.querySelectorAll(".embedded-publication-wrap, .poll-embed, .file-embed-wrapper, .comment-embed, [data-component-name='PollToDOM'], [data-component-name='FileToDOM'], [data-component-name='CommentPlaceholder'], [data-component-name='EmbeddedPublicationToDOM']").forEach(function (el) {
      if (!box.contains(el)) return;
      const a = attrs(el);
      const link = el.querySelector("a[href]");
      const kind = /poll/i.test(el.className) ? "Poll" : /file/i.test(el.className) ? "File" : /comment/i.test(el.className) ? "Comment" : "Publication";
      const href = cleanUrl((link && link.getAttribute("href")) || a.url || a.base_url || post.url);
      const label = (a.name || a.filename || (link && link.textContent) || "").trim() || (kind === "Poll" ? "Vote on Substack" : "Open on Substack");
      el.replaceWith(card(doc, "link", '<p class="ss-card-meta"><span class="ss-card-kind">' + kind + "</span> \u00b7 " + linkHtml(href, label) + "</p>"));
    });

    /* Any other embedded frame: a link to it. */
    box.querySelectorAll("iframe").forEach(function (f) {
      const src = f.getAttribute("src") || "";
      const holder = f.closest("[data-component-name]") || f;
      if (!/^https?:/i.test(src)) {
        holder.remove();
        return;
      }
      holder.replaceWith(card(doc, "link", '<p class="ss-card-meta"><span class="ss-card-kind">Embedded</span> \u00b7 ' + linkHtml(src, hostOf(src)) + "</p>"));
    });

    /* Pull quotes. */
    box.querySelectorAll(".pullquote").forEach(function (el) {
      const q = doc.createElement("blockquote");
      q.className = "ss-pullquote";
      while (el.firstChild) q.appendChild(el.firstChild);
      el.replaceWith(q);
    });

    /* Remaining images (inside text or links). */
    box.querySelectorAll("picture").forEach(function (pic) {
      const img = pic.querySelector("img");
      if (img) pic.replaceWith(tidyImage(doc, img));
      else pic.remove();
    });
    box.querySelectorAll("a.image-link, a.image2").forEach(function (a) {
      a.replaceWith.apply(a, Array.prototype.slice.call(a.childNodes));
    });
    box.querySelectorAll(".image2-inset").forEach(function (d) {
      d.replaceWith.apply(d, Array.prototype.slice.call(d.childNodes));
    });

    /* Code: <pre><code><code>…</code></code></pre> and Substack's class-less spans →
       plain text for the reader's highlighter. */
    box.querySelectorAll("pre").forEach(function (pre) {
      const code = pre.querySelector("code");
      const text = (code || pre).textContent;
      const lang = ((code && code.className) || pre.className || "").match(/language-([\w+-]+)/);
      const c = doc.createElement("code");
      if (lang) c.className = "language-" + lang[1];
      c.textContent = text.replace(/\n$/, "");
      pre.textContent = "";
      pre.removeAttribute("class");
      pre.appendChild(c);
    });

    /* Heading anchors (pencraft widgets) and editor leftovers. */
    box.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach(function (h) {
      h.querySelectorAll("div, button, svg").forEach(function (x) { x.remove(); });
      h.removeAttribute("class");
    });
    box.querySelectorAll("[contenteditable]").forEach(function (el) { el.removeAttribute("contenteditable"); });
    box.querySelectorAll("[data-attrs]").forEach(function (el) { el.removeAttribute("data-attrs"); });
    box.querySelectorAll("p").forEach(function (p) {
      if (!p.textContent.trim() && !p.querySelector("img, br, .katex")) p.remove();
    });
    box.querySelectorAll("a[href]").forEach(function (a) {
      const href = a.getAttribute("href");
      if (/^https?:/i.test(href)) a.setAttribute("href", cleanUrl(href));
      a.removeAttribute("target");
    });
    return box;
  }

  /* The post as a small HTML document for ReaderHTML (Reader style via the adapter). */
  function postDocument(p) {
    const doc = document.implementation.createHTMLDocument(p.title);
    const meta = doc.createElement("meta");
    meta.setAttribute("name", "reader-substack");
    meta.setAttribute("content", p.host + "/" + p.slug);
    doc.head.appendChild(meta);
    const by = doc.createElement("meta");
    by.setAttribute("name", "reader-substack-byline");
    const parts = [];
    if (p.authors.length) parts.push(p.authors.join(", "));
    if (p.pubName && p.authors.join(", ") !== p.pubName) parts.push(p.pubName);
    if (fmtDate(p.date)) parts.push(fmtDate(p.date));
    by.setAttribute("content", parts.join(" \u00b7 "));
    doc.head.appendChild(by);
    const canon = doc.createElement("link");
    canon.setAttribute("rel", "canonical");
    canon.setAttribute("href", p.url);
    doc.head.appendChild(canon);

    const art = doc.createElement("article");
    /* no-math: KaTeX auto-render leaves the post alone ("$5" is money here). */
    art.className = "ss-article no-math";
    const head = doc.createElement("header");
    head.className = "ss-head";
    head.innerHTML = "<h1></h1>";
    head.querySelector("h1").textContent = p.title;
    if (p.subtitle) {
      const sub = doc.createElement("p");
      sub.className = "ss-subtitle";
      sub.textContent = p.subtitle;
      head.appendChild(sub);
    }
    art.appendChild(head);
    if (isPaid(p)) {
      art.appendChild(card(doc, "paid",
        "<p><strong>" + (p.audience === "only_free" ? "For subscribers." : "Subscriber-only post.") + "</strong> " +
        (p.audience === "only_free" ? "Substack shows this post in full to signed-in subscribers; this is the part it shows everyone." :
          "This is the free preview Substack shows everyone; the rest is for paid subscribers.") + " " +
        linkHtml(p.url, "Continue on Substack") + "</p>"));
    }
    if (p.podcast) {
      art.appendChild(card(doc, "audio", '<p class="ss-card-kind">Audio</p><audio controls preload="none" src="' + esc(p.podcast) + '"></audio>'));
    }
    const body = cleanBody(p.body || (p.truncated ? "<p>" + esc(p.truncated) + "</p>" : ""), p, doc);
    body.className = "ss-body";
    if (p.cover && !body.querySelector("img") && !isPaid(p)) {
      const fig = doc.createElement("figure");
      fig.className = "ss-figure ss-cover";
      fig.innerHTML = '<img alt="" decoding="async">';
      fig.querySelector("img").setAttribute("src", cdnImage(p.cover, 1456));
      body.insertBefore(fig, body.firstChild);
    }
    art.appendChild(body);
    if (isPaid(p)) {
      art.appendChild(card(doc, "paid ss-card-paid-end",
        "<p><strong>The free preview ends here.</strong> " + linkHtml(p.url, "Continue reading on Substack \u2192") + "</p>"));
    }
    doc.body.appendChild(art);
    return doc;
  }

  /* { wrap, title, url, post, from } */
  async function render(host, slug) {
    const r = await post(host, slug);
    const p = r.post;
    const doc = postDocument(p);
    const html = "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
    const ctx = { owner: "", repo: "", branch: "", path: p.url, web: p.url };
    const wrap = await global.ReaderHTML.render(html, ctx, { web: true, sourceText: html });
    return { wrap: wrap, title: p.title, url: p.url, post: p, from: r.from };
  }

  /* ---- Reader-style adapter: footnotes → the reader's numbered notes -------------- */

  function prepare(doc, page) {
    const meta = doc.querySelector('meta[name="reader-substack-byline"]');
    const h1 = doc.querySelector(".ss-head h1");
    page.title = h1 ? h1.textContent : page.title;
    page.byline = meta ? meta.getAttribute("content") : "";
    const art = doc.querySelector(".ss-article");
    if (!art) return;
    const bodies = {};
    art.querySelectorAll(".footnote, [data-component-name='FootnoteToDOM']").forEach(function (fn) {
      const num = fn.querySelector(".footnote-number, a[id^='footnote-']");
      const id = num && num.id;
      const content = fn.querySelector(".footnote-content") || fn;
      if (num && content === fn) num.remove();
      if (id) bodies[id] = content;
    });
    const refs = {};
    art.querySelectorAll("a.footnote-anchor, [data-component-name='FootnoteAnchorToDOM']").forEach(function (a) {
      const target = (a.getAttribute("href") || "").replace(/^#/, "");
      const label = (a.textContent || "").trim();
      if (refs[target]) {
        /* Cited again: point at the same note. */
        const sup = doc.createElement("sup");
        sup.className = "restyle-note-ref";
        const link = doc.createElement("a");
        link.href = refs[target].getAttribute("href");
        link.textContent = refs[target].textContent;
        sup.appendChild(link);
        a.replaceWith(sup);
        return;
      }
      const content = bodies[target];
      if (!content) {
        a.remove();
        return;
      }
      const sup = page.notePair(label, content);
      refs[target] = sup.querySelector("a");
      a.replaceWith(sup);
    });
    art.querySelectorAll(".footnote, [data-component-name='FootnoteToDOM']").forEach(function (fn) { fn.remove(); });
    /* Numbers of repeated citations, once the notes are numbered (restyle.js numbers
       them after prepare; the order here is the order of first citation). */
    let n = 0;
    Object.keys(refs).forEach(function (k) {
      n += 1;
      refs[k].textContent = String(n);
    });
    art.querySelectorAll("sup.restyle-note-ref > a:not([id])").forEach(function (a) {
      const hit = Object.keys(refs).map(function (k) { return refs[k]; }).filter(function (r) { return r.getAttribute("href") === a.getAttribute("href"); })[0];
      if (hit) a.textContent = hit.textContent;
    });
  }

  if (global.ReaderRestyle) {
    global.ReaderRestyle.register({
      id: "substack",
      name: "Substack post",
      match: function (doc) { return !!doc.querySelector('meta[name="reader-substack"]'); },
      prepare: prepare,
      root: function (doc) { return doc.querySelector(".ss-article"); },
      drop: []
    });
  }

  /* ---- Lists: the archive page and the sidebar ------------------------------------- */

  function fold(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }
  function itemText(i) {
    return fold([i.title, i.subtitle, (i.authors || []).join(" "), i.slug.replace(/-/g, " ")].join(" "));
  }
  function badge(i) {
    if (i.audience === "only_paid" || i.audience === "founding") return '<span class="ss-badge">Paid</span>';
    if (i.audience === "only_free") return '<span class="ss-badge">Subscribers</span>';
    return "";
  }
  function typeLabel(t) {
    return t === "podcast" ? "Podcast" : t === "thread" ? "Thread" : t === "video" ? "Video" : "";
  }

  function itemHtml(host, i) {
    const meta = [fmtDate(i.date), (i.authors || []).join(", "), typeLabel(i.type), i.wordcount ? Math.max(1, Math.round(i.wordcount / 230)) + " min" : ""]
      .filter(Boolean).join(" \u00b7 ");
    return '<li data-ss-slug="' + esc(i.slug) + '"><a href="' + esc(hashFor(i.host || host, i.slug)) + '"><span class="ss-item-title">' +
      esc(i.title) + "</span>" + badge(i) + (i.subtitle ? '<span class="ss-item-sub">' + esc(i.subtitle) + "</span>" : "") +
      '<span class="ss-item-meta">' + esc(meta) + "</span></a></li>";
  }

  /* The publication page (in the article area). onMore() is called after more posts
     load (to refresh the sidebar). */
  function indexView(arc, onMore) {
    const host = arc.canonicalHost || arc.host;
    const name = arc.name || nameFor(host) || host;
    const wrap = document.createElement("div");
    wrap.className = "markdown-body doc-html ss-index";
    wrap.innerHTML = [
      '<header class="ss-index-head">',
      "<h1></h1>",
      '<p class="ss-intro">Posts from <a href="' + esc(pubUrl(host)) + '" target="_blank" rel="noopener noreferrer">' + esc(host) +
        "</a>, newest first, read from Substack and shown in the reader\u2019s style. Paid posts show their free preview.</p>",
      arc.error && !arc.items.length ? '<p class="ss-note"></p>' : "",
      "</header>",
      '<div class="rp-filter"><input type="search" class="rp-filter-input ss-filter-input" placeholder="Filter posts" aria-label="Filter posts" autocomplete="off" spellcheck="false"></div>',
      '<p class="rp-count ss-count" aria-live="polite"></p>',
      '<ol class="ss-list"></ol>',
      '<p class="rp-none ss-none" hidden>No post title matches the posts loaded so far.</p>',
      '<p class="ss-more-wrap"><button type="button" class="ss-more">Load more posts</button><span class="ss-more-note"></span></p>'
    ].join("");
    wrap.querySelector("h1").textContent = name;
    const note = wrap.querySelector(".ss-note");
    if (note) note.textContent = arc.error;
    const list = wrap.querySelector(".ss-list");
    const input = wrap.querySelector(".ss-filter-input");
    const more = wrap.querySelector(".ss-more");
    const moreNote = wrap.querySelector(".ss-more-note");
    let shown = 0;
    function paint() {
      const add = arc.items.slice(shown);
      list.insertAdjacentHTML("beforeend", add.map(function (i) { return itemHtml(host, i); }).join(""));
      shown = arc.items.length;
      more.hidden = arc.done;
      moreNote.textContent = arc.error && arc.items.length ? " " + arc.error : arc.done && arc.items.length ? "That\u2019s every post." : "";
      apply();
    }
    const bySlug = {};
    function apply() {
      arc.items.forEach(function (i) { bySlug[i.slug] = i; });
      const words = fold(input.value).split(/\s+/).filter(Boolean);
      let n = 0;
      list.querySelectorAll("li[data-ss-slug]").forEach(function (li) {
        const i = bySlug[li.getAttribute("data-ss-slug")];
        const ok = !words.length || (i && words.every(function (w) { return itemText(i).indexOf(w) !== -1; }));
        li.hidden = !ok;
        if (ok) n++;
      });
      wrap.querySelector(".ss-none").hidden = !words.length || n > 0;
      wrap.querySelector(".ss-count").textContent = words.length
        ? n + " of " + arc.items.length + " posts loaded" + (arc.done ? "" : " (load more to search older ones)") : "";
      input.placeholder = "Filter " + arc.items.length + (arc.done ? "" : "+") + " posts";
      try {
        sessionStorage.setItem("reader-substack-filter:" + host, input.value);
      } catch (e) { /* ignore */ }
    }
    input.addEventListener("input", apply);
    more.addEventListener("click", async function () {
      more.disabled = true;
      more.textContent = "Loading\u2026";
      await archive(arc.host, { more: true });
      more.disabled = false;
      more.textContent = "Load more posts";
      paint();
      if (onMore) onMore(arc);
    });
    try {
      input.value = sessionStorage.getItem("reader-substack-filter:" + host) || "";
    } catch (e) { /* ignore */ }
    paint();
    return wrap;
  }

  function humanSlug(slug) {
    const s = String(slug || "").replace(/-/g, " ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /* Sidebar / drawer: the archive loaded so far (the pager follows it), with the open
     post's contents under it. A post not in the loaded archive is listed between its
     newer and older neighbours. */
  function sidebarHtml(arc, current, outline) {
    const host = (arc && (arc.canonicalHost || arc.host)) || (current && current.host) || "";
    const items = (arc && arc.items) || [];
    const parts = ['<li class="rp-side-filter"><input type="search" placeholder="Filter posts" aria-label="Filter posts" autocomplete="off" spellcheck="false"></li>'];
    if (current) parts.push('<li class="dir-up"><a href="' + esc(hashFor(host, "")) + '">\u2190 All posts</a></li>');
    const slug = current ? current.slug : "";
    function row(i, on) {
      parts.push('<li class="file-item is-root" data-ss-slug="' + esc(i.slug) + '"><a class="file-link' + (on ? " active" : "") +
        '" href="' + esc(hashFor(i.host || host, i.slug)) + '"' + (on ? ' aria-current="page"' : "") + ">" + esc(i.title) + "</a></li>");
      if (on && outline && outline.length) {
        const min = Math.min.apply(null, outline.map(function (o) { return o.level; }));
        const top = outline.filter(function (x) { return x.level === min; }).length === 1;
        outline.forEach(function (o) {
          if (o.level === min && top) return; /* the title */
          parts.push('<li class="toc-item rp-side-toc" style="--depth:' + (o.level - min + (top ? 0 : 1)) + '"><a class="file-link" href="' +
            esc(hashFor(i.host || host, i.slug, o.id)) + '">' + esc(o.text) + "</a></li>");
        });
      }
    }
    const listed = items.some(function (i) { return i.slug === slug; });
    if (current && !listed) {
      parts.push('<li class="rp-side-section">This post</li>');
      if (current.newer) row({ slug: current.newer, title: "Newer: " + humanSlug(current.newer) }, false);
      row({ slug: current.slug, title: current.title, host: current.host }, true);
      if (current.older) row({ slug: current.older, title: "Older: " + humanSlug(current.older) }, false);
      if (items.length) parts.push('<li class="rp-side-section">Latest posts</li>');
    } else if (items.length) {
      parts.push('<li class="rp-side-section">Posts, newest first</li>');
    }
    items.forEach(function (i) { row(i, i.slug === slug); });
    if (arc && !arc.done && items.length) {
      parts.push('<li class="dir-up ss-side-all"><a href="' + esc(hashFor(host, "")) + '">More in the archive\u2026</a></li>');
    }
    return parts.join("");
  }
  function wireSidebar(list) {
    const input = list.querySelector(".rp-side-filter input");
    if (!input) return;
    input.addEventListener("input", function () {
      const words = fold(input.value).split(/\s+/).filter(Boolean);
      list.querySelectorAll("li[data-ss-slug]").forEach(function (li) {
        const a = li.querySelector("a");
        li.hidden = !!words.length && !words.every(function (w) { return fold(a.textContent + " " + li.getAttribute("data-ss-slug")).indexOf(w) !== -1; });
      });
      list.querySelectorAll(".rp-side-toc, .rp-side-section").forEach(function (li) { li.hidden = !!words.length; });
    });
  }

  function archiveFor(host) {
    return archives.get(String(host).toLowerCase()) || null;
  }

  const api = {
    parseUrl: parseUrl,
    hashFor: hashFor,
    hashForId: hashForId,
    hashForUrl: hashForUrl,
    postUrl: postUrl,
    pubUrl: pubUrl,
    apiPostUrl: apiPostUrl,
    isPubHost: isPubHost,
    rememberHost: rememberHost,
    nameFor: nameFor,
    fetchBytes: fetchBytes,
    post: post,
    byId: byId,
    archive: archive,
    archiveFor: archiveFor,
    detect: detect,
    fromHtml: fromHtml,
    cleanBody: cleanBody,
    cdnImage: cdnImage,
    render: render,
    indexView: indexView,
    sidebarHtml: sidebarHtml,
    wireSidebar: wireSidebar,
    isPaid: isPaid,
    /* Set by the app: async (api url) → Uint8Array of a saved copy, or null. */
    savedSource: null
  };
  global.ReaderSubstack = api;
})(window);
