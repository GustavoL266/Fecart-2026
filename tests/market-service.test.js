import assert from "node:assert/strict";
import test from "node:test";
import { calculateMarketStats, MarketService } from "../js/services/market-service.js";

test("calcula a mediana local somente com preços BRL válidos", () => {
  const stats = calculateMarketStats([
    { price: 40, currency: "BRL" },
    { price: 29.9, currency: "BRL" },
    { price: 35, currency: "BRL" },
    { price: 31, currency: "BRL" },
    { price: 32, currency: "BRL" },
    { price: 20, currency: "USD" },
    { price: 0, currency: "BRL" },
  ]);
  assert.equal(stats.median, 32);
  assert.equal(stats.count, 5);
  assert.equal(stats.min, 29.9);
  assert.equal(stats.max, 40);
});

test("consulta somente a rota interna e mostra até cinco itens relevantes", async () => {
  const calls = [];
  const service = new MarketService({
    async get(path) {
      calls.push(path);
      return {
        marketplace: "Amazon",
        provider: "Nexscope",
        results: [
          { id: "B001", title: "Produto teste", price: 99.9, currency: "BRL", source: "Amazon", category: "Eletrônicos", url: "https://amazon" },
          { id: "B002", title: "Sem preço", price: null, currency: "BRL", source: "Amazon", url: "https://amazon" },
          { id: "B003", title: "Item incompatível", price: 10, currency: "BRL", source: "Amazon", url: "https://amazon" },
          { id: "B004", title: "Capa para Produto teste", price: 20, currency: "BRL", source: "Amazon", category: "Acessórios", url: "https://amazon" },
          ...Array.from({ length: 6 }, (_, index) => ({ id: `B10${index}`, title: `Produto teste ${index}`, price: 100 + index, currency: "BRL", source: "Amazon", url: "https://amazon" })),
        ],
      };
    },
  });

  const result = await service.search("  produto   teste ");
  assert.deepEqual(calls, ["/market/search?q=produto%20teste"]);
  assert.equal(result.items.length, 5);
  assert.equal(result.items[0].category, "Eletrônicos");
  assert.equal(result.provider, "Nexscope");
});
