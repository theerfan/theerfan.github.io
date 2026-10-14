(function () {
  function readCookie(name) {
    try {
      var parts = document.cookie.split(";");
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i].replace(/^\s+/, "");
        if (p.indexOf(name + "=") === 0) {
          return decodeURIComponent(p.slice(name.length + 1));
        }
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  function readPref(key) {
    try {
      var local = localStorage.getItem(key);
      if (local) return local;
    } catch (e) {
      /* ignore */
    }
    try {
      var session = sessionStorage.getItem(key);
      if (session) return session;
    } catch (e) {
      /* ignore */
    }
    return readCookie(key);
  }

  function writePref(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      /* ignore */
    }
    try {
      sessionStorage.setItem(key, value);
    } catch (e) {
      /* ignore */
    }
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

  var storedTheme = readPref("reader-theme");
  var storedAlign = readPref("reader-align");
  var storedSidebar = readPref("reader-sidebar");
  var storedWarmth = readPref("reader-warmth");
  var legacyWarm = readPref("reader-warm");
  var storedFont = readPref("reader-font");
  var storedSize = readPref("reader-text-size");
  var theme;
  var align;
  var sidebar;
  var rememberedTheme = storedTheme === "light" || storedTheme === "dark";

  if (rememberedTheme) {
    theme = storedTheme;
  } else {
    theme =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  }
  if (storedAlign === "left" || storedAlign === "right" || storedAlign === "center") {
    align = storedAlign;
  } else {
    align = "center";
  }
  if (storedSidebar === "collapsed" || storedSidebar === "expanded") {
    sidebar = storedSidebar;
  } else {
    sidebar = "expanded";
  }

  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.setAttribute("data-align", align);
  document.documentElement.setAttribute("data-sidebar", sidebar);
  /* Warm text, 0..100; the old on/off setting maps to 40, its former tint. */
  var warmth = parseInt(storedWarmth, 10);
  if (!(warmth >= 0 && warmth <= 100)) warmth = legacyWarm === "on" ? 40 : 0;
  document.documentElement.style.setProperty("--warmth", String(warmth));
  /* Reading font (see css/doc.css) and text size, a scale of 0.85..1.5. */
  if (/^(literata|sans|legible)$/.test(storedFont || "")) {
    document.documentElement.setAttribute("data-font", storedFont);
  }
  var size = parseFloat(storedSize);
  if (size >= 0.85 && size <= 1.5 && size !== 1) {
    document.documentElement.style.setProperty("--text-scale", String(size));
  }
  if (document.body) {
    document.body.classList.toggle("sidebar-collapsed", sidebar === "collapsed");
  }

  if (rememberedTheme) writePref("reader-theme", theme);
  if (storedAlign === align) writePref("reader-align", align);
  if (storedSidebar === sidebar) writePref("reader-sidebar", sidebar);
  if (warmth > 0) writePref("reader-warmth", String(warmth));
})();
