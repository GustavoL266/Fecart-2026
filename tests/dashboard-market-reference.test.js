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
  const result = calculatePricing(inputs, { price: 30, source: "Amazon", rule: "selected-product" });
  const document = documentStub();
  renderDashboard(document, result, { status: "idle", items: [], stats: null, selectedItem: null }, new ConfiguredTaxRuleEngine().assess(inputs));
  assert.match(document.nodes.get("#suggestedPrice").textContent, /R\$/);
  assert.equal(document.nodes.get("#marketTitle").textContent, "Produto individual selecionado");
  assert.match(document.nodes.get("#marketStatus").textContent, /Diferença/);
});
