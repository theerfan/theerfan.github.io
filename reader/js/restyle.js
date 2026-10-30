/* Reader style for web pages.

   HTML documents that need scripts normally run in a sandboxed frame with their own
   design (html.js). "Reader style" instead extracts the article from the page and
   renders it like any other note: the reader's fonts, text size, theme (dark mode,
   warmth), math and outline. Interactive parts that can't work without the page's
   scripts are replaced by a note that switches back to the original page.

   The ⋯ menu's "Page style" picks Reader or Original. The choice is remembered per site
   (per adapter, else per host of the page's original address) or, for a note with no
   original address, per document. Web pages (an adapter matches, or the page says where
   it came from: a saved article, a canonical link) default to Reader; other notes default
   to Original, since they are usually interactive notes written for the reader.

   Adapters teach it a family of pages. Each is an object passed to
   ReaderRestyle.register():

     id        stable key (stored in the remembered choice)
     name      shown in the menu ("Distill article")
     match(doc, page)     true when this adapter handles the page
     prepare(doc, page)   optional, may be async: rewrite script-driven markup into plain
                          HTML (custom elements, math sources, citations) and fill
                          page.title / page.byline
     root(doc, page)      optional: the element holding the article (default: generic)
     drop                 optional: selectors removed from the article

   `page` is { url (original address, when the page says), ctx, title, byline,
   fetchSibling(relPath) → text of a file next to the document, notePair(label, el) →
   a footnote reference for el's content, references: [<li>] for a reference list }.
   Without an adapter the generic extractor uses <main>/<article> or the block with the
   most paragraph text, and the generic rules below (popover footnotes, lazy images,
   page layout styles, script-built widgets). How to add a site: js/restyle-sites.js. */
(function (global) {
  "use strict";
  const document = global.document;
  const adapters = [];
  const STORE_KEY = "reader-page-style";

  function register(adapter) {
    adapters.push(adapter);
  }

  /* ---- Remembered choice ------------------------------------------------- */

  function readModes() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  }
  function writeMode(key, mode) {
    const all = readModes();
    all[key] = mode;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(all));
    } catch (e) {
      /* private mode: choice lasts for this page only */
    }
  }

  /* ---- Page facts --------------------------------------------------------- */

  /* The page's original address: canonical link, og:url, or the note the app's
     "Save article" writes at the top of an offline copy. */
  function originalUrl(doc, text) {
    const link = doc.querySelector('link[rel="canonical"][href^="http"]');
    if (link) return link.getAttribute("href");
    const og = doc.querySelector('meta[property="og:url"][content^="http"]');
    if (og) return og.getAttribute("content");
    const m = String(text || "").slice(0, 2000).match(/<!--\s*Offline copy of (https?:\/\/\S+)/);
    return m ? m[1] : "";
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (e) {
      return "";
    }
  }

  function makePage(doc, ctx, text) {
    const dir = global.ReaderDoc.fileDir(ctx.path);
    return {
      url: ctx.web || originalUrl(doc, text),
      ctx: ctx,
      title: "",
      byline: "",
      fetchSibling: function (rel) {
        if (ctx.web) {
          return global.fetch(new URL(rel, ctx.web).href, { credentials: "omit", readerCache: true }).then(function (res) {
            if (!res.ok) throw new Error(res.status + " " + rel);
            return res.text();
          });
        }
        const path = (dir ? dir + "/" : "") + String(rel).replace(/^\.?\//, "");
        return global.ReaderGitHub.fetchText(ctx.owner, ctx.repo, ctx.branch, path);
      }
    };
  }

  /* Which adapter applies, the remembered key and the mode to render in. */
  function plan(doc, ctx, text) {
    const page = makePage(doc, ctx, text);
    let adapter = null;
    for (let i = 0; i < adapters.length && !adapter; i++) {
      try {
        if (adapters[i].match(doc, page)) adapter = adapters[i];
      } catch (e) {
        /* a broken adapter must not break rendering */
      }
    }
    const host = hostOf(page.url);
    const key = adapter
      ? "site:" + adapter.id
      : host
        ? "host:" + host
        : "doc:" + [ctx.owner, ctx.repo, ctx.path].join("/").toLowerCase();
    const stored = readModes()[key];
    const web = !!(adapter || host);
    const mode = stored === "reader" || stored === "original" ? stored : web ? "reader" : "original";
    const result = { key: key, mode: mode, adapter: adapter, page: page, name: adapter ? adapter.name : host };
    state.current = { path: ctx.path, key: key, mode: mode, name: result.name };
    return result;
  }

  /* ---- Generic extraction -------------------------------------------------- */

  function textLength(el) {
    return (el.textContent || "").replace(/\s+/g, " ").trim().length;
  }

  /* Length of the text written straight into `el` (not inside child elements). */
  function directText(el) {
    let n = 0;
    el.childNodes.forEach(function (c) {
      if (c.nodeType === 3) n += c.textContent.replace(/\s+/g, " ").trim().length;
    });
    return n;
  }

  /* <main>, a single <article>, or the block whose paragraphs hold the most text
     (paragraph elements, or text written straight into a block between <br>s, as old
     sites do). */
  function findArticle(doc) {
    const body = doc.body;
    const main = body.querySelector("main, [role='main']");
    if (main && textLength(main) > 500) return main;
    const articles = body.querySelectorAll("article");
    if (articles.length === 1 && textLength(articles[0]) > 500) return articles[0];
    const scores = new Map();
    body.querySelectorAll("p, pre, blockquote, li").forEach(function (p) {
      const n = textLength(p);
      if (n < 40) return;
      const parent = p.parentElement;
      if (!parent) return;
      scores.set(parent, (scores.get(parent) || 0) + n);
      const grand = parent.parentElement;
      if (grand) scores.set(grand, (scores.get(grand) || 0) + n / 2);
    });
    body.querySelectorAll("div, td, font, section, article, center, span").forEach(function (el) {
      const n = directText(el);
      if (n > 200) scores.set(el, (scores.get(el) || 0) + n);
    });
    let best = null;
    let bestScore = 0;
    scores.forEach(function (score, el) {
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    });
    return best && bestScore > 500 ? best : main || body;
  }

  const CHROME =
    "script:not([type^='math/tex']), noscript, nav, [role='navigation'], [role='search'], form, input, select, " +
    "textarea, .skip-link, [class*='share'], [class*='newsletter'], [class*='subscribe'], [class*='cookie']";

  let noteCount = 0;

  /* button[aria-describedby] + [role=tooltip] (and similar popovers): the marker becomes
     a numbered link, the popup text a note at the end. */
  function popoverNotes(root, notes) {
    root.querySelectorAll("[aria-describedby]").forEach(function (mark) {
      const id = mark.getAttribute("aria-describedby");
      const pop = id && root.querySelector('[id="' + CSS.escape(id) + '"]');
      if (!pop || !/tooltip|dialog/.test(pop.getAttribute("role") || "") || !mark.isConnected) return;
      notes.push(notePair(mark.ownerDocument, (mark.textContent || "").trim(), pop));
      const n = notes.length;
      mark.replaceWith(notes[n - 1].ref);
      pop.remove();
    });
  }

  /* A footnote reference and its body: { ref: <sup>, body: Element, label }. */
  function notePair(doc, label, content) {
    noteCount += 1;
    const id = "rs-note-" + noteCount;
    const sup = doc.createElement("sup");
    sup.className = "restyle-note-ref";
    const a = doc.createElement("a");
    a.href = "#" + id;
    a.id = id + "-ref";
    sup.appendChild(a);
    const body = doc.createElement("li");
    body.id = id;
    while (content.firstChild) body.appendChild(content.firstChild);
    const back = doc.createElement("a");
    back.href = "#" + id + "-ref";
    back.className = "restyle-back";
    back.setAttribute("aria-label", "Back to the text");
    back.textContent = " ↩";
    body.appendChild(back);
    return { ref: sup, body: body, label: label, link: a };
  }

  function interactiveNote(doc) {
    const p = doc.createElement("p");
    p.className = "restyle-interactive";
    p.innerHTML =
      'Interactive figure. <a href="#" data-restyle-mode="original">Show the original page</a> to use it.';
    return p;
  }

  /* Containers in `root` whose id the page's inline scripts mention as a string
     (getElementById("x"), querySelector("#x"), var eid = "x"; …): where they build
     widgets. Only blocks count, not headings or paragraphs a script merely scrolls to. */
  function scriptTargets(doc, root) {
    const text = Array.prototype.map
      .call(doc.querySelectorAll("script:not([src])"), function (s) { return s.textContent || ""; })
      .join("\n");
    const out = [];
    if (!text) return out;
    root.querySelectorAll("figure[id], div[id], section[id], aside[id]").forEach(function (el) {
      const id = el.id;
      if (id.length < 3) return;
      if (text.indexOf('"' + id) !== -1 || text.indexOf("'" + id) !== -1 || text.indexOf("#" + id) !== -1) out.push(id);
    });
    return out;
  }

  /* A widget shell: no pictures or math and next to no text besides its caption. */
  function hollow(box) {
    if (box.querySelector("img, svg, video, picture, math, .katex, table, pre")) return false;
    let n = textLength(box);
    box.querySelectorAll("figcaption, style, script, template").forEach(function (el) {
      n -= textLength(el);
    });
    return n < 300;
  }

  function swapForNote(box) {
    const caption = box.querySelector(":scope > figcaption");
    const note = interactiveNote(box.ownerDocument);
    if (box.localName === "figure") {
      box.querySelectorAll(":scope > :not(figcaption)").forEach(function (c) {
        c.remove();
      });
      box.insertBefore(note, caption);
    } else {
      box.replaceWith(note);
    }
  }

  /* Things that only work with the page's scripts become one note each. */
  function replaceInteractive(root, targets) {
    const doc = root.ownerDocument;
    (targets || []).forEach(function (id) {
      const el = root.querySelector('[id="' + CSS.escape(id) + '"]');
      if (!el || !el.isConnected || el === root) return;
      const box = el.closest("figure") || el;
      if (root.contains(box) && box !== root && hollow(box)) swapForNote(box);
    });
    root.querySelectorAll("canvas, iframe, object, embed").forEach(function (el) {
      if (!el.isConnected) return;
      const box = el.closest("figure") || el;
      const caption = box.querySelector && box.querySelector("figcaption");
      const note = interactiveNote(doc);
      if (box !== el && caption) {
        box.querySelectorAll(":scope > :not(figcaption)").forEach(function (c) {
          c.remove();
        });
        box.insertBefore(note, caption);
      } else {
        el.replaceWith(note);
      }
    });
    /* Script-built widgets: a figure with controls but next to no content. */
    root.querySelectorAll("figure, [class*='widget'], [id][class*='viewer']").forEach(function (box) {
      if (!box.isConnected || box.querySelector(".restyle-interactive")) return;
      const controls = box.querySelectorAll("button, [role='button'], input, select").length;
      const media = box.querySelectorAll("img, svg, video, picture, math, .katex").length;
      const caption = box.querySelector("figcaption");
      const text = textLength(box) - (caption ? textLength(caption) : 0);
      if (controls && !media && text < 200) {
        box.querySelectorAll(":scope > :not(figcaption)").forEach(function (c) {
          c.remove();
        });
        box.insertBefore(interactiveNote(doc), caption);
      }
    });
    root.querySelectorAll("button, [role='button']").forEach(function (b) {
      b.remove();
    });
  }

  /* The page's layout (breakouts, columns, fixed heights) on containers; pictures keep
     their sizes, and the reader's column caps them. */
  const LAYOUT_STYLE = [
    "width", "min-width", "max-width", "height", "min-height", "max-height", "margin", "margin-left",
    "margin-right", "float", "inset", "transform", "overflow", "grid-column", "grid-area"
  ];
  function dropLayout(root) {
    root.querySelectorAll("[style]").forEach(function (el) {
      if (el.closest("svg, math, .katex") || /^(img|video|picture|source|canvas)$/.test(el.localName)) return;
      LAYOUT_STYLE.forEach(function (prop) {
        el.style.removeProperty(prop);
      });
      if (!el.getAttribute("style").trim()) el.removeAttribute("style");
    });
  }

  function fixLazyImages(root) {
    root.querySelectorAll("img").forEach(function (img) {
      const lazy = img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || img.getAttribute("data-original");
      if (lazy && (!img.getAttribute("src") || /^data:image\/gif|placeholder|blank/i.test(img.getAttribute("src")))) {
        img.setAttribute("src", lazy);
      }
      const set = img.getAttribute("data-srcset");
      if (set && !img.getAttribute("srcset")) img.setAttribute("srcset", set);
      img.removeAttribute("loading");
    });
  }

  /* Presentational wrappers (<font>, <center>) go; their content stays. */
  function unwrapPresentational(root) {
    root.querySelectorAll("font, center, basefont").forEach(function (el) {
      el.replaceWith.apply(el, Array.prototype.slice.call(el.childNodes));
    });
  }

  const BLOCK = /^(P|DIV|TABLE|UL|OL|DL|H[1-6]|BLOCKQUOTE|PRE|FIGURE|HR|SECTION|ARTICLE|ASIDE|DETAILS|FORM)$/;

  /* Text separated by <br><br> instead of <p> becomes paragraphs. */
  function brParagraphs(root) {
    const doc = root.ownerDocument;
    [root].concat(Array.prototype.slice.call(root.querySelectorAll("div, td, blockquote, section, article"))).forEach(function (el) {
      if (el.querySelectorAll(":scope > br").length < 2 || directText(el) < 200) return;
      const nodes = Array.prototype.slice.call(el.childNodes);
      const groups = [];
      let cur = [];
      for (let i = 0; i < nodes.length; ) {
        if (nodes[i].nodeName === "BR") {
          let j = i;
          let brs = 0;
          while (j < nodes.length && (nodes[j].nodeName === "BR" || (nodes[j].nodeType === 3 && !nodes[j].textContent.trim()))) {
            if (nodes[j].nodeName === "BR") brs++;
            j++;
          }
          if (brs >= 2) {
            groups.push(cur);
            cur = [];
            i = j;
            continue;
          }
        }
        cur.push(nodes[i]);
        i++;
      }
      groups.push(cur);
      el.textContent = "";
      groups.forEach(function (group) {
        let p = null;
        group.forEach(function (n) {
          if (n.nodeType === 1 && BLOCK.test(n.nodeName)) {
            p = null;
            el.appendChild(n);
            return;
          }
          if (!p) {
            if (n.nodeType === 3 && !n.textContent.trim()) return;
            p = doc.createElement("p");
            el.appendChild(p);
          }
          p.appendChild(n);
        });
      });
    });
  }

  /* Unknown custom elements: keep their content as plain blocks/spans. */
  function unwrapCustom(root) {
    const doc = root.ownerDocument;
    Array.prototype.slice.call(root.querySelectorAll("*")).reverse().forEach(function (el) {
      if (el.localName.indexOf("-") === -1 || el.closest("svg, math")) return;
      const block = doc.createElement(/^(span|a|b|i|em|strong|code)$/.test(el.parentElement && el.parentElement.localName) ? "span" : "div");
      while (el.firstChild) block.appendChild(el.firstChild);
      el.replaceWith(block);
    });
  }

  function notesSection(doc, heading, items, className) {
    const sec = doc.createElement("section");
    sec.className = className;
    const h = doc.createElement("h2");
    h.textContent = heading;
    const ol = doc.createElement("ol");
    items.forEach(function (li) {
      ol.appendChild(li);
    });
    sec.append(h, ol);
    return sec;
  }

  /* A plain document holding just the article, ready for the inline renderer. */
  async function article(doc, ctx, p) {
    doc = doc.cloneNode(true);
    const page = p.page;
    const adapter = p.adapter;
    const notes = [];
    page.notes = notes;
    page.notePair = function (label, content) {
      const pair = notePair(doc, label, content);
      notes.push(pair);
      return pair.ref;
    };
    if (adapter && adapter.prepare) await adapter.prepare(doc, page);
    let root = (adapter && adapter.root && adapter.root(doc, page)) || findArticle(doc);
    if (!root || textLength(root) < 200) return null;
    if (/^(font|center|span)$/.test(root.localName)) {
      const div = doc.createElement("div");
      while (root.firstChild) div.appendChild(root.firstChild);
      root.replaceWith(div);
      root = div;
    }
    const targets = scriptTargets(doc, root);

    root.querySelectorAll(CHROME).forEach(function (el) {
      el.remove();
    });
    ((adapter && adapter.drop) || []).forEach(function (sel) {
      root.querySelectorAll(sel).forEach(function (el) {
        el.remove();
      });
    });
    popoverNotes(root, notes);
    fixLazyImages(root);
    unwrapPresentational(root);
    brParagraphs(root);
    dropLayout(root);
    replaceInteractive(root, targets);
    unwrapCustom(root);
    notes.forEach(function (n, i) {
      n.link.textContent = String(i + 1);
    });

    const out = document.implementation.createHTMLDocument("");
    const title = (page.title || (doc.querySelector("title") || {}).textContent || "").replace(/\s+/g, " ").trim();
    out.title = title;
    const main = out.createElement("main");
    const header = out.createElement("header");
    header.className = "restyle-head";
    const firstHeading = root.querySelector("h1");
    if (title && !(firstHeading && textLength(firstHeading))) {
      const h1 = out.createElement("h1");
      h1.textContent = title;
      header.appendChild(h1);
    }
    if (page.byline) {
      const by = out.createElement("p");
      by.className = "restyle-byline";
      by.textContent = page.byline;
      header.appendChild(by);
    }
    if (page.url) {
      const src = out.createElement("p");
      src.className = "restyle-source";
      src.innerHTML = 'Reader style of <a href=""></a>. <a href="#" data-restyle-mode="original">Show the original page</a>.';
      const a = src.querySelector("a");
      a.href = page.url;
      a.textContent = hostOf(page.url) || page.url;
      header.appendChild(src);
    }
    const body = out.importNode(root, true);
    /* The page has its own title block: our header (source line) goes after it. */
    const ownTitle = body.querySelector("h1");
    let titleBlock = ownTitle;
    while (titleBlock && titleBlock.parentElement !== body) titleBlock = titleBlock.parentElement;
    if (header.childNodes.length && titleBlock && !header.querySelector("h1")) {
      titleBlock.after(header);
    } else if (header.childNodes.length) {
      main.appendChild(header);
    }
    main.appendChild(body);
    if (notes.length) {
      main.appendChild(out.importNode(notesSection(doc, "Notes", notes.map(function (n) { return n.body; }), "restyle-notes"), true));
    }
    if (page.references && page.references.length) {
      main.appendChild(out.importNode(notesSection(doc, "References", page.references, "restyle-references"), true));
    }
    out.body.appendChild(main);
    return out;
  }

  /* ---- Menu ------------------------------------------------------------------ */

  const state = { current: null };

  function paintMenu(route) {
    const group = document.getElementById("pageStyle");
    if (!group) return;
    const cur = state.current;
    const show = !!(cur && route && ((route.view === "file" && route.path === cur.path) || (route.view === "web" && route.url === cur.path) || (route.view === "raypeat" && route.path && global.ReaderRayPeat && global.ReaderRayPeat.articleUrl(route.path) === cur.path) || (route.view === "substack" && route.slug && global.ReaderSubstack && global.ReaderSubstack.postUrl(route.host, route.slug) === cur.path)));
    group.hidden = !show;
    if (!show) return;
    const label = document.getElementById("pageStyleLabel");
    if (label) label.textContent = "Page style" + (cur.name ? " · " + cur.name : "");
    group.querySelectorAll("button[data-style]").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-style") === cur.mode ? "true" : "false");
    });
  }

  function setMode(mode) {
    const cur = state.current;
    if (!cur || cur.mode === mode) return;
    writeMode(cur.key, mode);
    cur.mode = mode;
    if (global.ReaderApp && global.ReaderApp.rerender) global.ReaderApp.rerender();
  }

  document.addEventListener("DOMContentLoaded", function () {
    const group = document.getElementById("pageStyle");
    if (group) {
      group.addEventListener("click", function (ev) {
        const b = ev.target.closest("button[data-style]");
        if (b) setMode(b.getAttribute("data-style"));
      });
    }
  });
  document.addEventListener(
    "click",
    function (ev) {
      const a = ev.target.closest && ev.target.closest("[data-restyle-mode]");
      if (!a) return;
      ev.preventDefault();
      ev.stopPropagation();
      setMode(a.getAttribute("data-restyle-mode"));
    },
    true
  );
  document.addEventListener("reader:view", function (ev) {
    const d = ev.detail || {};
    if (d.view !== "file" && d.view !== "web" && d.view !== "raypeat" && d.view !== "substack") state.current = null;
    paintMenu(d.route);
  });

  global.ReaderRestyle = {
    register: register,
    plan: plan,
    article: article,
    findArticle: findArticle,
    setMode: setMode,
    get current() {
      return state.current;
    }
  };
})(window);
