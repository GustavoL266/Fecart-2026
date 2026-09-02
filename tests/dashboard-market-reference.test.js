import assert from "node:assert/strict";
import test from "node:test";
import { calculatePricing } from "../js/domain/pricing-calculator.js";
import { ConfiguredTaxRuleEngine } from "../js/domain/tax-rule-engine.js";
import { renderDashboard } from "../js/ui/dashboard.js";

function documentStub() {
  const nodes = new Map();
  return { nodes, querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, { classList: { toggle() {} }, hidden: false, innerHTML: "", textContent: "", value: 0, setAttribute() {} }); return nodes.get(selector); } };
}
const inputs = { materialCost: 10, wasteRate: 0, packagingCost: 1, deliveryCost: 1, monthlyPayroll: 100, monthlyFixedCosts: 100, expectedMonthlyUnits: 100, taxRate: 0.06, paymentFeeRate: 0.02, commissionRate: 0.03, desiredNetMargin: 0.2, inventoryDays: 0, receivingDays: 0, paymentDays: 0, monthlyCapitalRate: 0, fiscalContext: {} };

test("dashboard lê o resultado canônico e distingue produto individual", () => {
  const selectedProduct = { id: "produto-1", title: "Produto principal", price: 30, source: "Loja Exemplo", seller: "Loja Exemplo", currency: "BRL", image: "https://example.com/image.jpg", url: "https://example.com/product", rating: 4.7, reviews: 120, consultedAt: "2026-09-02T12:00:00.000Z" };
  const otherProduct = { ...selectedProduct, id: "produto-2", title: "Produto alternativo", price: 32, source: "Outra Loja", seller: "Outra Loja" };
  const reference = { price: 30, source: "Loja Exemplo", rule: "selected-product", selectedProduct };
  const result = calculatePricing(inputs, reference);
  const document = documentStub();
  renderDashboard(document, result, {
    status: "success",
    query: "Produto principal",
    items: [selectedProduct, otherProduct],
    stats: { count: 2, average: 31, median: 31, min: 30, max: 32 },
    selectedItem: selectedProduct,
    marketplace: "Google Shopping",
  }, new ConfiguredTaxRuleEngine().assess(inputs));
  assert.match(document.nodes.get("#suggestedPrice").textContent, /R\$/);
  assert.equal(document.nodes.get("#marketTitle").textContent, "Produto individual selecionado");
  assert.match(document.nodes.get("#marketStatus").textContent, /Diferença/);
  assert.equal(document.nodes.get("#marketPanel").hidden, false);
  assert.match(document.nodes.get("#marketDashboardStatus").textContent, /2 referências encontradas/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /Média/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /Maior \+ tributos/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /Tributação pendente/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /Produto alternativo/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /Preço de mercado: R\$\s32,00/);
  assert.doesNotMatch(document.nodes.get("#marketStats").innerHTML, /Fonte fiscal: Focus NFe/);
  assert.match(document.nodes.get("#marketResults").innerHTML, /Produto principal/);
  assert.match(document.nodes.get("#marketResults").innerHTML, /Referência selecionada/);
  assert.match(document.nodes.get("#marketResults").innerHTML, /Usar como referência/);
  assert.equal(document.nodes.get("#primaryMarketValue").hidden, false);
  assert.match(document.nodes.get("#primaryMarketSource").textContent, /Produto principal.*Loja Exemplo.*Google Shopping/);
});
