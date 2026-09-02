import assert from "node:assert/strict";
import test from "node:test";

import { renderIncompleteDashboard } from "../js/ui/dashboard.js";

function element() {
  return {
    classList: { add() {}, remove() {}, toggle() {} },
    hidden: false,
    innerHTML: "",
    setAttribute() {},
    textContent: "",
    value: 0,
  };
}

test("referência selecionada atualiza imediatamente nome, preço e fonte no dashboard incompleto", () => {
  const elements = new Map();
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
  };
  const selectedItem = {
    id: "B000000001",
    title: "iPhone 15 Pro Max",
    price: 7499,
    source: "Amazon",
  };

  renderIncompleteDashboard(document, {
    status: "idle",
    selectedItem,
    stats: null,
    items: [],
  }, { materialsCost: "Obrigatório" });

  assert.equal(elements.get("#marketTitle").textContent, "iPhone 15 Pro Max");
  assert.match(elements.get("#marketPrice").textContent, /R\$\s*7\.499,00/);
  assert.equal(elements.get("#marketReferenceDetails").textContent, "Fonte: Amazon");
  assert.match(elements.get("#primaryMarketPrice").textContent, /R\$\s*7\.499,00/);
  assert.equal(elements.get("#primaryMarketSource").textContent, "Fonte: Amazon");
});
