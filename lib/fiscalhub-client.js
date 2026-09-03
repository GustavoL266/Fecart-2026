const FISCALHUB_BASE_URL = "https://api.fiscalhub.com.br";
const retryableStatuses = new Set([429, 502, 503, 504]);

export class FiscalHubError extends Error {
  constructor(message, { code = "FISCALHUB_ERROR", status = 500, retryable = false } = {}) {
    super(message);
    this.name = "FiscalHubError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function errorForStatus(status) {
  if (status === 400) {
    return new FiscalHubError("Os dados da operação fiscal são inválidos.", {
      code: "FISCALHUB_INVALID_OPERATION",
      status: 400,
    });
  }
  if (status === 401) {
    return new FiscalHubError("A API Key da FiscalHub é inválida ou foi revogada.", {
      code: "FISCALHUB_UNAUTHORIZED",
      status: 401,
    });
  }
  if (status === 403) {
    return new FiscalHubError("A empresa ou o recurso não está autorizado na FiscalHub.", {
      code: "FISCALHUB_FORBIDDEN",
      status: 403,
    });
  }
  if (status === 404) {
    return new FiscalHubError("A empresa ou o recurso não foi encontrado na FiscalHub.", {
      code: "FISCALHUB_NOT_FOUND",
      status: 404,
    });
  }
  if (status === 422) {
    return new FiscalHubError("A FiscalHub rejeitou os dados da operação fiscal.", {
      code: "FISCALHUB_REJECTED",
      status: 422,
    });
  }
  if (status === 429) {
    return new FiscalHubError("A FiscalHub limitou temporariamente as consultas.", {
      code: "FISCALHUB_RATE_LIMITED",
      status: 429,
      retryable: true,
    });
  }
  if (status >= 500) {
    return new FiscalHubError("A FiscalHub não conseguiu concluir o cálculo.", {
      code: "FISCALHUB_ERROR",
      status,
      retryable: retryableStatuses.has(status),
    });
  }
  return new FiscalHubError("A FiscalHub retornou uma resposta inesperada.", {
    code: "FISCALHUB_BAD_GATEWAY",
    status: 502,
  });
}

function retryDelayMs(response, attempt) {
  const retryAfter = response.headers?.get?.("retry-after");
  const seconds = Number.parseInt(retryAfter || "", 10);
  if (Number.isInteger(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 2_000);
  return 150 * (2 ** attempt);
}

export class FiscalHubClient {
  #apiKey;
  #baseUrl;
  #fetch;
  #logger;
  #maxRetries;
  #sleep;
  #timeoutMs;

  constructor({
    apiKey,
    baseUrl = FISCALHUB_BASE_URL,
    timeoutMs = 10_000,
    fetchImpl = globalThis.fetch,
    logger = console,
    maxRetries = 1,
    sleep,
  } = {}) {
    if (!apiKey?.trim()) {
      throw new FiscalHubError("A integração FiscalHub não foi configurada.", {
        code: "FISCALHUB_NOT_CONFIGURED",
        status: 503,
      });
    }
    if (typeof fetchImpl !== "function") throw new TypeError("Um cliente HTTP compatível com fetch é obrigatório.");
    const normalizedBaseUrl = String(baseUrl || "").replace(/\/+$/, "");
    if (normalizedBaseUrl !== FISCALHUB_BASE_URL) throw new TypeError("URL base da FiscalHub não permitida.");

    this.#apiKey = apiKey.trim();
    this.#baseUrl = normalizedBaseUrl;
    this.#fetch = fetchImpl;
    this.#logger = logger;
    this.#maxRetries = maxRetries;
    this.#sleep = sleep || ((milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)));
    this.#timeoutMs = timeoutMs;
  }

  async request(path, { method = "GET", body } = {}) {
    let lastError;

    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      let response;
      try {
        response = await this.#fetch(`${this.#baseUrl}${path}`, {
          method,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Api-Key": this.#apiKey,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: "error",
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
      } catch (error) {
        const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";
        lastError = new FiscalHubError(
          isTimeout ? "A FiscalHub não respondeu dentro do tempo esperado." : "Não foi possível conectar à FiscalHub.",
          {
            code: isTimeout ? "FISCALHUB_TIMEOUT" : "FISCALHUB_UNAVAILABLE",
            status: isTimeout ? 504 : 503,
            retryable: true,
          },
        );
        this.#logger.warn?.("[FiscalHub] Request failed", { code: lastError.code, attempt: attempt + 1 });
        if (attempt < this.#maxRetries) {
          await this.#sleep(150 * (2 ** attempt));
          continue;
        }
        throw lastError;
      }

      this.#logger.info?.(`[FiscalHub] Status: ${response.status}`);
      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new FiscalHubError("A FiscalHub retornou uma resposta inválida.", {
            code: "FISCALHUB_INVALID_RESPONSE",
            status: 502,
          });
        }
      }

      lastError = errorForStatus(response.status);
      if (lastError.retryable && attempt < this.#maxRetries) {
        await this.#sleep(retryDelayMs(response, attempt));
        continue;
      }
      throw lastError;
    }

    throw lastError;
  }
}

export function createFiscalHubClient(config, dependencies = {}) {
  return new FiscalHubClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    ...dependencies,
  });
}

export function redactFiscalHubSensitiveData(value, secrets = []) {
  let sanitized = String(value || "")
    .replace(/X-Api-Key\s*[:=]\s*[^\s,;]+/gi, "X-Api-Key: [REDACTED]")
    .replace(/fh_(?:live|test)_[A-Za-z0-9_-]+/gi, "[REDACTED]");
  for (const secret of secrets) {
    if (secret) sanitized = sanitized.replaceAll(secret, "[REDACTED]");
  }
  return sanitized;
}

export function fiscalHubErrorForClient(error, secrets = []) {
  return {
    error: redactFiscalHubSensitiveData(error.message, secrets),
    code: error.code,
  };
}
