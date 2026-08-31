/* Markdown → HTML with KaTeX. Extract math before marked so underscores survive. */
(function (global) {
  const document = global.document;

  function slugify(text) {
    return text
      .trim()
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-");
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

  function render(text, ctx) {
    const fences = [];
    let processed = String(text || "").replace(/```[\s\S]*?```/g, function (m) {
      const i = fences.length;
      fences.push(m);
      return "\n\n%%CODE_FENCE_" + i + "%%\n\n";
    });

    const latex = [];
    processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, function (_, content) {
      const i = latex.length;
      latex.push({ content: content.trim(), display: true });
      return "\n\n%%LATEX_" + i + "%%\n\n";
    });
    processed = processed.replace(/\\\[([\s\S]*?)\\\]/g, function (_, content) {
      const i = latex.length;
      latex.push({ content: content.trim(), display: true });
      return "\n\n%%LATEX_" + i + "%%\n\n";
    });
    processed = processed.replace(/\$([^$\n]+?)\$/g, function (_, content) {
      const i = latex.length;
      latex.push({ content: content.trim(), display: false });
      return "%%LATEX_" + i + "%%";
    });
    processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, function (_, content) {
      const i = latex.length;
      latex.push({ content: content.trim(), display: false });
      return "%%LATEX_" + i + "%%";
    });

    fences.forEach(function (block, i) {
      processed = processed.replace("%%CODE_FENCE_" + i + "%%", block);
    });

    let html = global.marked.parse(processed, { gfm: true, breaks: false });
    html = global.DOMPurify.sanitize(html);

    html = html.replace(/%%LATEX_(\d+)%%/g, function (_, idx) {
      const block = latex[Number(idx)];
      if (!block) return "";
      return renderLatex(block.content, block.display);
    });

    const wrap = document.createElement("div");
    wrap.innerHTML = html;

    wrap.querySelectorAll("pre code").forEach(function (block) {
      if (global.hljs) {
        try {
          global.hljs.highlightElement(block);
        } catch (e) {
          /* leave unhighlighted */
        }
      }
    });

    wrap.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach(function (heading) {
      if (!heading.id) heading.id = slugify(heading.textContent || "");
    });

    const dir = fileDir(ctx.path);
    wrap.querySelectorAll("img").forEach(function (img) {
      const src = img.getAttribute("src");
      if (!src || /^(https?:|data:|\/\/)/i.test(src)) return;
      img.setAttribute(
        "src",
        global.ReaderGitHub.rawFileUrl(ctx.owner, ctx.repo, ctx.branch, normalizePath(dir, src))
      );
    });

    wrap.querySelectorAll("a").forEach(function (a) {
      const href = a.getAttribute("href");
      if (!href) return;

      if (href.charAt(0) === "#") {
        a.addEventListener("click", function (ev) {
          ev.preventDefault();
          const id = decodeURIComponent(href.slice(1));
          const esc = global.CSS && global.CSS.escape ? global.CSS.escape(id) : id.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
        const target = wrap.querySelector("#" + esc) || document.getElementById(id);
          if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        return;
      }

      if (/^(https?:|mailto:|\/\/)/i.test(href)) {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
        return;
      }

      const [pathPart, frag] = href.split("#");
      const resolved = normalizePath(dir, pathPart || "");
      if (/\.md$/i.test(resolved)) {
        a.setAttribute("href", "#/" + ctx.owner + "/" + ctx.repo + "/" + resolved);
        return;
      }

      a.setAttribute(
        "href",
        global.ReaderGitHub.rawFileUrl(ctx.owner, ctx.repo, ctx.branch, resolved)
      );
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });

    return wrap;
  }

  global.ReaderMarkdown = { render: render };
})(window);
