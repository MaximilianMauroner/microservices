(() => {
  const saved = window.localStorage.getItem("tools-theme");
  const theme = saved === "light" || saved === "dark" ? saved : "dark";
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f3f5f8" : "#1b1e28");
})();
