/* Site adapters for Reader style (js/restyle.js): one ReaderRestyle.register() per
   family of pages. Field list: the top of restyle.js.

   Every web page already gets the generic extractor: the article is found (<main>,
   <article>, or the densest text), the page's own CSS and layout are dropped, math goes
   through the reader's KaTeX, button+tooltip footnotes become numbered notes, and
   containers the page's scripts fill in become "Interactive figure" notes. Web pages
   (a saved article, or a page with a canonical link) open in Reader style by default.

   Add an adapter when a site needs more than that:
   - match: recognise the family by markup (a template's custom elements, a generator
     <meta>) rather than by host where possible, so mirrors and saved copies match too;
     page.url (the original address) is there for host checks.
   - prepare: turn script-driven markup into plain HTML before extraction, e.g. custom
     elements holding TeX → "\( … \)" text, citation keys → numbered links plus
     page.references, inline footnotes → page.notePair(). Set page.title / page.byline
     when the page keeps them outside the article.
   - root: the article element, when <main>/<article> is not it.
   - drop: selectors of leftovers (share bars, inline tables of contents, …).
   Check a saved copy of the page in both styles (⋯ → Page style), light and dark. */
(function (global) {
  "use strict";
  const R = global.ReaderRestyle;
  if (!R) return;

  /* ---- BibTeX (enough for reference lists) --------------------------------- */

  function readValue(s, i) {
    const open = s.charAt(i);
    if (open === "{" || open === '"') {
      let depth = 0;
      let j = i;
      for (; j < s.length; j++) {
        const c = s.charAt(j);
        if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === '"' && open === '"' && depth === 0 && j > i) break;
        if (open === "{" && depth === 0) break;
      }
      return { value: s.slice(i + 1, j), end: j + 1 };
    }
    const m = s.slice(i).match(/^[^,}\s]+/);
    return { value: m ? m[0] : "", end: i + (m ? m[0].length : 0) };
  }

  function texText(v) {
    return String(v || "")
      .replace(/\\[`'^"~=.]\{?(\w)\}?/g, "$1")
      .replace(/\\&/g, "&")
      .replace(/--/g, "–")
      .replace(/[{}]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseBibtex(text) {
    const out = {};
    const s = String(text || "");
    const head = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g;
    let m;
    while ((m = head.exec(s))) {
      const type = m[1].toLowerCase();
      if (type === "comment" || type === "string" || type === "preamble") continue;
      const entry = { type: type, key: m[2] };
      let i = head.lastIndex;
      for (;;) {
        const f = s.slice(i).match(/^\s*,?\s*([\w-]+)\s*=\s*/);
        if (!f) break;
        i += f[0].length;
        const v = readValue(s, i);
        entry[f[1].toLowerCase()] = texText(v.value);
        i = v.end;
      }
      out[entry.key] = entry;
      head.lastIndex = i;
    }
    return out;
  }

  function formatRef(doc, e, key) {
    const li = doc.createElement("li");
    li.id = "rs-ref-" + key.replace(/[^\w-]/g, "_");
    if (!e) {
      li.textContent = key;
      return li;
    }
    /* "Last, First" → "First Last". */
    let names = (e.author || "").split(/\s+and\s+/).filter(Boolean).map(function (n) {
      const i = n.indexOf(",");
      return i === -1 ? n.trim() : (n.slice(i + 1).trim() + " " + n.slice(0, i).trim()).trim();
    });
    if (names.length > 8) names = names.slice(0, 8).concat(["et al."]);
    const parts = [];
    if (names.length) parts.push(names.join(", ") + (e.year ? " (" + e.year + ")" : ""));
    else if (e.year) parts.push(e.year);
    li.appendChild(doc.createTextNode(parts.length ? parts[0] + ". " : ""));
    const title = doc.createElement("em");
    title.textContent = e.title || key;
    const url = e.url || (e.doi ? "https://doi.org/" + e.doi : "");
    if (url) {
      const a = doc.createElement("a");
      a.href = url;
      a.appendChild(title);
      li.appendChild(a);
    } else {
      li.appendChild(title);
    }
    const venue = e.journal || e.booktitle || e.publisher || e.howpublished || "";
    li.appendChild(doc.createTextNode(venue ? ". " + venue.replace(/^\\url/, "") + "." : "."));
    return li;
  }

  /* ---- Distill (distill.pub, transformer-circuits.pub, any distill.template page) ---- */

  R.register({
    id: "distill",
    name: "Distill article",
    match: function (doc) {
      return !!doc.querySelector("d-article");
    },
    prepare: async function (doc, page) {
      const art = doc.querySelector("d-article");

      let front = {};
      try {
        const fm = doc.querySelector("d-front-matter script[type='text/json']");
        if (fm) front = JSON.parse(fm.textContent) || {};
      } catch (e) {
        front = {};
      }
      const h1 = doc.querySelector("d-title h1");
      page.title = front.title || (h1 && h1.textContent.trim()) || "";
      const authors = (front.authors || [])
        .map(function (a) { return a.author || a.name; })
        .filter(Boolean);
      if (authors.length) page.byline = authors.join(", ");
      /* Pages that write their own byline (.d-byline: authors, affiliations, published). */
      const by = doc.querySelector(".d-byline, d-byline");
      if (by && !art.contains(by)) {
        const part = function (cls) {
          const el = by.querySelector("." + cls);
          if (!el) return "";
          const c = el.cloneNode(true);
          c.querySelectorAll("h3").forEach(function (h) { h.remove(); });
          c.querySelectorAll("br").forEach(function (br) { br.replaceWith(doc.createTextNode(", ")); });
          return c.textContent.replace(/\s+/g, " ").replace(/(,\s*)+/g, ", ").replace(/^[,\s]+|[,\s]+$/g, "");
        };
        const line = [authors.length ? "" : part("authors"), part("affiliations"), part("published")].filter(Boolean);
        if (line.length) page.byline = [page.byline].concat(line).filter(Boolean).join(" · ");
        const info = part("info");
        if (info) {
          const p = doc.createElement("p");
          p.className = "restyle-byline-note";
          p.textContent = info;
          art.prepend(p);
        }
      }
      /* d-title's subtitle (not the heading) opens the article. */
      const title = doc.querySelector("d-title");
      if (title) {
        title.querySelectorAll("h1").forEach(function (h) { h.remove(); });
        if (title.textContent.trim()) art.prepend.apply(art, Array.prototype.slice.call(title.childNodes));
      }

      /* Math: TeX source → the reader's KaTeX. */
      doc.querySelectorAll("d-math").forEach(function (m) {
        const tex = m.textContent || "";
        if (m.hasAttribute("block")) {
          const div = doc.createElement("div");
          div.textContent = "\\[" + tex + "\\]";
          m.replaceWith(div);
        } else {
          m.replaceWith(doc.createTextNode("\\(" + tex + "\\)"));
        }
      });

      /* Citations: numbered links in order of first use, and a reference list. */
      let bib = {};
      const bibEl = doc.querySelector("d-bibliography");
      if (bibEl) {
        const inline = bibEl.querySelector("script[type='text/bibtex']");
        try {
          bib = parseBibtex(inline ? inline.textContent : await page.fetchSibling(bibEl.getAttribute("src") || "bibliography.bib"));
        } catch (e) {
          bib = {};
        }
      }
      const order = [];
      doc.querySelectorAll("d-cite").forEach(function (c) {
        const keys = (c.getAttribute("key") || "").split(",").map(function (k) { return k.trim(); }).filter(Boolean);
        if (!keys.length) {
          c.remove();
          return;
        }
        const span = doc.createElement("span");
        span.className = "restyle-cite";
        span.appendChild(doc.createTextNode("["));
        keys.forEach(function (k, i) {
          if (order.indexOf(k) === -1) order.push(k);
          const a = doc.createElement("a");
          a.href = "#rs-ref-" + k.replace(/[^\w-]/g, "_");
          a.textContent = String(order.indexOf(k) + 1);
          if (i) span.appendChild(doc.createTextNode(", "));
          span.appendChild(a);
        });
        span.appendChild(doc.createTextNode("]"));
        c.replaceWith(span);
      });
      page.references = order.map(function (k) { return formatRef(doc, bib[k], k); });

      doc.querySelectorAll("d-footnote").forEach(function (f) {
        f.replaceWith(page.notePair("", f));
      });

      /* The appendix sits after the article. */
      doc.querySelectorAll("d-appendix").forEach(function (a) {
        art.appendChild(a);
      });
    },
    root: function (doc) {
      return doc.querySelector("d-article");
    },
    drop: ["d-footnote-list", "d-citation-list", "d-byline", "d-hover-box", "d-toc", "d-bibliography", "d-front-matter"]
  });

  R.parseBibtex = parseBibtex;
})(window);
