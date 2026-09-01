import assert from "node:assert/strict";
import test from "node:test";
import { AmazonService, calculateAmazonStats } from "../js/services/amazon-service.js";

test("calcula a mediana local somente com preços BRL válidos", () => {
  const stats = calculateAmazonStats([
    { price: 40, currency: "BRL" },
    { price: 29.9, currency: "BRL" },
    { price: 35, currency: "BRL" },
    { price: 31, currency: "BRL" },
    { price: 32, currency: "BRL" },
    { price: 20, currency: "USD" },
    { price: 0, currency: "BRL" },
    { price: Number.NaN, currency: "BRL" },
  ]);

  assert.equal(stats.median, 32);
  assert.equal(stats.count, 5);
  assert.equal(stats.min, 29.9);
  assert.equal(stats.max, 40);
});

test("consulta somente a rota interna e descarta itens incompletos", async () => {
  const calls = [];
  const service = new AmazonService({
    async get(path) {
      calls.push(path);
      return {
        marketplace: "www.amazon.com.br",
        items: [
          { asin: "B001", title: "Produto teste", price: 99.9, currency: "BRL", image: "https://imagem", url: "https://amazon" },
          { asin: "B002", title: "Sem preço", price: null, currency: "BRL", url: "https://amazon" },
          { asin: "B003", title: "Item incompatível", price: 10, currency: "BRL", url: "https://amazon" },
        ],
      };
    },
  });

  const result = await service.search("  produto   teste ");
  assert.deepEqual(calls, ["/amazon/search?q=produto%20teste"]);
  assert.equal(result.items.length, 1);
  assert.equal(result.stats.median, 99.9);
});
