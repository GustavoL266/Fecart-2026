export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request(path, options = {}) {
  const { method = "GET", body, handleUnauthorized = true } = options;
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

  const error = new ApiError(payload?.error || "Não foi possível concluir a operação.", response.status);
  if (handleUnauthorized && response.status === 401) window.dispatchEvent(new CustomEvent("app:session-expired"));
  throw error;
}

export const api = {
  get: (path, options) => request(path, options),
  post: (path, body, options) => request(path, { ...options, method: "POST", body }),
  patch: (path, body, options) => request(path, { ...options, method: "PATCH", body }),
  delete: (path, options) => request(path, { ...options, method: "DELETE" }),
};
