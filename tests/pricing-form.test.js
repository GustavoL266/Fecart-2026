import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  clearPricingInputs, FORM_OPTION_FIELD_IDS, parseBrazilianNumber, PRICING_FIELD_IDS, validatePricingForm,
} from "../js/ui/form.js";

const values = {
  materialCost: "18,50", wasteRate: "5", packagingCost: "3,50",
  averageOrderFreight: "4", companyFreightShare: "", averageOrderUnits: "2",
  otherVariableCost: "", otherDirectExpenses: "",
  monthlyLaborCost: "12000", monthlyProductiveHours: "160", laborHourlyCost: "",
  productionTimeMinutes: "15", monthlyFixedCosts: "8000", expectedMonthlyUnits: "2000",
  allocationLaborHours: "", machineTimeMinutes: "", monthlyMachineHours: "",
  monthlyBusinessRevenue: "", monthlyProductRevenue: "", equipmentValue: "",
  equipmentUsefulLifeMonths: "", equipmentMaintenanceMonthly: "",
  taxRate: "6", paymentFeeRate: "2,8", commissionRate: "5", marketplaceFeeRate: "",
  fixedFeePerOrder: "", postSaleLossRate: "", minimumMargin: "", desiredNetMargin: "20",
  inventoryDays: "10", receivingDays: "7", paymentDays: "30", monthlyCapitalRate: "2",
  discountRate: "", fixedDiscountAmount: "", marketPrice: "",
  laborCostMode: "automatic", freightPayer: "company", allocationMethod: "quantity",
  capitalRateSource: "informed", discountType: "none",
};

const contextFieldIds = [
  "ncmCode", "taxRegime", "originState", "destinationState", "cfop", "taxSituation", "customerType", "operationPurpose",
];

function elementsFor(overrides = {}) {
  const all = { ...values, ...overrides };
  return Object.fromEntries([...PRICING_FIELD_IDS, ...FORM_OPTION_FIELD_IDS, ...contextFieldIds]
    .map((id) => [id, { value: all[id] ?? "" }]));
}

test("interpreta número brasileiro e rejeita texto, infinito e notação", () => {
  assert.deepEqual(parseBrazilianNumber("1.234,56"), { status: "valid", value: 1234.56 });
  ["", "abc", "Infinity", "1e3"].forEach((value) => assert.notEqual(parseBrazilianNumber(value).status, "valid"));
});

test("mantém obrigatórios vazios, opcionais nulos e texto inválido sem trocar o valor digitado", () => {
  const empty = elementsFor(Object.fromEntries(PRICING_FIELD_IDS.map((id) => [id, ""])));
  const validation = validatePricingForm(empty);
  assert.equal(validation.isValid, false);
  assert.equal(validation.errors.materialCost, "Informe o custo dos insumos e da matéria-prima.");
  assert.equal(validation.errors.marketPrice, undefined);
  const invalid = elementsFor({ materialCost: "abc" });
  assert.equal(validatePricingForm(invalid).errors.materialCost, "Informe um número válido, sem notação científica.");
  assert.equal(invalid.materialCost.value, "abc");
});

test("converte percentuais, opções e vazios para o contrato canônico", () => {
  const validation = validatePricingForm(elementsFor());
  assert.equal(validation.isValid, true);
  assert.equal(validation.inputs.wasteRate, 0.05);
  assert.equal(validation.inputs.desiredNetMargin, 0.2);
  assert.equal(validation.inputs.freightPayer, "company");
  assert.equal(validation.inputs.companyFreightShare, 1);
  assert.equal(validation.inputs.marketPrice, null);
  assert.equal(validation.inputs.otherDirectExpenses, 0);
  assert.ok(validation.emptyOptionalFields.includes("marketPrice"));
  assert.ok(validation.emptyOptionalFields.includes("otherDirectExpenses"));
});

test("valida domínio matemático, margem e campos condicionais", () => {
  assert.match(validatePricingForm(elementsFor({ wasteRate: "100" })).errors.wasteRate, /menor que 100%/);
  assert.match(validatePricingForm(elementsFor({ materialCost: "-1" })).errors.materialCost, /não pode ser negativo/);
  assert.match(validatePricingForm(elementsFor({ taxRate: "80", paymentFeeRate: "10", commissionRate: "10", desiredNetMargin: "0" })).errors.desiredNetMargin, /menor que 100%/);
  assert.match(validatePricingForm(elementsFor({ freightPayer: "shared", companyFreightShare: "" })).errors.companyFreightShare, /Informe/);
  assert.match(validatePricingForm(elementsFor({ laborCostMode: "manual", laborHourlyCost: "" })).errors.laborHourlyCost, /Informe/);
  assert.match(validatePricingForm(elementsFor({ minimumMargin: "25", desiredNetMargin: "20" })).errors.minimumMargin, /não pode ser maior/);
});

test("campos inativos não invalidam a opção explícita selecionada", () => {
  const validation = validatePricingForm(elementsFor({
    laborCostMode: "automatic", laborHourlyCost: "-1", allocationMethod: "quantity",
    machineTimeMinutes: "-1", monthlyMachineHours: "-1", capitalRateSource: "zero", monthlyCapitalRate: "-1",
  }));
  assert.equal(validation.isValid, true);
  assert.equal(validation.inputs.monthlyCapitalRate, 0);
  assert.equal(validation.inputs.laborHourlyCost, null);
});

test("HTML inicia vazio e expõe todos os campos e opções da versão 7", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const id of [...PRICING_FIELD_IDS, ...FORM_OPTION_FIELD_IDS]) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /id="discountAmount"/);
  assert.doesNotMatch(html, /id="monthlyPayroll"/);
  assert.match(html, /Percentual efetivo de impostos sobre a venda/);
  assert.match(html, /Quantidade deste produto que você espera produzir\/vender por mês/);
});

test("limpa precificação e contexto fiscal e restaura opções padrão", () => {
  const fields = elementsFor({
    ncmCode: "09012100", taxRegime: "simples-nacional", originState: "SP", destinationState: "RJ",
    cfop: "5102", taxSituation: "102", customerType: "contribuinte", operationPurpose: "venda",
    laborCostMode: "manual", freightPayer: "shared", allocationMethod: "revenue",
    capitalRateSource: "zero", discountType: "fixed",
  });
  clearPricingInputs(fields);

  for (const id of PRICING_FIELD_IDS) assert.equal(fields[id].value, "", `${id} deve ser limpo`);
  assert.deepEqual(Object.fromEntries(FORM_OPTION_FIELD_IDS.map((id) => [id, fields[id].value])), {
    laborCostMode: "automatic", freightPayer: "company", allocationMethod: "quantity",
    capitalRateSource: "informed", discountType: "none",
  });
  for (const id of contextFieldIds) assert.equal(fields[id].value, "", `${id} deve voltar ao padrão vazio`);
});
