import { Buffer } from "node:buffer";
import { z } from "zod";

const NCM_CODE = /^\d{8}$/;
const ncmPart = (length) => z.string().regex(new RegExp(`^\\d{${length}}$`));

const ncmResponseSchema = z.object({
  codigo: z.string().regex(NCM_CODE),
  descricao_completa: z.string().trim().min(1),
  capitulo: ncmPart(2).optional(),
  posicao: ncmPart(2).optional(),
  subposicao1: ncmPart(1).optional(),
  subposicao2: ncmPart(1).optional(),
  item1: ncmPart(1).optional(),
  item2: ncmPart(1).optional(),
});

const retryableStatuses = new Set([429, 500, 502, 503, 504]);
const allowedBaseUrls = new Set(["https://homologacao.focusnfe.com.br", "https://api.focusnfe.com.br"]);

export class FocusNFeError extends Error {
  constructor(message, { code, status = 503, retryable = false } = {}) {
    super(message);
    this.name = "FocusNFeError";
    this.code = code || "FOCUS_NFE_ERROR";
    this.status = status;
    this.retryable = retryable;
  }
}

function publicErrorForStatus(status) {
  if (status === 401) {
    return new FocusNFeError("A integração fiscal não está autorizada. Verifique a configuração do ambiente.", {
      code: "FOCUS_NFE_UNAUTHORIZED",
      status: 503,
    });
  }
  if (status === 404) {
    return new FocusNFeError("Código NCM não encontrado na Focus NFe.", {
      code: "FOCUS_NFE_NCM_NOT_FOUND",
      status: 404,
    });
  }
  if (status === 429) {
    return new FocusNFeError("A Focus NFe limitou temporariamente as consultas. Tente novamente em instantes.", {
      code: "FOCUS_NFE_RATE_LIMITED",
      status: 503,
      retryable: true,
    });
  }
  return new FocusNFeError("A Focus NFe está temporariamente indisponível.", {
    code: "FOCUS_NFE_UNAVAILABLE",
    status: 503,
    retryable: status >= 500,
  });
}

function retryDelayMs(response, attempt) {
  const retryAfter = response.headers?.get?.("retry-after");
  const seconds = Number.parseInt(retryAfter || "", 10);
  if (Number.isInteger(seconds) && seconds >= 0) return Math.min(seconds * 1000, 2_000);
  return 100 * (2 ** attempt);
}

export class FocusNFeClient {
  #authorization;
  #baseUrl;
  #fetch;
  #logger;
  #maxRetries;
  #sleep;
  #timeoutMs;

  constructor({ token, baseUrl, timeoutMs = 5_000, fetchImpl = globalThis.fetch, logger = console, maxRetries = 2, sleep } = {}) {
    if (!token?.trim()) throw new FocusNFeError("A integração Focus NFe não foi configurada.", { code: "FOCUS_NFE_NOT_CONFIGURED" });
    if (typeof fetchImpl !== "function") throw new TypeError("Um cliente HTTP compatível com fetch é obrigatório.");
    const normalizedBaseUrl = String(baseUrl || "").replace(/\/+$/, "");
    if (!allowedBaseUrls.has(normalizedBaseUrl)) throw new TypeError("URL base da Focus NFe não permitida.");

    this.#authorization = `Basic ${Buffer.from(`${token.trim()}:`, "utf8").toString("base64")}`;
    this.#baseUrl = normalizedBaseUrl;
    this.#fetch = fetchImpl;
    this.#logger = logger;
    this.#maxRetries = maxRetries;
    this.#sleep = sleep || ((milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)));
    this.#timeoutMs = timeoutMs;
  }

  async #request(path) {
    let lastError;

    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      let response;
      try {
        response = await this.#fetch(`${this.#baseUrl}/v2${path}`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: this.#authorization,
          },
          redirect: "error",
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
      } catch (error) {
        const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";
        lastError = new FocusNFeError(
          isTimeout ? "A consulta à Focus NFe excedeu o tempo limite." : "Não foi possível conectar à Focus NFe.",
          { code: isTimeout ? "FOCUS_NFE_TIMEOUT" : "FOCUS_NFE_UNAVAILABLE", retryable: true },
        );
        this.#logger.warn?.("[focus-nfe] Falha temporária na consulta", { code: lastError.code, attempt: attempt + 1 });
        if (attempt < this.#maxRetries) {
          await this.#sleep(100 * (2 ** attempt));
          continue;
        }
        throw lastError;
      }

      if (response.ok) {
        let payload;
        try {
          payload = await response.json();
        } catch {
          throw new FocusNFeError("A Focus NFe retornou uma resposta inválida.", { code: "FOCUS_NFE_INVALID_RESPONSE" });
        }
        return payload;
      }

      lastError = publicErrorForStatus(response.status);
      this.#logger.warn?.("[focus-nfe] Consulta não concluída", {
        code: lastError.code,
        status: response.status,
        attempt: attempt + 1,
      });
      if (retryableStatuses.has(response.status) && attempt < this.#maxRetries) {
        await this.#sleep(retryDelayMs(response, attempt));
        continue;
      }
      throw lastError;
    }

    throw lastError;
  }

  async getNcm(code) {
    const normalizedCode = String(code || "").replace(/\D/g, "");
    if (!NCM_CODE.test(normalizedCode)) {
      throw new FocusNFeError("Informe um código NCM com exatamente 8 dígitos.", {
        code: "INVALID_NCM_CODE",
        status: 400,
      });
    }

    const payload = await this.#request(`/ncms/${encodeURIComponent(normalizedCode)}`);
    const parsed = ncmResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new FocusNFeError("A Focus NFe retornou dados de NCM em formato inesperado.", {
        code: "FOCUS_NFE_INVALID_RESPONSE",
      });
    }
    return parsed.data;
  }
}

export function createFocusNFeClient(config, dependencies = {}) {
  return new FocusNFeClient({
    token: config.token,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    ...dependencies,
  });
}

export function redactFocusNFeSensitiveData(value, secrets = []) {
  let sanitized = String(value || "").replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic [REDACTED]");
  for (const secret of secrets) {
    if (secret) sanitized = sanitized.replaceAll(secret, "[REDACTED]");
  }
  return sanitized;
}

export function focusNFeErrorForClient(error, secrets = []) {
  return {
    error: redactFocusNFeSensitiveData(error.message, secrets),
    code: error.code,
  };
}
