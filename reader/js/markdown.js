/* Markdown → HTML with KaTeX. Extract math before marked so underscores survive. */
(function (global) {
  const document = global.document;

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
      return global.ReaderDoc.renderLatex(block.content, block.display);
    });

    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    return global.ReaderDoc.finalize(wrap, ctx);
  }

  global.ReaderMarkdown = { render: render };
})(window);
