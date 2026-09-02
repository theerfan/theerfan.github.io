(function () {
  const els = {};
  const state = {
    catalog: { title: "Reader", repos: [] },
    route: { view: "catalog" },
    meta: null,
    files: [],
    truncated: false,
    sidebarOpen: false,
    scopedFolder: "",
    collapsed: new Set(),
    collapsedRepo: "",
    listActivePath: "",
    listFolder: ""
  };

  function $(id) {
    return document.getElementById(id);
  }

  function bind() {
    els.catalog = $("catalogView");
    els.repo = $("repoView");
    els.repoList = $("repoList");
    els.fileList = $("fileList");
    els.article = $("article");
    els.crumb = $("crumb");
    els.status = $("status");
    els.githubLink = $("githubLink");
    els.sidebar = $("sidebar");
    els.menuBtn = $("menuBtn");
    els.backdrop = $("backdrop");
    els.truncated = $("truncatedNote");
    els.jumpForm = $("jumpForm");
    els.jumpInput = $("jumpInput");
    els.jumpError = $("jumpError");
    els.jumpFormBar = $("jumpFormBar");
    els.jumpInputBar = $("jumpInputBar");
    els.themeBtn = $("themeBtn");
    els.alignGroup = $("alignGroup");
    els.sidebarToggle = $("sidebarToggle");
    els.filesBtn = $("filesBtn");
    els.folderTools = $("folderTools");
    els.collapseAll = $("collapseAll");
    els.expandAll = $("expandAll");

    els.menuBtn.addEventListener("click", function () {
      setSidebar(!state.sidebarOpen);
    });
    els.backdrop.addEventListener("click", function () {
      setSidebar(false);
    });
    els.jumpForm.addEventListener("submit", onJump);
    els.jumpFormBar.addEventListener("submit", onJump);
    els.themeBtn.addEventListener("click", toggleTheme);
    els.alignGroup.addEventListener("click", onAlignClick);
    document.addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-action='toggle-sidebar']");
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();
      toggleSidebarRail();
    });
    els.sidebar.addEventListener("click", function (ev) {
      if (!sidebarCollapsed()) return;
      if (ev.target.closest("[data-action='toggle-sidebar']")) return;
      toggleSidebarRail();
    });
    els.fileList.addEventListener("click", onFileListClick);
    if (els.collapseAll) {
      els.collapseAll.addEventListener("click", function (ev) {
        ev.preventDefault();
        collapseAllFolders();
      });
    }
    if (els.expandAll) {
      els.expandAll.addEventListener("click", function (ev) {
        ev.preventDefault();
        expandAllFolders();
      });
    }
    window.addEventListener("hashchange", onRoute);
    window.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") setSidebar(false);
      if (ev.key === "/" && !isTypingIntoField(ev.target)) {
        ev.preventDefault();
        focusJump();
      }
    });
    syncThemeButton();
    syncAlignButtons();
    setSidebarRail(document.documentElement.getAttribute("data-sidebar") === "collapsed");
  }

  function isTypingIntoField(el) {
    if (!el) return false;
    var tag = (el.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || el.isContentEditable;
  }

  function focusJump() {
    var input = document.body.classList.contains("view-catalog")
      ? els.jumpInput
      : els.jumpInputBar;
    if (input) input.focus();
  }

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light";
  }

  function currentAlign() {
    var align = document.documentElement.getAttribute("data-align");
    if (align === "left" || align === "right" || align === "center") return align;
    return "center";
  }

  function persist(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      /* ignore quota / private mode */
    }
    try {
      sessionStorage.setItem(key, value);
    } catch (e) {
      /* ignore */
    }
    if (
      key === "reader-theme" ||
      key === "reader-align" ||
      key === "reader-sidebar"
    ) {
      try {
        document.cookie =
          key +
          "=" +
          encodeURIComponent(value) +
          "; Max-Age=31536000; Path=/; SameSite=Lax";
      } catch (e) {
        /* ignore */
      }
    }
  }

  function toggleTheme() {
    var next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    persist("reader-theme", next);
    syncThemeButton();
  }

  function syncThemeButton() {
    var dark = currentTheme() === "dark";
    els.themeBtn.textContent = dark ? "Light" : "Dark";
    els.themeBtn.setAttribute(
      "aria-label",
      dark ? "Switch to light mode" : "Switch to dark mode"
    );
  }

  function onAlignClick(ev) {
    var btn = ev.target.closest("[data-align]");
    if (!btn) return;
    setAlign(btn.getAttribute("data-align"));
  }

  function setAlign(align) {
    if (align !== "left" && align !== "right" && align !== "center") return;
    document.documentElement.setAttribute("data-align", align);
    persist("reader-align", align);
    syncAlignButtons();
  }

  function syncAlignButtons() {
    var align = currentAlign();
    var buttons = els.alignGroup.querySelectorAll("[data-align]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute(
        "aria-pressed",
        buttons[i].getAttribute("data-align") === align ? "true" : "false"
      );
    }
  }

  function setJumpError(message) {
    els.jumpError.hidden = !message;
    els.jumpError.textContent = message || "";
    if (document.body.classList.contains("view-catalog")) {
      showStatus("");
      return;
    }
    showStatus(message || "", message ? "error" : "");
  }

  function onJump(ev) {
    ev.preventDefault();
    var form = ev.currentTarget;
    var input = form.querySelector("input");
    var parsed = ReaderGitHub.parseInput(input.value);
    if (!parsed) {
      setJumpError("Could not parse that. Try owner/repo or a GitHub URL.");
      return;
    }
    setJumpError("");
    if (parsed.branch) {
      try {
        sessionStorage.setItem(
          "reader-branch:" + parsed.owner + "/" + parsed.repo,
          parsed.branch
        );
      } catch (e) {
        /* ignore */
      }
    }
    var hash = hashFor(parsed.owner, parsed.repo, parsed.path);
    if (location.hash === hash) {
      onRoute();
    } else {
      location.hash = hash;
    }
    input.blur();
  }

  function sidebarCollapsed() {
    return (
      document.documentElement.getAttribute("data-sidebar") === "collapsed" ||
      document.body.classList.contains("sidebar-collapsed")
    );
  }

  function toggleSidebarRail() {
    setSidebarRail(!sidebarCollapsed());
  }

  function setSidebarRail(collapsed) {
    var next = collapsed ? "collapsed" : "expanded";
    document.documentElement.setAttribute("data-sidebar", next);
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    if (els.sidebar) els.sidebar.classList.toggle("is-collapsed", collapsed);
    persist("reader-sidebar", next);
    syncSidebarToggle();
  }

  function syncSidebarToggle() {
    var collapsed = sidebarCollapsed();
    var expanded = collapsed ? "false" : "true";
    var hideLabel = collapsed ? "Show" : "Hide";
    var filesLabel = collapsed ? "Show files" : "Hide files";
    if (els.sidebarToggle) {
      els.sidebarToggle.textContent = hideLabel;
      els.sidebarToggle.setAttribute("aria-expanded", expanded);
      els.sidebarToggle.setAttribute(
        "title",
        collapsed ? "Expand sidebar" : "Collapse sidebar"
      );
      els.sidebarToggle.setAttribute(
        "aria-label",
        collapsed ? "Expand sidebar" : "Collapse sidebar"
      );
    }
    if (els.filesBtn) {
      els.filesBtn.textContent = filesLabel;
      els.filesBtn.setAttribute("aria-expanded", expanded);
    }
  }

  window.ReaderToggleSidebar = toggleSidebarRail;

  function setSidebar(open) {
    state.sidebarOpen = open;
    document.body.classList.toggle("sidebar-open", open);
    els.menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function encodePath(path) {
    return (path || "")
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");
  }

  function hashFor(owner, repo, path) {
    var hash =
      "#/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
    var encoded = encodePath(path);
    if (encoded) hash += "/" + encoded;
    return hash;
  }

  function joinRepoPath(a, b) {
    a = (a || "").replace(/^\/+|\/+$/g, "");
    b = (b || "").replace(/^\/+|\/+$/g, "");
    if (!a) return b;
    if (!b) return a;
    return a + "/" + b;
  }

  function parentFolder(folder) {
    var clean = (folder || "").replace(/^\/+|\/+$/g, "");
    if (!clean) return "";
    var i = clean.lastIndexOf("/");
    return i === -1 ? "" : clean.slice(0, i);
  }

  function pathIsUnder(path, folder) {
    if (!folder) return true;
    var a = String(path || "").toLowerCase();
    var b = String(folder || "").replace(/^\/+|\/+$/g, "").toLowerCase();
    return a === b || a.indexOf(b + "/") === 0;
  }

  function parseHash() {
    const raw = (location.hash || "").replace(/^#\/?/, "");
    if (!raw) return { view: "catalog" };
    const parts = raw.split("/").map(function (p) {
      try {
        return decodeURIComponent(p);
      } catch (e) {
        return p;
      }
    }).filter(function (p, i) {
      return i < 2 || p;
    });
    const owner = parts[0];
    const repo = parts[1];
    const path = parts.slice(2).join("/");
    if (!owner || !repo) return { view: "catalog" };
    if (!path) return { view: "repo", owner: owner, repo: repo };
    if (/\.md$/i.test(path)) {
      return { view: "file", owner: owner, repo: repo, path: path };
    }
    return { view: "repo", owner: owner, repo: repo, folder: path };
  }

  function findCatalogEntry(owner, repo) {
    const list = state.catalog.repos || [];
    const lowerOwner = owner.toLowerCase();
    const lowerRepo = repo.toLowerCase();
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.owner.toLowerCase() === lowerOwner && r.repo.toLowerCase() === lowerRepo) {
        return r;
      }
    }
    return null;
  }

  async function resolveMeta(owner, repo) {
    const listed = findCatalogEntry(owner, repo);
    if (listed) {
      return {
        title: listed.title || listed.repo,
        description: listed.description || "",
        owner: listed.owner,
        repo: listed.repo,
        branch: listed.branch || "main",
        root: listed.root || ""
      };
    }
    const remote = await ReaderGitHub.getRepo(owner, repo);
    return remote;
  }

  async function loadCatalog() {
    const res = await fetch("catalog.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("Could not load catalog.json");
    state.catalog = await res.json();
  }

  function showStatus(message, kind) {
    els.status.hidden = !message;
    els.status.textContent = message || "";
    els.status.className = "status" + (kind ? " " + kind : "");
  }

  function setTitle(parts) {
    document.title = parts.filter(Boolean).join(" · ");
  }

  function renderCatalog() {
    setTitle([state.catalog.title || "Reader", "Erfan Abedi"]);
    document.body.classList.add("view-catalog");
    document.body.classList.remove("view-repo");
    els.catalog.hidden = false;
    els.repo.hidden = true;
    setSidebar(false);
    els.githubLink.hidden = true;
    els.crumb.innerHTML = "";
    els.fileList.innerHTML = "";
    if (els.folderTools) els.folderTools.hidden = true;
    els.jumpInput.value = "";
    els.jumpInputBar.value = "";
    setJumpError("");
    showStatus("");

    const repos = state.catalog.repos || [];
    if (!repos.length) {
      els.repoList.innerHTML =
        '<p class="empty">No repos in <code>catalog.json</code> yet.</p>';
      return;
    }

    els.repoList.innerHTML = repos
      .map(function (r) {
        const href = hashFor(r.owner, r.repo);
        const desc = r.description
          ? "<p>" + escapeHtml(r.description) + "</p>"
          : "";
        return (
          '<a class="repo-card" href="' +
          href +
          '">' +
          "<h2>" +
          escapeHtml(r.title || r.repo) +
          "</h2>" +
          '<p class="repo-id">' +
          escapeHtml(r.owner + "/" + r.repo) +
          "</p>" +
          desc +
          "</a>"
        );
      })
      .join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function relativePath(path, root) {
    const prefix = (root || "").replace(/^\/+|\/+$/g, "");
    if (!prefix) return path;
    if (
      path.length >= prefix.length &&
      path.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase()
    ) {
      if (path.length === prefix.length) return path.split("/").pop();
      if (path.charAt(prefix.length) === "/") return path.slice(prefix.length + 1);
    }
    return path;
  }

  function canonicalFolder(paths, folder) {
    const prefix = (folder || "").replace(/^\/+|\/+$/g, "");
    if (!prefix || !paths || !paths.length) return prefix;
    const lower = prefix.toLowerCase();
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      if (
        path.length >= prefix.length &&
        path.slice(0, prefix.length).toLowerCase() === lower &&
        (path.length === prefix.length || path.charAt(prefix.length) === "/")
      ) {
        return path.slice(0, prefix.length);
      }
    }
    return prefix;
  }

  function collapsedStorageKey() {
    if (!state.meta) return "reader-collapsed";
    return "reader-collapsed:" + state.meta.owner + "/" + state.meta.repo;
  }

  function loadCollapsed() {
    const key = collapsedStorageKey();
    if (state.collapsedRepo === key) return;
    state.collapsedRepo = key;
    state.collapsed = new Set();
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        list.forEach(function (p) {
          if (p) state.collapsed.add(p);
        });
      }
    } catch (e) {
      /* ignore */
    }
  }

  function saveCollapsed() {
    persist(collapsedStorageKey(), JSON.stringify(Array.from(state.collapsed)));
  }

  function folderIsCollapsed(folderPath) {
    return state.collapsed.has(folderPath);
  }

  function buildFolderTree(files, root) {
    const tree = { name: "", path: root || "", dirs: [], dirMap: {}, files: [] };

    function child(parent, name, fullPath) {
      if (!parent.dirMap[name]) {
        const node = { name: name, path: fullPath, dirs: [], dirMap: {}, files: [] };
        parent.dirMap[name] = node;
        parent.dirs.push(node);
      }
      return parent.dirMap[name];
    }

    files.forEach(function (path) {
      const rel = relativePath(path, root);
      const parts = rel.split("/").filter(Boolean);
      if (!parts.length) return;
      if (parts.length === 1) {
        tree.files.push({ name: parts[0], path: path });
        return;
      }
      let node = tree;
      let acc = root || "";
      for (let i = 0; i < parts.length - 1; i++) {
        acc = joinRepoPath(acc, parts[i]);
        node = child(node, parts[i], acc);
      }
      node.files.push({ name: parts[parts.length - 1], path: path });
    });
    return tree;
  }

  function countTreeFiles(node) {
    let n = node.files.length;
    for (let i = 0; i < node.dirs.length; i++) n += countTreeFiles(node.dirs[i]);
    return n;
  }

  function collectFolderPaths(node, out) {
    for (let i = 0; i < node.dirs.length; i++) {
      out.push(node.dirs[i].path);
      collectFolderPaths(node.dirs[i], out);
    }
    return out;
  }

  function renderFileItem(file, activePath, depth) {
    const href = hashFor(state.meta.owner, state.meta.repo, file.path);
    const active = file.path === activePath ? " active" : "";
    const current = file.path === activePath ? ' aria-current="page"' : "";
    return (
      '<li class="file-item' +
      (depth === 0 ? " is-root" : "") +
      '" style="--depth:' +
      depth +
      '"><a class="file-link' +
      active +
      '" href="' +
      href +
      '"' +
      current +
      ">" +
      escapeHtml(file.name) +
      "</a></li>"
    );
  }

  function renderTreeNode(node, activePath, depth) {
    let html = "";
    node.files.forEach(function (file) {
      html += renderFileItem(file, activePath, depth);
    });
    node.dirs.forEach(function (dir) {
      const collapsed = folderIsCollapsed(dir.path);
      const n = countTreeFiles(dir);
      html +=
        '<li class="dir-node' +
        (collapsed ? " is-collapsed" : "") +
        '">';
      html +=
        '<div class="dir-row" style="--depth:' +
        depth +
        '">' +
        '<button type="button" class="dir-twist" data-action="toggle-folder" data-folder="' +
        escapeHtml(dir.path) +
        '" aria-expanded="' +
        (collapsed ? "false" : "true") +
        '" title="' +
        (collapsed ? "Expand folder" : "Collapse folder") +
        '"><span class="caret"></span></button>' +
        '<a class="dir-name" href="' +
        hashFor(state.meta.owner, state.meta.repo, dir.path) +
        '" title="Show only this folder">' +
        escapeHtml(dir.name) +
        "</a>";
      if (collapsed) {
        html += '<span class="dir-count">' + n + "</span>";
      }
      html += "</div>";
      if (!collapsed) {
        html += '<ul class="file-list nested">';
        html += renderTreeNode(dir, activePath, depth + 1);
        html += "</ul>";
      }
      html += "</li>";
    });
    return html;
  }

  function redrawFileList() {
    renderFileList(state.listActivePath, state.listFolder);
  }

  function onFileListClick(ev) {
    const btn = ev.target.closest("[data-action='toggle-folder']");
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    const folder = btn.getAttribute("data-folder");
    if (!folder) return;
    if (state.collapsed.has(folder)) state.collapsed.delete(folder);
    else state.collapsed.add(folder);
    saveCollapsed();
    const top = els.sidebar ? els.sidebar.scrollTop : 0;
    redrawFileList();
    if (els.sidebar) els.sidebar.scrollTop = top;
  }

  function collapseAllFolders() {
    if (!state.folderTree) return;
    collectFolderPaths(state.folderTree, []).forEach(function (p) {
      state.collapsed.add(p);
    });
    saveCollapsed();
    redrawFileList();
  }

  function expandAllFolders() {
    if (!state.folderTree) return;
    collectFolderPaths(state.folderTree, []).forEach(function (p) {
      state.collapsed.delete(p);
    });
    saveCollapsed();
    redrawFileList();
  }

  function renderFileList(activePath, folder) {
    state.listActivePath = activePath || "";
    state.listFolder = folder || "";
    const root = state.meta ? state.meta.root : "";
    const bits = [];

    if (folder) {
      const parent = parentFolder(folder);
      const parentLabel = parent
        ? parent.split("/").pop()
        : state.meta.title || state.meta.repo;
      bits.push(
        '<li class="dir-up"><a href="' +
          hashFor(state.meta.owner, state.meta.repo, parent) +
          '" title="Show the parent folder">← ' +
          escapeHtml(parentLabel) +
          "</a></li>"
      );
    }

    if (!state.files.length) {
      bits.push('<li class="muted">No Markdown files in this folder.</li>');
      state.folderTree = { name: "", path: root || "", dirs: [], files: [] };
      els.fileList.innerHTML = bits.join("");
      els.truncated.hidden = !state.truncated;
      if (els.folderTools) els.folderTools.hidden = true;
      return;
    }

    const tree = buildFolderTree(state.files, root);
    state.folderTree = tree;
    bits.push(renderTreeNode(tree, activePath, 0));
    els.fileList.innerHTML = bits.join("");
    els.truncated.hidden = !state.truncated;
    if (els.folderTools) els.folderTools.hidden = tree.dirs.length === 0;
  }

  function setCrumb(meta, path, folder) {
    const repoHref = hashFor(meta.owner, meta.repo);
    let html =
      '<a href="#/">Catalog</a><span class="sep">/</span><a href="' +
      repoHref +
      '">' +
      escapeHtml(meta.title || meta.repo) +
      "</a>";
    const trail = path || folder || "";
    if (!trail) {
      els.crumb.innerHTML = html;
      return;
    }
    const parts = trail.split("/").filter(Boolean);
    let acc = [];
    parts.forEach(function (part, i) {
      acc.push(part);
      const isLast = i === parts.length - 1;
      html += '<span class="sep">/</span>';
      if (isLast) {
        html += '<span class="here">' + escapeHtml(part) + "</span>";
      } else {
        html +=
          '<a href="' +
          hashFor(meta.owner, meta.repo, acc.join("/")) +
          '">' +
          escapeHtml(part) +
          "</a>";
      }
    });
    els.crumb.innerHTML = html;
  }

  function showRepoChrome(meta, path, folder) {
    document.body.classList.remove("view-catalog");
    document.body.classList.add("view-repo");
    els.catalog.hidden = true;
    els.repo.hidden = false;
    els.githubLink.hidden = false;
    if (path) {
      els.githubLink.href = ReaderGitHub.githubBlobUrl(
        meta.owner,
        meta.repo,
        meta.branch,
        path
      );
      els.githubLink.textContent = "View on GitHub";
    } else if (folder) {
      els.githubLink.href = ReaderGitHub.githubTreeUrl(
        meta.owner,
        meta.repo,
        meta.branch,
        folder
      );
      els.githubLink.textContent = "View on GitHub";
    } else {
      els.githubLink.href =
        "https://github.com/" + meta.owner + "/" + meta.repo;
      els.githubLink.textContent = "Repo";
    }
    setCrumb(meta, path, folder);
    const folderName = folder ? folder.split("/").pop() : "";
    $("sidebarTitle").textContent = folderName || meta.title || meta.repo;
    $("sidebarMeta").textContent =
      meta.owner + "/" + meta.repo + (folder ? "/" + folder : "");
    els.jumpInputBar.value =
      meta.owner +
      "/" +
      meta.repo +
      (path || folder ? "/" + (path || folder) : "");
  }

  function renderRepoLanding(meta, folder, heading) {
    const tree =
      state.folderTree || buildFolderTree(state.files, meta.root || "");
    const intro = folder
      ? "Open a subfolder, or a note in this folder."
      : meta.description
        ? meta.description
        : "Open a folder or a note.";

    let foldersHtml = "";
    if (tree.dirs && tree.dirs.length) {
      foldersHtml =
        '<ul class="folder-pick">' +
        tree.dirs
          .map(function (dir) {
            const notes = countTreeFiles(dir);
            const subs = dir.dirs.length;
            const bits = [];
            if (subs) {
              bits.push(subs + (subs === 1 ? " folder" : " folders"));
            }
            if (notes) {
              bits.push(notes + (notes === 1 ? " note" : " notes"));
            }
            return (
              '<li><a class="folder-card" href="' +
              hashFor(meta.owner, meta.repo, dir.path) +
              '"><span class="folder-card-name">' +
              escapeHtml(dir.name) +
              "</span>" +
              (bits.length
                ? '<span class="folder-card-meta">' +
                  escapeHtml(bits.join(" · ")) +
                  "</span>"
                : "") +
              "</a></li>"
            );
          })
          .join("") +
        "</ul>";
    }

    let filesHtml = "";
    if (tree.files && tree.files.length) {
      filesHtml =
        (tree.dirs && tree.dirs.length
          ? '<h2 class="pick-heading">Notes in this folder</h2>'
          : "") +
        '<ul class="pick-list">' +
        tree.files
          .map(function (file) {
            return (
              '<li><a href="' +
              hashFor(meta.owner, meta.repo, file.path) +
              '">' +
              escapeHtml(file.name) +
              "</a></li>"
            );
          })
          .join("") +
        "</ul>";
    }

    els.article.innerHTML =
      '<div class="article-msg"><h1>' +
      escapeHtml(heading) +
      "</h1><p>" +
      escapeHtml(intro) +
      "</p>" +
      foldersHtml +
      filesHtml +
      "</div>";
  }

  function showArticleMessage(title, body, kind) {
    els.article.innerHTML =
      '<div class="article-msg' +
      (kind ? " " + kind : "") +
      '"><h1>' +
      escapeHtml(title) +
      "</h1><p>" +
      escapeHtml(body) +
      "</p></div>";
  }

  async function loadRepo(owner, repo, folder) {
    showStatus("Indexing Markdown files…");
    const meta = await resolveMeta(owner, repo);
    try {
      var stored = sessionStorage.getItem(
        "reader-branch:" + meta.owner + "/" + meta.repo
      );
      if (stored) meta.branch = stored;
    } catch (e) {
      /* ignore */
    }
    const catalogRoot = (meta.root || "").replace(/^\/+|\/+$/g, "");
    const urlFolder = (folder || "").replace(/^\/+|\/+$/g, "");
    meta.root = urlFolder || catalogRoot;
    state.meta = meta;
    loadCollapsed();
    const listed = await ReaderGitHub.listMarkdownFiles(
      meta.owner,
      meta.repo,
      meta.branch,
      meta.root
    );
    state.files = listed.paths;
    state.truncated = listed.truncated;
    if (meta.root) meta.root = canonicalFolder(state.files, meta.root);
    showStatus("");
    return meta;
  }

  async function onRoute() {
    const route = parseHash();
    state.route = route;
    setSidebar(false);

    try {
      if (route.view === "catalog") {
        state.scopedFolder = "";
        renderCatalog();
        return;
      }

      if (route.view === "repo") {
        state.scopedFolder = route.folder || "";
      } else if (state.scopedFolder && !pathIsUnder(route.path, state.scopedFolder)) {
        state.scopedFolder = "";
      }

      const folderFilter = route.folder || state.scopedFolder || "";
      const meta = await loadRepo(route.owner, route.repo, folderFilter);
      if (folderFilter) state.scopedFolder = meta.root;
      const folder = folderFilter ? meta.root : "";
      showRepoChrome(meta, route.path || "", folder);
      renderFileList(route.path || "", folder);

      if (route.view === "repo") {
        const heading = folder ? folder.split("/").pop() : meta.title;
        setTitle([heading, meta.title, "Reader"]);
        if (!state.files.length) {
          showArticleMessage(
            heading,
            "No Markdown files showed up under " +
              (meta.root ? '"' + meta.root + '"' : "the repo root") +
              "."
          );
          return;
        }
        renderRepoLanding(meta, folder, heading);
        return;
      }

      setTitle([relativePath(route.path, meta.root), meta.title, "Reader"]);
      showStatus("Loading " + relativePath(route.path, meta.root) + "…");
      const text = await ReaderGitHub.fetchMarkdown(
        meta.owner,
        meta.repo,
        meta.branch,
        route.path
      );
      const rendered = ReaderMarkdown.render(text, {
        owner: meta.owner,
        repo: meta.repo,
        branch: meta.branch,
        path: route.path
      });
      els.article.innerHTML = "";
      const body = document.createElement("div");
      body.className = "markdown-body";
      while (rendered.firstChild) body.appendChild(rendered.firstChild);
      els.article.appendChild(body);
      showStatus("");
      els.article.scrollTop = 0;
    } catch (err) {
      console.error(err);
      showStatus("");
      if (state.route.view === "catalog") {
        els.repoList.innerHTML =
          '<p class="empty error">' + escapeHtml(err.message) + "</p>";
        return;
      }
      document.body.classList.remove("view-catalog");
      document.body.classList.add("view-repo");
      els.catalog.hidden = true;
      els.repo.hidden = false;
      showArticleMessage("Could not load this", err.message, "error");
    }
  }

  async function init() {
    bind();
    try {
      await loadCatalog();
    } catch (err) {
      state.catalog = { title: "Reader", repos: [] };
      renderCatalog();
      els.repoList.innerHTML =
        '<p class="empty error">' + escapeHtml(err.message) + "</p>";
      return;
    }
    await onRoute();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
