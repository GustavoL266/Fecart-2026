import assert from "node:assert/strict";
import test from "node:test";
import { calculatePricing } from "../js/domain/pricing-calculator.js";
import { buildCalculationMemory, ConfiguredTaxRuleEngine, TaxRuleEngine } from "../js/domain/tax-rule-engine.js";

const inputs = { materialCost: 10, wasteRate: 0, packagingCost: 1, deliveryCost: 1, monthlyPayroll: 100, monthlyFixedCosts: 100, expectedMonthlyUnits: 100, taxRate: 0.06, paymentFeeRate: 0.02, commissionRate: 0.03, desiredNetMargin: 0.2, inventoryDays: 0, receivingDays: 0, paymentDays: 0, monthlyCapitalRate: 0, fiscalContext: { ncmCode: "18061000", taxRegime: "lucro-real", originState: "SP", destinationState: "RJ", cfop: "6102", taxSituation: "00", customerType: "contribuinte", operationPurpose: "venda" } };

test("Focus valida NCM sem criar alíquota nem substituir taxa manual", () => {
  assert.throws(() => new TaxRuleEngine().assess(), /implementar/);
  const assessment = new ConfiguredTaxRuleEngine().assess(inputs, { status: "success", source: "Focus NFe", ncm: { codigo: "18061000" }, environment: "homologação", checkedAt: "2026-01-01" });
  assert.equal(assessment.automaticCalculation, false);
  assert.equal(assessment.taxes[0].rate, 0.06);
  assert.equal(assessment.ncmSource, "Focus NFe");
  assert.ok(assessment.unresolvedTaxes.includes("ICMS-ST"));
});

test("memória usa o breakdown canônico, sem desconto como custo", () => {
  const result = calculatePricing(inputs);
  const memory = buildCalculationMemory(result, new ConfiguredTaxRuleEngine().assess(inputs));
  assert.equal(memory.find((item) => item.key === "taxAmount").value, result.taxAmount);
  assert.equal(memory.find((item) => item.key === "financialCost").value, result.financialCost);
  assert.equal(memory.some((item) => item.label === "Desconto"), false);
});
