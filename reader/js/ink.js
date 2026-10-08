/* Dark-mode ink for drawings. Black line art (SVG with black or default
   fills/strokes) vanishes on a dark page, so neutral colours are re-mapped onto
   the reader theme: black → text colour, white → page background, greys in
   between (a lightness inversion), and very dark/very light hues are nudged for
   contrast. Genuine colours are left alone.

   Each element is classified once from its computed colours and tagged with
   data-ink tokens; the actual re-mapping is CSS under [data-theme="dark"], so
   toggling the theme switches instantly and light mode is untouched. In
   sandboxed HTML frames the same runs over page-styled HTML (text, backgrounds,
   borders, canvases) and re-classifies whatever the page's scripts change. */
(function (global) {
  const document = global.document;

  const SKIP = ".katex, .MathJax:not(mjx-container), .MathJax_SVG, .MathJax_Display";
  const NON_RENDERED = "defs, symbol, clipPath, mask, pattern, marker, metadata";
  const SVG_SHAPES =
    "path, rect, circle, ellipse, line, polyline, polygon, text, tspan, textPath, use";
  const HTML_SKIP = /^(SCRIPT|STYLE|LINK|META|TITLE|HEAD|NOSCRIPT|TEMPLATE|IMG|VIDEO|AUDIO|IFRAME|OBJECT|EMBED|PICTURE|SOURCE|BR|WBR)$/;
  const MAX_ELEMENTS = 20000;

  let sheet = null;
  const known = new Set();

  function ruleSheet() {
    if (sheet && sheet.ownerNode && sheet.ownerNode.isConnected) return sheet;
    const style = document.createElement("style");
    style.id = "reader-ink";
    (document.head || document.documentElement).appendChild(style);
    sheet = style.sheet;
    known.clear();
    return sheet;
  }

  function parseColor(value) {
    const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(
      String(value || "").trim()
    );
    if (!m) return null;
    let a = m[4] == null ? 1 : parseFloat(m[4]);
    if (m[4] && m[4].slice(-1) === "%") a /= 100;
    return { r: +m[1], g: +m[2], b: +m[3], a: a };
  }

  function hsl(c) {
    const r = c.r / 255, g = c.g / 255, b = c.b / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    let h = 0, s = 0;
    if (d > 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h: h, s: s, l: l, chroma: d };
  }

  /* WCAG relative luminance / contrast, against the dark theme's page colour
     (doc.css [data-theme="dark"] --paper: #141210). */
  const DARK_PAPER_LUM = 0.0066;

  function luminance(r, g, b) {
    const lin = function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  function contrastOnDark(lum) {
    return (lum + 0.05) / (DARK_PAPER_LUM + 0.05);
  }

  /* Same hue, lighter, until it reads on the dark page (contrast >= 4.5). */
  function lightenForDark(t) {
    let l = Math.max(t.l, 0.5);
    let out = fromHsl(t.h, t.s, l);
    while (l < 0.9) {
      const n = parseInt(out, 16);
      if (contrastOnDark(luminance((n >> 16) & 255, (n >> 8) & 255, n & 255)) >= 4.5) break;
      l += 0.04;
      out = fromHsl(t.h, t.s, l);
    }
    return out;
  }

  function hex(n) {
    return Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  }

  function fromHsl(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let rgb;
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return hex((rgb[0] + m) * 255) + hex((rgb[1] + m) * 255) + hex((rgb[2] + m) * 255);
  }

  /* Colours the theme itself supplies (inherited text colour, currentColor in
     MathJax SVG, links): these already follow the theme. */
  function themeColors() {
    const probe = document.createElement("span");
    probe.style.display = "none";
    (document.body || document.documentElement).appendChild(probe);
    const out = new Set();
    ["--ink", "--muted", "--accent", "--accent-ink", "--paper"].forEach(function (v) {
      probe.style.color = "var(" + v + ")";
      out.add(getComputedStyle(probe).color);
    });
    probe.remove();
    return out;
  }

  /* role: "ink" (text, strokes, drawing fills), "fill" (SVG area fills),
     "surface" (HTML backgrounds). Returns a token, or "" to leave it alone. */
  function tokenFor(prop, value, role, theme) {
    if (!value || theme.has(value)) return "";
    const c = parseColor(value);
    if (!c || c.a === 0) return "";
    const t = hsl(c);
    const alpha = c.a < 1 ? Math.round(c.a * 20) * 5 : 100;
    if (t.chroma <= 0.11) {
      if (role === "text" && t.l >= 0.6) return "";
      if (role === "surface" && t.l <= 0.4) return "";
      const ink = Math.round((1 - t.l) * 20) * 5;
      return prop + "-n" + ink + (alpha < 100 ? "-a" + alpha : "");
    }
    if (role !== "surface" && contrastOnDark(luminance(c.r, c.g, c.b)) < 3) {
      return prop + "-c" + lightenForDark(t);
    }
    if ((role === "surface" || role === "fill") && t.l > 0.8) {
      return prop + "-c" + fromHsl(t.h, Math.min(t.s, 0.6), Math.max(0.16, Math.min(0.28, 1 - t.l)));
    }
    return "";
  }

  const PROPS = { f: "fill", s: "stroke", p: "stop-color", c: "color", b: "background-color", d: "border-color" };

  function ensureRule(token) {
    if (known.has(token)) return;
    known.add(token);
    const parts = token.split("-");
    const prop = PROPS[parts[0]];
    let value;
    if (parts[1] === "canvas") {
      value = null;
    } else if (parts[1].charAt(0) === "n") {
      const ink = Number(parts[1].slice(1));
      value = "color-mix(in srgb, var(--ink) " + ink + "%, var(--paper))";
      if (parts[2]) value = "color-mix(in srgb, " + value + " " + parts[2].slice(1) + "%, transparent)";
    } else {
      value = "#" + parts[1].slice(1);
    }
    const sel = '[data-theme="dark"] [data-ink~="' + token + '"]';
    const body =
      value === null
        ? "filter: invert(1) hue-rotate(180deg);"
        : prop + ": " + value + " !important;";
    try {
      ruleSheet().insertRule(sel + " { " + body + " }", ruleSheet().cssRules.length);
    } catch (e) {
      /* unsupported value: leave it */
    }
  }

  function isSvg(el) {
    return el.namespaceURI === "http://www.w3.org/2000/svg";
  }

  function classify(el, theme, html) {
    const cs = getComputedStyle(el);
    const tokens = [];
    function add(t) {
      if (t) tokens.push(t);
    }
    if (isSvg(el)) {
      const tag = el.localName;
      if (tag === "svg") {
        add(tokenFor("b", cs.backgroundColor, "surface", theme));
      } else if (tag === "stop") {
        add(tokenFor("p", cs.stopColor, "ink", theme));
      } else {
        const textish = tag === "text" || tag === "tspan" || tag === "textPath";
        add(tokenFor("f", cs.fill, textish ? "ink" : "fill", theme));
        add(tokenFor("s", cs.stroke, "ink", theme));
      }
      return tokens.join(" ");
    }
    if (!html) return "";
    if (el.localName === "canvas") {
      if (canvasIsLight(el, cs)) add("c-canvas");
      return tokens.join(" ");
    }
    add(tokenFor("c", cs.color, "text", theme));
    add(tokenFor("b", cs.backgroundColor, "surface", theme));
    const w = ["Top", "Right", "Bottom", "Left"];
    const widths = w.map(function (s) {
      return parseFloat(cs["border" + s + "Width"]) || 0;
    });
    if (widths.some(Boolean)) {
      const colors = w.map(function (s) {
        return cs["border" + s + "Color"];
      });
      if (colors.every(function (c) { return c === colors[0]; })) {
        add(tokenFor("d", colors[0], "ink", theme));
      }
    }
    return tokens.join(" ");
  }

  /* Canvases are pixels: in dark mode, invert ones that look like dark-on-light
     or dark-on-transparent drawings (hue-preserving), unless overlaid. */
  function canvasIsLight(canvas, cs) {
    if (cs.position === "absolute" || cs.position === "fixed") return false;
    if (!canvas.width || !canvas.height) return false;
    try {
      const probe = document.createElement("canvas");
      probe.width = probe.height = 8;
      const ctx = probe.getContext("2d");
      ctx.drawImage(canvas, 0, 0, 8, 8);
      const px = ctx.getImageData(0, 0, 8, 8).data;
      let opaque = 0, light = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 32) continue;
        opaque++;
        if ((px[i] + px[i + 1] + px[i + 2]) / 3 > 150) light++;
      }
      return opaque < 32 || light / opaque > 0.5;
    } catch (e) {
      return false; /* tainted: can't tell */
    }
  }

  function collect(root, html, out) {
    const push = function (el) {
      if (out.length < MAX_ELEMENTS) out.push(el);
    };
    const consider = function (el) {
      if (el.closest(SKIP)) return;
      if (isSvg(el)) {
        if (el.closest(NON_RENDERED)) return;
        if (el.localName === "stop" || el.localName === "svg" || el.matches(SVG_SHAPES)) push(el);
        return;
      }
      if (html && !HTML_SKIP.test(el.tagName)) push(el);
    };
    if (root.nodeType !== 1) return out;
    consider(root);
    const sel = html ? "*" : "svg, svg " + SVG_SHAPES.split(", ").join(", svg ") + ", svg stop";
    root.querySelectorAll(sel).forEach(consider);
    return out;
  }

  function apply(elements, html) {
    if (!elements.length) return;
    elements.forEach(function (el) {
      if (el.hasAttribute("data-ink")) el.removeAttribute("data-ink");
    });
    const theme = themeColors();
    const tokens = elements.map(function (el) {
      return el.isConnected ? classify(el, theme, html) : "";
    });
    elements.forEach(function (el, i) {
      if (!tokens[i]) return;
      tokens[i].split(" ").forEach(ensureRule);
      el.setAttribute("data-ink", tokens[i]);
    });
  }

  /* One-off pass (static documents). options.html also covers HTML elements. */
  function scan(root, options) {
    const html = !!(options && options.html);
    apply(collect(root, html, []), html);
  }

  /* Scan now and keep up with DOM changes made by the document's scripts. */
  function watch(root, options) {
    const html = !!(options && options.html);
    scan(root, options);
    const pending = new Set();
    let queued = false;
    function flush() {
      queued = false;
      const list = [];
      pending.forEach(function (el) {
        if (el.isConnected) collect(el, html, list);
      });
      pending.clear();
      apply(list, html);
    }
    const observer = new MutationObserver(function (records) {
      records.forEach(function (r) {
        if (r.type === "childList") {
          r.addedNodes.forEach(function (n) {
            if (n.nodeType === 1) pending.add(n);
          });
        } else if (r.target.nodeType === 1) {
          pending.add(r.target);
        }
      });
      if (pending.size && !queued) {
        queued = true;
        (global.requestAnimationFrame || setTimeout)(flush);
      }
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style", "class", "fill", "stroke", "color", "stop-color", "bgcolor"]
    });
    return observer;
  }

  /* Canvases are drawn after load; look at them again once they have pixels. */
  function rescanCanvases(root) {
    const list = Array.prototype.slice.call(root.querySelectorAll("canvas"));
    apply(list, true);
  }

  global.ReaderInk = { scan: scan, watch: watch, rescanCanvases: rescanCanvases };
})(window);
