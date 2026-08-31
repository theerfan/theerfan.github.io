(function () {
  var theme;
  var align;
  var sidebar;
  try {
    theme = localStorage.getItem("reader-theme");
    align = localStorage.getItem("reader-align");
    sidebar = localStorage.getItem("reader-sidebar");
  } catch (e) {
    theme = null;
    align = null;
    sidebar = null;
  }
  if (theme !== "light" && theme !== "dark") {
    theme =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  }
  if (align !== "left" && align !== "right" && align !== "center") {
    align = "center";
  }
  if (sidebar !== "collapsed" && sidebar !== "expanded") {
    sidebar = "expanded";
  }
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.setAttribute("data-align", align);
  document.documentElement.setAttribute("data-sidebar", sidebar);
})();
