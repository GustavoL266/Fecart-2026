import { z } from "zod";

export const NEXSCOPE_AMAZON_SEARCH_URL = "https://api.nexscope.ai/api/skill-api/v1/skills/amazon-search/run";
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1_000;
const SEARCH_RESULT_LIMIT = 10;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const productSchema = z.object({
  asin: z.string().optional(),
  title: z.string().optional(),
  brand: z.string().optional(),
  price: z.coerce.number().optional(),
  extractedPrice: z.coerce.number().optional(),
  currency: z.string().optional(),
  imageUrl: z.string().optional(),
  asinUrl: z.string().optional(),
  sourceType: z.string().optional(),
}).passthrough();

const searchResponseSchema = z.object({
  total: z.coerce.number().int().nonnegative().optional(),
  keyword: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  totalPage: z.coerce.number().int().nonnegative().optional(),
  products: z.array(productSchema).optional(),
  errcode: z.coerce.number().optional(),
  errmsg: z.string().optional(),
  code: z.union([z.string(), z.number()]).optional(),
  msg: z.string().optional(),
  message: z.string().optional(),
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
  return !currency || ["BRL", "R$", "REAL", "REAIS"].includes(currency) ? "BRL" : currency;
}

function normalizeProduct(product, { amazonDomain, consultedAt }) {
  const id = String(product.asin || "").trim().toUpperCase();
  const title = String(product.title || "").trim();
  const price = [product.extractedPrice, product.price]
    .map(Number)
    .find((candidate) => Number.isFinite(candidate) && candidate > 0);
  const currency = normalizeCurrency(product.currency);
  const url = productUrl(product.asinUrl, id, amazonDomain);
  const image = safeHttpsUrl(product.imageUrl, ["media-amazon.com", "ssl-images-amazon.com", "amazon.com"]);

  if (!id || !title || !url || currency !== "BRL" || !price) return null;
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

function errorForStatus(status) {
  if (status === 400) {
    return new NexscopeError("A Nexscope não aceitou os parâmetros desta pesquisa.", {
      code: "NEXSCOPE_INVALID_REQUEST",
      status: 400,
    });
  }
  if (status === 401 || status === 403) {
    return new NexscopeError("A credencial da Nexscope é inválida ou não tem permissão para esta consulta.", {
      code: "NEXSCOPE_AUTHENTICATION_FAILED",
      status,
    });
  }
  if (status === 429) {
    return new NexscopeError("A Nexscope limitou temporariamente as consultas.", {
      code: "NEXSCOPE_RATE_LIMITED",
      status: 429,
      retryable: true,
    });
  }
  if (status === 504) {
    return new NexscopeError("A consulta à Nexscope excedeu o tempo de resposta.", {
      code: "NEXSCOPE_TIMEOUT",
      status: 504,
      retryable: true,
    });
  }
  return new NexscopeError("A Nexscope está indisponível no momento.", {
    code: "NEXSCOPE_UNAVAILABLE",
    status: status === 500 ? 502 : [502, 503].includes(status) ? status : 502,
    retryable: status >= 500,
  });
}

function retryDelayMs(response, attempt) {
  const retryAfter = Number.parseInt(response.headers?.get?.("retry-after") || "", 10);
  if (Number.isInteger(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1_000, 2_000);
  return 150 * (2 ** attempt);
}

async function optionalJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export class NexscopeProvider {
  #amazonDomain;
  #apiKey;
  #fetch;
  #inflightSearches = new Map();
  #language;
  #logger;
  #maxRetries;
  #now;
  #searchCache = new Map();
  #searchCacheTtlMs;
  #sleep;
  #timeoutMs;

  constructor({
    amazonDomain,
    apiKey,
    language,
    timeoutMs = 5_000,
    fetchImpl = globalThis.fetch,
    logger = console,
    maxRetries = 2,
    now = Date.now,
    sleep,
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
    this.#fetch = fetchImpl;
    this.#language = language.trim();
    this.#logger = logger;
    this.#maxRetries = maxRetries;
    this.#now = now;
    this.#searchCacheTtlMs = searchCacheTtlMs;
    this.#sleep = sleep || ((milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)));
    this.#timeoutMs = timeoutMs;
  }

  async #requestSearch(query) {
    let lastError;
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
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
        lastError = new NexscopeError(
          isTimeout ? "A consulta à Nexscope excedeu o tempo de resposta." : "Não foi possível conectar à Nexscope.",
          {
            code: isTimeout ? "NEXSCOPE_TIMEOUT" : "NEXSCOPE_UNAVAILABLE",
            status: isTimeout ? 504 : 503,
            retryable: true,
          },
        );
        if (attempt < this.#maxRetries) {
          await this.#sleep(150 * (2 ** attempt));
          continue;
        }
        throw lastError;
      }

      const payload = await optionalJsonResponse(response);
      if (response.ok) {
        const parsed = searchResponseSchema.safeParse(payload);
        if (!parsed.success) {
          throw new NexscopeError("A Nexscope retornou uma resposta inválida.", {
            code: "NEXSCOPE_INVALID_RESPONSE",
            status: 502,
          });
        }
        if (Number.isFinite(parsed.data.errcode) && parsed.data.errcode !== 0) {
          throw new NexscopeError("A Nexscope não conseguiu executar esta pesquisa.", {
            code: "NEXSCOPE_UPSTREAM_ERROR",
            status: 502,
          });
        }
        const consultedAt = new Date(this.#now()).toISOString();
        const results = (parsed.data.products || [])
          .map((product) => normalizeProduct(product, { amazonDomain: this.#amazonDomain, consultedAt }))
          .filter(Boolean)
          .slice(0, SEARCH_RESULT_LIMIT);
        this.#logger.info?.("[Nexscope] Search concluída", {
          itemCount: results.length,
          marketplace: "Amazon",
          page: parsed.data.page || 1,
        });
        return {
          results,
          page: parsed.data.page || 1,
          pageSize: parsed.data.pageSize || parsed.data.products?.length || 0,
          total: parsed.data.total ?? results.length,
          totalPages: parsed.data.totalPage ?? null,
        };
      }

      lastError = errorForStatus(response.status);
      this.#logger.warn?.(`[Nexscope] Provider returned ${response.status}`, {
        attempt: attempt + 1,
        code: lastError.code,
        status: response.status,
      });
      if (RETRYABLE_STATUSES.has(response.status) && attempt < this.#maxRetries) {
        await this.#sleep(retryDelayMs(response, attempt));
        continue;
      }
      throw lastError;
    }
    throw lastError;
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

export function nexscopeErrorForClient(error, secrets = []) {
  return {
    error: redactNexscopeSensitiveData(error.message, secrets),
    code: error.code,
    ...error.details,
  };
}
