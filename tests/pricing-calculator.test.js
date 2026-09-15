import assert from "node:assert/strict";
import test from "node:test";
import { calculatePricing, PricingValidationError, validatePricingInputs } from "../js/domain/pricing-calculator.js";

const base = {
  materialCost: 18.5, wasteRate: 0.05, packagingCost: 3.5,
  averageOrderFreight: 12, freightPayer: "shared", companyFreightShare: 0.5, averageOrderUnits: 3,
  otherVariableCost: 1, otherDirectExpenses: 0.5,
  laborCostMode: "automatic", monthlyLaborCost: 12000, monthlyProductiveHours: 2000, productionTimeMinutes: 30,
  monthlyFixedCosts: 8000, expectedMonthlyUnits: 2000, allocationMethod: "quantity",
  taxRate: 0.06, paymentFeeRate: 0.028, commissionRate: 0.05, marketplaceFeeRate: 0.03,
  fixedFeePerOrder: 6, postSaleLossRate: 0.01, minimumMargin: 0.15, desiredNetMargin: 0.2,
  inventoryDays: 10, receivingDays: 7, paymentDays: 30, capitalRateSource: "informed", monthlyCapitalRate: 0.02,
  discountType: "none", discountRate: 0, fixedDiscountAmount: 0, marketPrice: null,
};

function cost100(overrides = {}) {
  return {
    materialCost: 100, wasteRate: 0, packagingCost: 0,
    averageOrderFreight: 0, freightPayer: "company", averageOrderUnits: 1,
    laborCostMode: "manual", laborHourlyCost: 0, productionTimeMinutes: 0,
    monthlyFixedCosts: 0, expectedMonthlyUnits: 1, allocationMethod: "quantity",
    taxRate: 0, desiredNetMargin: 0.2,
    inventoryDays: 0, receivingDays: 0, paymentDays: 0, capitalRateSource: "zero",
    discountType: "none",
    ...overrides,
  };
}

test("decompõe custo completo e usa margem sobre o preço, não markup", () => {
  const result = calculatePricing(base, { price: 69.9, source: "manual", rule: "manual" });
  assert.ok(Math.abs(result.adjustedMaterialCost - (18.5 / 0.95)) < 1e-12);
  assert.ok(Math.abs(result.freightCostPerUnit - 2) < 1e-12);
  assert.equal(result.effectiveLaborHourlyCost, 6);
  assert.equal(result.directLaborCost, 3);
  assert.equal(result.fixedCostPerUnit, 4);
  assert.equal(result.fixedSaleFeePerUnit, 2);
  assert.equal(result.financedDays, 0);
  assert.ok(Math.abs(result.technicalPriceRaw - (result.totalUnitCost / (1 - result.saleExpenseRate - 0.2))) < 1e-12);
  assert.equal(result.market.price, 69.9);
  assert.equal(result.breakdown.some(({ key }) => key === "directLaborCost"), true);
});

test("exemplos matemáticos de margem retornam R$ 125,00 e R$ 142,86", () => {
  assert.equal(calculatePricing(cost100({ desiredNetMargin: 0.2 })).technicalPrice, 125);
  assert.equal(calculatePricing(cost100({ desiredNetMargin: 0.3 })).technicalPrice, 142.86);
  assert.equal(calculatePricing(cost100({ desiredNetMargin: 0.3 })).breakEvenPrice, 100);
});

test("mão de obra automática e manual produzem o mesmo custo por unidade", () => {
  const automatic = calculatePricing(cost100({ materialCost: 0, laborCostMode: "automatic", monthlyLaborCost: 4000, monthlyProductiveHours: 200, productionTimeMinutes: 30 }));
  const manual = calculatePricing(cost100({ materialCost: 0, laborCostMode: "manual", laborHourlyCost: 20, productionTimeMinutes: 30 }));
  assert.equal(automatic.directLaborCost, 10);
  assert.equal(automatic.directLaborCost, manual.directLaborCost);
});

test("frete considera pagador, participação e unidades do pedido uma única vez", () => {
  const company = calculatePricing(cost100({ materialCost: 0, averageOrderFreight: 30, averageOrderUnits: 3 }));
  const customer = calculatePricing(cost100({ materialCost: 0, averageOrderFreight: 30, averageOrderUnits: 3, freightPayer: "customer" }));
  const shared = calculatePricing(cost100({ materialCost: 0, averageOrderFreight: 30, averageOrderUnits: 3, freightPayer: "shared", companyFreightShare: 0.4 }));
  assert.equal(company.freightCostPerUnit, 10);
  assert.equal(customer.freightCostPerUnit, 0);
  assert.equal(shared.freightCostPerUnit, 4);
});

test("taxa fixa por pedido é dividida pelas unidades e não vira percentual", () => {
  const result = calculatePricing(cost100({ fixedFeePerOrder: 9, averageOrderUnits: 3 }));
  assert.equal(result.fixedSaleFeePerUnit, 3);
  assert.equal(result.totalUnitCost, 103);
  assert.equal(result.saleExpenseRate, 0);
});

test("todos os métodos de rateio usam apenas bases explicitamente informadas", () => {
  const common = cost100({ materialCost: 0, monthlyFixedCosts: 6000, expectedMonthlyUnits: 1000, productionTimeMinutes: 30, laborCostMode: "automatic", monthlyLaborCost: 0, monthlyProductiveHours: 500 });
  const quantity = calculatePricing(common);
  const labor = calculatePricing({ ...common, allocationMethod: "labor-hours" });
  const machine = calculatePricing({ ...common, allocationMethod: "machine-hours", machineTimeMinutes: 30, monthlyMachineHours: 500 });
  const revenue = calculatePricing({ ...common, allocationMethod: "revenue", monthlyBusinessRevenue: 100000, monthlyProductRevenue: 10000 });
  assert.equal(quantity.fixedCostPerUnit, 6);
  assert.equal(labor.fixedCostPerUnit, 6);
  assert.equal(machine.fixedCostPerUnit, 6);
  assert.equal(revenue.fixedCostPerUnit, 0.6);
});

test("equipamentos calculam depreciação e manutenção sem duplicar custos fixos", () => {
  const result = calculatePricing(cost100({ equipmentValue: 12000, equipmentUsefulLifeMonths: 60, equipmentMaintenanceMonthly: 100, expectedMonthlyUnits: 1000 }));
  assert.equal(result.equipmentDepreciationMonthly, 200);
  assert.equal(result.equipmentMonthlyCost, 300);
  assert.equal(result.equipmentCostPerUnit, 0.3);
});

test("desconto fica fora do custo e eleva o preço anunciado para preservar margem", () => {
  const percentage = calculatePricing(cost100({ discountType: "percentage", discountRate: 0.1 }));
  const fixed = calculatePricing(cost100({ discountType: "fixed", fixedDiscountAmount: 5 }));
  assert.equal(percentage.technicalPrice, 125);
  assert.equal(percentage.discount.advertisedPrice, 138.89);
  assert.equal(percentage.discount.postDiscountPrice, 125);
  assert.equal(fixed.discount.advertisedPrice, 130);
});

test("valida negativos, denominadores, bases condicionais e não corrige valores", () => {
  assert.match(validatePricingInputs(cost100({ materialCost: -1 })).errors.materialCost, /não pode ser negativo/);
  assert.match(validatePricingInputs(cost100({ averageOrderUnits: 0 })).errors.averageOrderUnits, /maior que zero/);
  assert.match(validatePricingInputs(cost100({ desiredNetMargin: 0.9, taxRate: 0.1 })).errors.desiredNetMargin, /menor que 100%/);
  assert.match(validatePricingInputs(cost100({ freightPayer: "shared" })).errors.companyFreightShare, /Informe/);
  assert.match(validatePricingInputs(cost100({ allocationMethod: "machine-hours" })).errors.machineTimeMinutes, /Informe/);
  assert.match(validatePricingInputs(cost100({ equipmentValue: 1000 })).errors.equipmentUsefulLifeMonths, /Informe/);
  assert.throws(() => calculatePricing(cost100({ monthlyCapitalRate: Infinity, capitalRateSource: "informed" })), PricingValidationError);
});

test("ciclo financeiro respeita zero, prazo do fornecedor e juros compostos", () => {
  assert.equal(calculatePricing(cost100()).financialCost, 0);
  assert.equal(calculatePricing(cost100({ inventoryDays: 1, receivingDays: 1, paymentDays: 10, capitalRateSource: "informed", monthlyCapitalRate: 0.02 })).financedDays, 0);
  const result = calculatePricing(cost100({ inventoryDays: 30, receivingDays: 30, paymentDays: 0, capitalRateSource: "informed", monthlyCapitalRate: 0.02 }));
  assert.equal(result.financedDays, 60);
  assert.ok(Math.abs(result.periodCapitalRate - ((1.02 ** 2) - 1)) < 1e-12);
});

test("inputs v6 continuam calculáveis sem reescrever registros históricos", () => {
  const legacy = {
    materialCost: 18.5, wasteRate: 0.05, packagingCost: 3.5, deliveryCost: 4, insuranceCost: 0.5, otherDirectExpenses: 1.5,
    monthlyPayroll: 12000, monthlyFixedCosts: 8000, expectedMonthlyUnits: 2000,
    taxRate: 0.06, paymentFeeRate: 0.028, commissionRate: 0.05, desiredNetMargin: 0.2,
    inventoryDays: 10, receivingDays: 7, paymentDays: 30, monthlyCapitalRate: 0.02,
  };
  assert.equal(calculatePricing(legacy).technicalPrice, 58.88);
  assert.equal(calculatePricing(calculatePricing(legacy).inputs).technicalPrice, 58.88);
});
