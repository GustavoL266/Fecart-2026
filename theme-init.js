(() => {
  const storageKey = "assistente-precificacao-theme";
  try {
    const savedTheme = localStorage.getItem(storageKey);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = savedTheme === "dark" || savedTheme === "light" ? savedTheme : prefersDark ? "dark" : "light";
  } catch {
    document.documentElement.dataset.theme = "light";
  }
})();
