/* Bootstrap for HTML documents that carry scripts. It runs first inside the
   document's sandboxed iframe (sandbox="allow-scripts", no allow-same-origin:
   an opaque origin with no access to the reader's DOM, storage or cookies) and
   talks to the reader only through postMessage (see frame-host.js):

     → host  { type: "ready" | "height" | "link" | "anchor" | "interact" }
     ← host  { type: "theme" | "locate" }

   It also gives the page in-memory localStorage/sessionStorage/cookies (the
   real ones are unavailable to an opaque origin), keeps the frame as tall as
   its content so the reader scrolls it like a normal page, hands link clicks
   to the reader, and runs dark-mode ink over whatever the page draws. */
(function () {
  "use strict";
  var script = document.currentScript;
  var hostOrigin = (script && script.getAttribute("data-host-origin")) || "*";
  var root = document.documentElement;
  var host = window.parent;

  function post(msg) {
    msg.reader = "doc-frame";
    try {
      host.postMessage(msg, hostOrigin);
    } catch (e) {
      /* host gone */
    }
  }

  /* Storage stand-ins: pages that remember settings keep working (per view). */
  function memoryStorage() {
    var data = Object.create(null);
    return {
      get length() {
        return Object.keys(data).length;
      },
      key: function (i) {
        var k = Object.keys(data);
        return i < k.length ? k[i] : null;
      },
      getItem: function (k) {
        k = String(k);
        return k in data ? data[k] : null;
      },
      setItem: function (k, v) {
        data[String(k)] = String(v);
      },
      removeItem: function (k) {
        delete data[String(k)];
      },
      clear: function () {
        data = Object.create(null);
      }
    };
  }

  ["localStorage", "sessionStorage"].forEach(function (name) {
    var ok = false;
    try {
      ok = !!window[name];
    } catch (e) {
      ok = false;
    }
    if (ok) return;
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        value: memoryStorage()
      });
    } catch (e) {
      /* leave it throwing */
    }
  });

  try {
    void document.cookie;
  } catch (e) {
    var jar = Object.create(null);
    try {
      Object.defineProperty(document, "cookie", {
        configurable: true,
        get: function () {
          return Object.keys(jar)
            .map(function (k) {
              return k + "=" + jar[k];
            })
            .join("; ");
        },
        set: function (v) {
          var pair = String(v).split(";")[0];
          var i = pair.indexOf("=");
          if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
        }
      });
    } catch (e2) {
      /* leave it throwing */
    }
  }

  /* Messages from the reader: theme switches and anchor look-ups. */
  window.addEventListener("message", function (ev) {
    if (ev.source !== host) return;
    if (hostOrigin !== "*" && ev.origin !== hostOrigin) return;
    var d = ev.data;
    if (!d || typeof d !== "object" || d.reader !== "doc-host") return;
    if (d.type === "theme" && (d.theme === "dark" || d.theme === "light")) {
      root.setAttribute("data-theme", d.theme);
    } else if (d.type === "locate") {
      locate(String(d.id || ""), d.seq);
    }
  });

  function findTarget(id) {
    if (!id) return null;
    var el = document.getElementById(id);
    if (el) return el;
    var named = document.getElementsByName(id);
    return named.length ? named[0] : null;
  }

  function locate(id, seq) {
    var el = findTarget(id);
    var top = null;
    if (el) {
      var margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
      top = el.getBoundingClientRect().top + window.scrollY - margin;
    }
    post({ type: "anchor", seq: seq, id: id, found: !!el, top: top });
  }

  /* Links: the page's own handlers run first; whatever is left (a plain
     navigation) is handed to the reader, which resolves it against the
     document's place in the repo. javascript: links stay inside the frame. */
  function linkFrom(ev) {
    if (ev.defaultPrevented) return null;
    var t = ev.target;
    var a = t && t.closest ? t.closest("a") : null;
    if (!a) return null;
    var href =
      a.getAttribute("href") ||
      a.getAttribute("xlink:href") ||
      a.getAttributeNS("http://www.w3.org/1999/xlink", "href");
    if (!href || /^\s*javascript:/i.test(href)) return null;
    return { a: a, href: href };
  }

  window.addEventListener("click", function (ev) {
    if (ev.button !== 0) return;
    var link = linkFrom(ev);
    if (!link) return;
    ev.preventDefault();
    post({
      type: "link",
      href: link.href,
      newTab: !!(ev.metaKey || ev.ctrlKey || ev.shiftKey)
    });
  });

  window.addEventListener("auxclick", function (ev) {
    if (ev.button !== 1) return;
    var link = linkFrom(ev);
    if (!link) return;
    ev.preventDefault();
    post({ type: "link", href: link.href, newTab: true });
  });

  /* Height: report the content height so the host sizes the frame to fit.
     Pages sized in vh units would grow forever (the frame's viewport is the
     frame); stop following after a burst of back-to-back growth. */
  var lastHeight = -1;
  var growth = [];
  var frozen = false;

  function measure() {
    if (frozen) return;
    var scrollbar = Math.max(0, window.innerHeight - root.clientHeight);
    var h = Math.ceil(root.getBoundingClientRect().height + scrollbar);
    if (h === lastHeight) return;
    if (h > lastHeight && lastHeight > 0) {
      var now = Date.now();
      growth.push(now);
      growth = growth.filter(function (t) {
        return now - t < 3000;
      });
      if (growth.length > 30) {
        frozen = true;
        return;
      }
    }
    lastHeight = h;
    post({ type: "height", height: h });
  }

  var queued = false;
  function scheduleMeasure() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      measure();
    });
  }

  if (window.ResizeObserver) new ResizeObserver(scheduleMeasure).observe(root);
  [200, 600, 1500, 3000, 6000].forEach(function (ms) {
    setTimeout(measure, ms);
  });

  var told = false;
  ["wheel", "touchstart", "keydown", "mousedown"].forEach(function (type) {
    window.addEventListener(
      type,
      function () {
        if (told) return;
        told = true;
        post({ type: "interact" });
      },
      { capture: true, passive: true }
    );
  });

  document.addEventListener("DOMContentLoaded", function () {
    var body = document.body;
    if (body) {
      body.classList.add("markdown-body", "doc-html");
      if (window.ReaderInk) window.ReaderInk.watch(body, { html: true });
    }
    post({ type: "ready" });
    measure();
  });

  window.addEventListener("load", function () {
    measure();
    if (window.ReaderInk && document.body) {
      setTimeout(function () {
        window.ReaderInk.rescanCanvases(document.body);
      }, 300);
    }
  });
})();
