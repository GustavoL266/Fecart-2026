import assert from "node:assert/strict";
import test from "node:test";
import { calculatePricing, PricingValidationError, validatePricingInputs } from "../js/domain/pricing-calculator.js";

const base = {
  materialCost: 18.5, wasteRate: 0.05, packagingCost: 3.5, deliveryCost: 4, insuranceCost: 0.5, otherDirectExpenses: 1.5,
  monthlyPayroll: 12000, monthlyFixedCosts: 8000, expectedMonthlyUnits: 2000,
  taxRate: 0.06, paymentFeeRate: 0.028, commissionRate: 0.05, desiredNetMargin: 0.2,
  inventoryDays: 10, receivingDays: 7, paymentDays: 30, monthlyCapitalRate: 0.02,
};

test("cenário obrigatório usa desperdício por rendimento e arredonda apenas o preço técnico", () => {
  const result = calculatePricing(base, { price: 69.9, source: "manual", rule: "manual" });
  assert.ok(Math.abs(result.adjustedMaterialCost - (18.5 / 0.95)) < 1e-12);
  assert.ok(Math.abs(result.directCost - 28.973684210526315) < 1e-12);
  assert.equal(result.indirectCost, 10);
  assert.equal(result.financedDays, 0);
  assert.equal(result.financialCost, 0);
  assert.ok(Math.abs(result.technicalPriceRaw - 58.872635) < 0.001);
  assert.equal(result.technicalPrice, 58.88);
  assert.equal(result.market.price, 69.9);
  assert.ok(result.market.difference > 0);
  assert.equal(result.presentation.technicalPrice, 58.88);
});

test("valida desperdício, produção, percentuais e números sem correção silenciosa", () => {
  assert.equal(validatePricingInputs({ ...base, wasteRate: 0 }).isValid, true);
  assert.equal(validatePricingInputs({ ...base, wasteRate: 0.999999 }).isValid, true);
  assert.equal(validatePricingInputs({ ...base, wasteRate: 1 }).errors.wasteRate, "O desperdício deve ser menor que 100%.");
  assert.match(validatePricingInputs({ ...base, expectedMonthlyUnits: 0 }).errors.expectedMonthlyUnits, /maior que zero/);
  assert.match(validatePricingInputs({ ...base, desiredNetMargin: -0.01 }).errors.desiredNetMargin, /não pode ser negativo/);
  assert.match(validatePricingInputs({ ...base, taxRate: 0.7, paymentFeeRate: 0.2, commissionRate: 0.1, desiredNetMargin: 0 }).errors.desiredNetMargin, /menor que 100%/);
  assert.match(validatePricingInputs({ ...base, materialCost: Number.NaN }).errors.materialCost, /número finito/);
  assert.throws(() => calculatePricing({ ...base, monthlyCapitalRate: Infinity }), PricingValidationError);
});

test("ciclo financeiro respeita zero, ciclo negativo e juros compostos positivos", () => {
  assert.equal(calculatePricing({ ...base, inventoryDays: 0, receivingDays: 0, paymentDays: 0 }).financialCost, 0);
  assert.equal(calculatePricing({ ...base, inventoryDays: 1, receivingDays: 1, paymentDays: 10 }).financedDays, 0);
  const result = calculatePricing({ ...base, inventoryDays: 30, receivingDays: 30, paymentDays: 0, monthlyCapitalRate: 0.02 });
  assert.equal(result.financedDays, 60);
  assert.ok(Math.abs(result.periodCapitalRate - ((1.02 ** 2) - 1)) < 1e-12);
  assert.ok(result.financialCost > 0);
});

test("mercado vazio permanece nulo; produto, média e mediana são referências distintas", () => {
  assert.equal(calculatePricing(base).market.price, null);
  const product = calculatePricing(base, { price: 77, source: "Loja Exemplo", rule: "selected-product", selectedProduct: { id: "x" } });
  const average = calculatePricing(base, { price: 70, source: "Google Shopping", rule: "market-average" });
  const median = calculatePricing(base, { price: 68, source: "Google Shopping", rule: "market-median" });
  assert.equal(product.market.rule, "selected-product");
  assert.equal(average.market.rule, "market-average");
  assert.equal(median.market.rule, "market-median");
  assert.equal(product.technicalPrice, average.technicalPrice);
});

test("desconto fica fora do custo e preserva o preço técnico após o desconto", () => {
  const withoutDiscount = calculatePricing(base);
  const percentage = calculatePricing({ ...base, discountRate: 0.1 });
  const fixed = calculatePricing({ ...base, fixedDiscountAmount: 5 });
  assert.equal(withoutDiscount.technicalPrice, percentage.technicalPrice);
  assert.equal(withoutDiscount.technicalPrice, fixed.technicalPrice);
  assert.equal(percentage.discount.postDiscountPrice, percentage.technicalPrice);
  assert.equal(fixed.discount.advertisedPrice, fixed.technicalPrice + 5);
  assert.equal(validatePricingInputs({ ...base, discountRate: 0.1, fixedDiscountAmount: 1 }).isValid, false);
});

test("capacidade produtiva é apenas informativa e nunca muda o preço", () => {
  const low = calculatePricing({ ...base, productionCapacity: { workerCount: 1, productiveHoursPerWorkerMonth: 1, unitsPerWorkerHour: 1 } });
  const high = calculatePricing({ ...base, productionCapacity: { workerCount: 100, productiveHoursPerWorkerMonth: 300, unitsPerWorkerHour: 100 } });
  assert.equal(low.technicalPrice, high.technicalPrice);
  assert.equal(low.inputs.productionCapacity.monthlyCapacity, 1);
});
