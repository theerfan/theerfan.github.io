/* Reading position memory: every document reopens where you left it.

   Stored on this device only (localStorage "reader-resume-v1"; never sent anywhere),
   one entry per page (the location hash without its #anchor), newest 500 kept:
     { a: id of the heading above the top of the reading area ("" before the first),
       s: that heading's text, r: how far into its section (0–1), o: px below it,
       f: scroll fraction of the whole page (fallback), end: reached the bottom,
       t: last saved (ms) }
   A section-relative position survives font size, theme and width changes better
   than a pixel offset.

   Saved on scroll (throttled), when leaving the page, and when the page/app is
   hidden (visibilitychange, pagehide; the Android app also calls flush() on pause).
   Restored when a page opens without a #section in its address (an explicit anchor
   wins), once fonts, images, math and framed documents have settled, and corrected
   again if the layout still moves before you touch anything. Pages left at the top
   are forgotten; pages read to the very end open at the top again.

   Framed HTML notes (js/frame-host.js) report their headings' positions through the
   frame messaging ("tops"). */
(function (global) {
  "use strict";
  const doc = global.document;
  const KEY = "reader-resume-v1";
  const MAX = 500;
  const NEAR_TOP = 160; /* px: closer to the top than this is "not started" */
  const LINE = 24; /* px below the top of the reading area: the reading line */
  const SAVE_MS = 500;
  const SETTLE_MAX_MS = 5000;
  const CORRECT_MS = 8000;

  let store = null;
  function load() {
    if (store) return store;
    try {
      store = JSON.parse(global.localStorage.getItem(KEY) || "null");
    } catch (e) {
      store = null;
    }
    if (!store || typeof store !== "object" || !store.items || typeof store.items !== "object") store = { v: 1, items: {} };
    return store;
  }
  function persist() {
    const s = load();
    const keys = Object.keys(s.items);
    if (keys.length > MAX) {
      keys.sort(function (a, b) { return (s.items[b].t || 0) - (s.items[a].t || 0); });
      keys.slice(MAX).forEach(function (k) { delete s.items[k]; });
    }
    try {
      global.localStorage.setItem(KEY, JSON.stringify(s));
    } catch (e) {
      /* Quota: keep the newest half. */
      const ks = Object.keys(s.items).sort(function (a, b) { return (s.items[b].t || 0) - (s.items[a].t || 0); });
      ks.slice(Math.floor(ks.length / 2)).forEach(function (k) { delete s.items[k]; });
      try { global.localStorage.setItem(KEY, JSON.stringify(s)); } catch (e2) { /* give up */ }
    }
  }
  function get(key) {
    const e = load().items[key];
    return e && typeof e === "object" ? e : null;
  }

  /* The page part of the hash: "#/owner/repo/path" without "#anchor". */
  function pageKey(hash) {
    const h = String(hash === undefined ? global.location.hash : hash).replace(/^#\/?/, "");
    const cut = h.indexOf("#");
    return "#/" + (cut === -1 ? h : h.slice(0, cut));
  }

  function scroller() {
    return doc.getElementById("repoView");
  }
  function frameEl() {
    const f = doc.querySelector("#article iframe.doc-frame");
    return f && global.ReaderFrame && global.ReaderFrame.active() ? f : null;
  }
  function topIn(el, sc) {
    return el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
  }
  function clean(t) {
    return String(t || "").replace(/\s+/g, " ").trim().slice(0, 160);
  }

  /* Headings of the open document, top to bottom: [{ id, top, text }] in scroller px. */
  let frameTops = null; /* last list the frame reported (frame coordinates) */
  function headings(sc) {
    const frame = frameEl();
    if (frame) {
      if (!frameTops) return [];
      const base = topIn(frame, sc);
      return frameTops.map(function (h) { return { id: h.id, top: base + h.top, text: h.text }; });
    }
    const art = doc.getElementById("article");
    if (!art) return [];
    const out = [];
    art.querySelectorAll("h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]").forEach(function (h) {
      if (h.closest(".article-msg")) return;
      if (!h.getClientRects().length) return;
      out.push({ id: h.id, top: topIn(h, sc), text: clean(h.textContent) });
    });
    out.sort(function (a, b) { return a.top - b.top; });
    return out;
  }
  function refreshFrameTops() {
    if (!frameEl() || !global.ReaderFrame.tops) return Promise.resolve(null);
    return global.ReaderFrame.tops().then(function (items) {
      if (items) frameTops = items;
      return items;
    });
  }

  /* Where the reader is now, or null near the top. */
  function measure() {
    const sc = scroller();
    if (!sc) return null;
    const y = sc.scrollTop;
    const max = Math.max(0, sc.scrollHeight - sc.clientHeight);
    if (y < NEAR_TOP || max < sc.clientHeight * 0.5) return null;
    const line = y + LINE;
    const hs = headings(sc);
    let i = -1;
    for (let k = 0; k < hs.length; k++) if (hs[k].top <= line) i = k;
    const start = i >= 0 ? hs[i].top : 0;
    const next = i + 1 < hs.length ? hs[i + 1].top : sc.scrollHeight;
    return {
      a: i >= 0 ? hs[i].id : "",
      s: i >= 0 ? hs[i].text : "",
      r: next > start ? Math.max(0, Math.min(1, (line - start) / (next - start))) : 0,
      o: Math.round(line - start),
      f: max ? Math.round((y / max) * 10000) / 10000 : 0,
      end: max - y < sc.clientHeight * 0.5,
      t: Date.now()
    };
  }

  /* scrollTop that puts entry `e` back on the reading line. */
  function target(e) {
    const sc = scroller();
    const max = Math.max(0, sc.scrollHeight - sc.clientHeight);
    const hs = headings(sc);
    let line = null;
    const i = e.a ? hs.findIndex(function (h) { return h.id === e.a; }) : -1;
    if (i >= 0) {
      const start = hs[i].top;
      const next = i + 1 < hs.length ? hs[i + 1].top : sc.scrollHeight;
      line = typeof e.r === "number" && next > start ? start + e.r * (next - start) : start + (e.o || 0);
    } else if (!e.a && hs.length && typeof e.r === "number") {
      line = e.r * hs[0].top;
    }
    const y = line === null ? (e.f || 0) * max : line - LINE;
    return Math.max(0, Math.min(max, Math.round(y)));
  }

  /* ---- Current page -------------------------------------------------------- */

  let cur = null; /* { key, armed, restoring, userMoved } */
  let saveTimer = 0;

  function save(now) {
    if (!cur || !cur.armed || cur.restoring) return;
    const key = cur.key;
    const write = function () {
      if (!cur || cur.key !== key) return;
      const m = measure();
      const items = load().items;
      if (!m) delete items[key];
      else items[key] = m;
      persist();
      paintContinue();
    };
    if (now) {
      write();
    } else if (frameEl()) {
      refreshFrameTops().then(write);
    } else {
      write();
    }
  }
  function flush() {
    clearTimeout(saveTimer);
    save(true);
  }
  function onScroll() {
    if (!cur || !cur.armed || cur.restoring) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { save(false); }, SAVE_MS);
  }
  function moved() {
    if (cur) cur.userMoved = true;
  }

  function wait(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }
  /* Fonts, images in the document, the frame's headings, then a height that holds
     still for a moment (KaTeX, figures, the frame resizing). */
  async function settled(token) {
    const until = Date.now() + SETTLE_MAX_MS;
    if (doc.fonts && doc.fonts.ready) await Promise.race([doc.fonts.ready, wait(1500)]);
    const imgs = Array.prototype.filter.call(doc.querySelectorAll("#article img"), function (img) {
      return !img.complete && img.loading !== "lazy";
    });
    if (imgs.length) {
      await Promise.race([
        Promise.all(imgs.map(function (img) {
          return new Promise(function (r) {
            img.addEventListener("load", r, { once: true });
            img.addEventListener("error", r, { once: true });
          });
        })),
        wait(3000)
      ]);
    }
    if (frameEl()) {
      while (Date.now() < until && token === cur && !(await refreshFrameTops())) await wait(150);
    }
    const sc = scroller();
    let last = -1;
    let still = 0;
    while (Date.now() < until && token === cur && still < 3) {
      const h = sc.scrollHeight;
      still = h === last ? still + 1 : 0;
      last = h;
      await wait(120);
    }
    if (frameEl()) await refreshFrameTops();
  }

  async function restore(token, entry) {
    token.restoring = true;
    await settled(token);
    if (token !== cur) return;
    const sc = scroller();
    if (token.userMoved && sc.scrollTop > 40) {
      /* They already scrolled away from the top themselves. */
      token.restoring = false;
      return;
    }
    sc.scrollTop = target(entry);
    token.restoring = false;
    token.userMoved = false;
    showToast(entry);
    /* Late layout shifts (a figure, the frame growing): put it back, until the
       reader touches anything. */
    const stopAt = Date.now() + CORRECT_MS;
    let pending = 0;
    const fix = function () {
      clearTimeout(pending);
      pending = setTimeout(async function () {
        if (token !== cur || token.userMoved || Date.now() > stopAt) return;
        if (frameEl()) await refreshFrameTops();
        if (token !== cur || token.userMoved) return;
        const y = target(entry);
        if (Math.abs(sc.scrollTop - y) > 2) {
          token.restoring = true;
          sc.scrollTop = y;
          setTimeout(function () { token.restoring = false; }, 50);
        }
      }, 80);
    };
    if (global.ResizeObserver) {
      const ro = new ResizeObserver(fix);
      const art = doc.getElementById("article");
      if (art) ro.observe(art);
      const f = frameEl();
      if (f) ro.observe(f);
      setTimeout(function () { ro.disconnect(); }, CORRECT_MS);
    }
    [300, 1200, 3000].forEach(function (ms) { setTimeout(fix, ms); });
  }

  /* Which views are documents with a reading position. */
  function isDoc(d) {
    const v = d && d.view;
    if (v === "file" || v === "wiki" || v === "web") return true;
    if (v === "substack") return !!(d.route && d.route.slug);
    return v === "raypeat" && !!(d.route && d.route.path);
  }

  function onView(ev) {
    const d = ev.detail || {};
    hideToast();
    frameTops = null;
    if (!isDoc(d)) {
      cur = null;
      return;
    }
    const key = pageKey();
    const token = { key: key, armed: false, restoring: false, userMoved: false };
    cur = token;
    const entry = get(key);
    const anchor = d.route && d.route.anchor;
    if (entry && !anchor && !entry.end) {
      restore(token, entry).then(function () { if (token === cur) token.armed = true; });
    } else {
      /* An explicit #section, nothing saved, or read to the end: start as opened. */
      if (entry && entry.end && !anchor) {
        delete load().items[key];
        persist();
      }
      setTimeout(function () { if (token === cur) token.armed = true; }, 400);
    }
  }

  global.addEventListener("hashchange", function (ev) {
    if (!cur) return;
    const oldKey = pageKey(ev.oldURL ? ev.oldURL.slice(ev.oldURL.indexOf("#") === -1 ? ev.oldURL.length : ev.oldURL.indexOf("#")) : "");
    if (oldKey !== cur.key) return;
    if (pageKey() === cur.key) return; /* a jump within the page */
    /* Leaving: the old page is still on screen. */
    flush();
    cur = null;
  });
  doc.addEventListener("visibilitychange", function () {
    if (doc.visibilityState === "hidden") flush();
  });
  global.addEventListener("pagehide", flush);
  ["wheel", "touchstart", "pointerdown", "keydown"].forEach(function (type) {
    global.addEventListener(type, moved, { capture: true, passive: true });
  });
  doc.addEventListener("reader:frame-interact", moved);

  /* ---- "Resumed at § X · Back to top" ------------------------------------- */

  let toast = null;
  let toastTimer = 0;
  function hideToast() {
    clearTimeout(toastTimer);
    if (toast) toast.hidden = true;
  }
  function showToast(entry) {
    const sc = scroller();
    if (!sc || sc.scrollTop < sc.clientHeight * 0.5) return;
    if (!toast) {
      toast = doc.createElement("div");
      toast.className = "resume-toast";
      toast.setAttribute("role", "status");
      toast.innerHTML = '<span class="resume-toast-text"></span><button type="button">Back to top</button>';
      toast.querySelector("button").addEventListener("click", function () {
        const s = scroller();
        hideToast();
        if (cur) {
          delete load().items[cur.key];
          persist();
        }
        if (s) s.scrollTop = 0;
      });
      doc.body.appendChild(toast);
    }
    const where = entry.s ? "\u00a7 " + entry.s : Math.round((entry.f || 0) * 100) + "%";
    toast.querySelector(".resume-toast-text").textContent = "Resumed at " + where;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 5000);
  }

  /* The app's Continue reading card (native.js) shows the section too. */
  function paintContinue() {
    const card = doc.getElementById("continueCard");
    if (!card) return;
    const e = get(pageKey(card.getAttribute("href") || ""));
    let span = card.querySelector(".continue-where");
    if (!e || !e.s) {
      if (span) span.remove();
      return;
    }
    if (!span) {
      span = doc.createElement("span");
      span.className = "continue-where";
      card.appendChild(span);
    }
    span.textContent = "\u00a7 " + e.s;
  }

  doc.addEventListener("DOMContentLoaded", function () {
    const sc = scroller();
    if (sc) sc.addEventListener("scroll", onScroll, { passive: true });
  });
  doc.addEventListener("reader:view", onView);

  global.ReaderResume = {
    flush: flush,
    /* The section on the reading line now: { id, text } or null (Favorites). */
    where: function () {
      const m = measure();
      return m && m.a ? { id: m.a, text: m.s } : null;
    },
    entry: function (hash) { return get(pageKey(hash)); },
    paintContinue: paintContinue,
    _target: target,
    _measure: measure
  };
})(window);
