import { z } from "zod";

export const SEARCHAPI_GOOGLE_SHOPPING_URL = "https://www.searchapi.io/api/v1/search";
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1_000;
const SEARCH_RESULT_LIMIT = 10;
const SAFE_LOG_VALUE_LIMIT = 300;

const shoppingResultSchema = z.object({
  product_id: z.unknown().optional(),
  title: z.unknown().optional(),
  product_link: z.unknown().optional(),
  offers_link: z.unknown().optional(),
  seller: z.unknown().optional(),
  extracted_price: z.unknown().optional(),
  price: z.unknown().optional(),
  currency: z.unknown().optional(),
  rating: z.unknown().optional(),
  reviews: z.unknown().optional(),
  thumbnail: z.unknown().optional(),
}).passthrough();

const searchResponseSchema = z.object({
  shopping_results: z.array(shoppingResultSchema).optional(),
  error: z.unknown().optional(),
  message: z.unknown().optional(),
}).passthrough();

export class SearchApiError extends Error {
  constructor(message, { code, details = {}, status = 503, retryable = false } = {}) {
    super(message);
    this.name = "SearchApiError";
    this.code = code || "SEARCHAPI_ERROR";
    this.details = details;
    this.status = status;
    this.retryable = retryable;
  }
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function positiveNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function brazilianPrice(value) {
  const text = String(value || "").trim();
  if (!/(?:R\$|BRL)/i.test(text)) return null;
  const normalized = text
    .replace(/(?:R\$|BRL)/gi, "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");
  return positiveNumber(normalized);
}

function isBrlResult(product) {
  const explicitCurrency = String(product.currency || "").trim().toUpperCase();
  if (explicitCurrency) return ["BRL", "R$", "REAL", "REAIS"].includes(explicitCurrency);
  return /(?:R\$|BRL)/i.test(String(product.price || ""));
}

function optionalNumber(value, { integer = false, max = Number.POSITIVE_INFINITY } = {}) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > max || (integer && !Number.isInteger(number))) return null;
  return number;
}

function normalizeProduct(product, consultedAt) {
  const id = String(product.product_id || "").trim();
  const title = String(product.title || "").trim();
  const seller = String(product.seller || "").trim();
  const hasExtractedPrice = product.extracted_price !== undefined
    && product.extracted_price !== null
    && String(product.extracted_price).trim() !== "";
  const price = hasExtractedPrice ? positiveNumber(product.extracted_price) : brazilianPrice(product.price);
  const url = safeHttpsUrl(product.product_link) || safeHttpsUrl(product.offers_link);
  const image = safeHttpsUrl(product.thumbnail);
  const rating = optionalNumber(product.rating, { max: 5 });
  const reviews = optionalNumber(product.reviews, { integer: true });

  if (!id || !title || !seller || !url || !isBrlResult(product) || price === null) return null;
  return {
    id,
    title,
    price,
    currency: "BRL",
    source: seller,
    seller,
    image,
    url,
    consultedAt,
    ...(rating === null ? {} : { rating }),
    ...(reviews === null ? {} : { reviews }),
  };
}

function errorForStatus(status, details = {}) {
  if (status === 400) return new SearchApiError("A pesquisa enviada é inválida.", { code: "SEARCHAPI_INVALID_REQUEST", details, status });
  if (status === 401) return new SearchApiError("A credencial da consulta de mercado é inválida.", { code: "SEARCHAPI_UNAUTHORIZED", details, status });
  if (status === 403) return new SearchApiError("A conta não possui permissão para consultar o Google Shopping.", { code: "SEARCHAPI_FORBIDDEN", details, status });
  if (status === 429) return new SearchApiError("O limite temporário de consultas de mercado foi atingido.", { code: "SEARCHAPI_RATE_LIMITED", details, status });
  if (status === 504) return new SearchApiError("A pesquisa de mercado excedeu o tempo de resposta.", { code: "SEARCHAPI_TIMEOUT", details, status });
  if (status === 503) return new SearchApiError("A pesquisa do Google Shopping está temporariamente indisponível.", { code: "SEARCHAPI_UNAVAILABLE", details, status, retryable: true });
  if (status >= 500 && status <= 599) return new SearchApiError("A pesquisa do Google Shopping falhou temporariamente.", { code: "SEARCHAPI_UPSTREAM_ERROR", details, status, retryable: true });
  return new SearchApiError("A pesquisa de mercado retornou uma resposta inesperada.", { code: "SEARCHAPI_UPSTREAM_ERROR", details, status: 502 });
}

async function readResponsePayload(response) {
  try {
    if (typeof response.text === "function") {
      const text = await response.text();
      return text.trim() ? JSON.parse(text) : null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

function requestIdFrom(response) {
  return response?.headers?.get?.("x-request-id") || response?.headers?.get?.("request-id") || "";
}

export class SearchApiMarketProvider {
  #apiKey;
  #durationNow;
  #fetch;
  #inflightSearches = new Map();
  #logger;
  #now;
  #searchCache = new Map();
  #searchCacheTtlMs;
  #timeoutMs;

  constructor({
    apiKey,
    timeoutMs = 15_000,
    fetchImpl = globalThis.fetch,
    logger = console,
    now = Date.now,
    durationNow = Date.now,
    searchCacheTtlMs = SEARCH_CACHE_TTL_MS,
  } = {}) {
    if (!String(apiKey || "").trim()) {
      throw new SearchApiError("A consulta de mercado não foi configurada neste ambiente.", { code: "SEARCHAPI_NOT_CONFIGURED" });
    }
    if (typeof fetchImpl !== "function") throw new TypeError("Um cliente HTTP compatível com fetch é obrigatório.");
    this.#apiKey = apiKey.trim();
    this.#durationNow = durationNow;
    this.#fetch = fetchImpl;
    this.#logger = logger;
    this.#now = now;
    this.#searchCacheTtlMs = searchCacheTtlMs;
    this.#timeoutMs = timeoutMs;
  }

  async #requestSearch(query) {
    const startedAt = this.#durationNow();
    const url = new URL(SEARCHAPI_GOOGLE_SHOPPING_URL);
    url.searchParams.set("engine", "google_shopping");
    url.searchParams.set("q", query);
    url.searchParams.set("gl", "br");
    url.searchParams.set("hl", "pt-br");

    try {
      let response;
      try {
        response = await this.#fetch(url, {
          method: "GET",
          headers: { Accept: "application/json", Authorization: `Bearer ${this.#apiKey}` },
          redirect: "error",
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
      } catch (error) {
        const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";
        const requestError = new SearchApiError(
          isTimeout ? "A pesquisa de mercado excedeu o tempo de resposta." : "Não foi possível conectar ao serviço de pesquisa de mercado.",
          { code: isTimeout ? "SEARCHAPI_TIMEOUT" : "SEARCHAPI_UNAVAILABLE", status: isTimeout ? 504 : 503, retryable: true },
        );
        this.#logger.warn?.(`[Market] Status: ${isTimeout ? "timeout" : "network-error"}`);
        throw requestError;
      }

      this.#logger.info?.(`[Market] Status: ${response.status}`);
      const payload = await readResponsePayload(response);
      const requestId = requestIdFrom(response);
      const details = { upstreamStatus: response.status, ...(requestId ? { requestId } : {}) };
      if (!response.ok) throw errorForStatus(response.status, details);

      const parsed = searchResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new SearchApiError("O serviço de pesquisa retornou dados inválidos.", {
          code: "SEARCHAPI_INVALID_RESPONSE",
          details,
          status: 502,
        });
      }
      if (parsed.data.error) {
        throw new SearchApiError("O serviço de pesquisa recusou a operação.", {
          code: "SEARCHAPI_UPSTREAM_ERROR",
          details,
          status: 502,
        });
      }

      const consultedAt = new Date(this.#now()).toISOString();
      const products = parsed.data.shopping_results || [];
      const results = products.map((product) => normalizeProduct(product, consultedAt)).filter(Boolean).slice(0, SEARCH_RESULT_LIMIT);
      this.#logger.info?.(`[Market] Results: ${results.length}`, { received: products.length });
      return { results, page: 1, pageSize: products.length, total: products.length };
    } finally {
      this.#logger.info?.(`[Market] Duration: ${Math.max(0, Math.round(this.#durationNow() - startedAt))}ms`);
    }
  }

  async search(query) {
    const normalizedQuery = String(query || "").trim().replace(/\s+/g, " ");
    if (normalizedQuery.length < 3) throw new SearchApiError("Informe pelo menos 3 caracteres para pesquisar.", { code: "INVALID_MARKET_QUERY", status: 400 });

    const key = normalizedQuery.toLocaleLowerCase("pt-BR");
    const cached = this.#searchCache.get(key);
    if (cached && cached.expiresAt > this.#now()) {
      this.#logger.info?.("[Market] Cache: hit", { query: normalizedQuery });
      return { ...cached.result, cached: true };
    }
    if (cached) this.#searchCache.delete(key);
    if (this.#inflightSearches.has(key)) return this.#inflightSearches.get(key);

    const request = this.#requestSearch(normalizedQuery)
      .then((response) => {
        const result = { ...response, query: normalizedQuery, marketplace: "Google Shopping", provider: "SearchAPI / Google Shopping" };
        this.#searchCache.set(key, { expiresAt: this.#now() + this.#searchCacheTtlMs, result });
        if (this.#searchCache.size > 50) this.#searchCache.delete(this.#searchCache.keys().next().value);
        return result;
      })
      .finally(() => this.#inflightSearches.delete(key));
    this.#inflightSearches.set(key, request);
    return request;
  }
}

export function createSearchApiMarketProvider(config, dependencies = {}) {
  return new SearchApiMarketProvider({ ...config, ...dependencies });
}

export function redactSearchApiSensitiveData(value, secrets = []) {
  let sanitized = String(value || "").replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]");
  for (const secret of secrets) if (secret) sanitized = sanitized.replaceAll(secret, "[REDACTED]");
  return sanitized;
}

export function searchApiErrorForClient(error) {
  const safeDetails = Object.fromEntries(
    Object.entries(error.details || {}).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value)),
  );
  return { error: error.message, code: error.code, ...safeDetails };
}
