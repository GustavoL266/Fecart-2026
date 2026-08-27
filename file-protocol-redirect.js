const hostedAppUrl = "https://fecart-2026.onrender.com/";
const isProjectGithubPages =
  window.location.hostname === "gustavol266.github.io" && window.location.pathname.startsWith("/Fecart-2026");

if (isProjectGithubPages) {
  window.location.replace(`${hostedAppUrl}${window.location.hash}`);
} else if (window.location.protocol === "file:") {
  window.location.replace("http://localhost:3000/");
}
