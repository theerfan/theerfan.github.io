/* Full-screen image viewer. Tap an image or figure in a document (any source:
   library notes, Markdown, Ray Peat, Substack, web pages, Wikipedia; inline SVG
   diagrams; images in sandboxed HTML notes, which frame-host.js forwards) to open
   it over the page:

     pinch            zoom around the fingers (1×–8×), pan when zoomed
     double-tap       1× ↔ 2.5× at the tap point
     swipe ←/→ (1×)   previous / next image of the document ("n / N")
     swipe ↓ (1×), ×, Esc, Android back   close
     tap              show / hide the caption and controls
     wheel, + / −, arrows   the same on a desktop

   Images that link to another page keep opening the link; a long press opens
   them here instead. Icons, emoji and math images are left alone. Zoomed past
   1.3×, the image switches to the largest source available (srcset, Substack's
   original, Wikipedia's full-size file).

   All gestures are pointer events written here (no library). The page under
   the viewer is not touched (no scroll lock that would move it), so the
   reading position stays where it was. */
(function (global) {
  "use strict";
  const document = global.document;
  const MAX = 8;
  const DOUBLE = 2.5;
  const MIN_SIDE = 48;
  const LONG_MS = 550;

  /* ---- Which images ----------------------------------------------------------- */

  const SKIP_INSIDE = ".katex, .MathJax, mjx-container, .doc-pager, .restyle-head, .restyle-byline, button, .lb, " +
    ".embedded-post-publication-logo, .ss-card-kind, nav, header.site, .file-list";
  const SKIP_IMG = /(^|\s)(emoji|wp-smiley|mwe-math-fallback-image-(inline|display)|tex|latex|icon|avatar|logo)(\s|$)/i;
  const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif|svg|bmp|tiff?)(\?|#|$)/i;

  function article() {
    return document.getElementById("article");
  }

  function sizeOk(el) {
    const r = el.getBoundingClientRect();
    if (r.width < MIN_SIDE || r.height < MIN_SIDE) return false;
    if (el.localName === "img" && el.naturalWidth && el.naturalWidth < MIN_SIDE && el.naturalHeight < MIN_SIDE) return false;
    return true;
  }

  function candidate(el) {
    if (!el || !el.closest) return false;
    if (el.closest(SKIP_INSIDE)) return false;
    if (el.localName === "img") {
      if (SKIP_IMG.test(el.className || "") || /^\\/.test(el.getAttribute("alt") || "")) return false;
      if (!(el.currentSrc || el.getAttribute("src"))) return false;
      return sizeOk(el);
    }
    if (el.localName === "svg") {
      if (el.parentElement && el.parentElement.closest("svg")) return false;
      if (el.closest("a, .katex, .icon-btn")) return false;
      return sizeOk(el);
    }
    return false;
  }

  /* The image (or top-level SVG) a tap landed on, if it is one we open. */
  function targetOf(node) {
    if (!node || !node.closest) return null;
    let el = node.closest("img");
    if (!el) {
      el = node.closest("svg");
      while (el && el.parentElement && el.parentElement.closest("svg")) el = el.parentElement.closest("svg");
    }
    if (!el) {
      /* A tap on a figure's padding: its single image. */
      const fig = node.closest("figure");
      if (fig) {
        const inside = fig.querySelectorAll("img, svg");
        if (inside.length === 1) el = inside[0];
      }
    }
    return candidate(el) ? el : null;
  }

  /* Does the image sit in a link to something other than the image itself? */
  function linkAway(el) {
    const a = el.closest("a[href]");
    if (!a) return false;
    const href = a.getAttribute("href") || "";
    if (a.classList.contains("mw-file-description") || a.classList.contains("image") || a.classList.contains("image-link")) return false;
    if (/\/wiki\/(File|Image|Datei|Fichier|Archivo):/i.test(href) || /commons\.wikimedia\.org\/wiki\/File:/i.test(href)) return false;
    if (IMAGE_FILE.test(href.split("#")[0]) || /substackcdn\.com\/image\//.test(href)) return false;
    try {
      const abs = new URL(href, document.baseURI).href;
      if (el.localName === "img" && (abs === el.currentSrc || abs === el.src)) return false;
    } catch (e) { /* treat as a link */ }
    return true;
  }

  /* ---- Sources ---------------------------------------------------------------- */

  function largestSrcset(set) {
    let best = null;
    String(set || "").split(/,\s+(?=\S)/).forEach(function (part) {
      const bits = part.trim().split(/\s+/);
      if (!bits[0]) return;
      const d = bits[1] || "1x";
      const v = parseFloat(d) * (/x$/.test(d) ? 1000 : 1) || 0;
      if (!best || v > best.v) best = { url: bits[0], v: v };
    });
    return best ? best.url : "";
  }

  function fullSource(src, img) {
    if (!src || /^data:/.test(src)) return src;
    /* Wikipedia thumbnails → the file itself. */
    /* Wikipedia thumbnails → the file itself (photos and drawings browsers show;
       SVG/TIFF/PDF originals keep the largest thumbnail). */
    let m = src.match(/^https:\/\/(?:upload|thumb)\.wikimedia\.org\/(wikipedia\/[^/]+\/)thumb\/([0-9a-f]\/[0-9a-f]{2}\/([^/]+))\/[^/]+$/);
    if (m && /\.(jpe?g|png|gif|webp)$/i.test(m[3])) return "https://upload.wikimedia.org/" + m[1] + m[2];
    /* Substack's image service → the original upload. */
    m = src.match(/^https:\/\/substackcdn\.com\/image\/fetch\/(?:\$s_![^,/]+!,)?[^/]*\/(https?%3A.+)$/);
    if (m) return "https://substackcdn.com/image/fetch/f_auto,q_auto:good,fl_progressive:steep/" + m[1];
    const set = img && img.getAttribute("srcset");
    const big = set && largestSrcset(set);
    if (big) {
      try {
        return new URL(big, document.baseURI).href;
      } catch (e) { /* keep src */ }
    }
    const a = img && img.closest && img.closest("a[href]");
    if (a && IMAGE_FILE.test((a.getAttribute("href") || "").split("#")[0])) return a.href;
    return src;
  }

  function captionOf(el) {
    const fig = el.closest("figure");
    const cap = fig && fig.querySelector("figcaption");
    let text = cap ? cap.textContent : "";
    if (!text.trim()) {
      /* Wikipedia infobox pictures: the caption sits next to the image. */
      const box = el.closest(".infobox-image");
      const row = box && box.closest("tr");
      const ic = box && (box.querySelector(".infobox-caption") ||
        (row && row.nextElementSibling && row.nextElementSibling.querySelector(".infobox-caption")));
      if (ic) text = ic.textContent;
    }
    if (!text.trim()) text = el.getAttribute("alt") || el.getAttribute("title") || el.getAttribute("aria-label") || "";
    if (!text.trim() && el.localName === "svg") {
      const t = el.querySelector("title");
      text = t ? t.textContent : "";
    }
    return text.replace(/\s+/g, " ").trim();
  }

  /* { kind: "img", src, full, alt, caption, w, h, filter } | { kind: "svg", node, w, h } */
  function itemFor(el) {
    const r = el.getBoundingClientRect();
    if (el.localName === "img") {
      const src = el.currentSrc || el.src;
      return {
        kind: "img", src: src, full: fullSource(src, el), alt: el.getAttribute("alt") || "",
        caption: captionOf(el), w: el.naturalWidth || r.width, h: el.naturalHeight || r.height,
        filter: getComputedStyle(el).filter, el: el
      };
    }
    let w = r.width;
    let h = r.height;
    const vb = el.viewBox && el.viewBox.baseVal;
    if (vb && vb.width && vb.height) {
      w = vb.width;
      h = vb.height;
    }
    return { kind: "svg", node: el, caption: captionOf(el), w: w, h: h, el: el };
  }

  function itemsIn(root, current) {
    const els = Array.prototype.filter.call(root.querySelectorAll("img, svg"), function (el) {
      if (el === current) return true;
      if (!candidate(el) || el.getClientRects().length === 0) return false;
      return !(el.localName === "img" && linkAway(el));
    });
    if (els.indexOf(current) === -1) els.push(current);
    return els;
  }

  /* ---- The viewer ------------------------------------------------------------- */

  let ui = null;
  const st = {
    open: false, items: [], index: 0, s: 1, tx: 0, ty: 0, fw: 0, fh: 0, W: 0, H: 0,
    pushed: false, chrome: true, hiLoaded: false, lastTap: null, tapTimer: 0, opener: null
  };

  function build() {
    if (ui) return ui;
    const root = document.createElement("div");
    root.className = "lb";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Image viewer");
    root.innerHTML =
      '<div class="lb-stage"><div class="lb-slide"></div></div>' +
      '<div class="lb-top"><span class="lb-count" aria-live="polite"></span>' +
      '<button type="button" class="lb-btn lb-close" aria-label="Close image viewer" title="Close">' +
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg></button></div>' +
      '<button type="button" class="lb-btn lb-nav lb-prev" aria-label="Previous image" title="Previous"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5"/></svg></button>' +
      '<button type="button" class="lb-btn lb-nav lb-next" aria-label="Next image" title="Next"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg></button>' +
      '<div class="lb-cap"></div>';
    document.body.appendChild(root);
    ui = {
      root: root,
      stage: root.querySelector(".lb-stage"),
      slide: root.querySelector(".lb-slide"),
      count: root.querySelector(".lb-count"),
      cap: root.querySelector(".lb-cap"),
      close: root.querySelector(".lb-close"),
      prev: root.querySelector(".lb-prev"),
      next: root.querySelector(".lb-next"),
      media: null
    };
    ui.close.addEventListener("click", function () { close(); });
    ui.prev.addEventListener("click", function () { go(-1); });
    ui.next.addEventListener("click", function () { go(1); });
    wireGestures(ui.stage);
    return ui;
  }

  function measureStage() {
    st.W = ui.stage.clientWidth || global.innerWidth;
    st.H = ui.stage.clientHeight || global.innerHeight;
  }

  function fit(item) {
    measureStage();
    const pad = st.W < 600 ? 0 : 48;
    const maxW = st.W - pad * 2;
    const maxH = st.H - pad * 2;
    const w = item.w || maxW;
    const h = item.h || maxH;
    /* Never blow a small image past 2× its own size at 1×. */
    const k = Math.min(maxW / w, maxH / h, item.kind === "img" ? 2 : 8);
    st.fw = Math.max(1, w * k);
    st.fh = Math.max(1, h * k);
  }

  function apply(animate) {
    const m = ui.media;
    if (!m) return;
    m.classList.toggle("lb-anim", !!animate);
    m.style.transform = "translate(" + st.tx + "px," + st.ty + "px) scale(" + st.s + ")";
    ui.root.classList.toggle("lb-zoomed", st.s > 1.01);
    if (st.s > 1.3) upgrade();
  }

  function bounds(s) {
    return {
      x: Math.max(0, (st.fw * s - st.W) / 2),
      y: Math.max(0, (st.fh * s - st.H) / 2)
    };
  }
  function clampT() {
    const b = bounds(st.s);
    st.tx = Math.max(-b.x, Math.min(b.x, st.tx));
    st.ty = Math.max(-b.y, Math.min(b.y, st.ty));
  }

  /* Zoom to s keeping the content point under (mx, my) (stage-centre coordinates) in place. */
  function zoomAt(s, mx, my, animate) {
    s = Math.max(1, Math.min(MAX, s));
    const px = (mx - st.tx) / st.s;
    const py = (my - st.ty) / st.s;
    st.s = s;
    st.tx = mx - px * s;
    st.ty = my - py * s;
    clampT();
    apply(animate);
  }

  function reset(animate) {
    st.s = 1;
    st.tx = 0;
    st.ty = 0;
    apply(animate);
  }

  function upgrade() {
    const item = st.items[st.index];
    if (!item || item.kind !== "img" || st.hiLoaded || !item.full || item.full === item.src) return;
    st.hiLoaded = true;
    const media = ui.media;
    const pre = new Image();
    pre.decoding = "async";
    pre.onload = function () {
      if (ui.media === media && st.items[st.index] === item) media.src = item.full;
    };
    pre.src = item.full;
  }

  function show(index, from) {
    st.index = index;
    st.hiLoaded = false;
    const item = st.items[index];
    ui.slide.textContent = "";
    let media;
    if (item.kind === "img") {
      media = document.createElement("img");
      media.alt = item.alt || "";
      media.decoding = "async";
      media.draggable = false;
      media.src = item.src;
      if (item.filter && item.filter !== "none") media.style.filter = item.filter;
      if (!item.w || !item.h) {
        media.addEventListener("load", function () {
          if (ui.media !== media) return;
          item.w = media.naturalWidth;
          item.h = media.naturalHeight;
          layout();
        }, { once: true });
      }
    } else {
      media = item.node.cloneNode(true);
      media.removeAttribute("id");
      media.setAttribute("preserveAspectRatio", media.getAttribute("preserveAspectRatio") || "xMidYMid meet");
      media.classList.add("lb-svg");
      /* The page's own sizing (min-width for scrolling figures) does not apply here. */
      ["min-width", "max-width", "min-height", "max-height", "margin", "display"].forEach(function (k) {
        media.style.removeProperty(k);
      });
    }
    media.classList.add("lb-media");
    ui.slide.appendChild(media);
    ui.media = media;
    layout();
    st.s = 1;
    st.tx = from ? from * st.W * 0.35 : 0;
    st.ty = 0;
    apply(false);
    if (from) {
      media.style.opacity = "0";
      requestAnimationFrame(function () {
        media.style.opacity = "";
        st.tx = 0;
        apply(true);
      });
    }
    const n = st.items.length;
    ui.count.textContent = n > 1 ? index + 1 + " / " + n : "";
    ui.cap.textContent = item.caption || "";
    ui.cap.hidden = !item.caption;
    ui.prev.hidden = n < 2 || index === 0;
    ui.next.hidden = n < 2 || index === n - 1;
  }

  function layout() {
    const item = st.items[st.index];
    if (!item || !ui.media) return;
    fit(item);
    const m = ui.media;
    m.style.width = st.fw + "px";
    m.style.height = st.fh + "px";
    m.style.left = (st.W - st.fw) / 2 + "px";
    m.style.top = (st.H - st.fh) / 2 + "px";
    clampT();
    apply(false);
  }

  function go(dir) {
    const i = st.index + dir;
    if (i < 0 || i >= st.items.length) {
      reset(true);
      return;
    }
    show(i, dir);
  }

  function setChrome(on) {
    st.chrome = on;
    ui.root.classList.toggle("lb-bare", !on);
  }

  function openItems(items, index, opener) {
    if (!items || !items.length) return;
    build();
    st.items = items;
    st.open = true;
    st.opener = opener || document.activeElement;
    ui.root.hidden = false;
    ui.root.classList.remove("lb-closing");
    ui.root.style.opacity = "";
    setChrome(true);
    document.documentElement.classList.add("lb-open");
    show(Math.max(0, Math.min(items.length - 1, index || 0)), 0);
    ui.close.focus({ preventScroll: true });
    /* Mobile web: the browser's back gesture closes the viewer. The app's back
       button asks isOpen() instead (native.js), so no history entry there. */
    st.pushed = false;
    if (!document.documentElement.classList.contains("native-app") && global.history && global.history.pushState) {
      try {
        global.history.pushState({ readerLightbox: true }, "", global.location.href);
        st.pushed = true;
      } catch (e) { /* ignore */ }
    }
    document.dispatchEvent(new CustomEvent("reader:lightbox", { detail: { open: true } }));
  }

  function close(fromHistory) {
    if (!st.open) return;
    st.open = false;
    clearTimeout(st.tapTimer);
    ui.root.classList.add("lb-closing");
    const media = ui.media;
    setTimeout(function () {
      if (st.open) return;
      ui.root.hidden = true;
      ui.root.classList.remove("lb-closing");
      ui.root.style.opacity = "";
      ui.slide.textContent = "";
      if (ui.media === media) ui.media = null;
    }, 180);
    document.documentElement.classList.remove("lb-open");
    if (st.pushed && !fromHistory) {
      st.pushed = false;
      try {
        global.history.back();
      } catch (e) { /* ignore */ }
    }
    st.pushed = false;
    const back = st.opener;
    st.opener = null;
    if (back && back.focus && back.isConnected) {
      try {
        back.focus({ preventScroll: true });
      } catch (e) { /* ignore */ }
    }
    document.dispatchEvent(new CustomEvent("reader:lightbox", { detail: { open: false } }));
  }

  /* Open on an element of the page, with the document's other images as the set. */
  function openOn(el) {
    const root = el.closest(".markdown-body") || article() || document.body;
    const els = itemsIn(root, el);
    const items = els.map(itemFor);
    openItems(items, els.indexOf(el), el);
  }

  /* ---- Gestures ------------------------------------------------------------------ */

  function wireGestures(stage) {
    const pts = new Map();
    let g = null; /* the gesture in progress */

    function rel(x, y) {
      const r = stage.getBoundingClientRect();
      return { x: x - r.left - r.width / 2, y: y - r.top - r.height / 2 };
    }
    function two() {
      const a = Array.from(pts.values());
      return {
        d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1,
        m: rel((a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2)
      };
    }
    function startOne(p) {
      g = { type: "pending", x0: p.x, y0: p.y, tx0: st.tx, ty0: st.ty, t0: Date.now(), moved: false };
    }
    function startPinch() {
      const t = two();
      g = { type: "pinch", d0: t.d, s0: st.s, m0: t.m, tx0: st.tx, ty0: st.ty };
    }

    stage.addEventListener("pointerdown", function (ev) {
      if (!st.open || (ev.pointerType === "mouse" && ev.button !== 0)) return;
      if (ev.target.closest && ev.target.closest(".lb-btn")) return;
      try {
        stage.setPointerCapture(ev.pointerId);
      } catch (e) { /* ignore */ }
      pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (ui.media) ui.media.classList.remove("lb-anim");
      if (pts.size === 1) startOne(pts.get(ev.pointerId));
      else if (pts.size === 2) startPinch();
      ev.preventDefault();
    });

    stage.addEventListener("pointermove", function (ev) {
      if (!pts.has(ev.pointerId) || !g) return;
      pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (g.type === "pinch") {
        if (pts.size < 2) return;
        const t = two();
        /* Under 1× is allowed while pinching (rubber band); it springs back. */
        const s = Math.max(0.6, Math.min(MAX * 1.15, g.s0 * t.d / g.d0));
        const px = (g.m0.x - g.tx0) / g.s0;
        const py = (g.m0.y - g.ty0) / g.s0;
        st.s = s;
        st.tx = t.m.x - px * s;
        st.ty = t.m.y - py * s;
        g.mLast = t.m;
        apply(false);
        return;
      }
      const p = pts.get(ev.pointerId);
      const dx = p.x - g.x0;
      const dy = p.y - g.y0;
      if (g.type === "pending") {
        if (Math.hypot(dx, dy) < 8) return;
        g.moved = true;
        if (st.s > 1.01) g.type = "pan";
        else if (Math.abs(dx) > Math.abs(dy)) g.type = "swipe";
        else if (dy > 0) g.type = "dismiss";
        else g.type = "pan";
      }
      g.lx = p.x;
      g.ly = p.y;
      g.lt = Date.now();
      if (g.type === "pan") {
        st.tx = g.tx0 + dx;
        st.ty = g.ty0 + dy;
        clampT();
        apply(false);
      } else if (g.type === "swipe") {
        const edge = (dx > 0 && st.index === 0) || (dx < 0 && st.index === st.items.length - 1);
        st.tx = edge ? dx * 0.3 : dx;
        apply(false);
      } else if (g.type === "dismiss") {
        st.ty = dy;
        st.tx = dx * 0.3;
        apply(false);
        ui.root.style.opacity = String(Math.max(0.25, 1 - dy / 500));
      }
    });

    function end(ev) {
      if (!pts.has(ev.pointerId)) return;
      const last = pts.get(ev.pointerId);
      pts.delete(ev.pointerId);
      if (!g) return;
      if (g.type === "pinch") {
        if (pts.size === 1) {
          /* One finger stays down: carry on as a pan from here. */
          const p = Array.from(pts.values())[0];
          g = { type: "pan", x0: p.x, y0: p.y, tx0: st.tx, ty0: st.ty, t0: Date.now(), moved: true, fromPinch: g.mLast || g.m0 };
          return;
        }
        if (pts.size === 0) {
          settle(g.mLast || g.m0);
          g = null;
        }
        return;
      }
      if (pts.size) return;
      const dx = last.x - g.x0;
      const dy = last.y - g.y0;
      const dt = Math.max(1, Date.now() - g.t0);
      if (g.type === "pending" && !g.moved) {
        tap(last);
      } else if (g.type === "swipe") {
        const fast = Math.abs(dx) / dt > 0.5;
        if (Math.abs(dx) > st.W * 0.18 || (fast && Math.abs(dx) > 30)) go(dx < 0 ? 1 : -1);
        else reset(true);
      } else if (g.type === "dismiss") {
        const fast = dy / dt > 0.6;
        if (dy > 110 || (fast && dy > 40)) close();
        else {
          ui.root.style.opacity = "";
          reset(true);
        }
      } else if (g.type === "pan") {
        settle(g.fromPinch || null);
      }
      g = null;
    }
    /* After a gesture: back to 1× if under it, down to the maximum if over it. */
    function settle(m) {
      if (st.s <= 1.0001) reset(true);
      else if (st.s > MAX && m) zoomAt(MAX, m.x, m.y, true);
      else {
        st.s = Math.min(st.s, MAX);
        clampT();
        apply(true);
      }
    }
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", function (ev) {
      pts.delete(ev.pointerId);
      if (!pts.size) {
        g = null;
        ui.root.style.opacity = "";
        if (st.s <= 1) reset(true);
        else {
          clampT();
          apply(true);
        }
      }
    });

    function tap(p) {
      const now = Date.now();
      const prev = st.lastTap;
      if (prev && now - prev.t < 300 && Math.hypot(p.x - prev.x, p.y - prev.y) < 30) {
        clearTimeout(st.tapTimer);
        st.lastTap = null;
        const m = rel(p.x, p.y);
        if (st.s > 1.01) reset(true);
        else zoomAt(DOUBLE, m.x, m.y, true);
        return;
      }
      st.lastTap = { t: now, x: p.x, y: p.y };
      clearTimeout(st.tapTimer);
      st.tapTimer = setTimeout(function () {
        st.lastTap = null;
        if (st.open) setChrome(!st.chrome);
      }, 300);
    }

    stage.addEventListener("wheel", function (ev) {
      if (!st.open) return;
      ev.preventDefault();
      const m = rel(ev.clientX, ev.clientY);
      const k = Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0025));
      if (ui.media) ui.media.classList.remove("lb-anim");
      zoomAt(st.s * k, m.x, m.y, false);
      if (st.s <= 1.001) reset(false);
    }, { passive: false });

    stage.addEventListener("contextmenu", function (ev) { ev.preventDefault(); });
  }

  /* ---- Page hooks ----------------------------------------------------------------- */

  let suppressClick = 0;
  let press = null;

  document.addEventListener("click", function (ev) {
    if (suppressClick && Date.now() - suppressClick < 800) {
      suppressClick = 0;
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const root = article();
    if (!root || !root.contains(ev.target)) return;
    const el = targetOf(ev.target);
    if (!el) return;
    if (el.localName === "img" && linkAway(el)) return; /* the link wins; long press opens */
    ev.preventDefault();
    ev.stopPropagation();
    openOn(el);
  }, true);

  /* Long press on an image that is a link: open it here. */
  document.addEventListener("pointerdown", function (ev) {
    if (ev.pointerType === "mouse" || st.open) return;
    const root = article();
    if (!root || !root.contains(ev.target)) return;
    const el = targetOf(ev.target);
    if (!el || !(el.localName === "img" && linkAway(el))) return;
    const x = ev.clientX;
    const y = ev.clientY;
    press = { el: el, x: x, y: y, timer: setTimeout(function () {
      press = null;
      suppressClick = Date.now();
      openOn(el);
    }, LONG_MS) };
  }, true);
  function cancelPress(ev) {
    if (!press) return;
    if (ev.type === "pointermove" && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) < 10) return;
    clearTimeout(press.timer);
    press = null;
  }
  ["pointermove", "pointerup", "pointercancel", "scroll"].forEach(function (t) {
    document.addEventListener(t, cancelPress, { capture: true, passive: true });
  });
  document.addEventListener("contextmenu", function (ev) {
    const root = article();
    if (root && root.contains(ev.target) && (press || st.open || suppressClick)) ev.preventDefault();
  }, true);

  document.addEventListener("keydown", function (ev) {
    if (!st.open) return;
    const k = ev.key;
    if (k === "Escape") close();
    else if (k === "ArrowLeft") go(-1);
    else if (k === "ArrowRight") go(1);
    else if (k === "+" || k === "=") zoomAt(st.s * 1.5, 0, 0, true);
    else if (k === "-" || k === "_") {
      if (st.s / 1.5 <= 1.01) reset(true);
      else zoomAt(st.s / 1.5, 0, 0, true);
    } else if (k === "0") reset(true);
    else if (k === "Tab") {
      /* keep focus inside the dialog */
      const btns = Array.prototype.filter.call(ui.root.querySelectorAll(".lb-btn"), function (b) { return !b.hidden; });
      const i = btns.indexOf(document.activeElement);
      const n = btns[(i + (ev.shiftKey ? -1 : 1) + btns.length) % btns.length];
      if (n) n.focus();
    } else return;
    ev.preventDefault();
    ev.stopPropagation();
  }, true);

  global.addEventListener("popstate", function () {
    if (st.open && st.pushed) {
      st.pushed = false;
      close(true);
    }
  });
  global.addEventListener("resize", function () {
    if (st.open) layout();
  });
  /* Navigating away (a route change) closes it. */
  global.addEventListener("hashchange", function () {
    if (st.open) {
      st.pushed = false;
      close(true);
    }
  });

  /* Images from a sandboxed HTML note (frame-host.js): plain sources only. */
  function openFromFrame(list, index) {
    const items = [];
    (Array.isArray(list) ? list : []).slice(0, 500).forEach(function (it) {
      if (!it || typeof it.src !== "string") return;
      const ok = function (u) { return typeof u === "string" && u.length < 4000000 && (/^https?:\/\//i.test(u) || /^data:image\//i.test(u)); };
      if (!ok(it.src)) return;
      items.push({
        kind: "img", src: it.src, full: ok(it.full) ? it.full : it.src, alt: String(it.alt || "").slice(0, 500),
        caption: String(it.caption || "").replace(/\s+/g, " ").trim().slice(0, 1000),
        w: Number(it.w) || 0, h: Number(it.h) || 0, filter: ""
      });
    });
    if (items.length) openItems(items, Math.max(0, Math.min(items.length - 1, Number(index) || 0)));
  }

  global.ReaderLightbox = {
    isOpen: function () { return st.open; },
    close: function () { close(); },
    open: openOn,
    openItems: openItems,
    openFromFrame: openFromFrame,
    fullSource: fullSource,
    _state: st
  };
})(window);
