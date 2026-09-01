import assert from "node:assert/strict";
import test from "node:test";
import { calculatePrice } from "../js/domain/pricing-calculator.js";
import { buildCalculationMemory, ConfiguredTaxRuleEngine, TaxRuleEngine } from "../js/domain/tax-rule-engine.js";

const inputs = {
  materialsCost: 12,
  waste: 0.08,
  packagingCost: 2,
  deliveryCost: 1.5,
  insuranceCost: 0.5,
  discountAmount: 1,
  otherExpenses: 0.75,
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
  fiscalContext: {
    ncmCode: "18061000",
    taxRegime: "lucro-real",
    originState: "SP",
    destinationState: "RJ",
    cfop: "6102",
    taxSituation: "00",
    customerType: "contribuinte",
    operationPurpose: "venda",
  },
};

test("mantém interface substituível para um motor tributário futuro", () => {
  assert.throws(() => new TaxRuleEngine().assess(), /implementar/);
  assert.ok(new ConfiguredTaxRuleEngine() instanceof TaxRuleEngine);
});

test("não trata NCM como cálculo tributário automático", () => {
  const assessment = new ConfiguredTaxRuleEngine().assess(inputs, {
    status: "success",
    ncm: { codigo: "18061000", descricao_completa: "Cacau e suas preparações" },
  });

  assert.equal(assessment.automaticCalculation, false);
  assert.equal(assessment.complete, false);
  assert.equal(assessment.ncmSource, "Focus NFe");
  assert.ok(assessment.unresolvedTaxes.includes("ICMS-ST"));
  assert.ok(assessment.unresolvedTaxes.some((name) => name.includes("IBS/CBS")));
});

test("memória separa custos, frete, seguro, desconto, tributo, margem e origem", () => {
  const result = calculatePrice(inputs);
  const assessment = new ConfiguredTaxRuleEngine().assess(inputs, { status: "error", unavailable: true });
  const memory = buildCalculationMemory(inputs, result, assessment);

  assert.equal(memory.find((item) => item.label === "Frete/entrega").valueCents, 150);
  assert.equal(memory.find((item) => item.label === "Seguro").valueCents, 50);
  assert.equal(memory.find((item) => item.label === "Desconto").valueCents, -100);
  assert.equal(memory.find((item) => item.group === "Tributo").baseCents, result.minimumPriceCents);
  assert.equal(memory.find((item) => item.group === "Tributo").source, "Usuário/regra configurada");
  assert.equal(memory.at(-1).label, "Preço sugerido");
  assert.equal(assessment.focusUnavailable, true);
});
