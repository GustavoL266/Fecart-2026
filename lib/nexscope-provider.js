import { z } from "zod";

export const NEXSCOPE_AMAZON_SEARCH_URL = "https://api.nexscope.ai/api/skill-api/v1/skills/amazon-search/run";
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1_000;
const SEARCH_RESULT_LIMIT = 10;
const SAFE_LOG_VALUE_LIMIT = 300;

const productSchema = z.object({
  asin: z.unknown().optional(),
  title: z.unknown().optional(),
  brand: z.unknown().optional(),
  price: z.unknown().optional(),
  extractedPrice: z.unknown().optional(),
  currency: z.unknown().optional(),
  imageUrl: z.unknown().optional(),
  asinUrl: z.unknown().optional(),
  sourceType: z.unknown().optional(),
}).passthrough();

const searchResponseSchema = z.object({
  total: z.unknown().optional(),
  keyword: z.unknown().optional(),
  page: z.unknown().optional(),
  pageSize: z.unknown().optional(),
  totalPage: z.unknown().optional(),
  products: z.array(productSchema).optional(),
  errcode: z.unknown().optional(),
  errmsg: z.unknown().optional(),
  code: z.unknown().optional(),
  msg: z.unknown().optional(),
  message: z.unknown().optional(),
  requestId: z.unknown().optional(),
  request_id: z.unknown().optional(),
  success: z.unknown().optional(),
}).passthrough();

export class NexscopeError extends Error {
  constructor(message, { code, details = {}, status = 503, retryable = false } = {}) {
    super(message);
    this.name = "NexscopeError";
    this.code = code || "NEXSCOPE_ERROR";
    this.details = details;
    this.status = status;
    this.retryable = retryable;
  }
}

function safeHttpsUrl(value, allowedHostSuffixes) {
  try {
    const url = new URL(value);
    const allowedHost = allowedHostSuffixes.some((suffix) =>
      url.hostname === suffix || url.hostname.endsWith(`.${suffix}`));
    return url.protocol === "https:" && allowedHost ? url.toString() : "";
  } catch {
    return "";
  }
}

function productUrl(value, asin, amazonDomain) {
  const directUrl = safeHttpsUrl(value, ["amazon.com.br"]);
  if (directUrl) return directUrl;
  const normalizedAsin = String(asin || "").trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(normalizedAsin)
    ? `https://www.${amazonDomain}/dp/${normalizedAsin}`
    : "";
}

function normalizeCurrency(value) {
  const currency = String(value || "").trim().toUpperCase();
  return ["BRL", "R$", "REAL", "REAIS"].includes(currency) ? "BRL" : currency;
}

function positiveNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonnegativeInteger(value, fallback) {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeProduct(product, { amazonDomain, consultedAt }) {
  const id = String(product.asin || "").trim().toUpperCase();
  const title = String(product.title || "").trim();
  const price = positiveNumber(product.extractedPrice) ?? positiveNumber(product.price);
  const currency = normalizeCurrency(product.currency);
  const url = productUrl(product.asinUrl, id, amazonDomain);
  const image = safeHttpsUrl(product.imageUrl, ["media-amazon.com", "ssl-images-amazon.com", "amazon.com"]);

  if (!id || !title || !url || currency !== "BRL" || price === null) return null;
  return {
    id,
    asin: id,
    title,
    price,
    currency,
    source: "Amazon",
    category: String(product.brand || "").trim(),
    image,
    url,
    consultedAt,
  };
}

function errorForStatus(status, upstreamDetails = {}) {
  const details = {
    upstreamStatus: upstreamDetails.upstreamStatus ?? status,
    ...(upstreamDetails.upstreamCode ? { upstreamCode: upstreamDetails.upstreamCode } : {}),
    ...(upstreamDetails.requestId ? { requestId: upstreamDetails.requestId } : {}),
  };
  if (status === 400) {
    return new NexscopeError("A Nexscope não aceitou os parâmetros desta pesquisa.", {
      code: "NEXSCOPE_INVALID_REQUEST",
      details,
      status: 400,
    });
  }
  if (status === 401) {
    return new NexscopeError("A Nexscope recusou a credencial enviada.", {
      code: "NEXSCOPE_UNAUTHORIZED",
      details,
      status: 401,
    });
  }
  if (status === 402) {
    return new NexscopeError("A conta Nexscope não possui créditos suficientes para esta pesquisa.", {
      code: "NEXSCOPE_INSUFFICIENT_CREDITS",
      details,
      status: 402,
    });
  }
  if (status === 403) {
    return new NexscopeError("A conta Nexscope não possui acesso ao Amazon Search.", {
      code: "NEXSCOPE_FORBIDDEN",
      details,
      status: 403,
    });
  }
  if (status === 429) {
    return new NexscopeError("A Nexscope limitou temporariamente as consultas.", {
      code: "NEXSCOPE_RATE_LIMITED",
      details,
      status: 429,
    });
  }
  if (status === 504) {
    return new NexscopeError("A consulta à Nexscope excedeu o tempo de resposta.", {
      code: "NEXSCOPE_TIMEOUT",
      details,
      status: 504,
    });
  }
  if (status === 503) {
    return new NexscopeError("A Nexscope está temporariamente indisponível.", {
      code: "NEXSCOPE_UNAVAILABLE",
      details,
      status: 503,
      retryable: true,
    });
  }
  return new NexscopeError("A Nexscope ou uma dependência dela falhou ao executar a pesquisa.", {
    code: "NEXSCOPE_UPSTREAM_ERROR",
    details,
    status: 502,
    retryable: status >= 500,
  });
}

function firstNonEmptyValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function responseErrorInfo(payload, response) {
  const nestedError = payload?.error && typeof payload.error === "object" ? payload.error : {};
  const code = firstNonEmptyValue(payload?.errcode, payload?.code, nestedError.code);
  const message = firstNonEmptyValue(
    payload?.errmsg,
    payload?.msg,
    payload?.message,
    nestedError.message,
    typeof payload?.error === "string" ? payload.error : undefined,
    response?.statusText,
  );
  const requestId = firstNonEmptyValue(
    response?.headers?.get?.("x-request-id"),
    response?.headers?.get?.("request-id"),
    response?.headers?.get?.("x-correlation-id"),
    payload?.requestId,
    payload?.request_id,
    payload?.traceId,
  );
  return {
    code: code === undefined ? "" : String(code),
    message: message === undefined ? "" : String(message),
    requestId: requestId === undefined ? "" : String(requestId),
  };
}

function hasApplicationError(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.success === false) return true;
  if (payload.errcode !== undefined && !["", "0"].includes(String(payload.errcode).trim())) return true;
  if (payload.error) return true;
  const hasErrorMessage = firstNonEmptyValue(payload.errmsg, payload.msg, payload.message) !== undefined;
  const hasNonzeroCode = payload.code !== undefined && !["", "0", "200"].includes(String(payload.code).trim());
  return Boolean(hasNonzeroCode && (hasErrorMessage || !Array.isArray(payload.products)));
}

function applicationErrorStatus(info) {
  const numericCode = Number.parseInt(info.code, 10);
  if ([400, 401, 402, 403, 429, 503, 504].includes(numericCode)) return numericCode;

  const diagnostic = `${info.code} ${info.message}`.toLowerCase();
  if (/credit|balance|billing|payment|insufficient/.test(diagnostic)) return 402;
  if (/forbidden|permission|access denied|not authorized|not allowed|plan/.test(diagnostic)) return 403;
  if (/unauthorized|api[ _-]?key|credential|authentication|invalid key/.test(diagnostic)) return 401;
  if (/rate.?limit|too many requests|throttl/.test(diagnostic)) return 429;
  if (/invalid (request|parameter)|bad request/.test(diagnostic)) return 400;
  if (/timeout|timed out/.test(diagnostic)) return 504;
  return 502;
}

function safeLogValue(value, secret) {
  const singleLine = String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, SAFE_LOG_VALUE_LIMIT);
  return redactNexscopeSensitiveData(singleLine, [secret]);
}

async function readResponsePayload(response) {
  if (typeof response.text === "function") {
    const text = await response.text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export class NexscopeProvider {
  #amazonDomain;
  #apiKey;
  #durationNow;
  #fetch;
  #inflightSearches = new Map();
  #language;
  #logger;
  #now;
  #searchCache = new Map();
  #searchCacheTtlMs;
  #timeoutMs;

  constructor({
    amazonDomain,
    apiKey,
    language,
    timeoutMs = 15_000,
    fetchImpl = globalThis.fetch,
    logger = console,
    now = Date.now,
    durationNow = Date.now,
    searchCacheTtlMs = SEARCH_CACHE_TTL_MS,
  } = {}) {
    if (![amazonDomain, apiKey, language].every((value) => String(value || "").trim())) {
      throw new NexscopeError("A Nexscope não foi configurada neste ambiente.", {
        code: "NEXSCOPE_NOT_CONFIGURED",
      });
    }
    if (typeof fetchImpl !== "function") throw new TypeError("Um cliente HTTP compatível com fetch é obrigatório.");

    this.#amazonDomain = amazonDomain.trim();
    this.#apiKey = apiKey.trim();
    this.#durationNow = durationNow;
    this.#fetch = fetchImpl;
    this.#language = language.trim();
    this.#logger = logger;
    this.#now = now;
    this.#searchCacheTtlMs = searchCacheTtlMs;
    this.#timeoutMs = timeoutMs;
  }

  async #requestSearch(query) {
    const startedAt = this.#durationNow();
    this.#logger.info?.(`[Nexscope] Search "${safeLogValue(query, this.#apiKey)}"`);
    this.#logger.info?.("[Nexscope] POST amazon-search");
    try {
      let response;
      try {
        response = await this.#fetch(NEXSCOPE_AMAZON_SEARCH_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.#apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            keyword: query,
            amazonDomain: this.#amazonDomain,
            language: this.#language,
            page: 1,
            device: "desktop",
          }),
          redirect: "error",
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
      } catch (error) {
        const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";
        const requestError = new NexscopeError(
          isTimeout ? "A consulta à Nexscope excedeu o tempo de resposta." : "Não foi possível conectar à Nexscope.",
          {
            code: isTimeout ? "NEXSCOPE_TIMEOUT" : "NEXSCOPE_UNAVAILABLE",
            status: isTimeout ? 504 : 503,
          },
        );
        this.#logger.warn?.(`[Nexscope] Status: ${isTimeout ? "timeout" : "network-error"}`);
        this.#logger.warn?.(`[Nexscope] Error: code=${requestError.code} message=${safeLogValue(requestError.message, this.#apiKey)}`);
        throw requestError;
      }

      this.#logger.info?.(`[Nexscope] Status: ${response.status}`);
      const payload = await readResponsePayload(response);
      const upstreamInfo = responseErrorInfo(payload, response);
      const upstreamDetails = {
        upstreamCode: upstreamInfo.code,
        upstreamStatus: response.status,
        requestId: upstreamInfo.requestId,
      };

      if (!response.ok) {
        const requestError = errorForStatus(response.status, upstreamDetails);
        const diagnosticMessage = upstreamInfo.message || requestError.message;
        const requestId = upstreamInfo.requestId ? ` requestId=${safeLogValue(upstreamInfo.requestId, this.#apiKey)}` : "";
        this.#logger.warn?.(
          `[Nexscope] Error: code=${safeLogValue(upstreamInfo.code || requestError.code, this.#apiKey)} message=${safeLogValue(diagnosticMessage, this.#apiKey)}${requestId}`,
        );
        throw requestError;
      }

      const parsed = searchResponseSchema.safeParse(payload);
      if (!parsed.success) {
        const invalidResponseError = new NexscopeError("A Nexscope retornou uma resposta inválida.", {
          code: "NEXSCOPE_INVALID_RESPONSE",
          details: { upstreamStatus: response.status, ...(upstreamInfo.requestId ? { requestId: upstreamInfo.requestId } : {}) },
          status: 502,
        });
        this.#logger.warn?.(`[Nexscope] Error: code=${invalidResponseError.code} message=${invalidResponseError.message}`);
        throw invalidResponseError;
      }

      if (hasApplicationError(parsed.data)) {
        const inferredStatus = applicationErrorStatus(upstreamInfo);
        const applicationError = errorForStatus(inferredStatus, upstreamDetails);
        const diagnosticMessage = upstreamInfo.message || applicationError.message;
        const requestId = upstreamInfo.requestId ? ` requestId=${safeLogValue(upstreamInfo.requestId, this.#apiKey)}` : "";
        this.#logger.warn?.(
          `[Nexscope] Error: code=${safeLogValue(upstreamInfo.code || applicationError.code, this.#apiKey)} message=${safeLogValue(diagnosticMessage, this.#apiKey)}${requestId}`,
        );
        throw applicationError;
      }

      const consultedAt = new Date(this.#now()).toISOString();
      const products = parsed.data.products || [];
      const results = products
        .map((product) => normalizeProduct(product, { amazonDomain: this.#amazonDomain, consultedAt }))
        .filter(Boolean)
        .slice(0, SEARCH_RESULT_LIMIT);
      this.#logger.info?.(`[Nexscope] Products received: ${products.length}`, {
        usableProducts: results.length,
      });
      return {
        results,
        page: nonnegativeInteger(parsed.data.page, 1),
        pageSize: nonnegativeInteger(parsed.data.pageSize, products.length),
        total: nonnegativeInteger(parsed.data.total, results.length),
        totalPages: nonnegativeInteger(parsed.data.totalPage, null),
      };
    } finally {
      const durationMs = Math.max(0, Math.round(this.#durationNow() - startedAt));
      this.#logger.info?.(`[Nexscope] Duration: ${durationMs}ms`);
    }
  }

  async search(query) {
    const normalizedQuery = String(query || "").trim().replace(/\s+/g, " ");
    if (normalizedQuery.length < 3) {
      throw new NexscopeError("Informe pelo menos 3 caracteres para pesquisar.", {
        code: "INVALID_MARKET_QUERY",
        status: 400,
      });
    }

    const key = normalizedQuery.toLocaleLowerCase("pt-BR");
    const cached = this.#searchCache.get(key);
    if (cached && cached.expiresAt > this.#now()) {
      this.#logger.info?.("[Nexscope] Cache hit", { query: normalizedQuery });
      return { ...cached.result, cached: true };
    }
    if (cached) this.#searchCache.delete(key);
    if (this.#inflightSearches.has(key)) return this.#inflightSearches.get(key);

    const request = this.#requestSearch(normalizedQuery)
      .then((response) => {
        const result = {
          ...response,
          query: normalizedQuery,
          marketplace: "Amazon",
          provider: "Nexscope",
        };
        this.#searchCache.set(key, { expiresAt: this.#now() + this.#searchCacheTtlMs, result });
        if (this.#searchCache.size > 50) this.#searchCache.delete(this.#searchCache.keys().next().value);
        return result;
      })
      .finally(() => this.#inflightSearches.delete(key));
    this.#inflightSearches.set(key, request);
    return request;
  }
}

export function createNexscopeProvider(config, dependencies = {}) {
  return new NexscopeProvider({ ...config, ...dependencies });
}

export function redactNexscopeSensitiveData(value, secrets = []) {
  let sanitized = String(value || "").replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]");
  for (const secret of secrets) {
    if (secret) sanitized = sanitized.replaceAll(secret, "[REDACTED]");
  }
  return sanitized;
}

function sanitizeClientDetail(value, secrets) {
  if (typeof value === "string") {
    return redactNexscopeSensitiveData(value, secrets).slice(0, SAFE_LOG_VALUE_LIMIT);
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeClientDetail(item, secrets));
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  return undefined;
}

export function nexscopeErrorForClient(error, secrets = []) {
  const safeDetails = Object.fromEntries(
    Object.entries(error.details || {})
      .map(([key, value]) => [key, sanitizeClientDetail(value, secrets)])
      .filter(([, value]) => value !== undefined),
  );
  return {
    error: redactNexscopeSensitiveData(error.message, secrets),
    code: error.code,
    ...safeDetails,
  };
}
