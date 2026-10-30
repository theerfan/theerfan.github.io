/* Favorites: pages saved like bookmarks (documents and Wikipedia articles).
   - ☆ in the top bar adds / removes the open page (filled star = saved);
   - listed on the catalog home ("Favorites"), in the ⋯ menu, and on phones in
     the drawer's Favorites tab (js/mobile.js);
   - stored with ReaderPrefs (js/prefs.js) under "reader-favorites" as
     [{ hash, title, source, anchor, section, added, missing }];
   - a page that failed to load the last time is shown as unavailable.
   Driven by the "reader:view" event from js/app.js. */
(function (global) {
  const doc = global.document;
  const KEY = "reader-favorites";
  const MAX = 500;
  const MENU_MAX = 6;
  const listeners = [];
  const els = {};
  let current = null; /* { hash, title, source, view } of the open page */
  let pending = "";   /* page hash being routed to (to mark failures) */

  /* ---- Storage ----------------------------------------------------------- */

  function valid(f) {
    return (
      f && typeof f === "object" && typeof f.hash === "string" &&
      /^#\/./.test(f.hash) && f.hash.length < 2048
    );
  }

  function load() {
    let raw = null;
    try {
      raw = global.ReaderPrefs ? global.ReaderPrefs.read(KEY) : localStorage.getItem(KEY);
    } catch (e) {
      raw = null;
    }
    let list;
    try {
      list = JSON.parse(raw || "[]");
    } catch (e) {
      list = [];
    }
    if (!Array.isArray(list)) return [];
    return list.filter(valid).slice(0, MAX).map(function (f) {
      return {
        hash: f.hash,
        title: String(f.title || "").slice(0, 300) || pageName(f.hash),
        source: String(f.source || "").slice(0, 200),
        anchor: typeof f.anchor === "string" ? f.anchor.slice(0, 300) : "",
        section: typeof f.section === "string" ? f.section.slice(0, 200) : "",
        added: Number(f.added) || 0,
        missing: !!f.missing
      };
    });
  }

  function save(list) {
    const text = JSON.stringify(list.slice(0, MAX));
    try {
      if (global.ReaderPrefs) global.ReaderPrefs.write(KEY, text, { cookie: false });
      else localStorage.setItem(KEY, text);
    } catch (e) {
      /* ignore quota */
    }
    changed();
  }

  /* Hashes compare decoded and case-insensitively (GitHub paths here are). */
  function norm(hash) {
    let h = String(hash || "");
    try {
      h = decodeURIComponent(h);
    } catch (e) {
      /* keep */
    }
    return h.toLowerCase();
  }

  function indexOf(list, hash) {
    const want = norm(hash);
    for (let i = 0; i < list.length; i++) if (norm(list[i].hash) === want) return i;
    return -1;
  }

  function pageName(hash) {
    let h = String(hash).split("#").filter(Boolean)[0] || "";
    try {
      h = decodeURIComponent(h);
    } catch (e) {
      /* keep */
    }
    return h.split("/").filter(Boolean).pop() || h;
  }

  /* The page part of the location hash (#/owner/repo/path, no #anchor). */
  function pageHash(hash) {
    const h = String(hash || "").replace(/^#\/?/, "");
    const cut = h.indexOf("#");
    return "#/" + (cut === -1 ? h : h.slice(0, cut));
  }

  function hrefOf(f) {
    return f.anchor ? f.hash + "#" + encodeURIComponent(f.anchor) : f.hash;
  }

  /* ---- Actions ------------------------------------------------------------ */

  function isFavorite(hash) {
    return indexOf(load(), hash) !== -1;
  }

  /* The heading at the top of the reading area, so a favorite reopens there
     (inline documents; framed ones keep an anchor from the address). */
  function visibleHeading() {
    const scroller = doc.getElementById("repoView");
    const body = doc.querySelector("#article .markdown-body");
    if (!scroller || !body || scroller.scrollTop < 80) return null;
    const top = scroller.getBoundingClientRect().top + 24;
    let best = null;
    body.querySelectorAll("h1[id], h2[id], h3[id]").forEach(function (h) {
      if (h.getBoundingClientRect().top <= top) best = h;
    });
    if (!best) return null;
    return { id: best.id, text: (best.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200) };
  }

  function add() {
    if (!current) return;
    const list = load();
    if (indexOf(list, current.hash) !== -1) return;
    const where = (global.ReaderResume && global.ReaderResume.where()) || visibleHeading();
    const anchor = where ? where.id : current.anchor || "";
    list.unshift({
      hash: current.hash,
      title: current.title || pageName(current.hash),
      source: current.source || "",
      anchor: anchor,
      section: where ? where.text : "",
      added: Date.now(),
      missing: false
    });
    save(list);
    toast("Added to favorites");
  }

  function remove(hash, withUndo) {
    const list = load();
    const i = indexOf(list, hash);
    if (i === -1) return;
    const gone = list.splice(i, 1)[0];
    save(list);
    if (withUndo) {
      toast("Removed “" + gone.title + "”", function () {
        const again = load();
        if (indexOf(again, gone.hash) !== -1) return;
        again.splice(Math.min(i, again.length), 0, gone);
        save(again);
      });
    }
  }

  function toggle() {
    if (!current) return;
    if (isFavorite(current.hash)) remove(current.hash, true);
    else add();
  }

  function setMissing(hash, missing) {
    const list = load();
    const i = indexOf(list, hash);
    if (i === -1 || list[i].missing === missing) return;
    list[i].missing = missing;
    save(list);
  }

  /* ---- Rendering ----------------------------------------------------------- */

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const STAR =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.9l1.85 3.77 4.15.6-3 2.93.71 4.13L8 11.38l-3.71 1.95.71-4.13-3-2.93 4.15-.6z"/></svg>';

  function itemHtml(f, here) {
    const meta = [f.source, f.section ? "§ " + f.section : ""].filter(Boolean).join(" · ");
    return (
      '<li class="fav-item' + (f.missing ? " is-missing" : "") + '" data-hash="' + esc(f.hash) + '">' +
      '<a class="fav-link" href="' + esc(hrefOf(f)) + '"' + (here ? ' aria-current="page"' : "") + ">" +
      '<span class="fav-title">' + esc(f.title) + "</span>" +
      (meta || f.missing
        ? '<span class="fav-meta">' +
          (f.missing ? '<span class="fav-missing">Unavailable</span>' : "") +
          esc(meta) + "</span>"
        : "") +
      "</a>" +
      '<button type="button" class="fav-remove" data-fav-remove aria-label="Remove ' + esc(f.title) +
      ' from favorites" title="Remove from favorites">' +
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>' +
      "</li>"
    );
  }

  const EMPTY_HINT =
    "No favorites yet. Open a page and tap the star (" + "☆" + ") in the top bar to keep it here.";

  /* Fills a <ul class="fav-list"> (limit: show at most n). */
  function renderList(ul, limit) {
    const list = load();
    const here = current ? norm(current.hash) : "";
    const shown = limit ? list.slice(0, limit) : list;
    ul.innerHTML = shown.length
      ? shown.map(function (f) { return itemHtml(f, norm(f.hash) === here); }).join("")
      : '<li class="fav-empty">' + esc(EMPTY_HINT) + "</li>";
    return list.length;
  }

  function renderAll() {
    if (els.home) {
      const n = renderList(els.homeList);
      els.homeCount.textContent = n ? String(n) : "";
    }
    if (els.menuList) {
      const n = renderList(els.menuList, MENU_MAX);
      els.menuMore.hidden = n <= MENU_MAX;
      els.menuMore.textContent = "All favorites (" + n + ")";
    }
    syncButton();
    listeners.forEach(function (fn) {
      try { fn(); } catch (e) { /* ignore */ }
    });
  }

  function changed() {
    renderAll();
  }

  function syncButton() {
    if (!els.btn) return;
    const on = !!current;
    els.btn.hidden = !on;
    const saved = on && isFavorite(current.hash);
    const label = saved ? "Remove from favorites" : "Add to favorites";
    els.btn.setAttribute("aria-pressed", saved ? "true" : "false");
    els.btn.setAttribute("aria-label", label);
    els.btn.setAttribute("title", label);
  }

  /* ---- Toast (with Undo) --------------------------------------------------- */

  let toastTimer = 0;
  function toast(message, undo) {
    if (!els.toast) return;
    els.toast.innerHTML = '<span class="fav-toast-text"></span>';
    els.toast.firstChild.textContent = message;
    if (undo) {
      const b = doc.createElement("button");
      b.type = "button";
      b.textContent = "Undo";
      b.addEventListener("click", function () {
        hideToast();
        undo();
      });
      els.toast.appendChild(b);
    }
    els.toast.hidden = false;
    els.toast.classList.add("is-shown");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, undo ? 5000 : 2200);
  }
  function hideToast() {
    if (!els.toast) return;
    els.toast.classList.remove("is-shown");
    els.toast.hidden = true;
  }

  /* ---- Remove buttons and swipe-to-remove ----------------------------------- */

  function wireList(ul) {
    ul.addEventListener("click", function (ev) {
      const btn = ev.target.closest("[data-fav-remove]");
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();
      const li = btn.closest(".fav-item");
      if (li) remove(li.getAttribute("data-hash"), true);
    });
    /* Touch: swipe an entry left to remove it. */
    let row = null;
    let x0 = 0;
    let y0 = 0;
    let dx = 0;
    let horizontal = null;
    ul.addEventListener("touchstart", function (ev) {
      const li = ev.target.closest(".fav-item");
      if (!li || ev.touches.length !== 1) return;
      row = li;
      x0 = ev.touches[0].clientX;
      y0 = ev.touches[0].clientY;
      dx = 0;
      horizontal = null;
    }, { passive: true });
    ul.addEventListener("touchmove", function (ev) {
      if (!row) return;
      const t = ev.touches[0];
      dx = Math.min(0, t.clientX - x0);
      if (horizontal === null && (Math.abs(t.clientX - x0) > 8 || Math.abs(t.clientY - y0) > 8)) {
        horizontal = Math.abs(t.clientX - x0) > Math.abs(t.clientY - y0);
      }
      if (!horizontal) return;
      row.classList.add("is-swiping");
      row.style.transform = "translateX(" + dx + "px)";
      row.style.opacity = String(Math.max(0.3, 1 + dx / 240));
    }, { passive: true });
    function end() {
      if (!row) return;
      const li = row;
      row = null;
      li.classList.remove("is-swiping");
      if (horizontal && dx < -90) {
        li.style.transform = "translateX(-100%)";
        li.style.opacity = "0";
        setTimeout(function () { remove(li.getAttribute("data-hash"), true); }, 150);
      } else {
        li.style.transform = "";
        li.style.opacity = "";
      }
    }
    ul.addEventListener("touchend", end);
    ul.addEventListener("touchcancel", end);
    /* A swipe isn't a tap on the link. */
    ul.addEventListener("click", function (ev) {
      if (horizontal && Math.abs(dx) > 8 && ev.target.closest(".fav-link")) {
        ev.preventDefault();
        horizontal = null;
      }
    }, true);
  }

  /* ---- Build ------------------------------------------------------------------ */

  function build() {
    els.btn = doc.getElementById("favBtn");
    if (els.btn) els.btn.addEventListener("click", toggle);

    /* Catalog home: a section above the saved libraries. */
    const view = doc.getElementById("catalogView");
    const heading = view && view.querySelector(".saved-heading");
    if (view && heading) {
      const sec = doc.createElement("section");
      sec.className = "fav-home";
      sec.id = "favoritesSection";
      sec.setAttribute("aria-labelledby", "favoritesHeading");
      sec.innerHTML =
        '<h2 class="fav-heading" id="favoritesHeading">Favorites <span class="fav-count"></span></h2>' +
        '<ul class="fav-list fav-cards"></ul>';
      view.insertBefore(sec, heading);
      els.home = sec;
      els.homeList = sec.querySelector(".fav-list");
      els.homeCount = sec.querySelector(".fav-count");
      wireList(els.homeList);
    }

    /* ⋯ menu: the latest few, and a link to the full list. */
    const panel = doc.querySelector("#moreMenu .more-panel");
    if (panel) {
      const box = doc.createElement("div");
      box.className = "menu-favs";
      box.innerHTML =
        '<p class="text-prefs-label">Favorites</p><ul class="fav-list fav-compact"></ul>' +
        '<a class="menu-favs-all" href="#/" hidden></a>';
      const prefs = panel.querySelector(".text-prefs");
      panel.insertBefore(box, prefs ? prefs.nextSibling : panel.firstChild);
      els.menuList = box.querySelector(".fav-list");
      els.menuMore = box.querySelector(".menu-favs-all");
      wireList(els.menuList);
      els.menuMore.addEventListener("click", function () {
        global.setTimeout(function () {
          if (els.home) els.home.scrollIntoView({ block: "start" });
        }, 60);
      });
      els.menuList.addEventListener("click", function (ev) {
        if (!ev.target.closest(".fav-link")) return;
        const menu = doc.getElementById("moreMenu");
        if (menu) menu.open = false;
      });
    }

    const t = doc.createElement("div");
    t.className = "fav-toast";
    t.setAttribute("role", "status");
    t.setAttribute("aria-live", "polite");
    t.hidden = true;
    doc.body.appendChild(t);
    els.toast = t;
  }

  function onView(ev) {
    const d = ev.detail || {};
    const r = d.route || {};
    if (els.home) els.home.hidden = d.view !== "catalog";
    if (d.view === "file" || d.view === "wiki" || d.view === "web" || (d.view === "raypeat" && r.path) || (d.view === "substack" && r.slug)) {
      const hash =
        d.view === "raypeat"
          ? global.ReaderRayPeat.hashFor(r.path)
          : d.view === "substack"
          ? global.ReaderSubstack.hashFor(r.host, r.slug)
          : d.view === "wiki"
          ? global.ReaderWiki.hashFor(r.lang, r.title)
          : d.view === "web"
            ? global.ReaderWeb.hashFor(r.url)
            : global.ReaderDoc.hashFor(r.owner, r.repo, r.path);
      current = { hash: hash, title: d.title || "", source: d.source || "", view: d.view, anchor: r.anchor || "" };
      /* Loaded fine: refresh its title / source and clear "unavailable". */
      const list = load();
      const i = indexOf(list, hash);
      if (i !== -1 && (list[i].missing || (d.title && list[i].title !== d.title))) {
        list[i].missing = false;
        if (d.title) list[i].title = d.title;
        if (d.source) list[i].source = d.source;
        save(list);
        return;
      }
    } else {
      if (d.view === "error" && pending) setMissing(pending, true);
      current = null;
    }
    renderAll();
  }

  doc.addEventListener("DOMContentLoaded", function () {
    build();
    renderAll();
    doc.addEventListener("reader:view", onView);
    global.addEventListener("hashchange", function () {
      pending = pageHash(global.location.hash);
    });
    pending = pageHash(global.location.hash);
    /* Another tab changed them. */
    global.addEventListener("storage", function (ev) {
      if (ev.key === KEY) renderAll();
    });
  });

  global.ReaderFavorites = {
    list: load,
    isFavorite: isFavorite,
    toggle: toggle,
    remove: remove,
    renderList: renderList,
    wireList: wireList,
    current: function () { return current; },
    onChange: function (fn) { listeners.push(fn); }
  };
})(window);
