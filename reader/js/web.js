/* Any web page, opened in the reader. The page is fetched, its relative links and
   media are made absolute, and it is rendered by ReaderHTML in Reader style
   (js/restyle.js: the article in the reader's fonts, size and theme); ⋯ → Page style →
   Original shows the page with its own design instead.

   Fetching another site from a web page needs that site's permission (CORS), which
   most sites don't give, so on the website this works only for some pages. The
   Android app fetches natively and opens any page.

   Route: #/~web/<encoded URL>[#anchor] */
(function (global) {
  "use strict";

  const cache = new Map();

  /* An http(s) address the GitHub and Wikipedia parsers don't take: a full URL, or a
     bare domain path ("example.com/post"; GitHub user names can't contain dots). */
  function parseInput(raw) {
    let s = String(raw || "").trim();
    if (!s || /\s/.test(s)) return null;
    if (!/^https?:\/\//i.test(s)) {
      const first = s.split("/")[0];
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?$/i.test(first)) return null;
      s = "https://" + s;
    }
    let u;
    try {
      u = new URL(s);
    } catch (e) {
      return null;
    }
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
    if (/(^|\.)github\.com$/i.test(u.hostname) || /(^|\.)wikipedia\.org$/i.test(u.hostname)) return null;
    return { url: u.href.split("#")[0], anchor: u.hash ? u.hash.slice(1) : "" };
  }

  function hashFor(url, anchor) {
    /* Sources with their own view (js/raypeat.js) take their addresses. */
    const own = global.ReaderRayPeat && global.ReaderRayPeat.hashForUrl(url, anchor);
    if (own) return own;
    return "#/~web/" + encodeURIComponent(String(url).split("#")[0]) + (anchor ? "#" + encodeURIComponent(anchor) : "");
  }

  function sameDoc(a, b) {
    return String(a || "").split("#")[0] === String(b || "").split("#")[0];
  }

  function host(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (e) {
      return "";
    }
  }

  /* Relative addresses in the page → absolute, against its <base> or its own URL. */
  function absolutize(doc, pageUrl) {
    let base = pageUrl;
    const own = doc.querySelector("base[href]");
    if (own) {
      try {
        base = new URL(own.getAttribute("href"), pageUrl).href;
      } catch (e) {
        base = pageUrl;
      }
    }
    const abs = function (v) {
      v = String(v || "").trim();
      if (!v || v.charAt(0) === "#" || /^(data:|blob:|javascript:|mailto:|tel:)/i.test(v)) return v;
      try {
        return new URL(v, base).href;
      } catch (e) {
        return v;
      }
    };
    [["a", "href"], ["img", "src"], ["source", "src"], ["video", "src"], ["video", "poster"],
      ["audio", "src"], ["track", "src"], ["link", "href"], ["script", "src"], ["iframe", "src"],
      ["img", "data-src"], ["img", "data-lazy-src"], ["img", "data-original"]].forEach(function (pair) {
      doc.querySelectorAll(pair[0] + "[" + pair[1] + "]").forEach(function (el) {
        el.setAttribute(pair[1], abs(el.getAttribute(pair[1])));
      });
    });
    doc.querySelectorAll("img[srcset], source[srcset], img[data-srcset]").forEach(function (el) {
      ["srcset", "data-srcset"].forEach(function (attr) {
        const set = el.getAttribute(attr);
        if (!set) return;
        el.setAttribute(attr, set.split(",").map(function (part) {
          const bits = part.trim().split(/\s+/);
          bits[0] = abs(bits[0]);
          return bits.join(" ");
        }).join(", "));
      });
    });
    return base;
  }

  async function fetchPage(url) {
    if (cache.has(url)) return cache.get(url);
    let res;
    try {
      /* readerCache: the Android app keeps a copy for offline reading. */
      res = await global.fetch(url, { credentials: "omit", readerCache: true });
    } catch (e) {
      const err = new Error(
        "Couldn't load " + host(url) + ". On the website, most sites don't let another page read " +
          "them; the Reader app can open any page. (Offline? Pages you opened before still work in the app.)"
      );
      err.cors = true;
      throw err;
    }
    if (!res.ok) throw new Error(host(url) + " answered " + res.status + " for this page.");
    const type = (res.headers.get("content-type") || "").toLowerCase();
    if (type && !/html|xml|text\/plain/.test(type)) {
      throw new Error("That address is not a web page (" + type.split(";")[0] + ").");
    }
    const text = await res.text();
    cache.set(url, text);
    return text;
  }

  /* { wrap, title, outline, url }: the rendered page. */
  async function render(url) {
    const text = await fetchPage(url);
    const ctx = { owner: "", repo: "", branch: "", path: url, web: url };
    /* ReaderHTML parses again; absolutize a parsed copy and hand over its markup. */
    const doc = new DOMParser().parseFromString(text, "text/html");
    absolutize(doc, url);
    const html = "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
    const wrap = await global.ReaderHTML.render(html, ctx, { web: true, sourceText: text });
    const title = wrap.getAttribute("data-doc-title") || host(url);
    return { wrap: wrap, title: title, url: url };
  }

  global.ReaderWeb = {
    parseInput: parseInput,
    hashFor: hashFor,
    absolutize: absolutize,
    render: render,
    sameDoc: sameDoc,
    host: host
  };
})(window);
