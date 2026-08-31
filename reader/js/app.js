(function () {
  const els = {};
  const state = {
    catalog: { title: "Reader", repos: [] },
    route: { view: "catalog" },
    meta: null,
    files: [],
    truncated: false,
    sidebarOpen: false
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

    els.menuBtn.addEventListener("click", function () {
      setSidebar(!state.sidebarOpen);
    });
    els.backdrop.addEventListener("click", function () {
      setSidebar(false);
    });
    window.addEventListener("hashchange", onRoute);
    window.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") setSidebar(false);
    });
  }

  function setSidebar(open) {
    state.sidebarOpen = open;
    document.body.classList.toggle("sidebar-open", open);
    els.menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
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
    });
    const owner = parts[0];
    const repo = parts[1];
    const path = parts.slice(2).join("/");
    if (!owner || !repo) return { view: "catalog" };
    if (!path) return { view: "repo", owner: owner, repo: repo };
    return { view: "file", owner: owner, repo: repo, path: path };
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
    showStatus("");

    const repos = state.catalog.repos || [];
    if (!repos.length) {
      els.repoList.innerHTML =
        '<p class="empty">No repos in <code>catalog.json</code> yet.</p>';
      return;
    }

    els.repoList.innerHTML = repos
      .map(function (r) {
        const href = "#/" + encodeURIComponent(r.owner) + "/" + encodeURIComponent(r.repo);
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
    if (prefix && path.indexOf(prefix + "/") === 0) return path.slice(prefix.length + 1);
    if (prefix && path === prefix) return path.split("/").pop();
    return path;
  }

  function renderFileList(activePath) {
    const root = state.meta ? state.meta.root : "";
    if (!state.files.length) {
      els.fileList.innerHTML = '<li class="muted">No Markdown files in this repo.</li>';
      return;
    }

    let lastDir = null;
    const bits = [];
    state.files.forEach(function (path) {
      const rel = relativePath(path, root);
      const slash = rel.lastIndexOf("/");
      const dir = slash === -1 ? "" : rel.slice(0, slash);
      const name = slash === -1 ? rel : rel.slice(slash + 1);
      if (dir !== lastDir) {
        if (dir) {
          bits.push(
            '<li class="dir" aria-hidden="true">' + escapeHtml(dir) + "</li>"
          );
        }
        lastDir = dir;
      }
      const href =
        "#/" +
        encodeURIComponent(state.meta.owner) +
        "/" +
        encodeURIComponent(state.meta.repo) +
        "/" +
        path
          .split("/")
          .map(encodeURIComponent)
          .join("/");
      const active = path === activePath ? " active" : "";
      const current = path === activePath ? ' aria-current="page"' : "";
      bits.push(
        '<li><a class="file-link' +
          active +
          '" href="' +
          href +
          '"' +
          current +
          ">" +
          escapeHtml(name) +
          "</a></li>"
      );
    });
    els.fileList.innerHTML = bits.join("");
    els.truncated.hidden = !state.truncated;
  }

  function setCrumb(meta, path) {
    const repoHref =
      "#/" + encodeURIComponent(meta.owner) + "/" + encodeURIComponent(meta.repo);
    let html =
      '<a href="#/">Catalog</a><span class="sep">/</span><a href="' +
      repoHref +
      '">' +
      escapeHtml(meta.title || meta.repo) +
      "</a>";
    if (path) {
      html +=
        '<span class="sep">/</span><span class="here">' +
        escapeHtml(relativePath(path, meta.root)) +
        "</span>";
    }
    els.crumb.innerHTML = html;
  }

  function showRepoChrome(meta, path) {
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
    } else {
      els.githubLink.href =
        "https://github.com/" + meta.owner + "/" + meta.repo;
      els.githubLink.textContent = "Repo";
    }
    setCrumb(meta, path);
    $("sidebarTitle").textContent = meta.title || meta.repo;
    $("sidebarMeta").textContent = meta.owner + "/" + meta.repo;
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

  async function loadRepo(owner, repo) {
    showStatus("Indexing Markdown files…");
    const meta = await resolveMeta(owner, repo);
    state.meta = meta;
    const listed = await ReaderGitHub.listMarkdownFiles(
      meta.owner,
      meta.repo,
      meta.branch,
      meta.root
    );
    state.files = listed.paths;
    state.truncated = listed.truncated;
    showStatus("");
    return meta;
  }

  async function onRoute() {
    const route = parseHash();
    state.route = route;
    setSidebar(false);

    try {
      if (route.view === "catalog") {
        renderCatalog();
        return;
      }

      const meta = await loadRepo(route.owner, route.repo);
      showRepoChrome(meta, route.path || "");
      renderFileList(route.path || "");

      if (route.view === "repo") {
        setTitle([meta.title, "Reader"]);
        if (!state.files.length) {
          showArticleMessage(
            meta.title,
            "No Markdown files showed up under " +
              (meta.root ? '"' + meta.root + '"' : "the repo root") +
              "."
          );
          return;
        }
        els.article.innerHTML =
          '<div class="article-msg"><h1>' +
          escapeHtml(meta.title) +
          "</h1><p>Select a note in the sidebar." +
          (meta.description ? " " + escapeHtml(meta.description) : "") +
          '</p><ul class="pick-list">' +
          state.files
            .map(function (path) {
              const href =
                "#/" +
                encodeURIComponent(meta.owner) +
                "/" +
                encodeURIComponent(meta.repo) +
                "/" +
                path
                  .split("/")
                  .map(encodeURIComponent)
                  .join("/");
              return (
                '<li><a href="' +
                href +
                '">' +
                escapeHtml(relativePath(path, meta.root)) +
                "</a></li>"
              );
            })
            .join("") +
          "</ul></div>";
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
