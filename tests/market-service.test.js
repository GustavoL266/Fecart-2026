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
        marketplace: "Google Shopping",
        provider: "SearchAPI / Google Shopping",
        results: [
          { id: "B001", title: "Produto teste", price: 99.9, currency: "BRL", source: "Loja A", seller: "Loja A", category: "Eletrônicos", url: "https://google.example/a", rating: 4.7, reviews: 20 },
          { id: "B002", title: "Sem preço", price: null, currency: "BRL", source: "Loja B", url: "https://google.example/b" },
          { id: "B003", title: "Item incompatível", price: 10, currency: "BRL", source: "Loja C", url: "https://google.example/c" },
          { id: "B004", title: "Capa para Produto teste", price: 20, currency: "BRL", source: "Loja D", category: "Acessórios", url: "https://google.example/d" },
          ...Array.from({ length: 6 }, (_, index) => ({ id: `B10${index}`, title: `Produto teste ${index}`, price: 100 + index, currency: "BRL", source: `Loja ${index}`, url: `https://google.example/${index}` })),
        ],
      };
    },
  });

  const result = await service.search("  produto   teste ");
  assert.deepEqual(calls, ["/market/search?q=produto%20teste"]);
  assert.equal(result.items.length, 5);
  assert.equal(result.items[0].category, "Eletrônicos");
  assert.equal(result.provider, "SearchAPI / Google Shopping");
  assert.equal(result.items[0].seller, "Loja A");
  assert.equal(result.items[0].rating, 4.7);
});
