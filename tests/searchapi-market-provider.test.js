import assert from "node:assert/strict";
import test from "node:test";

import { getSearchApiConfig, marketHealth } from "../lib/config.js";
import {
  createSearchApiMarketProvider,
  redactSearchApiSensitiveData,
  SEARCHAPI_GOOGLE_SHOPPING_URL,
  SearchApiError,
  searchApiErrorForClient,
} from "../lib/searchapi-market-provider.js";

function response(status, payload, headers = new Map()) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: { get: (name) => headers.get(name.toLowerCase()) || null },
    async text() { return payload === null ? "" : JSON.stringify(payload); },
  };
}

const validProduct = {
  product_id: "gid-123",
  title: "Apple iPhone 15 Pro Max 256 GB",
  seller: "Loja Exemplo",
  price: "R$ 7.499,00",
  extracted_price: 7499,
  product_link: "https://www.google.com/shopping/product/123",
  thumbnail: "https://encrypted-tbn0.gstatic.com/image.jpg",
  rating: 4.8,
  reviews: 321,
};

test("configura Google Shopping sem expor a chave no health", () => {
  const config = getSearchApiConfig({ SEARCHAPI_API_KEY: "secret", SEARCHAPI_TIMEOUT_MS: "9000" });
  assert.equal(config.engine, "google_shopping");
  assert.equal(config.country, "br");
  assert.equal(config.language, "pt-br");
  assert.equal(config.timeoutMs, 9000);
  assert.deepEqual(marketHealth(config), { provider: "SearchAPI / Google Shopping", configured: true });
  assert.equal("apiKey" in marketHealth(config), false);
});

test("faz GET autenticado ao Google Shopping e normaliza somente produtos BRL reais", async () => {
  const calls = [];
  const provider = createSearchApiMarketProvider(
    { apiKey: "sk-test-secret", timeoutMs: 5000 },
    {
      fetchImpl: async (url, options) => {
        calls.push({ url: String(url), options });
        return response(200, {
          shopping_results: [
            validProduct,
            { ...validProduct, product_id: "gid-text-price", extracted_price: null, price: "R$ 1.234,56", rating: null, reviews: null },
            { ...validProduct, product_id: "gid-usd", price: "$ 99.00", currency: "USD" },
            { ...validProduct, product_id: "gid-zero", extracted_price: 0 },
            { ...validProduct, product_id: "gid-no-seller", seller: "" },
          ],
        });
      },
      logger: { info() {}, warn() {} },
      now: () => Date.UTC(2026, 8, 2),
    },
  );

  const result = await provider.search(" iPhone   15 Pro Max ");
  assert.equal(calls.length, 1);
  const requestUrl = new URL(calls[0].url);
  assert.equal(requestUrl.origin + requestUrl.pathname, SEARCHAPI_GOOGLE_SHOPPING_URL);
  assert.equal(requestUrl.searchParams.get("engine"), "google_shopping");
  assert.equal(requestUrl.searchParams.get("q"), "iPhone 15 Pro Max");
  assert.equal(requestUrl.searchParams.get("gl"), "br");
  assert.equal(requestUrl.searchParams.get("hl"), "pt-br");
  assert.equal(requestUrl.searchParams.has("api_key"), false);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.Authorization, "Bearer sk-test-secret");
  assert.equal(result.results.length, 2);
  assert.deepEqual(result.results[0], {
    id: "gid-123",
    title: "Apple iPhone 15 Pro Max 256 GB",
    price: 7499,
    currency: "BRL",
    source: "Loja Exemplo",
    seller: "Loja Exemplo",
    image: "https://encrypted-tbn0.gstatic.com/image.jpg",
    url: "https://www.google.com/shopping/product/123",
    consultedAt: "2026-09-02T00:00:00.000Z",
    rating: 4.8,
    reviews: 321,
  });
  assert.equal(result.results[1].price, 1234.56);
  assert.equal(result.marketplace, "Google Shopping");
  assert.equal(result.provider, "SearchAPI / Google Shopping");
});

test("não inventa moeda quando o resultado não confirma BRL", async () => {
  const provider = createSearchApiMarketProvider(
    { apiKey: "secret" },
    { fetchImpl: async () => response(200, { shopping_results: [{ ...validProduct, currency: "", price: "7499", extracted_price: 7499 }] }), logger: { info() {} } },
  );
  const result = await provider.search("iPhone");
  assert.deepEqual(result.results, []);
});

for (const [status, code] of [
  [400, "SEARCHAPI_INVALID_REQUEST"],
  [401, "SEARCHAPI_UNAUTHORIZED"],
  [403, "SEARCHAPI_FORBIDDEN"],
  [429, "SEARCHAPI_RATE_LIMITED"],
  [500, "SEARCHAPI_UPSTREAM_ERROR"],
  [503, "SEARCHAPI_UNAVAILABLE"],
  [504, "SEARCHAPI_TIMEOUT"],
]) {
  test(`preserva diagnóstico HTTP ${status} como ${code}`, async () => {
    const provider = createSearchApiMarketProvider(
      { apiKey: "secret" },
      { fetchImpl: async () => response(status, { error: "external failure" }), logger: { info() {} } },
    );
    await assert.rejects(() => provider.search("produto"), { code, status });
  });
}

test("distingue timeout de falha de rede", async () => {
  for (const [error, code, status] of [[{ name: "TimeoutError" }, "SEARCHAPI_TIMEOUT", 504], [new Error("offline"), "SEARCHAPI_UNAVAILABLE", 503]]) {
    const provider = createSearchApiMarketProvider(
      { apiKey: "secret" },
      { fetchImpl: async () => { throw error; }, logger: { info() {}, warn() {} } },
    );
    await assert.rejects(() => provider.search("produto"), { code, status });
  }
});

test("usa cache de cinco minutos e deduplica chamadas simultâneas", async () => {
  let calls = 0;
  let now = 1_000;
  const provider = createSearchApiMarketProvider(
    { apiKey: "secret" },
    {
      fetchImpl: async () => {
        calls += 1;
        await Promise.resolve();
        return response(200, { shopping_results: [validProduct] });
      },
      logger: { info() {} },
      now: () => now,
      searchCacheTtlMs: 300_000,
    },
  );
  const [first, simultaneous] = await Promise.all([provider.search("iPhone"), provider.search("iPhone")]);
  assert.equal(calls, 1);
  assert.equal(first.results.length, 1);
  assert.equal(simultaneous.results.length, 1);
  assert.equal((await provider.search("iphone")).cached, true);
  now += 300_001;
  await provider.search("iPhone");
  assert.equal(calls, 2);
});

test("rejeita configuração ausente, resposta inválida e consulta vazia", async () => {
  assert.throws(() => createSearchApiMarketProvider({}), { code: "SEARCHAPI_NOT_CONFIGURED" });
  const provider = createSearchApiMarketProvider({ apiKey: "secret" }, { fetchImpl: async () => response(200, null), logger: { info() {} } });
  await assert.rejects(() => provider.search("ok"), { code: "INVALID_MARKET_QUERY", status: 400 });
  await assert.rejects(() => provider.search("produto"), { code: "SEARCHAPI_INVALID_RESPONSE", status: 502 });
  const applicationErrorProvider = createSearchApiMarketProvider({ apiKey: "secret" }, { fetchImpl: async () => response(200, { error: "operation failed" }), logger: { info() {} } });
  await assert.rejects(() => applicationErrorProvider.search("produto"), { code: "SEARCHAPI_UPSTREAM_ERROR", status: 502 });
});

test("remove credenciais de logs e respostas públicas", () => {
  assert.equal(redactSearchApiSensitiveData("Authorization Bearer secret-token", ["secret-token"]), "Authorization Bearer [REDACTED]");
  const error = new SearchApiError("Falha segura.", { code: "SEARCHAPI_UNAUTHORIZED", status: 401, details: { upstreamStatus: 401, requestId: "abc" } });
  assert.deepEqual(searchApiErrorForClient(error), { error: "Falha segura.", code: "SEARCHAPI_UNAUTHORIZED", upstreamStatus: 401, requestId: "abc" });
});
