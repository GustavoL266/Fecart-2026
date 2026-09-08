export class ApiError extends Error {
  constructor(message, status = 0, code = "", details = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isGitHubPages() {
  return window.location.hostname.endsWith(".github.io");
}

async function request(path, options = {}) {
  const { method = "GET", body, handleUnauthorized = true } = options;
  if (isGitHubPages() && (path.startsWith("/auth") || path.startsWith("/products") || path.startsWith("/market") || path.startsWith("/tax") || path.startsWith("/fiscal"))) {
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
      // API and interface share the Render domain. "include" also keeps the
      // cookie explicit if this client is ever embedded by a same-site origin.
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    console.error(`[api] Falha de rede em ${method} ${path}:`, error);
    throw new ApiError("Não foi possível conectar ao servidor.", 0);
  }

  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (response.ok) return payload;

  const error = new ApiError(payload?.error || "Não foi possível concluir a operação.", response.status, payload?.code || "", payload || {});
  // A provider can legitimately return HTTP 401 (for example Focus NFe or
  // FiscalHub). Only our explicit session code may reset the local account.
  if (handleUnauthorized && error.code === "SESSION_REQUIRED") window.dispatchEvent(new CustomEvent("app:session-expired"));
  throw error;
}

export const api = {
  get: (path, options) => request(path, options),
  post: (path, body, options) => request(path, { ...options, method: "POST", body }),
  patch: (path, body, options) => request(path, { ...options, method: "PATCH", body }),
  delete: (path, options) => request(path, { ...options, method: "DELETE" }),
};
