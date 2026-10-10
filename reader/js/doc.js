/* Shared helpers for rendered documents (Markdown and HTML): paths, routes,
   and the post-processing every document gets (images, links, headings, code). */
(function (global) {
  const document = global.document;

  const MARKDOWN_RE = /\.(md|markdown)$/i;
  const HTML_RE = /\.html?$/i;

  function docKind(path) {
    const p = String(path || "");
    if (MARKDOWN_RE.test(p)) return "markdown";
    if (HTML_RE.test(p)) return "html";
    return "";
  }

  function isDocPath(path) {
    return docKind(path) !== "";
  }

  function slugify(text) {
    return text
      .trim()
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-");
  }

  function safeDecode(s) {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  }

  function normalizePath(fromDir, href) {
    const combined = (fromDir ? fromDir + "/" : "") + href;
    const parts = [];
    combined.split("/").forEach(function (part) {
      if (!part || part === ".") return;
      if (part === "..") parts.pop();
      else parts.push(part);
    });
    return parts.join("/");
  }

  function fileDir(path) {
    const i = path.lastIndexOf("/");
    return i === -1 ? "" : path.slice(0, i);
  }

  function encodePath(path) {
    return (path || "")
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");
  }

  /* Reader route: #/owner/repo[/path][#anchor] */
  function hashFor(owner, repo, path, anchor) {
    let hash =
      "#/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
    const encoded = encodePath(path);
    if (encoded) hash += "/" + encoded;
    if (anchor) hash += "#" + encodeURIComponent(anchor);
    return hash;
  }

  /* Resolve a relative href/src found in a document to a repo path (decoded). */
  function resolveRepoPath(ctx, ref) {
    const clean = ref.split("#")[0].split("?")[0];
    const fromRoot = clean.charAt(0) === "/";
    const resolved = normalizePath(fromRoot ? "" : fileDir(ctx.path), clean);
    return resolved
      .split("/")
      .map(safeDecode)
      .join("/");
  }

  function isExternal(ref) {
    return /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(ref);
  }

  function findAnchor(root, id) {
    if (!id) return null;
    const esc =
      global.CSS && global.CSS.escape
        ? global.CSS.escape(id)
        : id.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    return (
      (root && root.querySelector("#" + esc)) ||
      document.getElementById(id) ||
      (root && root.querySelector('a[name="' + id.replace(/["\\]/g, "\\$&") + '"]'))
    );
  }

  function scrollerOf(el) {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const y = global.getComputedStyle(p).overflowY;
      if ((y === "auto" || y === "scroll") && p.scrollHeight > p.clientHeight) return p;
    }
    return null;
  }

  /* Scroll only the document's own scroller: scrollIntoView also scrolls every
     ancestor, the page itself included, which pushed the top bar off screen. */
  function scrollToAnchor(root, id, smooth) {
    const target = findAnchor(root, id);
    if (!target) return false;
    const scroller = scrollerOf(target);
    const behavior = smooth ? "smooth" : "auto";
    if (!scroller) {
      target.scrollIntoView({ behavior: behavior, block: "start" });
      return true;
    }
    const top =
      scroller.scrollTop +
      target.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top;
    scroller.scrollTo({ top: top, behavior: behavior });
    return true;
  }

  function rawUrl(ctx, repoPath) {
    return global.ReaderGitHub.rawFileUrl(ctx.owner, ctx.repo, ctx.branch, repoPath);
  }

  function rewriteMedia(wrap, ctx) {
    const attrs = [
      ["img", "src"],
      ["source", "src"],
      ["video", "src"],
      ["video", "poster"],
      ["audio", "src"],
      ["track", "src"]
    ];
    attrs.forEach(function (pair) {
      wrap.querySelectorAll(pair[0] + "[" + pair[1] + "]").forEach(function (el) {
        /* trim: KaTeX's \includegraphics markup ends src with a space */
        const src = (el.getAttribute(pair[1]) || "").trim();
        if (!src || /^(https?:|data:|blob:|\/\/)/i.test(src)) return;
        el.setAttribute(pair[1], rawUrl(ctx, resolveRepoPath(ctx, src)));
      });
    });
    wrap.querySelectorAll("img[srcset], source[srcset]").forEach(function (el) {
      const set = el.getAttribute("srcset");
      const fixed = set
        .split(",")
        .map(function (part) {
          const bits = part.trim().split(/\s+/);
          if (bits[0] && !/^(https?:|data:|\/\/)/i.test(bits[0])) {
            bits[0] = rawUrl(ctx, resolveRepoPath(ctx, bits[0]));
          }
          return bits.join(" ");
        })
        .join(", ");
      el.setAttribute("srcset", fixed);
    });
  }

  /* Where a link in a document should go:
     { kind: "anchor", id }            same document, #fragment
     { kind: "route", hash }           another document or folder in the reader
     { kind: "external", url }         another site (opens in a new tab)
     { kind: "file", url }             a non-document repo file (raw, new tab)
     { kind: "none" }                  javascript: and other unusable links */
  function resolveHref(ctx, href) {
    href = String(href || "").trim();
    if (!href) return { kind: "none" };
    if (href.charAt(0) === "#") return { kind: "anchor", id: safeDecode(href.slice(1)) };
    if (isExternal(href)) {
      if (/^(https?:|mailto:|\/\/)/i.test(href)) return { kind: "external", url: href };
      return { kind: "none" };
    }
    const hashIdx = href.indexOf("#");
    const frag = hashIdx === -1 ? "" : safeDecode(href.slice(hashIdx + 1));
    const resolved = resolveRepoPath(ctx, href);
    if (resolved === ctx.path) return { kind: "anchor", id: frag };
    if (isDocPath(resolved)) {
      return { kind: "route", hash: hashFor(ctx.owner, ctx.repo, resolved, frag) };
    }
    const bare = href.split("#")[0].split("?")[0];
    if (/\/$/.test(bare) || !resolved) {
      return { kind: "route", hash: hashFor(ctx.owner, ctx.repo, resolved) };
    }
    return { kind: "file", url: rawUrl(ctx, resolved) };
  }

  function rewriteLinks(wrap, ctx) {
    wrap.querySelectorAll("a[href]").forEach(function (a) {
      const href = a.getAttribute("href");
      if (!href) return;
      const target = resolveHref(ctx, href);
      if (target.kind === "anchor") {
        bindInPage(a, wrap, ctx, target.id);
      } else if (target.kind === "route") {
        a.setAttribute("href", target.hash);
      } else if (/^\s*javascript:/i.test(href)) {
        a.removeAttribute("href");
      } else if (target.kind === "none" && !isExternal(href)) {
        /* nothing to do */
      } else {
        if (target.kind === "file") a.setAttribute("href", target.url);
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
      }
    });
  }

  function bindInPage(a, wrap, ctx, id) {
    a.setAttribute("href", hashFor(ctx.owner, ctx.repo, ctx.path, id));
    a.addEventListener("click", function (ev) {
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) return;
      ev.preventDefault();
      if (!id) return;
      if (scrollToAnchor(wrap, id, true) && global.history && global.history.replaceState) {
        global.history.replaceState(null, "", hashFor(ctx.owner, ctx.repo, ctx.path, id));
      }
    });
  }

  function highlightCode(wrap, keepMarkup) {
    if (!global.hljs) return;
    wrap.querySelectorAll("pre code").forEach(function (block) {
      if (keepMarkup && block.children.length) return; /* already marked up */
      try {
        global.hljs.highlightElement(block);
      } catch (e) {
        /* leave unhighlighted */
      }
    });
  }

  function headingIds(wrap) {
    wrap.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach(function (heading) {
      if (!heading.id) heading.id = slugify(heading.textContent || "");
    });
  }

  /* options.keepCodeMarkup: leave code blocks that already contain markup
     (e.g. pre-highlighted HTML) alone instead of re-highlighting them.
     options.links === false: leave links alone (sandboxed frames route clicks
     through the host instead). */
  function finalize(wrap, ctx, options) {
    options = options || {};
    highlightCode(wrap, !!options.keepCodeMarkup);
    headingIds(wrap);
    rewriteMedia(wrap, ctx);
    if (options.links !== false) rewriteLinks(wrap, ctx);
    return wrap;
  }

  /* KaTeX's trust option: only \includegraphics of an SVG file in the same
     repository (a relative path), so a diagram can sit inside an equation —
     aligned, tagged and centred on the math axis. Nothing else is trusted. */
  function trustLatex(context) {
    return (
      context.command === "\\includegraphics" &&
      /^(?![a-z][a-z0-9+.-]*:|\/\/)[\w\-./ ]+\.svg$/i.test(context.url || "") &&
      !/(^|\/)\.\.(\/|$)/.test(context.url)
    );
  }

  function renderLatex(content, display) {
    try {
      return global.katex.renderToString(content, {
        displayMode: display,
        throwOnError: false,
        strict: "ignore",
        trust: trustLatex,
        fleqn: false
      });
    } catch (e) {
      const el = document.createElement("span");
      el.className = "katex-error";
      el.textContent = content;
      return el.outerHTML;
    }
  }

  /* Display equations are horizontal scroll boxes so wide formulas scroll on
     phones instead of breaking the column. On iOS WebKit every scroll box is a
     native scroll view, and a chapter holds a hundred or more, which makes the
     whole page scroll badly; equations that fit are marked so CSS drops their
     overflow. Re-checked when a box resizes and when the math fonts arrive. */
  let fitObserver = null;

  function checkFit(el) {
    el.classList.toggle("reader-fits", el.scrollWidth <= el.clientWidth + 1);
  }

  function fitMath(root) {
    if (fitObserver) fitObserver.disconnect();
    fitObserver = null;
    const displays = root.querySelectorAll(".katex-display");
    if (!displays.length || !global.ResizeObserver) return;
    const observer = new global.ResizeObserver(function (entries) {
      entries.forEach(function (entry) {
        checkFit(entry.target);
      });
    });
    displays.forEach(function (el) {
      observer.observe(el);
    });
    fitObserver = observer;
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        if (fitObserver === observer) displays.forEach(checkFit);
      });
    }
  }

  function isEmptyAnchor(el) {
    return !!el && !el.firstChild && el.hasAttribute("id");
  }

  /* Long documents are slow to scroll on iPad: Safari keeps the whole page laid
     out and painted. Group the top-level blocks into one section per h2/h3 and
     let the browser skip sections far from the viewport (content-visibility).
     Each section's placeholder is its measured height, so skipped sections keep
     their real size and the scrollbar and anchors don't jump. Call it once the
     document is in the page. */
  function lazySections(root) {
    if (!global.CSS || !global.CSS.supports || !global.CSS.supports("content-visibility", "auto")) {
      return;
    }
    const kids = Array.prototype.slice.call(root.children);
    if (kids.filter(function (el) { return /^H[23]$/.test(el.tagName); }).length < 4) return;
    const sections = [];
    let section = null;
    kids.forEach(function (el) {
      if (!section || /^H[23]$/.test(el.tagName)) {
        const next = document.createElement("section");
        next.className = "reader-section";
        root.insertBefore(next, el);
        /* Empty anchors just above the heading (<div id="SS1"></div>) open the
           new section with it rather than end the previous one. */
        while (section && isEmptyAnchor(section.lastElementChild)) {
          next.insertBefore(section.lastElementChild, next.firstChild);
        }
        if (section && !section.firstChild) {
          section.remove();
          sections.pop();
        }
        section = next;
        sections.push(section);
      }
      section.appendChild(el);
    });
    /* Measure once the fonts are in, or the placeholders would be stale. */
    const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    fontsReady.then(function () {
      global.requestAnimationFrame(function () {
        if (!root.isConnected) return;
        const heights = sections.map(function (sec) {
          return sec.getBoundingClientRect().height;
        });
        sections.forEach(function (sec, i) {
          sec.style.containIntrinsicSize = "auto " + heights[i] + "px";
          sec.classList.add("reader-lazy");
        });
      });
    });
  }

  global.ReaderDoc = {
    docKind: docKind,
    isDocPath: isDocPath,
    slugify: slugify,
    normalizePath: normalizePath,
    fileDir: fileDir,
    encodePath: encodePath,
    hashFor: hashFor,
    safeDecode: safeDecode,
    resolveRepoPath: resolveRepoPath,
    resolveHref: resolveHref,
    rawUrl: rawUrl,
    scrollToAnchor: scrollToAnchor,
    renderLatex: renderLatex,
    fitMath: fitMath,
    lazySections: lazySections,
    finalize: finalize
  };
})(window);
