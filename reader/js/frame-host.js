/* Hosts HTML documents that carry scripts. They run inside a sandboxed iframe
   (sandbox="allow-scripts" only: opaque origin, so no access to the reader's
   DOM, localStorage or cookies; no top navigation, popups, forms, downloads or
   modals). The frame gets the reader theme, fonts and KaTeX CSS injected and
   talks to the reader only via postMessage (js/frame.js on the other side):

     frame → reader  ready | height | link | anchor | interact | tops
     reader → frame  theme | locate | tops

   Messages are accepted only from the current frame's window with the opaque
   "null" origin, are shape-checked, and links are honoured only during a user
   gesture and only as reader routes, http(s)/mailto URLs or raw repo files. */
(function (global) {
  const document = global.document;
  const script = document.currentScript;
  const JS_BASE = new URL(".", script ? script.src : document.baseURI).href;
  const VERSION = script ? new URL(script.src).search : "";
  const MAX_HEIGHT = 500000;

  const state = {
    frame: null,
    mark: null,
    ctx: null,
    ready: false,
    seq: 0,
    pending: null,
    lastLink: 0,
    settleUntil: 0,
    userMoved: false
  };

  function asset(rel) {
    return new URL(rel + VERSION, JS_BASE).href;
  }

  function theme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function warmth() {
    return document.documentElement.style.getPropertyValue("--warmth") || "0";
  }

  /* Theme, warm text, reading font and text size, as the frame applies them. */
  function look() {
    const root = document.documentElement;
    return {
      type: "theme",
      theme: theme(),
      warmth: warmth(),
      font: root.getAttribute("data-font") || "",
      scale: root.style.getPropertyValue("--text-scale") || ""
    };
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  /* <head> prologue for a framed document: base URL for its relative assets,
     the bootstrap, and the reader's styles. The reader's stylesheets (fonts,
     KaTeX, highlight.js, doc.css; same order as on the reader page) sit in
     @layer reader, the page's own CSS is moved into @layer page above it, and
     frame.css (unlayered) keeps the theme's colours and fonts on top. */
  function prologue(baseHref) {
    const imports = [];
    document.querySelectorAll('link[rel~="stylesheet"][href]').forEach(function (l) {
      if (/\/css\/styles\.css/.test(l.href)) return; /* reader chrome only */
      imports.push('@import url("' + l.href.replace(/"/g, "%22") + '") layer(reader);');
    });
    return [
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<base href="' + escapeAttr(baseHref) + '">',
      '<script src="' + escapeAttr(asset("ink.js")) + '"></script>',
      '<script src="' + escapeAttr(asset("frame.js")) + '" data-host-origin="' +
        escapeAttr(global.location.origin) + '"></script>',
      "<style>@layer reader, page;\n" + imports.join("\n") + "</style>",
      '<link rel="stylesheet" href="' + escapeAttr(asset("../css/frame.css")) + '">'
    ].join("\n");
  }

  function mount(srcdoc, ctx, title) {
    const wrap = document.createElement("div");
    wrap.className = "doc-frame-wrap";
    const frame = document.createElement("iframe");
    frame.className = "doc-frame";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("title", title || "Document");
    frame.srcdoc = srcdoc;
    const mark = document.createElement("span");
    mark.className = "doc-frame-mark";
    mark.setAttribute("aria-hidden", "true");
    wrap.appendChild(frame);
    wrap.appendChild(mark);

    state.frame = frame;
    state.mark = mark;
    state.ctx = ctx;
    state.ready = false;
    state.pending = null;
    return wrap;
  }

  function active() {
    return !!(state.frame && state.frame.isConnected);
  }

  function send(msg) {
    if (!active() || !state.frame.contentWindow) return;
    msg.reader = "doc-host";
    /* An opaque-origin frame can only be addressed with "*"; messages carry
       nothing private (theme name, anchor id). */
    state.frame.contentWindow.postMessage(msg, "*");
  }

  function onUserMove() {
    state.userMoved = true;
  }

  /* Scroll the reader to an anchor inside the frame. Without smooth (initial
     load / deep link) keep following it while the frame settles (fonts,
     images, scripts), until the reader scrolls by hand. */
  function scrollTo(id, smooth) {
    state.seq += 1;
    state.pending = { id: id, smooth: !!smooth, seq: state.seq };
    if (!smooth) {
      state.userMoved = false;
      state.settleUntil = Date.now() + 5000;
      ["wheel", "touchstart", "mousedown", "keydown"].forEach(function (type) {
        global.addEventListener(type, onUserMove, { once: true, passive: true, capture: true });
      });
    }
    if (state.ready) send({ type: "locate", id: id, seq: state.seq });
  }

  function settling() {
    return (
      state.pending &&
      !state.pending.smooth &&
      !state.userMoved &&
      Date.now() < state.settleUntil
    );
  }

  function onAnchor(d) {
    const p = state.pending;
    if (!p || d.seq !== p.seq || !d.found) return;
    const top = Number(d.top);
    if (!isFinite(top)) return;
    if (!p.smooth && state.userMoved) return;
    state.mark.style.top = Math.max(0, Math.min(MAX_HEIGHT, top)) + "px";
    state.mark.scrollIntoView({ behavior: p.smooth ? "smooth" : "auto", block: "start" });
  }

  /* Heading positions inside the frame (js/resume.js): [{ id, top, text }]. */
  const topsWaiting = {};
  function tops() {
    if (!active() || !state.ready) return Promise.resolve(null);
    state.seq += 1;
    const seq = state.seq;
    return new Promise(function (resolve) {
      topsWaiting[seq] = resolve;
      send({ type: "tops", seq: seq });
      setTimeout(function () {
        if (topsWaiting[seq]) {
          delete topsWaiting[seq];
          resolve(null);
        }
      }, 1000);
    });
  }
  function onTops(d) {
    const resolve = topsWaiting[d.seq];
    if (!resolve || !Array.isArray(d.items)) return;
    delete topsWaiting[d.seq];
    const items = [];
    for (let i = 0; i < d.items.length && items.length < 3000; i++) {
      const h = d.items[i];
      if (!h || typeof h.id !== "string" || !isFinite(Number(h.top))) continue;
      items.push({ id: h.id.slice(0, 300), top: Number(h.top), text: String(h.text || "").slice(0, 160) });
    }
    resolve(items);
  }

  function onLink(d) {
    const href = d.href;
    if (typeof href !== "string" || !href || href.length > 4096) return;
    /* Only follow links the reader actually clicked (activation propagates
       from the frame to the reader); scripts can't navigate the reader. */
    const ua = global.navigator.userActivation;
    if (ua && !ua.isActive) return;
    /* One navigation per gesture: a script can't turn one click into a burst. */
    const now = Date.now();
    if (now - state.lastLink < 1000) return;
    state.lastLink = now;
    const ctx = state.ctx;
    const target = global.ReaderDoc.resolveHref(ctx, href);
    if (target.kind === "anchor") {
      if (!target.id) return;
      const hash = global.ReaderDoc.hashFor(ctx.owner, ctx.repo, ctx.path, target.id);
      if (global.history && global.history.replaceState) global.history.replaceState(null, "", hash);
      scrollTo(target.id, true);
    } else if (target.kind === "route") {
      if (d.newTab) global.open(global.location.pathname + target.hash, "_blank", "noopener");
      else global.location.hash = target.hash;
    } else if (target.kind === "external" || target.kind === "file") {
      const url = new URL(target.url, "https://example.invalid/");
      if (!/^(https?|mailto):$/.test(url.protocol)) return;
      global.open(url.href, "_blank", "noopener,noreferrer");
    }
  }

  global.addEventListener("message", function (ev) {
    const frame = state.frame;
    if (!frame || !frame.isConnected || ev.source !== frame.contentWindow) return;
    if (ev.origin !== "null") return; /* must still be the opaque sandbox */
    const d = ev.data;
    if (!d || typeof d !== "object" || d.reader !== "doc-frame") return;
    switch (d.type) {
      case "ready":
        state.ready = true;
        send(look());
        if (state.pending) send({ type: "locate", id: state.pending.id, seq: state.pending.seq });
        break;
      case "height": {
        const h = Number(d.height);
        if (!isFinite(h)) return;
        frame.style.height = Math.max(40, Math.min(MAX_HEIGHT, Math.ceil(h))) + "px";
        if (settling()) send({ type: "locate", id: state.pending.id, seq: state.pending.seq });
        break;
      }
      case "anchor":
        onAnchor(d);
        break;
      case "link":
        onLink(d);
        break;
      case "interact":
        state.userMoved = true;
        document.dispatchEvent(new CustomEvent("reader:frame-interact"));
        break;
      case "tops":
        onTops(d);
        break;
      default:
        break;
    }
  });

  /* Live theme: follow the reader's data-theme, data-font and the --warmth and
     --text-scale inline styles into the frame. */
  new MutationObserver(function () {
    send(look());
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-font", "style"]
  });

  global.ReaderFrame = {
    prologue: prologue,
    mount: mount,
    active: active,
    scrollTo: scrollTo,
    tops: tops,
    theme: theme
  };
})(window);
