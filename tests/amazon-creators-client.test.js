import assert from "node:assert/strict";
import test from "node:test";
import {
  amazonErrorForClient,
  AmazonCreatorsClient,
  AmazonCreatorsError,
  redactAmazonSensitiveData,
} from "../lib/amazon-creators-client.js";
import {
  AMAZON_CREATORS_TOKEN_ENDPOINTS,
  AMAZON_MARKETPLACE_BRAZIL,
  getAmazonCreatorsConfig,
} from "../lib/config.js";

function response(status, body = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

function sampleSearchResponse() {
  return {
    searchResult: {
      items: [
        {
          asin: "B0TESTEBRL",
          detailPageURL: "https://www.amazon.com.br/dp/B0TESTEBRL?tag=teste-20",
          browseNodeInfo: { browseNodes: [{ contextFreeName: "Celulares e Smartphones" }] },
          images: { primary: { medium: { url: "https://m.media-amazon.com/images/I/teste.jpg" } } },
          itemInfo: { title: { displayValue: "Produto brasileiro" } },
          offersV2: { listings: [{ price: { money: { amount: 1299.9, currency: "BRL" } } }] },
        },
        {
          asin: "B0SEMVALOR",
          detailPageURL: "https://www.amazon.com.br/dp/B0SEMVALOR?tag=teste-20",
          itemInfo: { title: { displayValue: "Produto sem oferta" } },
          offersV2: { listings: [] },
        },
        {
          asin: "B0DOLAR",
          detailPageURL: "https://www.amazon.com.br/dp/B0DOLAR?tag=teste-20",
          itemInfo: { title: { displayValue: "Produto em outra moeda" } },
          offersV2: { listings: [{ price: { money: { amount: 100, currency: "USD" } } }] },
        },
      ],
    },
  };
}

function clientWith(fetchImpl, options = {}) {
  return new AmazonCreatorsClient({
    credentialId: "credencial-id-ficticia",
    credentialSecret: "segredo-ficticio",
    tokenEndpoint: AMAZON_CREATORS_TOKEN_ENDPOINTS["3.1"],
    partnerTag: "parceiro-teste-20",
    marketplace: AMAZON_MARKETPLACE_BRAZIL,
    fetchImpl,
    logger: { info() {}, warn() {} },
    maxRetries: 0,
    sleep: async () => {},
    ...options,
  });
}

test("configura o Brasil na região NA e continua opcional sem credenciais", () => {
  const optional = getAmazonCreatorsConfig({});
  assert.equal(optional.marketplace, "www.amazon.com.br");
  assert.equal(optional.credentialVersion, "3.1");
  assert.equal(optional.tokenEndpoint, "https://api.amazon.com/auth/o2/token");
  assert.equal(optional.isConfigured, false);
  assert.deepEqual(optional.missingEnvironmentVariables, [
    "AMAZON_CREATORS_CREDENTIAL_ID",
    "AMAZON_CREATORS_CREDENTIAL_SECRET",
    "AMAZON_PARTNER_TAG",
  ]);
});

test("seleciona o endpoint do token pela versão da credencial e restringe o marketplace ao Brasil", () => {
  assert.equal(
    getAmazonCreatorsConfig({ AMAZON_CREATORS_CREDENTIAL_VERSION: "3.2" }).tokenEndpoint,
    "https://api.amazon.co.uk/auth/o2/token",
  );
  assert.throws(() => getAmazonCreatorsConfig({ AMAZON_CREATORS_CREDENTIAL_VERSION: "4.0" }), /CREDENTIAL_VERSION/);
  assert.throws(() => getAmazonCreatorsConfig({ AMAZON_MARKETPLACE: "www.amazon.com" }), /AMAZON_MARKETPLACE/);
});

test("usa OAuth 2.0 no backend, chama SearchItems e normaliza somente ofertas BRL válidas", async () => {
  const calls = [];
  const client = clientWith(async (url, options) => {
    calls.push({ url, options });
    if (url.includes("/auth/o2/token")) {
      return response(200, { access_token: "token-ficticio", expires_in: 3600 });
    }
    return response(200, sampleSearchResponse());
  });

  const result = await client.search("iPhone 13 128GB");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api.amazon.com/auth/o2/token");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    grant_type: "client_credentials",
    client_id: "credencial-id-ficticia",
    client_secret: "segredo-ficticio",
    scope: "creatorsapi::default",
  });
  assert.equal(calls[1].url, "https://creatorsapi.amazon/catalog/v1/searchItems");
  assert.equal(calls[1].options.headers.Authorization, "Bearer token-ficticio");
  assert.equal(calls[1].options.headers["x-marketplace"], "www.amazon.com.br");
  const searchBody = JSON.parse(calls[1].options.body);
  assert.equal(searchBody.marketplace, "www.amazon.com.br");
  assert.equal(searchBody.partnerTag, "parceiro-teste-20");
  assert.equal(searchBody.itemCount, 5);
  assert.deepEqual(searchBody.resources, [
    "browseNodeInfo.browseNodes",
    "images.primary.medium",
    "itemInfo.title",
    "offersV2.listings.price",
  ]);
  assert.deepEqual(result.items, [{
    id: "B0TESTEBRL",
    asin: "B0TESTEBRL",
    title: "Produto brasileiro",
    price: 1299.9,
    source: "Amazon",
    currency: "BRL",
    category: "Celulares e Smartphones",
    image: "https://m.media-amazon.com/images/I/teste.jpg",
    url: "https://www.amazon.com.br/dp/B0TESTEBRL?tag=teste-20",
  }]);
});

test("reutiliza o access token enquanto válido e evita pesquisas idênticas simultâneas", async () => {
  let tokenCalls = 0;
  let searchCalls = 0;
  let releaseSearch;
  const pendingSearch = new Promise((resolvePromise) => { releaseSearch = resolvePromise; });
  const client = clientWith(async (url) => {
    if (url.includes("/auth/o2/token")) {
      tokenCalls += 1;
      return response(200, { access_token: "token-em-cache", expires_in: 3600 });
    }
    searchCalls += 1;
    await pendingSearch;
    return response(200, sampleSearchResponse());
  });

  const first = client.search("cafeteira elétrica");
  const duplicate = client.search("cafeteira   elétrica");
  releaseSearch();
  await Promise.all([first, duplicate]);
  await client.search("cafeteira italiana");

  assert.equal(tokenCalls, 1);
  assert.equal(searchCalls, 2);
});

test("renova o token uma vez após 401 e trata ausência de resultado", async () => {
  let tokenCalls = 0;
  let searchCalls = 0;
  const client = clientWith(async (url) => {
    if (url.includes("/auth/o2/token")) {
      tokenCalls += 1;
      return response(200, { access_token: `token-${tokenCalls}`, expires_in: 3600 });
    }
    searchCalls += 1;
    if (searchCalls === 1) return response(401, { type: "UnauthorizedException" });
    return response(404, { type: "ResourceNotFoundException" });
  });

  const result = await client.search("produto inexistente");
  assert.equal(tokenCalls, 2);
  assert.equal(searchCalls, 2);
  assert.deepEqual(result.items, []);
});

test("faz retry limitado para 429 e não expõe credenciais ou tokens", async () => {
  let searchCalls = 0;
  const logs = [];
  const client = clientWith(async (url) => {
    if (url.includes("/auth/o2/token")) return response(200, { access_token: "token-super-secreto", expires_in: 3600 });
    searchCalls += 1;
    return searchCalls === 1
      ? response(429, { type: "ThrottleException", retryAfterSeconds: 0 })
      : response(200, sampleSearchResponse());
  }, { maxRetries: 1, logger: { info() {}, warn: (...args) => logs.push(args) } });

  assert.equal((await client.search("produto em oferta")).items.length, 1);
  assert.equal(searchCalls, 2);
  assert.equal(JSON.stringify(logs).includes("token-super-secreto"), false);
  assert.equal(
    redactAmazonSensitiveData("Bearer token-super-secreto segredo-ficticio", ["segredo-ficticio"]),
    "Bearer [REDACTED] [REDACTED]",
  );
  const error = new AmazonCreatorsError("Falha segredo-ficticio", { code: "TEST" });
  assert.equal(JSON.stringify(amazonErrorForClient(error, ["segredo-ficticio"])).includes("segredo-ficticio"), false);
});

test("diferencia credencial inválida, falta de permissão e Partner Tag incompatível", async (context) => {
  await context.test("credencial inválida no OAuth", async () => {
    const client = clientWith(async () => response(400, { error: "invalid_client" }));
    await assert.rejects(() => client.search("Iphone"), { code: "AMAZON_AUTHENTICATION_FAILED", status: 401 });
  });

  await context.test("conta sem permissão", async () => {
    const client = clientWith(async (url) => url.includes("/auth/o2/token")
      ? response(200, { access_token: "token-ficticio", expires_in: 3600 })
      : response(403, { type: "AccessDeniedException", reason: "AssociateNotEligible" }));
    await assert.rejects(() => client.search("Iphone"), { code: "AMAZON_ACCESS_DENIED", status: 403 });
  });

  await context.test("Partner Tag inválido", async () => {
    const client = clientWith(async (url) => url.includes("/auth/o2/token")
      ? response(200, { access_token: "token-ficticio", expires_in: 3600 })
      : response(400, { type: "ValidationException", reason: "InvalidPartnerTag" }));
    await assert.rejects(() => client.search("Iphone"), { code: "AMAZON_PARTNER_TAG_INVALID", status: 400 });
  });
});

test("diferencia timeout e indisponibilidade do provedor", async (context) => {
  await context.test("timeout", async () => {
    const timeout = new Error("timeout");
    timeout.name = "TimeoutError";
    const client = clientWith(async () => { throw timeout; });
    await assert.rejects(() => client.search("iPhone 15 Pro Max"), { code: "AMAZON_TIMEOUT", status: 504 });
  });

  await context.test("API indisponível", async () => {
    const client = clientWith(async (url) => url.includes("/auth/o2/token")
      ? response(200, { access_token: "token-ficticio", expires_in: 3600 })
      : response(503));
    await assert.rejects(() => client.search("iPhone 15 Pro Max"), { code: "AMAZON_UNAVAILABLE", status: 503 });
  });
});

test("mantém resultado vazio e reutiliza cache curto para pesquisa repetida", async () => {
  let searchCalls = 0;
  let now = 1_000;
  const client = clientWith(async (url) => {
    if (url.includes("/auth/o2/token")) return response(200, { access_token: "token-ficticio", expires_in: 3600 });
    searchCalls += 1;
    return response(200, { searchResult: { items: [] } });
  }, { now: () => now, searchCacheTtlMs: 300_000 });

  assert.deepEqual((await client.search("Iphone")).items, []);
  assert.equal((await client.search("iphone")).cached, true);
  assert.equal(searchCalls, 1);
  now += 300_001;
  await client.search("Iphone");
  assert.equal(searchCalls, 2);
});

test("rejeita consulta vazia sem fazer requisição", async () => {
  let calls = 0;
  const client = clientWith(async () => {
    calls += 1;
    return response(200, {});
  });
  await assert.rejects(() => client.search("  "), { code: "INVALID_AMAZON_QUERY", status: 400 });
  assert.equal(calls, 0);
});
