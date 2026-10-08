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

  function scrollToAnchor(root, id, smooth) {
    const target = findAnchor(root, id);
    if (target) {
      target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    }
    return !!target;
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
        const src = el.getAttribute(pair[1]);
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

  function rewriteLinks(wrap, ctx) {
    wrap.querySelectorAll("a[href]").forEach(function (a) {
      const href = a.getAttribute("href");
      if (!href) return;

      if (href.charAt(0) === "#") {
        bindInPage(a, wrap, ctx, safeDecode(href.slice(1)));
        return;
      }

      if (isExternal(href)) {
        if (/^javascript:/i.test(href)) {
          a.removeAttribute("href");
          return;
        }
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
        return;
      }

      const hashIdx = href.indexOf("#");
      const frag = hashIdx === -1 ? "" : safeDecode(href.slice(hashIdx + 1));
      const resolved = resolveRepoPath(ctx, href);

      if (resolved === ctx.path) {
        bindInPage(a, wrap, ctx, frag);
        return;
      }

      if (isDocPath(resolved)) {
        a.setAttribute("href", hashFor(ctx.owner, ctx.repo, resolved, frag));
        return;
      }

      const bare = href.split("#")[0].split("?")[0];
      if (/\/$/.test(bare) || !resolved) {
        a.setAttribute("href", hashFor(ctx.owner, ctx.repo, resolved));
        return;
      }

      a.setAttribute("href", rawUrl(ctx, resolved));
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
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
     (e.g. pre-highlighted HTML) alone instead of re-highlighting them. */
  function finalize(wrap, ctx, options) {
    highlightCode(wrap, !!(options && options.keepCodeMarkup));
    headingIds(wrap);
    rewriteMedia(wrap, ctx);
    rewriteLinks(wrap, ctx);
    return wrap;
  }

  function renderLatex(content, display) {
    try {
      return global.katex.renderToString(content, {
        displayMode: display,
        throwOnError: false,
        strict: "ignore",
        fleqn: false
      });
    } catch (e) {
      const el = document.createElement("span");
      el.className = "katex-error";
      el.textContent = content;
      return el.outerHTML;
    }
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
    scrollToAnchor: scrollToAnchor,
    renderLatex: renderLatex,
    finalize: finalize
  };
})(window);
