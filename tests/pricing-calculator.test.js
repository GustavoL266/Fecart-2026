import assert from "node:assert/strict";
import test from "node:test";
import { calculateCosts, calculatePrice } from "../js/domain/pricing-calculator.js";

const baseInputs = {
  materialsCost: 12,
  waste: 0.08,
  packagingCost: 2,
  deliveryCost: 1.5,
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

test("calcula os custos diretos e o preço mínimo do cenário padrão", () => {
  const costs = calculateCosts(baseInputs);
  const result = calculatePrice(baseInputs);

  assert.equal(costs.materialsWithWaste, 12.96);
  assert.equal(costs.cashGapDays, 0);
  assert.equal(Number(costs.baseCost.toFixed(2)), 21.45);
  assert.equal(result.minimumPrice, 29.31);
  assert.equal(Number(result.actualMargin.toFixed(2)), 0.18);
});

test("inclui o custo de capital quando o recebimento ocorre após o pagamento", () => {
  const result = calculatePrice({ ...baseInputs, receiveDays: 30, payDays: 0 });

  assert.equal(result.costs.cashGapDays, 30);
  assert.ok(result.costs.workingCapitalCost > 0);
  assert.ok(result.minimumPrice > 29.31);
});

test("marca o cálculo como inviável quando as taxas e a margem consomem todo o preço", () => {
  const result = calculatePrice({ ...baseInputs, taxRate: 0.5, paymentFeeRate: 0.2, commissionRate: 0.1, margin: 0.2 });

  assert.equal(result.isValid, false);
  assert.equal(result.minimumPrice, null);
  assert.equal(result.profitPerSale, 0);
});

test("calcula dinheiro em centavos e arredonda o preço sempre para cima", () => {
  const result = calculatePrice({
    ...baseInputs,
    materialsCost: 0.1,
    waste: 0.1,
    packagingCost: 0.2,
    deliveryCost: 0.3,
    totalPayroll: 0,
    monthlyFixedCosts: 0,
    taxRate: 0,
    paymentFeeRate: 0,
    margin: 0.3333,
  });

  assert.equal(Number.isInteger(result.costs.baseCostCents), true);
  assert.equal(Number.isInteger(result.minimumPriceCents), true);
  assert.equal(result.minimumPrice, result.minimumPriceCents / 100);
  assert.ok(result.minimumPriceCents >= result.costs.baseCostCents);
});

test("incorpora frete, seguro, desconto e despesas adicionais sem ponto flutuante monetário", () => {
  const result = calculatePrice({
    ...baseInputs,
    insuranceCost: 1.25,
    discountAmount: 0.5,
    otherExpenses: 0.75,
  });

  assert.equal(result.costs.deliveryCostCents, 150);
  assert.equal(result.costs.insuranceCostCents, 125);
  assert.equal(result.costs.discountAmountCents, 50);
  assert.equal(result.costs.otherExpensesCents, 75);
  assert.equal(Number.isInteger(result.salesExpensesCents), true);
});
