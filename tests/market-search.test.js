import assert from "node:assert/strict";
import test from "node:test";

import { runMarketSearch } from "../lib/market-search.js";

const baseConfig = {
  marketplace: "Google Shopping",
  missingEnvironmentVariables: [],
};

test("rota de mercado informa a configuração ausente sem expor valores", async () => {
  const config = { ...baseConfig, missingEnvironmentVariables: ["SEARCHAPI_API_KEY"] };
  await assert.rejects(
    () => runMarketSearch({ provider: null, config, logger: { info() {}, warn() {} }, query: "Iphone" }),
    (error) => {
      assert.equal(error.code, "SEARCHAPI_NOT_CONFIGURED");
      assert.equal(error.status, 503);
      assert.deepEqual(error.details.missingEnvironmentVariables, ["SEARCHAPI_API_KEY"]);
      return true;
    },
  );
});

test("busca vazia retorna INVALID_MARKET_QUERY sem chamar provider", async () => {
  let calls = 0;
  await assert.rejects(
    () => runMarketSearch({
      provider: { async search() { calls += 1; } },
      config: baseConfig,
      logger: { info() {}, warn() {} },
      query: "  ",
    }),
    { code: "INVALID_MARKET_QUERY", status: 400 },
  );
  assert.equal(calls, 0);
});

test("rota executa as duas consultas pedidas e registra somente metadados seguros", async () => {
  const logs = [];
  const results = [{ id: "B001", title: "Telefone", price: 100, currency: "BRL", source: "Loja" }];
  for (const query of ["Iphone", "iPhone 15 Pro Max"]) {
    const result = await runMarketSearch({
      provider: { async search(receivedQuery) { assert.equal(receivedQuery, query); return { results, cached: false }; } },
      config: baseConfig,
      logger: { info: (...values) => logs.push(values), warn: (...values) => logs.push(values) },
      query,
    });
    assert.deepEqual(result.results, results);
  }
  assert.match(logs[0][0], /Query: Iphone/);
  assert.match(logs[4][0], /Query: iPhone 15 Pro Max/);
  assert.match(logs[1][0], /Provider: SearchAPI Google Shopping/);
  assert.doesNotMatch(JSON.stringify(logs), /authorization|bearer|nk-/i);
});
