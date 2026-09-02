import assert from "node:assert/strict";
import test from "node:test";
import { authoritativeProductSnapshot } from "../lib/pricing-persistence.js";
import { calculatePricing, PricingValidationError } from "../js/domain/pricing-calculator.js";

const inputs = { materialCost: 18.5, wasteRate: 0.05, packagingCost: 3.5, deliveryCost: 4, insuranceCost: 0.5, otherDirectExpenses: 1.5, monthlyPayroll: 12000, monthlyFixedCosts: 8000, expectedMonthlyUnits: 2000, taxRate: 0.06, paymentFeeRate: 0.028, commissionRate: 0.05, desiredNetMargin: 0.2, inventoryDays: 10, receivingDays: 7, paymentDays: 30, monthlyCapitalRate: 0.02, fiscalContext: { ncmCode: "18061000" } };

test("servidor ignora derivados adulterados e devolve snapshot v6 autoritativo", () => {
  const payload = { name: "Bolo", description: "", category: "Alimentos", suggestedPrice: 0.01, profitMargin: 99, pricing: { inputs, market: { rule: "manual" }, emptyOptionalFields: [] } };
  const snapshot = authoritativeProductSnapshot(payload);
  assert.equal(snapshot.suggestedPrice, 58.88);
  assert.equal(snapshot.profitMargin, 20);
  assert.equal(snapshot.calculationData.pricingSchemaVersion, 6);
  assert.equal(snapshot.calculationData.pricingResult.technicalPrice, snapshot.suggestedPrice);
  assert.deepEqual(snapshot.calculationData.pricingResult.presentation, calculatePricing(inputs).presentation);
});

test("backend repete a validação e não deixa preço existir com input inválido", () => {
  assert.throws(() => authoritativeProductSnapshot({ name: "X", description: "", category: "C", pricing: { inputs: { ...inputs, expectedMonthlyUnits: 0 }, market: {} } }), PricingValidationError);
});

test("NCM só é salvo como Focus validado se o código e a prova coincidem", () => {
  const valid = authoritativeProductSnapshot({ name: "X", description: "", category: "C", pricing: { inputs, market: {}, fiscalValidation: { status: "success", source: "Focus NFe", code: "18061000", ncm: { codigo: "18061000", descricao_completa: "Cacau" }, environment: "homologação", checkedAt: "2026-01-01" } } });
  assert.equal(valid.calculationData.fiscal.ncmValidation.status, "success");
  const stale = authoritativeProductSnapshot({ name: "X", description: "", category: "C", pricing: { inputs: { ...inputs, fiscalContext: { ncmCode: "12345678" } }, market: {}, fiscalValidation: { status: "success", source: "Focus NFe", code: "18061000", ncm: { codigo: "18061000" } } } });
  assert.equal(stale.calculationData.fiscal.ncmValidation.status, "unverified");
});
