/* Wikipedia articles, re-rendered in the reader's own typography. The article
   comes from the MediaWiki parse API (CORS-enabled, no key); site chrome is
   dropped, math is typeset with KaTeX from the TeX Wikipedia keeps beside its
   MathML, links to other articles stay in the reader, and the section list
   becomes the sidebar's table of contents.

   Route: #/~wiki/<lang>/<Title>[#anchor] */
(function (global) {
  const document = global.document;

  const LANG_RE = /^[a-z][a-z0-9-]{1,15}$/;

  /* Pages that are not articles: opened on Wikipedia itself. Canonical
     (English) names; other wikis accept these as aliases too. */
  const NON_ARTICLE =
    /^(talk|user|user_talk|wikipedia|wikipedia_talk|wp|file|image|file_talk|mediawiki|mediawiki_talk|template|template_talk|help|help_talk|category|category_talk|portal|portal_talk|draft|draft_talk|module|module_talk|special|media|timedtext|book)$/i;

  /* Site chrome and maintenance markup that make no sense outside Wikipedia
     (navigation boxes, series sidebars, cleanup banners, edit links). */
  const DROP =
    ".mw-editsection, .navbox, .navbox-styles, .vertical-navbox, table.sidebar, .metadata, " +
    ".ambox, .ombox, .tmbox, .cmbox, .fmbox, .mbox-small, .side-box, .sistersitebox, " +
    ".portalbox, .noprint, .mw-empty-elt, .navbar, .authority-control, .catlinks, " +
    ".Z3988, .cs1-hidden-error, .cs1-maint, .mw-jump-link, link, style, meta";

  const cache = new Map();

  function cleanTitle(title) {
    return String(title || "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  }

  function urlTitle(title) {
    return cleanTitle(title).replace(/ /g, "_");
  }

  function hashFor(lang, title, anchor) {
    let hash = "#/~wiki/" + lang + "/" + encodeURIComponent(urlTitle(title));
    if (anchor) hash += "#" + encodeURIComponent(anchor);
    return hash;
  }

  function articleUrl(lang, title, anchor) {
    return (
      "https://" + lang + ".wikipedia.org/wiki/" +
      encodeURIComponent(urlTitle(title)).replace(/%2F/g, "/").replace(/%3A/g, ":") +
      (anchor ? "#" + encodeURIComponent(anchor) : "")
    );
  }

  function safeDecode(s) {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  }

  /* Accepts en.wikipedia.org/wiki/Title, mobile (en.m.) and index.php?title=
     links, or a shorthand "wiki:Title" (English) / "wiki:de:Title".
     Returns { lang, title, anchor } or null. */
  function parseInput(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    const short = /^(?:w|wiki|wikipedia)\s*:\s*(?:([a-z][a-z0-9-]{1,15})\s*:\s*)?(.+)$/i.exec(s);
    if (short && !/^\/\//.test(short[2])) {
      const lang = (short[1] || "en").toLowerCase();
      const cut = short[2].indexOf("#");
      return {
        lang: lang,
        title: cleanTitle(cut === -1 ? short[2] : short[2].slice(0, cut)),
        anchor: cut === -1 ? "" : short[2].slice(cut + 1)
      };
    }
    if (!/^(https?:\/\/)?[a-z0-9-]+\.(m\.)?wikipedia\.org\//i.test(s)) return null;
    let u;
    try {
      u = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s);
    } catch (e) {
      return null;
    }
    const lang = u.hostname.toLowerCase().split(".")[0];
    if (!LANG_RE.test(lang)) return null;
    let title = "";
    if (u.pathname.indexOf("/wiki/") === 0) {
      title = safeDecode(u.pathname.slice(6));
    } else if (u.searchParams.get("title")) {
      title = u.searchParams.get("title");
    }
    title = cleanTitle(title);
    if (!title) return null;
    return { lang: lang, title: title, anchor: safeDecode(u.hash.replace(/^#/, "")) };
  }

  async function fetchArticle(lang, title) {
    const key = lang + ":" + urlTitle(title);
    if (cache.has(key)) return cache.get(key);
    const params = new URLSearchParams({
      action: "parse",
      page: urlTitle(title),
      prop: "text|displaytitle|sections|revid",
      redirects: "1",
      disableeditsection: "1",
      disabletoc: "1",
      formatversion: "2",
      format: "json",
      origin: "*"
    });
    const pending = fetch("https://" + lang + ".wikipedia.org/w/api.php?" + params, {
      credentials: "omit"
    })
      .then(function (res) {
        if (!res.ok) throw new Error("Wikipedia answered " + res.status + ".");
        return res.json();
      })
      .then(function (data) {
        if (data.error) {
          throw new Error(
            data.error.code === "missingtitle"
              ? "Wikipedia has no article called “" + cleanTitle(title) + "”."
              : data.error.info || "Wikipedia could not return this article."
          );
        }
        return data.parse;
      });
    cache.set(key, pending);
    pending.catch(function () {
      cache.delete(key);
    });
    return pending;
  }

  function textOf(html) {
    const t = document.createElement("template");
    t.innerHTML = String(html || "");
    return (t.content.textContent || "").replace(/\s+/g, " ").trim();
  }

  /* Wikipedia typesets every formula in \displaystyle, inline ones too; in
     running text that makes lines tall, so inline math drops it. */
  function prepareMath(root) {
    root.querySelectorAll(".mwe-math-element").forEach(function (el) {
      const m = el.querySelector("math");
      if (!m) return;
      const display =
        el.classList.contains("mwe-math-element-block") || m.getAttribute("display") === "block";
      if (display) {
        m.setAttribute("display", "block");
      } else {
        m.removeAttribute("display");
        const strip = function (tex) {
          const inner = /^\s*\{\\displaystyle\s*([\s\S]*)\}\s*$/.exec(tex || "");
          return inner ? inner[1] : tex;
        };
        const ann = m.querySelector('annotation[encoding="application/x-tex"]');
        if (ann) ann.textContent = strip(ann.textContent);
        if (m.hasAttribute("alttext")) m.setAttribute("alttext", strip(m.getAttribute("alttext")));
      }
      el.replaceWith(m);
    });
  }

  /* Article links → reader routes; everything else → absolute URLs on
     Wikipedia. Links to missing pages (red links) become plain text. */
  function prepareLinks(root, lang) {
    const site = "https://" + lang + ".wikipedia.org";
    root.querySelectorAll("a[href]").forEach(function (a) {
      const href = a.getAttribute("href") || "";
      if (href.charAt(0) === "#") return;
      if (/[?&]redlink=1/.test(href) || a.classList.contains("new")) {
        a.replaceWith.apply(a, Array.prototype.slice.call(a.childNodes));
        return;
      }
      if (href.indexOf("//") === 0) {
        a.setAttribute("href", "https:" + href);
        return;
      }
      const wiki = /^(?:\/wiki\/|\.\/)([^?#]+)(?:#(.*))?$/.exec(href);
      if (wiki && !a.classList.contains("mw-file-description")) {
        const title = safeDecode(wiki[1]);
        const colon = title.indexOf(":");
        if (colon === -1 || !NON_ARTICLE.test(title.slice(0, colon))) {
          a.setAttribute("href", hashFor(lang, title, wiki[2] ? safeDecode(wiki[2]) : ""));
          return;
        }
      }
      if (href.charAt(0) === "/" || href.indexOf("./") === 0) {
        a.setAttribute("href", site + (href.charAt(0) === "/" ? href : "/wiki/" + href.slice(2)));
      }
    });
  }

  function absolute(url) {
    return url.indexOf("//") === 0 ? "https:" + url : url;
  }

  function prepareMedia(root) {
    root.querySelectorAll("img").forEach(function (img) {
      const src = absolute((img.getAttribute("src") || "").trim());
      if (!/^https:\/\//i.test(src)) {
        img.remove();
        return;
      }
      img.setAttribute("src", src);
      const set = img.getAttribute("srcset");
      if (set) {
        img.setAttribute(
          "srcset",
          set
            .split(",")
            .map(function (part) {
              return absolute(part.trim());
            })
            .filter(function (part) {
              return /^https:\/\//i.test(part);
            })
            .join(", ")
        );
      }
    });
    root.querySelectorAll("audio, video, source, track").forEach(function (el) {
      ["src", "poster"].forEach(function (attr) {
        const v = el.getAttribute(attr);
        if (v) el.setAttribute(attr, absolute(v));
      });
    });
  }

  /* <div class="mw-heading"><h2 id=…>…</h2></div> → <h2 id=…>…</h2>, so the
     reader's per-section lazy rendering sees the headings. */
  function unwrapHeadings(root) {
    root.querySelectorAll(".mw-heading").forEach(function (box) {
      const h = box.querySelector("h1, h2, h3, h4, h5, h6");
      if (h) box.replaceWith(h);
    });
  }

  function bindLinks(wrap, lang, title) {
    wrap.querySelectorAll("a[href]").forEach(function (a) {
      const href = a.getAttribute("href");
      if (href.indexOf("#/") === 0) return;
      if (href.charAt(0) === "#") {
        const id = safeDecode(href.slice(1));
        const hash = hashFor(lang, title, id);
        a.setAttribute("href", hash);
        a.addEventListener("click", function (ev) {
          if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) return;
          ev.preventDefault();
          if (global.ReaderDoc.scrollToAnchor(wrap, id, true) && global.history.replaceState) {
            global.history.replaceState(null, "", hash);
          }
        });
        return;
      }
      if (/^\s*javascript:/i.test(href)) {
        a.removeAttribute("href");
        return;
      }
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /* Returns { wrap, title, sections, url }: wrap is a <div> holding the
     article, title the canonical (post-redirect) title, sections the table of
     contents as [{ level, number, text, anchor }]. */
  async function render(lang, title) {
    if (!LANG_RE.test(lang)) throw new Error("“" + lang + "” is not a Wikipedia language code.");
    const parsed = await fetchArticle(lang, title);
    const canonical = cleanTitle(parsed.title);
    const heading = textOf(parsed.displaytitle) || canonical;

    const doc = new DOMParser().parseFromString(
      "<!DOCTYPE html><html><body>" + parsed.text + "</body></html>",
      "text/html"
    );
    const root = doc.querySelector(".mw-parser-output") || doc.body;
    const shortDesc = root.querySelector(".shortdescription");
    const lede = shortDesc ? (shortDesc.textContent || "").trim() : "";

    root.querySelectorAll(DROP + ", .shortdescription").forEach(function (node) {
      node.remove();
    });
    unwrapHeadings(root);
    prepareMath(root);
    prepareLinks(root, lang);
    prepareMedia(root);

    const body = global.ReaderHTML.clean(doc, root, { autoMath: false });
    global.ReaderDoc.finalize(body, {}, { keepCodeMarkup: true, links: false });
    bindLinks(body, lang, canonical);

    const url = articleUrl(lang, canonical);
    const wrap = document.createElement("div");
    wrap.appendChild(el("h1", "wiki-title", heading));
    const source = el("p", "wiki-source");
    if (lede) source.appendChild(el("span", "wiki-lede", lede));
    const link = el("a", "", lang + ".wikipedia.org");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    source.appendChild(link);
    wrap.appendChild(source);
    while (body.firstChild) wrap.appendChild(body.firstChild);

    const credit = el("p", "wiki-credit");
    credit.append("Text from the Wikipedia article ");
    const page = el("a", "", "“" + canonical + "”");
    page.href = parsed.revid ? url.split("#")[0] + "?oldid=" + parsed.revid : url;
    page.target = "_blank";
    page.rel = "noopener noreferrer";
    credit.append(page, ", by its contributors, under ");
    const license = el("a", "", "CC BY-SA 4.0");
    license.href = "https://creativecommons.org/licenses/by-sa/4.0/";
    license.target = "_blank";
    license.rel = "noopener noreferrer";
    credit.append(license, ".");
    wrap.appendChild(credit);

    const sections = (parsed.sections || [])
      .filter(function (s) {
        return s.anchor && Number(s.toclevel) >= 1;
      })
      .map(function (s) {
        return {
          level: Number(s.toclevel),
          number: s.number || "",
          text: textOf(s.line),
          anchor: s.anchor
        };
      });

    return { wrap: wrap, title: canonical, heading: heading, sections: sections, url: url };
  }

  global.ReaderWiki = {
    parseInput: parseInput,
    hashFor: hashFor,
    articleUrl: articleUrl,
    urlTitle: urlTitle,
    isLang: function (lang) {
      return LANG_RE.test(String(lang || ""));
    },
    render: render
  };
})(window);
