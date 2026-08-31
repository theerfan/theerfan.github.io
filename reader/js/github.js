/* Fetch public GitHub repos: file trees and raw Markdown. */
(function (global) {
  const API = "https://api.github.com";
  const RAW = "https://raw.githubusercontent.com";
  const treeCache = new Map();
  const repoCache = new Map();

  const SKIP_PREFIXES = ["node_modules/", "vendor/", ".github/"];

  function cacheKey(owner, repo, branch) {
    return owner + "/" + repo + ":" + branch;
  }

  async function fetchJSON(url) {
    const res = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" }
    });
    if (!res.ok) {
      throw githubError(res);
    }
    return res.json();
  }

  function githubError(res) {
    let extra = "";
    if (res.status === 403 || res.status === 429) {
      const reset = res.headers.get("X-RateLimit-Reset");
      extra = reset
        ? " GitHub rate limit; try again after " +
          new Date(Number(reset) * 1000).toLocaleTimeString() +
          "."
        : " GitHub rate limit. Try again in a bit.";
    } else if (res.status === 404) {
      extra =
        " Not found. If this is your repo, it must be public — this reader cannot see private repos.";
    }
    const err = new Error("GitHub " + res.status + "." + extra);
    err.status = res.status;
    return err;
  }

  async function getRepo(owner, repo) {
    const key = owner + "/" + repo;
    if (repoCache.has(key)) return repoCache.get(key);
    const data = await fetchJSON(API + "/repos/" + owner + "/" + repo);
    const meta = {
      owner: data.owner && data.owner.login ? data.owner.login : owner,
      repo: data.name,
      branch: data.default_branch || "main",
      title: data.full_name,
      description: data.description || "",
      root: ""
    };
    repoCache.set(key, meta);
    return meta;
  }

  async function listMarkdownFiles(owner, repo, branch, root) {
    const key = cacheKey(owner, repo, branch);
    let tree = treeCache.get(key);
    if (!tree) {
      const data = await fetchJSON(
        API +
          "/repos/" +
          owner +
          "/" +
          repo +
          "/git/trees/" +
          encodeURIComponent(branch) +
          "?recursive=1"
      );
      tree = {
        truncated: !!data.truncated,
        paths: (data.tree || [])
          .filter(function (item) {
            return item.type === "blob" && /\.md$/i.test(item.path);
          })
          .map(function (item) {
            return item.path;
          })
      };
      treeCache.set(key, tree);
    }

    const prefix = (root || "").replace(/^\/+|\/+$/g, "");
    const paths = tree.paths.filter(function (path) {
      for (let i = 0; i < SKIP_PREFIXES.length; i++) {
        if (path === SKIP_PREFIXES[i].slice(0, -1) || path.indexOf(SKIP_PREFIXES[i]) === 0) {
          return false;
        }
      }
      if (!prefix) return true;
      return path === prefix || path.indexOf(prefix + "/") === 0;
    });

    return { truncated: tree.truncated, paths: paths };
  }

  async function fetchMarkdown(owner, repo, branch, path) {
    const url =
      RAW +
      "/" +
      owner +
      "/" +
      repo +
      "/" +
      branch +
      "/" +
      path
        .split("/")
        .map(encodeURIComponent)
        .join("/");
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error("File not found: " + path);
      }
      throw new Error("Could not load " + path + " (" + res.status + ")");
    }
    return res.text();
  }

  function rawFileUrl(owner, repo, branch, path) {
    return (
      RAW +
      "/" +
      owner +
      "/" +
      repo +
      "/" +
      branch +
      "/" +
      path
        .split("/")
        .map(encodeURIComponent)
        .join("/")
    );
  }

  function githubBlobUrl(owner, repo, branch, path) {
    return (
      "https://github.com/" +
      owner +
      "/" +
      repo +
      "/blob/" +
      branch +
      "/" +
      path
        .split("/")
        .map(encodeURIComponent)
        .join("/")
    );
  }

  function decodePart(part) {
    try {
      return decodeURIComponent(part);
    } catch (e) {
      return part;
    }
  }

  function parseInput(raw) {
    var s = String(raw || "").trim();
    if (!s) return null;

    var hashIdx = s.indexOf("#/");
    if (hashIdx !== -1) {
      var hp = s.slice(hashIdx + 2).split("/").filter(Boolean);
      if (hp.length >= 2) {
        return {
          owner: decodePart(hp[0]),
          repo: decodePart(hp[1]).replace(/\.git$/i, ""),
          path: hp.slice(2).map(decodePart).join("/"),
          branch: ""
        };
      }
    }

    s = s.replace(/^git@github\.com:/i, "https://github.com/");
    s = s.replace(/\.git$/i, "");

    if (/^(https?:\/\/)?(www\.)?github\.com[:/]/i.test(s)) {
      if (!/^https?:\/\//i.test(s)) s = "https://" + s.replace(/^\/\//, "");
      try {
        var u = new URL(s);
        var segs = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
        if (segs.length < 2 || !segs[0] || !segs[1]) return null;
        var owner = segs[0];
        var repo = segs[1].replace(/\.git$/i, "");
        var path = "";
        var branch = "";
        if (segs[2] === "blob" || segs[2] === "raw") {
          branch = segs[3] || "";
          path = segs.slice(4).join("/");
        } else if (segs[2] === "tree") {
          branch = segs[3] || "";
        }
        return { owner: owner, repo: repo, path: path, branch: branch };
      } catch (e) {
        return null;
      }
    }

    var m = s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/(.*))?$/);
    if (!m) return null;
    return {
      owner: m[1],
      repo: m[2].replace(/\.git$/i, ""),
      path: m[3] || "",
      branch: ""
    };
  }

  global.ReaderGitHub = {
    getRepo: getRepo,
    listMarkdownFiles: listMarkdownFiles,
    fetchMarkdown: fetchMarkdown,
    rawFileUrl: rawFileUrl,
    githubBlobUrl: githubBlobUrl,
    parseInput: parseInput
  };
})(window);
