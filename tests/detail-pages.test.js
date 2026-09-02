import assert from "node:assert/strict";
import test from "node:test";
import { calculatePricing } from "../js/domain/pricing-calculator.js";
import { priceCompositionFrom, renderPriceDetails } from "../js/ui/detail-pages.js";

const inputs = { materialCost: 10, wasteRate: 0, packagingCost: 1, deliveryCost: 1, monthlyPayroll: 100, monthlyFixedCosts: 100, expectedMonthlyUnits: 100, taxRate: 0.06, paymentFeeRate: 0.02, commissionRate: 0.03, desiredNetMargin: 0.2, inventoryDays: 0, receivingDays: 0, paymentDays: 0, monthlyCapitalRate: 0 };

test("gráfico e detalhe consomem componentes canônicos", () => {
  const result = calculatePricing(inputs, { price: 30, source: "manual", rule: "manual" });
  const composition = priceCompositionFrom(result);
  assert.equal(composition.reduce((total, item) => total + item.value, 0), result.technicalPrice);
  assert.equal(composition.some((item) => item.label === "Custo financeiro"), false);
});

test("renderização não recria fórmulas nem estilos inline", () => {
  const nodes = new Map();
  const document = { querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, { attributes: new Map(), innerHTML: "", textContent: "", setAttribute(name, value) { this.attributes.set(name, String(value)); } }); return nodes.get(selector); } };
  renderPriceDetails(document, calculatePricing(inputs), 1);
  assert.match(nodes.get("#priceDonutSegments").innerHTML, /donut-segment/);
  assert.doesNotMatch(`${nodes.get("#priceDonutSegments").innerHTML}${nodes.get("#priceCompositionLegend").innerHTML}`, /\bstyle\s*=/i);
});
