import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseBrazilianNumber, PRICING_FIELD_IDS, validatePricingForm } from "../js/ui/form.js";

const values = {
  materialCost: "18,50", wasteRate: "5", packagingCost: "3,50", deliveryCost: "4", insuranceCost: "", otherDirectExpenses: "",
  monthlyPayroll: "12000", monthlyFixedCosts: "8000", expectedMonthlyUnits: "2000", taxRate: "6", paymentFeeRate: "2,8", commissionRate: "5", desiredNetMargin: "20",
  inventoryDays: "10", receivingDays: "7", paymentDays: "30", monthlyCapitalRate: "2", discountRate: "", fixedDiscountAmount: "", marketPrice: "",
};
function elementsFor(overrides = {}) {
  const all = { ...values, ...overrides };
  return Object.fromEntries([...PRICING_FIELD_IDS, "workerCount", "productiveHoursPerWorkerMonth", "unitsPerWorkerHour", "ncmCode", "taxRegime", "originState", "destinationState", "cfop", "taxSituation", "customerType", "operationPurpose"].map((id) => [id, { value: all[id] ?? "" }]));
}

test("interpreta número brasileiro e rejeita texto, infinito e notação", () => {
  assert.deepEqual(parseBrazilianNumber("1.234,56"), { status: "valid", value: 1234.56 });
  ["", "abc", "Infinity", "1e3"].forEach((value) => assert.notEqual(parseBrazilianNumber(value).status, "valid"));
});

test("mantém campos obrigatórios vazios, opcional nulo e texto inválido sem trocar o valor digitado", () => {
  const empty = elementsFor(Object.fromEntries(PRICING_FIELD_IDS.map((id) => [id, ""])));
  const validation = validatePricingForm(empty);
  assert.equal(validation.isValid, false);
  assert.equal(validation.errors.materialCost, "Informe o custo da matéria-prima.");
  assert.equal(validation.errors.marketPrice, undefined);
  const invalid = elementsFor({ materialCost: "abc" });
  assert.equal(validatePricingForm(invalid).errors.materialCost, "Informe um número válido, sem notação científica.");
  assert.equal(invalid.materialCost.value, "abc");
});

test("converte percentuais para frações e deixa mercado ausente como null", () => {
  const validation = validatePricingForm(elementsFor());
  assert.equal(validation.isValid, true);
  assert.equal(validation.inputs.wasteRate, 0.05);
  assert.equal(validation.inputs.desiredNetMargin, 0.2);
  assert.equal(validation.inputs.marketPrice, null);
  assert.equal(validation.inputs.insuranceCost, 0);
  assert.deepEqual(validation.emptyOptionalFields.sort(), ["discountRate", "fixedDiscountAmount", "insuranceCost", "marketPrice", "otherDirectExpenses"].sort());
});

test("bloqueia domínio matemático, negativos e capacidade incompleta", () => {
  assert.match(validatePricingForm(elementsFor({ wasteRate: "100" })).errors.wasteRate, /menor que 100%/);
  assert.match(validatePricingForm(elementsFor({ materialCost: "-1" })).errors.materialCost, /não pode ser negativo/);
  assert.match(validatePricingForm(elementsFor({ taxRate: "80", paymentFeeRate: "10", commissionRate: "10", desiredNetMargin: "0" })).errors.desiredNetMargin, /menor que 100%/);
  assert.match(validatePricingForm(elementsFor({ workerCount: "2" })).errors.productiveHoursPerWorkerMonth, /Complete a capacidade/);
});

test("HTML inicia vazio e expõe os novos campos sem desconto legado como custo", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const id of PRICING_FIELD_IDS) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /id="discountAmount"/);
  assert.match(html, /Carga tributária estimada/);
  assert.match(html, /Quantidade prevista de unidades por mês/);
});
