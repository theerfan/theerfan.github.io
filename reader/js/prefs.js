(function () {
  var theme;
  var align;
  try {
    theme = localStorage.getItem("reader-theme");
    align = localStorage.getItem("reader-align");
  } catch (e) {
    theme = null;
    align = null;
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
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.setAttribute("data-align", align);
})();
