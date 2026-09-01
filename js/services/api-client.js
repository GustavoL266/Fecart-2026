export class ApiError extends Error {
  constructor(message, status = 0, code = "") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function isGitHubPages() {
  return window.location.hostname.endsWith(".github.io");
}

async function request(path, options = {}) {
  const { method = "GET", body, handleUnauthorized = true } = options;
  if (isGitHubPages() && (path.startsWith("/auth") || path.startsWith("/products") || path.startsWith("/amazon"))) {
    throw new ApiError(
      "Este endereço do GitHub Pages exibe apenas a interface. Abra a URL da aplicação no Render para criar ou acessar sua conta.",
      503,
      "STATIC_HOSTING",
    );
  }
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    console.error(`[api] Falha de rede em ${method} ${path}:`, error);
    throw new ApiError("Não foi possível conectar ao servidor.", 0);
  }

  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (response.ok) return payload;

  const error = new ApiError(payload?.error || "Não foi possível concluir a operação.", response.status, payload?.code || "");
  if (handleUnauthorized && response.status === 401) window.dispatchEvent(new CustomEvent("app:session-expired"));
  throw error;
}

export const api = {
  get: (path, options) => request(path, options),
  post: (path, body, options) => request(path, { ...options, method: "POST", body }),
  patch: (path, body, options) => request(path, { ...options, method: "PATCH", body }),
  delete: (path, options) => request(path, { ...options, method: "DELETE" }),
};
