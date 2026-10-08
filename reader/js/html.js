/* HTML documents → reader article. Parses untrusted HTML without running it,
   drops page chrome/styling that would fight the reader theme, sanitizes with
   DOMPurify, and renders math with KaTeX (TeX delimiters, MathJax sources,
   MathML with TeX annotations). Already-typeset KaTeX is left alone. */
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

  const FORBID_TAGS = [
    "style", "link", "meta", "base", "title", "noscript", "form", "input",
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

  /* Typeset MathJax output without its source: fall back to the assistive
     MathML it carries (v2 .MJX_Assistive_MathML, v3 mjx-assistive-mml). */
  function convertMathJaxOutput(root) {
    root.querySelectorAll("mjx-container").forEach(function (c) {
      const display = c.getAttribute("display") === "true";
      const mml = c.querySelector("mjx-assistive-mml math, math");
      if (mml) {
        if (display) mml.setAttribute("display", "block");
        c.replaceWith(mml);
        return;
      }
      const svg = c.querySelector("svg");
      if (svg) {
        const box = root.ownerDocument.createElement(display ? "div" : "span");
        box.className = display ? "reader-mjx reader-mjx-display" : "reader-mjx";
        box.appendChild(svg);
        c.replaceWith(box);
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

  function stripChrome(root) {
    root
      .querySelectorAll("script, noscript, nav, [role='navigation'], [aria-hidden='true'][style*='display: none'], [hidden]")
      .forEach(function (el) {
        el.remove();
      });
  }

  function neutralize(wrap) {
    wrap.querySelectorAll("[style]").forEach(function (el) {
      if (el.closest(".katex")) return; /* pre-typeset KaTeX needs its inline layout */
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

  function render(text, ctx) {
    const doc = new DOMParser().parseFromString(String(text || ""), "text/html");
    const title = docTitle(doc);
    const root = pickRoot(doc);
    const store = [];

    convertMathJaxScripts(root, doc, store);
    convertMathJaxOutput(root);
    convertMathML(root, doc, store);
    stripChrome(root);

    const clean = global.DOMPurify.sanitize(root.innerHTML, {
      FORBID_TAGS: FORBID_TAGS,
      FORBID_ATTR: ["srcdoc", "formaction", "ping"]
    });

    const wrap = document.createElement("div");
    wrap.innerHTML = clean;
    neutralize(wrap);
    autoRender(wrap);
    fillMath(wrap, store);
    global.ReaderDoc.finalize(wrap, ctx, { keepCodeMarkup: true });
    if (title) wrap.setAttribute("data-doc-title", title);
    return wrap;
  }

  global.ReaderHTML = { render: render };
})(window);
