import assert from "node:assert/strict";
import test from "node:test";
import {
  NEXSCOPE_AMAZON_SEARCH_URL,
  nexscopeErrorForClient,
  NexscopeError,
  NexscopeProvider,
  redactNexscopeSensitiveData,
} from "../lib/nexscope-provider.js";
import { getNexscopeConfig, marketHealth, NEXSCOPE_AMAZON_DOMAIN_BRAZIL } from "../lib/config.js";

function response(status, body = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

function sampleSearchResponse() {
  return {
    total: 3,
    page: 1,
    pageSize: 20,
    totalPage: 1,
    products: [
      {
        asin: "B0TESTEBRL",
        title: "Apple iPhone 15 Pro Max 256 GB",
        brand: "Apple",
        extractedPrice: 7499,
        currency: "BRL",
        imageUrl: "https://m.media-amazon.com/images/I/teste.jpg",
        asinUrl: "B0TESTEBRL",
        sourceType: "amazon",
      },
      {
        asin: "B0SEMVALOR",
        title: "Produto sem preço",
        currency: "BRL",
        asinUrl: "B0SEMVALOR",
      },
      {
        asin: "B0DOLAR000",
        title: "Produto em outra moeda",
        price: 100,
        currency: "USD",
        asinUrl: "B0DOLAR000",
      },
    ],
  };
}

function providerWith(fetchImpl, options = {}) {
  return new NexscopeProvider({
    amazonDomain: NEXSCOPE_AMAZON_DOMAIN_BRAZIL,
    apiKey: "nk-chave-ficticia",
    language: "pt_BR",
    fetchImpl,
    logger: { info() {}, warn() {} },
    ...options,
  });
}

test("configura a Nexscope como opcional sem expor ou exigir credenciais Amazon", () => {
  const optional = getNexscopeConfig({});
  assert.equal(optional.amazonDomain, "amazon.com.br");
  assert.equal(optional.marketplace, "Amazon");
  assert.equal(optional.isConfigured, false);
  assert.deepEqual(optional.missingEnvironmentVariables, ["NEXSCOPE_API_KEY"]);
  assert.equal(getNexscopeConfig({ NEXSCOPE_API_KEY: "nk-teste" }).isConfigured, true);
  assert.throws(() => getNexscopeConfig({ NEXSCOPE_TIMEOUT_MS: "99" }), /NEXSCOPE_TIMEOUT_MS/);
});

test("aceita somente NEXSCOPE_API_KEY e gera health sem dados sensíveis", () => {
  const wrongNames = getNexscopeConfig({
    NEXCOPE_API_KEY: "nk-errada",
    NEXSCOPE_KEY: "nk-errada",
    NEXSCOPE_TOKEN: "nk-errada",
    NEXSCOPE_API_TOKEN: "nk-errada",
  });
  const configured = getNexscopeConfig({ NEXSCOPE_API_KEY: "  nk-correta  " });

  assert.equal(wrongNames.isConfigured, false);
  assert.equal(configured.isConfigured, true);
  assert.equal(configured.apiKey, "nk-correta");
  assert.deepEqual(marketHealth(configured), { provider: "Nexscope", configured: true });
  assert.deepEqual(marketHealth(wrongNames), { provider: "Nexscope", configured: false });
  assert.doesNotMatch(JSON.stringify(marketHealth(configured)), /nk-correta|apiKey/i);
});

test("autentica via Bearer no backend e usa o contrato oficial Amazon Search", async () => {
  const calls = [];
  const provider = providerWith(async (url, options) => {
    calls.push({ url, options });
    return response(200, sampleSearchResponse());
  }, { now: () => Date.parse("2026-09-02T12:00:00.000Z") });

  const result = await provider.search("iPhone 15 Pro Max");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, NEXSCOPE_AMAZON_SEARCH_URL);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer nk-chave-ficticia");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    keyword: "iPhone 15 Pro Max",
    amazonDomain: "amazon.com.br",
    language: "pt_BR",
    page: 1,
    device: "desktop",
  });
  assert.deepEqual(result.results, [{
    id: "B0TESTEBRL",
    asin: "B0TESTEBRL",
    title: "Apple iPhone 15 Pro Max 256 GB",
    price: 7499,
    currency: "BRL",
    source: "Amazon",
    category: "Apple",
    image: "https://m.media-amazon.com/images/I/teste.jpg",
    url: "https://www.amazon.com.br/dp/B0TESTEBRL",
    consultedAt: "2026-09-02T12:00:00.000Z",
  }]);
  assert.equal(result.provider, "Nexscope");
  assert.equal(result.marketplace, "Amazon");
});

test("aceita URL Amazon completa, mas não presume BRL quando a moeda está ausente", async () => {
  const provider = providerWith(async () => response(200, {
    products: [
      {
        asin: "B012345678",
        title: "Iphone sem moeda",
        price: 1999.9,
        asinUrl: "https://www.amazon.com.br/dp/B012345678?ref_=teste",
      },
      {
        asin: "B087654321",
        title: "Iphone com moeda",
        price: 2199.9,
        currency: "R$",
        asinUrl: "https://www.amazon.com.br/dp/B087654321?ref_=teste",
      },
    ],
  }));
  const result = await provider.search("Iphone");
  assert.equal(result.results.length, 1);
  const [item] = result.results;
  assert.equal(item.currency, "BRL");
  assert.equal(item.url, "https://www.amazon.com.br/dp/B087654321?ref_=teste");
});

test("reutiliza cache curto e evita pesquisas idênticas simultâneas", async () => {
  let calls = 0;
  let now = 1_000;
  let releaseSearch;
  const pendingSearch = new Promise((resolvePromise) => { releaseSearch = resolvePromise; });
  const provider = providerWith(async () => {
    calls += 1;
    await pendingSearch;
    return response(200, sampleSearchResponse());
  }, { now: () => now, searchCacheTtlMs: 300_000 });

  const first = provider.search("Iphone");
  const duplicate = provider.search("iphone");
  releaseSearch();
  await Promise.all([first, duplicate]);
  assert.equal((await provider.search("Iphone")).cached, true);
  assert.equal(calls, 1);
  now += 300_001;
  await provider.search("Iphone");
  assert.equal(calls, 2);
});

test("não repete automaticamente um 429 e nunca expõe a chave", async () => {
  let calls = 0;
  const logs = [];
  const provider = providerWith(async () => {
    calls += 1;
    return response(429, { code: "RATE_LIMITED", message: "Too many requests" }, { "retry-after": "0" });
  }, { logger: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) } });

  await assert.rejects(() => provider.search("Iphone"), { code: "NEXSCOPE_RATE_LIMITED", status: 429 });
  assert.equal(calls, 1);
  assert.match(JSON.stringify(logs), /\[Nexscope\] Status: 429/);
  assert.match(JSON.stringify(logs), /RATE_LIMITED/);
  assert.match(JSON.stringify(logs), /\[Nexscope\] Duration: \d+ms/);
  assert.equal(JSON.stringify(logs).includes("nk-chave-ficticia"), false);
  assert.equal(
    redactNexscopeSensitiveData("Bearer nk-chave-ficticia nk-chave-ficticia", ["nk-chave-ficticia"]),
    "Bearer [REDACTED] [REDACTED]",
  );
  const error = new NexscopeError("Falha nk-chave-ficticia", {
    code: "TEST",
    details: { upstreamCode: "nk-chave-ficticia", upstreamStatus: 401 },
  });
  assert.equal(JSON.stringify(nexscopeErrorForClient(error, ["nk-chave-ficticia"])).includes("nk-chave-ficticia"), false);
});

test("diferencia parâmetros, credencial, permissão, limite e indisponibilidade", async (context) => {
  const scenarios = [
    ["requisição inválida", 400, "NEXSCOPE_INVALID_REQUEST", 400],
    ["credencial inválida", 401, "NEXSCOPE_UNAUTHORIZED", 401],
    ["sem permissão", 403, "NEXSCOPE_FORBIDDEN", 403],
    ["rate limit", 429, "NEXSCOPE_RATE_LIMITED", 429],
    ["erro upstream", 500, "NEXSCOPE_UPSTREAM_ERROR", 502],
    ["bad gateway", 502, "NEXSCOPE_UPSTREAM_ERROR", 502],
    ["indisponível", 503, "NEXSCOPE_UNAVAILABLE", 503],
  ];
  for (const [name, providerStatus, code, clientStatus] of scenarios) {
    await context.test(name, async () => {
      const provider = providerWith(async () => response(providerStatus));
      await assert.rejects(() => provider.search("Iphone"), { code, status: clientStatus });
    });
  }
});

test("preserva erro de aplicação, permissão, créditos e request ID mesmo quando o HTTP é 200", async (context) => {
  await context.test("acesso ao Amazon Search negado", async () => {
    const logs = [];
    const provider = providerWith(
      async () => response(200, { errcode: 403, errmsg: "Amazon Search access denied" }, { "x-request-id": "req-403" }),
      { logger: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) } },
    );
    await assert.rejects(
      () => provider.search("Iphone"),
      (error) => {
        assert.equal(error.code, "NEXSCOPE_FORBIDDEN");
        assert.equal(error.status, 403);
        assert.deepEqual(error.details, { upstreamStatus: 200, upstreamCode: "403", requestId: "req-403" });
        return true;
      },
    );
    assert.match(JSON.stringify(logs), /Amazon Search access denied/);
    assert.match(JSON.stringify(logs), /requestId=req-403/);
  });

  await context.test("créditos insuficientes", async () => {
    const provider = providerWith(async () => response(200, {
      code: "INSUFFICIENT_CREDITS",
      message: "Insufficient credits",
    }));
    await assert.rejects(() => provider.search("Iphone"), {
      code: "NEXSCOPE_INSUFFICIENT_CREDITS",
      status: 402,
    });
  });
});

test("diferencia timeout, resposta inválida e busca vazia", async (context) => {
  await context.test("timeout", async () => {
    const timeout = new Error("timeout");
    timeout.name = "TimeoutError";
    const provider = providerWith(async () => { throw timeout; });
    await assert.rejects(() => provider.search("iPhone 15 Pro Max"), { code: "NEXSCOPE_TIMEOUT", status: 504 });
  });
  await context.test("resposta inválida", async () => {
    const provider = providerWith(async () => response(200, null));
    await assert.rejects(() => provider.search("Iphone"), { code: "NEXSCOPE_INVALID_RESPONSE", status: 502 });
  });
  await context.test("busca vazia", async () => {
    let calls = 0;
    const provider = providerWith(async () => { calls += 1; return response(200); });
    await assert.rejects(() => provider.search("  "), { code: "INVALID_MARKET_QUERY", status: 400 });
    assert.equal(calls, 0);
  });
});
