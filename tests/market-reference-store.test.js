import assert from "node:assert/strict";
import test from "node:test";

import { clearMarketReference, loadMarketReference, saveMarketReference } from "../js/services/market-reference-store.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

test("preserva a referência Amazon durante reload e mantém o fallback manual", () => {
  const storage = memoryStorage();
  const selectedItem = {
    asin: "B001TESTE",
    title: "Produto de teste 256 GB",
    price: 7499,
    currency: "BRL",
    category: "Smartphones",
    url: "https://www.amazon.com.br/dp/B001TESTE",
  };

  assert.equal(saveMarketReference(storage, { manualValue: 32, query: "produto teste", selectedItem }), true);
  assert.deepEqual(loadMarketReference(storage), {
    manualValue: 32,
    query: "produto teste",
    selectedItem: { ...selectedItem, id: "B001TESTE", image: "", source: "Amazon" },
  });

  clearMarketReference(storage);
  assert.equal(loadMarketReference(storage), null);
});

test("ignora conteúdo inválido do armazenamento da sessão", () => {
  const storage = memoryStorage();
  storage.setItem("assistente-precificacao-market-reference-v1", "{invalido");
  assert.equal(loadMarketReference(storage), null);
  assert.equal(saveMarketReference(storage, { manualValue: 0, selectedItem: {} }), false);
});

test("preserva referência Amazon quando o fallback manual ainda está vazio", () => {
  const storage = memoryStorage();
  const selectedItem = { asin: "B002TESTE", title: "Produto sem fallback", price: 99.9 };

  assert.equal(saveMarketReference(storage, { manualValue: null, query: "produto", selectedItem }), true);
  assert.equal(loadMarketReference(storage).manualValue, null);
  assert.equal(loadMarketReference(storage).selectedItem.price, 99.9);
});
