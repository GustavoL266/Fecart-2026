import { z } from "zod";

const AMAZON_SEARCH_URL = "https://creatorsapi.amazon/catalog/v1/searchItems";
const AMAZON_RESOURCES = Object.freeze([
  "images.primary.medium",
  "itemInfo.title",
  "offersV2.listings.price",
]);
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().int().positive(),
});

const searchResponseSchema = z.object({
  searchResult: z.object({
    items: z.array(z.object({
      asin: z.string().optional(),
      detailPageURL: z.string().optional(),
      images: z.object({
        primary: z.object({
          medium: z.object({ url: z.string().optional() }).nullish(),
          small: z.object({ url: z.string().optional() }).nullish(),
          large: z.object({ url: z.string().optional() }).nullish(),
        }).nullish(),
      }).nullish(),
      itemInfo: z.object({
        title: z.object({ displayValue: z.string().optional() }).nullish(),
      }).nullish(),
      offersV2: z.object({
        listings: z.array(z.object({
          price: z.object({
            money: z.object({
              amount: z.coerce.number().optional(),
              currency: z.string().optional(),
            }).nullish(),
          }).nullish(),
        }).passthrough()).optional(),
      }).nullish(),
    }).passthrough()).optional(),
  }).nullish(),
}).passthrough();

export class AmazonCreatorsError extends Error {
  constructor(message, { code, status = 503, retryable = false } = {}) {
    super(message);
    this.name = "AmazonCreatorsError";
    this.code = code || "AMAZON_CREATORS_ERROR";
    this.status = status;
    this.retryable = retryable;
  }
}

function safeHttpsUrl(value, allowedHostSuffix) {
  try {
    const url = new URL(value);
    const allowedHost = url.hostname === allowedHostSuffix || url.hostname.endsWith(`.${allowedHostSuffix}`);
    return url.protocol === "https:" && allowedHost ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeItem(item) {
  const asin = String(item.asin || "").trim();
  const title = String(item.itemInfo?.title?.displayValue || "").trim();
  const url = safeHttpsUrl(item.detailPageURL, "amazon.com.br");
  const imageCandidate = item.images?.primary?.medium?.url
    || item.images?.primary?.large?.url
    || item.images?.primary?.small?.url
    || "";
  const image = safeHttpsUrl(imageCandidate, "media-amazon.com");
  const price = (item.offersV2?.listings || [])
    .map((listing) => listing.price?.money)
    .find((money) => Number.isFinite(money?.amount) && money.amount > 0 && String(money.currency).toUpperCase() === "BRL");

  if (!asin || !title || !url || !price) return null;
  return {
    asin,
    title,
    price: Number(price.amount),
    currency: "BRL",
    image,
    url,
  };
}

function errorForStatus(status) {
  if (status === 400) {
    return new AmazonCreatorsError("A Amazon não aceitou os termos desta pesquisa.", {
      code: "AMAZON_INVALID_REQUEST",
      status: 400,
    });
  }
  if (status === 401 || status === 403) {
    return new AmazonCreatorsError("A integração com a Amazon precisa ter suas credenciais revisadas.", {
      code: "AMAZON_AUTHENTICATION_FAILED",
      status: 503,
    });
  }
  if (status === 429) {
    return new AmazonCreatorsError("A Amazon limitou temporariamente as consultas. Tente novamente em instantes.", {
      code: "AMAZON_RATE_LIMITED",
      status: 429,
      retryable: true,
    });
  }
  return new AmazonCreatorsError("Não foi possível consultar a Amazon no momento.", {
    code: "AMAZON_UNAVAILABLE",
    status: 503,
    retryable: status >= 500,
  });
}

function retryDelayMs(response, payload, attempt) {
  const headerValue = response.headers?.get?.("retry-after");
  const retryAfter = Number.parseInt(headerValue || payload?.retryAfterSeconds || "", 10);
  if (Number.isInteger(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1_000, 2_000);
  return 150 * (2 ** attempt);
}

async function jsonResponse(response) {
  try {
    return await response.json();
  } catch {
    throw new AmazonCreatorsError("A Amazon retornou uma resposta inválida.", {
      code: "AMAZON_INVALID_RESPONSE",
      status: 502,
    });
  }
}

async function optionalJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export class AmazonCreatorsClient {
  #credentialId;
  #credentialSecret;
  #fetch;
  #inflightSearches = new Map();
  #logger;
  #marketplace;
  #maxRetries;
  #now;
  #partnerTag;
  #sleep;
  #timeoutMs;
  #token = null;
  #tokenEndpoint;
  #tokenPromise = null;

  constructor({
    credentialId,
    credentialSecret,
    tokenEndpoint,
    partnerTag,
    marketplace,
    timeoutMs = 5_000,
    fetchImpl = globalThis.fetch,
    logger = console,
    maxRetries = 2,
    now = Date.now,
    sleep,
  } = {}) {
    if (![credentialId, credentialSecret, tokenEndpoint, partnerTag, marketplace].every((value) => String(value || "").trim())) {
      throw new AmazonCreatorsError("A Amazon Creators API não foi configurada neste ambiente.", {
        code: "AMAZON_NOT_CONFIGURED",
      });
    }
    if (typeof fetchImpl !== "function") throw new TypeError("Um cliente HTTP compatível com fetch é obrigatório.");

    this.#credentialId = credentialId.trim();
    this.#credentialSecret = credentialSecret.trim();
    this.#tokenEndpoint = tokenEndpoint;
    this.#partnerTag = partnerTag.trim();
    this.#marketplace = marketplace;
    this.#timeoutMs = timeoutMs;
    this.#fetch = fetchImpl;
    this.#logger = logger;
    this.#maxRetries = maxRetries;
    this.#now = now;
    this.#sleep = sleep || ((milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)));
  }

  async #requestToken() {
    let lastError;
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      let response;
      try {
        response = await this.#fetch(this.#tokenEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "client_credentials",
            client_id: this.#credentialId,
            client_secret: this.#credentialSecret,
            scope: "creatorsapi::default",
          }),
          redirect: "error",
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
      } catch (error) {
        const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";
        lastError = new AmazonCreatorsError("Não foi possível autenticar a consulta na Amazon no momento.", {
          code: isTimeout ? "AMAZON_TIMEOUT" : "AMAZON_UNAVAILABLE",
          status: isTimeout ? 504 : 503,
          retryable: true,
        });
        if (attempt < this.#maxRetries) {
          await this.#sleep(150 * (2 ** attempt));
          continue;
        }
        throw lastError;
      }

      if (response.ok) {
        const payload = await jsonResponse(response);
        const parsed = tokenResponseSchema.safeParse(payload);
        if (!parsed.success) {
          throw new AmazonCreatorsError("A Amazon retornou uma autenticação inválida.", {
            code: "AMAZON_INVALID_TOKEN_RESPONSE",
            status: 502,
          });
        }
        return {
          accessToken: parsed.data.access_token,
          expiresAt: this.#now() + parsed.data.expires_in * 1_000,
        };
      }

      const payload = await optionalJsonResponse(response);
      lastError = errorForStatus(response.status);
      if (lastError.retryable && attempt < this.#maxRetries) {
        await this.#sleep(retryDelayMs(response, payload, attempt));
        continue;
      }
      throw lastError;
    }
    throw lastError;
  }

  async #accessToken(forceRefresh = false) {
    const hasUsableToken = this.#token && this.#token.expiresAt - this.#now() > 60_000;
    if (!forceRefresh && hasUsableToken) return this.#token.accessToken;
    if (forceRefresh) this.#token = null;
    if (!this.#tokenPromise) {
      this.#tokenPromise = this.#requestToken()
        .then((token) => {
          this.#token = token;
          return token.accessToken;
        })
        .finally(() => {
          this.#tokenPromise = null;
        });
    }
    return this.#tokenPromise;
  }

  async #searchItems(query) {
    let accessToken = await this.#accessToken();
    let refreshedToken = false;
    let lastError;

    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      let response;
      try {
        response = await this.#fetch(AMAZON_SEARCH_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "x-marketplace": this.#marketplace,
          },
          body: JSON.stringify({
            keywords: query,
            searchIndex: "All",
            itemCount: 10,
            marketplace: this.#marketplace,
            partnerTag: this.#partnerTag,
            resources: AMAZON_RESOURCES,
          }),
          redirect: "error",
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
      } catch (error) {
        const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";
        lastError = new AmazonCreatorsError("Não foi possível consultar a Amazon no momento.", {
          code: isTimeout ? "AMAZON_TIMEOUT" : "AMAZON_UNAVAILABLE",
          status: isTimeout ? 504 : 503,
          retryable: true,
        });
        if (attempt < this.#maxRetries) {
          await this.#sleep(150 * (2 ** attempt));
          continue;
        }
        throw lastError;
      }

      if (response.status === 401 && !refreshedToken) {
        accessToken = await this.#accessToken(true);
        refreshedToken = true;
        attempt -= 1;
        continue;
      }
      if (response.status === 404) return { items: [] };

      if (response.ok) {
        const payload = await jsonResponse(response);
        const parsed = searchResponseSchema.safeParse(payload);
        if (!parsed.success) {
          throw new AmazonCreatorsError("A Amazon retornou dados de produtos em formato inesperado.", {
            code: "AMAZON_INVALID_RESPONSE",
            status: 502,
          });
        }
        const items = (parsed.data.searchResult?.items || []).map(normalizeItem).filter(Boolean);
        this.#logger.info?.("[Amazon] SearchItems concluído", { marketplace: this.#marketplace, itemCount: items.length });
        return { items };
      }

      const payload = await optionalJsonResponse(response);
      lastError = errorForStatus(response.status);
      this.#logger.warn?.("[Amazon] SearchItems falhou", {
        code: lastError.code,
        status: response.status,
        attempt: attempt + 1,
      });
      if (RETRYABLE_STATUSES.has(response.status) && attempt < this.#maxRetries) {
        await this.#sleep(retryDelayMs(response, payload, attempt));
        continue;
      }
      throw lastError;
    }

    throw lastError;
  }

  async search(query) {
    const normalizedQuery = String(query || "").trim().replace(/\s+/g, " ");
    if (normalizedQuery.length < 3) {
      throw new AmazonCreatorsError("Informe pelo menos 3 caracteres para pesquisar.", {
        code: "INVALID_AMAZON_QUERY",
        status: 400,
      });
    }

    const key = normalizedQuery.toLocaleLowerCase("pt-BR");
    if (this.#inflightSearches.has(key)) return this.#inflightSearches.get(key);
    const request = this.#searchItems(normalizedQuery)
      .then(({ items }) => ({ query: normalizedQuery, marketplace: this.#marketplace, items }))
      .finally(() => this.#inflightSearches.delete(key));
    this.#inflightSearches.set(key, request);
    return request;
  }
}

export function createAmazonCreatorsClient(config, dependencies = {}) {
  return new AmazonCreatorsClient({ ...config, ...dependencies });
}

export function redactAmazonSensitiveData(value, secrets = []) {
  let sanitized = String(value || "").replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]");
  for (const secret of secrets) {
    if (secret) sanitized = sanitized.replaceAll(secret, "[REDACTED]");
  }
  return sanitized;
}

export function amazonErrorForClient(error, secrets = []) {
  return {
    error: redactAmazonSensitiveData(error.message, secrets),
    code: error.code,
  };
}
