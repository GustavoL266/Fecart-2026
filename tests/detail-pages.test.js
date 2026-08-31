import assert from "node:assert/strict";
import test from "node:test";

import { calculatePrice } from "../js/domain/pricing-calculator.js";
import { priceComparisonFrom, priceCompositionFrom, renderPriceDetails } from "../js/ui/detail-pages.js";

const inputs = {
  materialsCost: 12,
  waste: 0.08,
  packagingCost: 2,
  deliveryCost: 1.5,
  insuranceCost: 0,
  discountAmount: 0,
  otherExpenses: 0,
  totalPayroll: 12600,
  workerCount: 6,
  outputPerWorkerHour: 12,
  monthlyFixedCosts: 16000,
  monthlyVolume: 4000,
  taxRate: 0.06,
  paymentFeeRate: 0.028,
  commissionRate: 0,
  margin: 0.18,
  competitorAverage: 32,
  receiveDays: 7,
  payDays: 14,
  capitalRate: 0.025,
};

test("a composição visual representa exatamente o preço calculado existente", () => {
  const result = calculatePrice(inputs);
  const composition = priceCompositionFrom(result);

  assert.equal(composition.reduce((total, item) => total + item.valueCents, 0), result.minimumPriceCents);
  assert.ok(Math.abs(composition.reduce((total, item) => total + item.share, 0) - 1) < 0.000001);
});

test("a comparação usa custo, preço recomendado e mercado sem alterar valores", () => {
  const result = calculatePrice(inputs);
  const comparison = priceComparisonFrom(inputs, result);

  assert.deepEqual(comparison.map((item) => item.value), [result.costs.baseCost, result.minimumPrice, inputs.competitorAverage]);
  assert.ok(comparison.every((item) => item.width >= 0 && item.width <= 100));
});

test("um cenário inválido não fabrica composição gráfica", () => {
  const result = calculatePrice({ ...inputs, taxRate: 0.6, paymentFeeRate: 0.2, margin: 0.2 });

  assert.equal(result.isValid, false);
  assert.deepEqual(priceCompositionFrom(result), []);
});

test("a renderização dinâmica de gráficos não produz atributos style", () => {
  const nodes = new Map();
  const document = {
    querySelector(selector) {
      if (!nodes.has(selector)) {
        nodes.set(selector, {
          attributes: new Map(),
          innerHTML: "",
          textContent: "",
          setAttribute(name, value) {
            this.attributes.set(name, String(value));
          },
        });
      }
      return nodes.get(selector);
    },
  };
  const result = calculatePrice(inputs);

  renderPriceDetails(document, inputs, result, "Preço próximo da média.", 1);

  const segments = nodes.get("#priceDonutSegments").innerHTML;
  const legend = nodes.get("#priceCompositionLegend").innerHTML;
  const comparison = nodes.get("#priceComparisonBars").innerHTML;
  assert.match(segments, /<circle class="donut-segment/);
  assert.match(comparison, /<progress class="comparison-track/);
  assert.doesNotMatch(`${segments}${legend}${comparison}`, /\bstyle\s*=/i);
});
