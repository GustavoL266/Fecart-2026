import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMarketQuery, rankMarketResults, simplifyMarketQuery } from "../js/domain/market-relevance.js";

test("normaliza a grafia sem substituir o modelo pesquisado por uma categoria", () => {
  for (const input of ["Iphone 18 Pro Max", "iPhone 18 Pro Max", "iphone 18 pro max"]) {
    assert.equal(normalizeMarketQuery(input).toLowerCase(), "iphone 18 pro max");
  }
  assert.equal(normalizeMarketQuery("  Iphone   18 Pro Max  "), "iPhone 18 Pro Max");
  assert.equal(simplifyMarketQuery("Apple iPhone 18 Pro Max 256GB"), "iPhone 18 Pro Max");
  assert.equal(simplifyMarketQuery("Galaxy S27 Ultra"), "Galaxy S27 Ultra");
  assert.equal(simplifyMarketQuery("PlayStation 6"), "PlayStation 6");
});

test("prioriza o aparelho e preserva geração e variante do modelo", () => {
  const results = rankMarketResults([
    { id: "case", title: "Capa para iPhone 18 Pro Max" },
    { id: "part", title: "Tela de reposição para iPhone 18 Pro Max" },
    { id: "old", title: "Apple iPhone 17 Pro Max 256GB" },
    { id: "smaller", title: "Apple iPhone 18 Pro 256GB" },
    { id: "bundle", title: "iPhone 18 Pro Max com capa" },
    { id: "main", title: "Apple iPhone 18 Pro Max 256GB" },
  ], "Apple iPhone 18 Pro Max 256GB");
  assert.deepEqual(results.results.map((item) => item.id), ["main", "bundle"]);
  assert.equal(results.primaryCount, 1);
  assert.equal(results.accessoryCount, 1);
});

for (const [query, product, accessory] of [
  ["PlayStation 6", "Console PlayStation 6", "Controle para PlayStation 6"],
  ["Galaxy S27 Ultra", "Samsung Galaxy S27 Ultra 512GB", "Capa Galaxy S27 Ultra"],
  ["MacBook Pro", "Apple MacBook Pro 14 polegadas", "Capa para MacBook Pro"],
]) {
  test(`${query}: mantém o produto e reduz o acessório`, () => {
    const ranked = rankMarketResults([{ id: "accessory", title: accessory }, { id: "main", title: product }], query);
    assert.deepEqual(ranked.results.map((item) => item.id), ["main"]);
  });
}

test("produto inexistente não recebe referência fictícia", () => {
  assert.deepEqual(rankMarketResults([{ id: "other", title: "Produto diferente" }], "produto inexistente xyz123abc").results, []);
});

test("reconhece modelo e capacidade escritos juntos ou separados", () => {
  const ranked = rankMarketResults([
    { id: "joined", title: "iPhone18 Pro Max 256 GB" },
    { id: "separated", title: "iPhone 18 Pro Max 256GB" },
  ], "iPhone 18 Pro Max 256GB");
  assert.deepEqual(ranked.results.map((item) => item.id), ["separated", "joined"]);
});
