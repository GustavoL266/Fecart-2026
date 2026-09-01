import assert from "node:assert/strict";
import test from "node:test";

import { runAmazonSearch } from "../lib/amazon-search.js";

const baseConfig = {
  marketplace: "www.amazon.com.br",
  missingEnvironmentVariables: [],
};

test("rota Amazon informa exatamente os nomes ausentes sem expor valores", async () => {
  const config = {
    ...baseConfig,
    missingEnvironmentVariables: ["AMAZON_CREATORS_CREDENTIAL_SECRET", "AMAZON_PARTNER_TAG"],
  };

  await assert.rejects(
    () => runAmazonSearch({ client: null, config, logger: { info() {}, warn() {} }, query: "Iphone" }),
    (error) => {
      assert.equal(error.code, "AMAZON_NOT_CONFIGURED");
      assert.equal(error.status, 503);
      assert.deepEqual(error.details.missingEnvironmentVariables, config.missingEnvironmentVariables);
      return true;
    },
  );
});

test("rota Amazon executa Iphone e iPhone 15 Pro Max e registra somente metadados seguros", async () => {
  const logs = [];
  const items = [{ asin: "B001", title: "Telefone", price: 100, currency: "BRL" }];
  const queries = ["Iphone", "iPhone 15 Pro Max"];
  for (const query of queries) {
    const result = await runAmazonSearch({
      client: { async search(receivedQuery) { assert.equal(receivedQuery, query); return { items, cached: false }; } },
      config: baseConfig,
      logger: { info: (...values) => logs.push(values), warn: (...values) => logs.push(values) },
      query,
    });
    assert.deepEqual(result.items, items);
  }

  assert.match(logs[0][0], /Query: Iphone/);
  assert.match(logs[4][0], /Query: iPhone 15 Pro Max/);
  assert.match(logs[2][0], /Configuration: valid/);
  assert.deepEqual(logs[3][1], { cached: false, itemCount: 1 });
  assert.doesNotMatch(JSON.stringify(logs), /credential|secret|authorization|bearer/i);
});
