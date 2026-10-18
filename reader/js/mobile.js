/* Phone navigation (narrow screens; css/styles.css shows these only at
   max-width 800px, so the desktop layout is unchanged):
   - the drawer gets an "All libraries" link and, while a document is open,
     Files / Contents tabs (Contents = the document's headings);
   - a Previous / Next pager under each document, in the drawer's file order;
   - swiping the open drawer to the left closes it.
   Driven by the "reader:view" event from js/app.js. */
(function (global) {
  const doc = global.document;
  const els = {};
  const state = { outline: null, tab: "files", route: null };

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function readTab() {
    try {
      return localStorage.getItem("reader-drawer-tab") === "outline" ? "outline" : "files";
    } catch (e) {
      return "files";
    }
  }

  function build() {
    els.sidebar = doc.getElementById("sidebar");
    els.fileList = doc.getElementById("fileList");
    els.article = doc.getElementById("article");
    if (!els.sidebar || !els.fileList) return false;
    const head = els.sidebar.querySelector(".sidebar-head");

    const home = doc.createElement("a");
    home.className = "drawer-home";
    home.href = "#/";
    home.innerHTML = '<span aria-hidden="true">←</span> All libraries';
    els.sidebar.insertBefore(home, head);

    const tabs = doc.createElement("div");
    tabs.className = "side-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.hidden = true;
    tabs.innerHTML =
      '<button type="button" role="tab" data-tab="files">Files</button>' +
      '<button type="button" role="tab" data-tab="outline">Contents</button>';
    head.insertAdjacentElement("afterend", tabs);
    els.tabs = tabs;

    const list = doc.createElement("ul");
    list.className = "file-list outline-list";
    list.id = "outlineList";
    list.hidden = true;
    els.fileList.insertAdjacentElement("afterend", list);
    els.outline = list;

    tabs.addEventListener("click", function (ev) {
      const b = ev.target.closest("[data-tab]");
      if (!b) return;
      setTab(b.getAttribute("data-tab"), true);
    });
    state.tab = readTab();
    return true;
  }

  function setTab(tab, save) {
    state.tab = tab === "outline" ? "outline" : "files";
    const hasOutline = !!(state.outline && state.outline.length);
    const showOutline = hasOutline && state.tab === "outline";
    doc.body.classList.toggle("drawer-outline", showOutline);
    els.outline.hidden = !showOutline;
    els.tabs.querySelectorAll("[data-tab]").forEach(function (b) {
      const on = (b.getAttribute("data-tab") === "outline") === showOutline;
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (save) {
      try {
        localStorage.setItem("reader-drawer-tab", state.tab);
      } catch (e) {
        /* ignore */
      }
    }
  }

  function renderOutline(route, outline) {
    state.outline = outline && outline.length ? outline : null;
    els.tabs.hidden = !state.outline;
    if (!state.outline) {
      els.outline.innerHTML = "";
      setTab(state.tab, false);
      return;
    }
    const min = Math.min.apply(null, state.outline.map(function (h) { return h.level; }));
    els.outline.innerHTML = state.outline
      .map(function (h) {
        const href = global.ReaderDoc.hashFor(route.owner, route.repo, route.path, h.id);
        return (
          '<li class="toc-item" style="--depth:' + (h.level - min) + '"><a class="file-link" href="' +
          esc(href) + '">' + esc(h.text) + "</a></li>"
        );
      })
      .join("");
    setTab(state.tab, false);
  }

  function renderPager(route) {
    if (!els.article) return;
    const old = els.article.querySelector(".doc-pager");
    if (old) old.remove();
    if (route.view !== "file") return;
    const links = Array.prototype.slice.call(els.fileList.querySelectorAll(".file-item .file-link"));
    const i = links.findIndex(function (a) { return a.classList.contains("active"); });
    if (i === -1) return;
    const prev = links[i - 1];
    const next = links[i + 1];
    function card(a, dir) {
      if (!a) return '<span class="pager-gap"></span>';
      return (
        '<a class="pager-' + dir + '" href="' + esc(a.getAttribute("href")) + '"><span class="pager-dir">' +
        (dir === "prev" ? "← Previous" : "Next →") + '</span><span class="pager-name">' +
        esc(a.textContent || "") + "</span></a>"
      );
    }
    const nav = doc.createElement("nav");
    nav.className = "doc-pager";
    nav.setAttribute("aria-label", "Previous and next document");
    nav.innerHTML = card(prev, "prev") + card(next, "next");
    els.article.appendChild(nav);
  }

  function onView(ev) {
    const d = ev.detail || {};
    const route = d.route || {};
    state.route = route;
    renderOutline(route, route.view === "file" ? d.outline : null);
    renderPager(route);
  }

  /* Swipe the open drawer left to close it. */
  function swipeToClose() {
    let x0 = null;
    let y0 = 0;
    els.sidebar.addEventListener("touchstart", function (ev) {
      if (!doc.body.classList.contains("sidebar-open") || ev.touches.length !== 1) return;
      x0 = ev.touches[0].clientX;
      y0 = ev.touches[0].clientY;
    }, { passive: true });
    els.sidebar.addEventListener("touchend", function (ev) {
      if (x0 === null) return;
      const t = ev.changedTouches[0];
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;
      x0 = null;
      if (dx < -60 && Math.abs(dy) < Math.abs(dx) * 0.6) {
        const backdrop = doc.getElementById("backdrop");
        if (backdrop) backdrop.click();
      }
    }, { passive: true });
  }

  doc.addEventListener("DOMContentLoaded", function () {
    if (!build()) return;
    swipeToClose();
    doc.addEventListener("reader:view", onView);
  });
})(window);
