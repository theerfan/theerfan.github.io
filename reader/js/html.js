/* HTML documents → reader article. Two paths:

   - Script-free documents are rendered inline: parsed without running, page
     chrome/styling that would fight the reader theme dropped, sanitized with
     DOMPurify, math rendered with KaTeX (TeX delimiters, MathJax sources,
     MathML with TeX annotations); typeset KaTeX and MathJax SVG are kept.
   - Documents with scripts or inline event handlers run for real, isolated in
     a sandboxed iframe (see frame-host.js / frame.js): relative scripts and
     stylesheets are resolved against the document's folder in the repo, the
     page's CSS is layered under the reader theme, and math is rendered by the
     page's own MathJax/KaTeX if it loads one, otherwise by the reader.

   Known analytics beacons are dropped first, so they neither run nor force a
   document into the frame. */
(function (global) {
  const document = global.document;

  /* Element ids the reader itself looks up; documents must not shadow them. */
  const READER_IDS = [
    "menuBtn", "filesBtn", "crumb", "jumpFormBar", "jumpInputBar", "alignGroup",
    "themeBtn", "githubLink", "sidebar", "sidebarTitle", "sidebarMeta",
    "sidebarToggle", "folderTools", "collapseAll", "expandAll", "fileList",
    "truncatedNote", "backdrop", "status", "catalogView", "jumpForm",
    "jumpInput", "jumpError", "repoList", "repoView", "article"
  ];

  /* Class names used by the reader's own CSS; stripped from document markup. */
  const RESERVED_CLASS =
    /^(topbar(-.*)?|brand|crumb|sep|here|home-link|menu-btn|icon-btn|seg|jump(-.*)?|saved-heading|layout|sidebar(-.*)?|folder-.*|file-.*|nested|dir-.*|is-root|is-collapsed|active|muted|truncated|main|status|error|article(-msg)?|catalog|lede|repo-.*|empty|pick-.*|markdown-body|doc-.*|backdrop|view-.*)$/;

  /* <style> is kept only inside inline SVG (scoped to that SVG). */
  const FORBID_TAGS = [
    "link", "meta", "base", "title", "noscript", "form", "input",
    "button", "select", "option", "textarea", "iframe", "frame", "frameset",
    "object", "embed", "applet", "dialog", "template"
  ];

  /* Inline style properties that would clash with the theme (colours, fonts) or
     break the layout (fixed/absolute overlays). Sizes and spacing are kept. */
  const DROP_STYLE = [
    "color", "background", "background-color", "background-image", "font",
    "font-family", "position", "z-index", "top", "left", "right", "bottom"
  ];
  const DROP_ATTRS = ["bgcolor", "background", "color", "text", "link", "vlink", "alink", "face"];

  const MATHJAX_OUTPUT =
    /(^|\s)(MathJax(_\w+)?|mjx-chtml|MJX_Assistive_MathML)(\s|$)/;

  const AUTO_DELIMITERS = [
    { left: "$$", right: "$$", display: true },
    { left: "\\[", right: "\\]", display: true },
    { left: "\\begin{equation}", right: "\\end{equation}", display: true },
    { left: "\\begin{equation*}", right: "\\end{equation*}", display: true },
    { left: "\\begin{align}", right: "\\end{align}", display: true },
    { left: "\\begin{align*}", right: "\\end{align*}", display: true },
    { left: "\\begin{gather}", right: "\\end{gather}", display: true },
    { left: "\\begin{gather*}", right: "\\end{gather*}", display: true },
    { left: "\\(", right: "\\)", display: false },
    { left: "$", right: "$", display: false }
  ];

  const TRACKER_HOSTS =
    /(^|\.)(cloudflareinsights\.com|google-analytics\.com|googletagmanager\.com|googlesyndication\.com|doubleclick\.net|plausible\.io|usefathom\.com|goatcounter\.com|zgo\.at|hotjar\.com|clarity\.ms|segment\.(com|io)|mixpanel\.com|simpleanalyticscdn\.com|umami\.is|statcounter\.com|quantserve\.com|scorecardresearch\.com|facebook\.net|hs-scripts\.com|hs-analytics\.net|matomo\.cloud|stats\.wp\.com)$/i;
  const TRACKER_PATHS = /\/(gtag\/js|analytics\.js|ga\.js|matomo\.js|piwik\.js)(\?|$)/i;
  const TRACKER_INLINE = /\b(gtag\s*\(|dataLayer\s*=|GoogleAnalyticsObject|_gaq\.push|_paq\.push|fbq\s*\()/;

  const JS_TYPES =
    /^(|text\/javascript|application\/javascript|module|text\/ecmascript|application\/ecmascript|text\/jscript|application\/x-javascript|text\/x-javascript)$/;
  const URL_ATTRS = ["href", "src", "action", "formaction", "xlink:href", "data"];

  const RAW_HOST = "raw.githubusercontent.com";

  function scriptType(s) {
    return (s.getAttribute("type") || "").trim().toLowerCase().split(";")[0].trim();
  }

  function isExecutable(s) {
    return JS_TYPES.test(scriptType(s));
  }

  function dropTrackers(doc) {
    doc.querySelectorAll("script").forEach(function (s) {
      const src = s.getAttribute("src");
      if (src) {
        let u;
        try {
          u = new URL(src, "https://document.invalid/");
        } catch (e) {
          return;
        }
        if (TRACKER_HOSTS.test(u.hostname) || TRACKER_PATHS.test(u.pathname)) s.remove();
      } else if (isExecutable(s)) {
        const text = s.textContent || "";
        if (text.length < 4000 && TRACKER_INLINE.test(text)) s.remove();
      }
    });
  }

  /* Does the document need to run code: scripts, on* handlers, javascript: URLs? */
  function needsScripts(doc) {
    const scripts = doc.querySelectorAll("script");
    for (let i = 0; i < scripts.length; i++) if (isExecutable(scripts[i])) return true;
    const all = doc.getElementsByTagName("*");
    for (let i = 0; i < all.length; i++) {
      const attrs = all[i].attributes;
      for (let j = 0; j < attrs.length; j++) {
        const name = attrs[j].name.toLowerCase();
        if (name.indexOf("on") === 0 && name.length > 2) return true;
        if (URL_ATTRS.indexOf(name) !== -1 && /^\s*javascript:/i.test(attrs[j].value)) return true;
      }
    }
    return false;
  }

  /* Pages that ship their own math engine typeset themselves. */
  function loadsOwnMath(doc) {
    return Array.prototype.some.call(doc.querySelectorAll("script"), function (s) {
      if (!isExecutable(s)) return false;
      const src = s.getAttribute("src") || "";
      return /mathjax|katex/i.test(src) || /\b(MathJax\.typeset|renderMathInElement|katex\.render)/.test(s.textContent || "");
    });
  }

  function pickRoot(doc) {
    const body = doc.body;
    if (!body) return doc.documentElement;
    const main = body.querySelector("main, [role='main']");
    if (main) return main;
    const articles = body.querySelectorAll("article");
    if (articles.length === 1) return articles[0];
    return body;
  }

  function docTitle(doc) {
    const t = doc.querySelector("title");
    return t ? (t.textContent || "").replace(/\s+/g, " ").trim() : "";
  }

  function placeholder(doc, store, html, display) {
    const el = doc.createElement(display ? "div" : "span");
    el.setAttribute("data-reader-math", String(store.length));
    store.push(html);
    return el;
  }

  /* LaTeX-isms that LaTeX→HTML converters copy into their TeX annotations but
     KaTeX does not know. */
  const TEX_MACROS = {
    "\\mbox": "\\text{#1}",
    "\\epsfbox": "\\boxed{\\small\\text{figure}}\\vphantom{#1}"
  };

  function texShims(tex) {
    return tex
      .replace(/\\begin\{array\}\[[^\]]*\]/g, "\\begin{array}")
      .replace(/\\raise\s*(-?[\d.]+\s*[a-z]{2})\s*\\hbox\s*\{/g, "\\raisebox{$1}{")
      .replace(/\\boldmath\s*\$([^$]*)\$/g, "\\boldsymbol{$1}");
  }

  function tryKatex(tex, display) {
    try {
      return global.katex.renderToString(texShims(tex), {
        displayMode: display,
        throwOnError: true,
        strict: "ignore",
        macros: Object.assign({}, TEX_MACROS)
      });
    } catch (e) {
      return null;
    }
  }

  function isMathJaxOutput(el) {
    return !!el && typeof el.className === "string" && MATHJAX_OUTPUT.test(el.className);
  }

  /* MathJax v2: <script type="math/tex[; mode=display]"> holds the source and the
     typeset output sits in preceding .MathJax* siblings. Render the source and
     drop the output so nothing is typeset twice. */
  function convertMathJaxScripts(root, doc, store) {
    root.querySelectorAll("script[type]").forEach(function (s) {
      const type = (s.getAttribute("type") || "").toLowerCase();
      if (type.indexOf("math/tex") !== 0) return;
      const display = /mode\s*=\s*display/.test(type);
      let prev = s.previousElementSibling;
      while (isMathJaxOutput(prev)) {
        const before = prev.previousElementSibling;
        prev.remove();
        prev = before;
      }
      const tex = s.textContent || "";
      s.replaceWith(
        placeholder(doc, store, global.ReaderDoc.renderLatex(tex.trim(), display), display)
      );
    });
  }

  /* Typeset MathJax output without its source. v3 SVG output is kept as is
     (it draws with currentColor, and glyphs shared through the global font
     cache resolve once that cache is kept too); otherwise fall back to the
     assistive MathML it carries (v2 .MJX_Assistive_MathML, v3
     mjx-assistive-mml). */
  function convertMathJaxOutput(root) {
    root.querySelectorAll("mjx-container").forEach(function (c) {
      const display = c.getAttribute("display") === "true";
      const svg = c.querySelector(":scope > svg");
      if (svg) {
        const box = root.ownerDocument.createElement(display ? "div" : "span");
        box.className = display ? "reader-mjx reader-mjx-display" : "reader-mjx";
        box.appendChild(svg);
        c.replaceWith(box);
        return;
      }
      const mml = c.querySelector("mjx-assistive-mml math, math");
      if (mml) {
        if (display) mml.setAttribute("display", "block");
        c.replaceWith(mml);
      }
    });
    root.querySelectorAll(".MathJax_Preview, #MathJax_Message, [id^='MathJax_'][style*='hidden']").forEach(function (el) {
      el.remove();
    });
    root.querySelectorAll("[class]").forEach(function (el) {
      if (!el.isConnected || !isMathJaxOutput(el)) return;
      if (/MJX_Assistive_MathML/.test(el.className)) return;
      const mml = el.querySelector("math");
      if (!mml) return;
      if (/Display/.test(el.className)) mml.setAttribute("display", "block");
      el.replaceWith(mml);
    });
  }

  /* Hidden SVGs holding shared <defs> (MathJax's global font cache, sprite
     sheets) often sit outside <main>; bring them along so <use> resolves. */
  function keepSvgDefs(doc, root) {
    if (root === doc.body || root === doc.documentElement) return;
    doc.querySelectorAll("svg").forEach(function (svg) {
      if (root.contains(svg) || svg.parentElement.closest("svg")) return;
      if (!svg.querySelector("defs, symbol")) return;
      const hidden =
        /display\s*:\s*none/i.test(svg.getAttribute("style") || "") ||
        svg.getAttribute("width") === "0" ||
        /^MJX-/.test(svg.id);
      if (hidden) root.appendChild(svg);
    });
  }

  function texFromMathML(m) {
    const ann = m.querySelector(
      'annotation[encoding="application/x-tex"], annotation[encoding="TeX"], annotation[encoding="application/x-latex"]'
    );
    const tex = ann ? ann.textContent : m.getAttribute("alttext");
    return (tex || "").trim();
  }

  /* MathML with a TeX source (LaTeXML, arXiv, pandoc --mathml): typeset with KaTeX
     for consistent typography; if KaTeX can't parse it, keep the MathML for the
     browser's native renderer. */
  function convertMathML(root, doc, store) {
    root.querySelectorAll("math").forEach(function (m) {
      if (!m.isConnected) return;
      const tex = texFromMathML(m);
      if (!tex) return;
      const display =
        m.getAttribute("display") === "block" || m.getAttribute("mode") === "display";
      const html = tryKatex(tex, display);
      if (html) m.replaceWith(placeholder(doc, store, html, display));
    });
  }

  /* <use> only for references inside the document (glyphs, symbols); never
     for external files. */
  function dropExternalUse(root) {
    root.querySelectorAll("use").forEach(function (u) {
      const href = u.getAttribute("href") || u.getAttribute("xlink:href") || "";
      if (href.charAt(0) !== "#") u.remove();
    });
  }

  function stripChrome(root) {
    root
      .querySelectorAll("script, noscript, nav, [role='navigation'], [aria-hidden='true'][style*='display: none'], [hidden]")
      .forEach(function (el) {
        el.remove();
      });
  }

  function neutralize(wrap) {
    wrap.querySelectorAll("[style]").forEach(function (el) {
      /* pre-typeset KaTeX needs its inline layout; SVG styles are drawing, not theme */
      if (el.closest(".katex, svg")) return;
      DROP_STYLE.forEach(function (prop) {
        el.style.removeProperty(prop);
      });
      if (!el.getAttribute("style").trim()) el.removeAttribute("style");
    });
    DROP_ATTRS.forEach(function (attr) {
      wrap.querySelectorAll("[" + attr + "]").forEach(function (el) {
        if (!el.closest("svg")) el.removeAttribute(attr);
      });
    });
    wrap.querySelectorAll("[class]").forEach(function (el) {
      const kept = Array.prototype.filter.call(el.classList, function (c) {
        return !RESERVED_CLASS.test(c);
      });
      if (kept.length === el.classList.length) return;
      if (kept.length) el.setAttribute("class", kept.join(" "));
      else el.removeAttribute("class");
    });
    READER_IDS.forEach(function (id) {
      wrap.querySelectorAll('[id="' + id + '"]').forEach(function (el) {
        el.id = "doc-" + id;
      });
    });
  }

  function autoRender(wrap) {
    if (!global.renderMathInElement) return;
    try {
      global.renderMathInElement(wrap, {
        delimiters: AUTO_DELIMITERS,
        ignoredTags: [
          "script", "noscript", "style", "textarea", "pre", "code", "option",
          "kbd", "samp", "math", "svg", "annotation"
        ],
        ignoredClasses: ["katex", "katex-display", "nohighlight", "tex2jax_ignore", "no-math"],
        throwOnError: false,
        strict: "ignore"
      });
    } catch (e) {
      /* leave raw TeX visible */
    }
  }

  function fillMath(wrap, store) {
    wrap.querySelectorAll("[data-reader-math]").forEach(function (el) {
      const html = store[Number(el.getAttribute("data-reader-math"))];
      if (html == null) {
        el.remove();
        return;
      }
      const t = document.createElement("template");
      t.innerHTML = html;
      el.replaceWith(t.content);
    });
  }

  /* ---- SVG: scoped <style>, inlined SVG images ---------------------------- */

  let svgScopeCount = 0;

  function splitSelectors(text) {
    const out = [];
    let depth = 0;
    let cur = "";
    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i);
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
      if (ch === "," && depth === 0) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  function scopeRules(rules, scope) {
    return Array.prototype.map
      .call(rules, function (r) {
        if (r.selectorText != null && r.style) {
          /* drawing styles only: nothing that could lift it over the reader */
          ["position", "z-index", "inset", "top", "left", "right", "bottom"].forEach(function (p) {
            r.style.removeProperty(p);
          });
          const sel = splitSelectors(r.selectorText)
            .map(function (one) {
              one = one.trim();
              if (/^(svg|:root)\b/i.test(one)) return scope + one.replace(/^(svg|:root)/i, "");
              return scope + " " + one;
            })
            .join(", ");
          return sel + " { " + r.style.cssText + " }";
        }
        if (r.media && r.cssRules) {
          return "@media " + r.media.mediaText + " { " + scopeRules(r.cssRules, scope) + " }";
        }
        if (r.conditionText != null && r.cssRules) {
          return "@supports " + r.conditionText + " { " + scopeRules(r.cssRules, scope) + " }";
        }
        return r.cssText; /* @font-face, @keyframes */
      })
      .join("\n");
  }

  /* <style> inside an SVG applies to the whole page; confine it to its SVG
     (Inkscape/Illustrator exports reuse class names like .st0 across files). */
  function scopeSvgStyles(root) {
    root.querySelectorAll("svg style").forEach(function (style) {
      const svg = style.closest("svg");
      let outer = svg;
      while (outer.parentElement && outer.parentElement.closest("svg")) {
        outer = outer.parentElement.closest("svg");
      }
      let token = outer.getAttribute("data-svg-scope");
      if (!token) {
        svgScopeCount += 1;
        token = "s" + svgScopeCount;
        outer.setAttribute("data-svg-scope", token);
      }
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync((style.textContent || "").replace(/@import[^;]*;/gi, ""));
        style.textContent = scopeRules(sheet.cssRules, '[data-svg-scope="' + token + '"]');
      } catch (e) {
        style.remove();
      }
    });
  }

  const SVG_IMG_MAX_BYTES = 1500000;
  const SVG_IMG_MAX_COUNT = 120;

  /* Parse and sanitize an SVG file; ids get a prefix so several inlined files
     (and the document) can't collide. Returns an <svg> element or null. */
  function svgFromText(text, prefix) {
    const clean = global.DOMPurify.sanitize(text, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_TAGS: ["use", "style"],
      FORBID_TAGS: ["script", "foreignObject", "a"],
      FORBID_ATTR: ["onload", "onclick"]
    });
    const t = document.createElement("template");
    t.innerHTML = clean;
    const svg = t.content.querySelector("svg");
    if (!svg) return null;
    dropExternalUse(svg);

    const ids = new Map();
    svg.querySelectorAll("[id]").forEach(function (el) {
      const next = prefix + "-" + el.id;
      ids.set(el.id, next);
      el.id = next;
    });
    if (ids.size) {
      const swapUrl = function (value) {
        return value.replace(/url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g, function (m, q, id) {
          return ids.has(id) ? "url(#" + ids.get(id) + ")" : m;
        });
      };
      svg.querySelectorAll("*").forEach(function (el) {
        Array.prototype.slice.call(el.attributes).forEach(function (attr) {
          const v = attr.value;
          if ((attr.localName === "href") && v.charAt(0) === "#" && ids.has(v.slice(1))) {
            el.setAttributeNS(attr.namespaceURI, attr.name, "#" + ids.get(v.slice(1)));
          } else if (v.indexOf("url(") !== -1) {
            el.setAttribute(attr.name, swapUrl(v));
          }
        });
      });
      svg.querySelectorAll("style").forEach(function (style) {
        let css = swapUrl(style.textContent || "");
        ids.forEach(function (next, id) {
          css = css.split("#" + id).join("#" + next);
        });
        style.textContent = css;
      });
    }
    return svg;
  }

  /* <img src="….svg">: fetch and inline, so the drawing follows the theme like
     inline SVG does (dark-mode ink). Falls back to the image on any failure. */
  async function inlineSvgImages(container) {
    const imgs = Array.prototype.filter
      .call(container.querySelectorAll("img[src]"), function (img) {
        const src = img.getAttribute("src") || "";
        return /^https:\/\//i.test(src) && /\.svg($|[?#])/i.test(src) && !img.closest("a[href], picture");
      })
      .slice(0, SVG_IMG_MAX_COUNT);
    let n = 0;
    await Promise.all(
      imgs.map(async function (img) {
        let text;
        try {
          const res = await fetch(img.getAttribute("src"), { credentials: "omit" });
          if (!res.ok) return;
          text = await res.text();
        } catch (e) {
          return;
        }
        if (!text || text.length > SVG_IMG_MAX_BYTES) return;
        n += 1;
        svgScopeCount += 1;
        const svg = svgFromText(text, "svgimg" + svgScopeCount);
        if (!svg) return;
        const vb = svg.getAttribute("viewBox");
        const w = parseFloat(svg.getAttribute("width"));
        const h = parseFloat(svg.getAttribute("height"));
        if (!vb && w > 0 && h > 0 && /^[\d.]+(px)?$/.test(svg.getAttribute("width"))) {
          svg.setAttribute("viewBox", "0 0 " + w + " " + h);
        }
        if (!svg.hasAttribute("width") && vb) {
          const box = vb.split(/[\s,]+/).map(Number);
          if (box[2] > 0 && box[3] > 0) {
            svg.setAttribute("width", String(box[2]));
            svg.setAttribute("height", String(box[3]));
          }
        }
        if (img.getAttribute("style")) svg.setAttribute("style", img.getAttribute("style"));
        /* The <img> size goes into CSS: attributes would change the drawing's
           intrinsic aspect ratio. */
        ["width", "height"].forEach(function (a) {
          const v = img.getAttribute(a);
          if (v && /^\d+(\.\d+)?$/.test(v)) svg.style[a] = v + "px";
          else if (v && /^\d+(\.\d+)?%$/.test(v)) svg.style[a] = v;
        });
        if (svg.style.width && !svg.style.height) svg.style.height = "auto";
        if (img.getAttribute("class")) svg.setAttribute("class", img.getAttribute("class"));
        if (img.id) svg.id = img.id;
        svg.classList.add("reader-svg-img");
        scopeSvgStyles(svg);
        svg.setAttribute("role", "img");
        const alt = img.getAttribute("alt");
        if (alt) svg.setAttribute("aria-label", alt);
        const owner = img.ownerDocument;
        img.replaceWith(owner === document ? svg : owner.importNode(svg, true));
      })
    );
    return n;
  }

  /* ---- Inline rendering (no scripts) ------------------------------------- */

  async function renderInline(doc, ctx, title) {
    const root = pickRoot(doc);
    const store = [];

    keepSvgDefs(doc, root);
    convertMathJaxScripts(root, doc, store);
    convertMathJaxOutput(root);
    convertMathML(root, doc, store);
    stripChrome(root);
    root.querySelectorAll("style").forEach(function (style) {
      if (!style.closest("svg")) style.remove();
    });

    const clean = global.DOMPurify.sanitize(root.innerHTML, {
      ADD_TAGS: ["use"],
      FORBID_TAGS: FORBID_TAGS,
      FORBID_ATTR: ["srcdoc", "formaction", "ping"]
    });

    const wrap = document.createElement("div");
    wrap.innerHTML = clean;
    dropExternalUse(wrap);
    wrap.querySelectorAll("style").forEach(function (style) {
      if (!style.closest("svg")) style.remove();
    });
    scopeSvgStyles(wrap);
    neutralize(wrap);
    autoRender(wrap);
    fillMath(wrap, store);
    global.ReaderDoc.finalize(wrap, ctx, { keepCodeMarkup: true });
    await inlineSvgImages(wrap);
    if (title) wrap.setAttribute("data-doc-title", title);
    return wrap;
  }

  /* ---- Framed rendering (documents with scripts) ------------------------- */

  const textCache = new Map();

  function fetchAsset(url) {
    if (!textCache.has(url)) {
      textCache.set(
        url,
        fetch(url, { credentials: "omit" }).then(function (res) {
          if (!res.ok) throw new Error(res.status + " " + url);
          return res.text();
        })
      );
      textCache.get(url).catch(function () {
        textCache.delete(url);
      });
    }
    return textCache.get(url);
  }

  function isRaw(url) {
    try {
      return new URL(url).hostname === RAW_HOST;
    } catch (e) {
      return false;
    }
  }

  /* raw.githubusercontent.com serves text/plain + nosniff, which browsers
     refuse as script/stylesheet; jsDelivr serves the same repo file with real
     types (cached for a while, so used only where the URL itself matters). */
  function jsdelivrUrl(url) {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 4) return url;
    return (
      "https://cdn.jsdelivr.net/gh/" + parts[0] + "/" + parts[1] + "@" + parts[2] + "/" +
      parts.slice(3).join("/") + u.search
    );
  }

  function rebaseCss(css, baseUrl) {
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, function (m, q, ref) {
      if (/^(data:|#|[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref.trim())) return m;
      try {
        return 'url("' + new URL(ref.trim(), baseUrl).href + '")';
      } catch (e) {
        return m;
      }
    });
  }

  /* Put page CSS in @layer page (under the reader's theme guard); @import
     must stay at the top level, so hoist it with a layer() of its own. */
  function layerPage(css, baseUrl, media) {
    const imports = [];
    css = String(css || "")
      .replace(/@charset[^;]*;/gi, "")
      .replace(/@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)([^;]*);/gi, function (m, q, u1, q2, u2, rest) {
        let url;
        try {
          url = new URL(u1 || u2, baseUrl).href;
        } catch (e) {
          return "";
        }
        if (isRaw(url)) url = jsdelivrUrl(url);
        rest = (rest || "").trim();
        if (!/\blayer\b/.test(rest)) rest = "layer(page) " + rest;
        imports.push('@import url("' + url + '") ' + rest.trim() + ";");
        return "";
      });
    if (media) css = "@media " + media + " {\n" + css + "\n}";
    return imports.join("\n") + "\n@layer page {\n" + css + "\n}";
  }

  async function prepareStyles(doc, base) {
    doc.querySelectorAll("style").forEach(function (style) {
      style.textContent = layerPage(style.textContent, base, style.getAttribute("media"));
      style.removeAttribute("media");
    });
    const links = Array.prototype.slice.call(doc.querySelectorAll("link"));
    await Promise.all(
      links.map(async function (link) {
        const rel = (link.getAttribute("rel") || "").toLowerCase();
        const href = link.getAttribute("href");
        if (!/\bstylesheet\b/.test(rel) || /\balternate\b/.test(rel) || !href) {
          link.remove();
          return;
        }
        let url;
        try {
          url = new URL(href, base).href;
        } catch (e) {
          link.remove();
          return;
        }
        const media = link.getAttribute("media");
        const style = doc.createElement("style");
        if (isRaw(url)) {
          try {
            style.textContent = layerPage(rebaseCss(await fetchAsset(url), url), url, media);
          } catch (e) {
            style.textContent = layerPage('@import url("' + url + '");', url, media);
          }
        } else {
          style.textContent =
            '@import url("' + url.replace(/"/g, "%22") + '") layer(page)' + (media ? " " + media : "") + ";";
        }
        link.replaceWith(style);
      })
    );
  }

  /* Repo-hosted classic scripts become data: URLs (keeping order, async and
     defer exactly as the page wrote them); modules go to jsDelivr so their
     relative imports resolve. Other absolute URLs (CDNs) load as usual. */
  async function prepareScripts(doc, base) {
    const scripts = Array.prototype.filter.call(doc.querySelectorAll("script[src]"), isExecutable);
    await Promise.all(
      scripts.map(async function (s) {
        let url;
        try {
          url = new URL(s.getAttribute("src"), base).href;
        } catch (e) {
          s.remove();
          return;
        }
        if (!isRaw(url)) {
          s.setAttribute("src", url);
          return;
        }
        s.removeAttribute("integrity");
        if (scriptType(s) === "module") {
          s.setAttribute("src", jsdelivrUrl(url));
          return;
        }
        try {
          const code = await fetchAsset(url);
          s.setAttribute(
            "src",
            "data:text/javascript;charset=utf-8," + encodeURIComponent(code + "\n//# sourceURL=" + url)
          );
        } catch (e) {
          s.setAttribute("src", jsdelivrUrl(url));
        }
      })
    );
  }

  function docBase(doc, ctx) {
    const dir = global.ReaderDoc.fileDir(ctx.path);
    const rawDir = dir ? global.ReaderDoc.rawUrl(ctx, dir) + "/" : global.ReaderDoc.rawUrl(ctx, "");
    const own = doc.querySelector("base[href]");
    let base = rawDir;
    if (own) {
      try {
        base = new URL(own.getAttribute("href"), rawDir).href;
      } catch (e) {
        base = rawDir;
      }
    }
    doc.querySelectorAll("base").forEach(function (b) {
      b.remove();
    });
    return base;
  }

  async function renderFramed(doc, ctx, title) {
    const body = doc.body;
    doc.querySelectorAll("noscript, meta[http-equiv]").forEach(function (el) {
      if (el.localName === "meta" && /content-type/i.test(el.getAttribute("http-equiv"))) return;
      el.remove();
    });
    const base = docBase(doc, ctx);

    if (!loadsOwnMath(doc)) {
      const store = [];
      convertMathJaxScripts(body, doc, store);
      convertMathJaxOutput(body);
      convertMathML(body, doc, store);
      autoRender(body);
      fillMath(body, store);
    }
    global.ReaderDoc.finalize(body, ctx, { keepCodeMarkup: true, links: false });

    await Promise.all([inlineSvgImages(body), prepareStyles(doc, base), prepareScripts(doc, base)]);

    doc.head.insertAdjacentHTML("afterbegin", global.ReaderFrame.prologue(base));
    doc.documentElement.setAttribute("data-reader-frame", "");
    doc.documentElement.setAttribute("data-theme", global.ReaderFrame.theme());
    body.classList.add("markdown-body", "doc-html");

    const srcdoc = "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
    const wrap = document.createElement("div");
    wrap.appendChild(global.ReaderFrame.mount(srcdoc, ctx, title));
    wrap.setAttribute("data-doc-framed", "");
    if (title) wrap.setAttribute("data-doc-title", title);
    return wrap;
  }

  /* Returns a promise of a <div> holding the rendered document. A framed
     document's <div> carries data-doc-framed. */
  async function render(text, ctx) {
    const doc = new DOMParser().parseFromString(String(text || ""), "text/html");
    const title = docTitle(doc);
    dropTrackers(doc);
    if (needsScripts(doc)) return renderFramed(doc, ctx, title);
    return renderInline(doc, ctx, title);
  }

  global.ReaderHTML = { render: render, inlineSvgImages: inlineSvgImages };
})(window);
