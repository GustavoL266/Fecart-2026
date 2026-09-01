import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { calculatePrice } from "../js/domain/pricing-calculator.js";
import { parseBrazilianNumber, PRICING_FIELD_IDS, validatePricingForm } from "../js/ui/form.js";

const validValues = {
  materialsCost: "12",
  waste: "8",
  packagingCost: "2",
  deliveryCost: "1,5",
  insuranceCost: "",
  discountAmount: "",
  otherExpenses: "",
  totalPayroll: "12600",
  workerCount: "6",
  outputPerWorkerHour: "12",
  monthlyFixedCosts: "16000",
  monthlyVolume: "4000",
  taxRate: "6",
  paymentFeeRate: "2,8",
  commissionRate: "0",
  margin: "18",
  competitorAverage: "32",
  receiveDays: "7",
  payDays: "14",
  capitalRate: "2,5",
};

function elementsFor(overrides = {}) {
  const values = { ...validValues, ...overrides };
  return Object.fromEntries(
    [
      ...PRICING_FIELD_IDS,
      "ncmCode",
      "taxRegime",
      "originState",
      "destinationState",
      "cfop",
      "taxSituation",
      "customerType",
      "operationPurpose",
    ].map((fieldId) => [fieldId, { value: values[fieldId] ?? "" }]),
  );
}

test("interpreta vírgula decimal e rejeita texto, infinito e notação não prevista", () => {
  assert.deepEqual(parseBrazilianNumber("10,5"), { status: "valid", value: 10.5 });
  assert.deepEqual(parseBrazilianNumber("1.234,56"), { status: "valid", value: 1234.56 });
  assert.equal(parseBrazilianNumber("").status, "empty");
  assert.equal(parseBrazilianNumber("abc").status, "invalid");
  assert.equal(parseBrazilianNumber("Infinity").status, "invalid");
  assert.equal(parseBrazilianNumber("1e3").status, "invalid");
});

test("formulário vazio permanece inválido sem transformar ausências em zero", () => {
  const emptyElements = elementsFor(Object.fromEntries(PRICING_FIELD_IDS.map((fieldId) => [fieldId, ""])));
  const validation = validatePricingForm(emptyElements);

  assert.equal(validation.isValid, false);
  assert.equal(validation.inputs, null);
  assert.equal(validation.errors.materialsCost, "Informe o custo dos insumos.");
  assert.equal(validation.errors.margin, "Informe a margem líquida desejada.");
  assert.equal(validation.errors.insuranceCost, undefined);
  assert.equal(validation.errors.discountAmount, undefined);
  assert.equal(validation.errors.otherExpenses, undefined);
});

test("mantém margem acima do limite no campo, informa o máximo e bloqueia o cálculo", () => {
  const elements = elementsFor({ margin: "90" });
  const validation = validatePricingForm(elements);

  assert.equal(elements.margin.value, "90");
  assert.equal(validation.isValid, false);
  assert.equal(validation.inputs, null);
  assert.equal(validation.errors.margin, "A margem máxima permitida é 60%.");
});

test("rejeita custo negativo e texto inválido sem corrigi-los", () => {
  const negativeElements = elementsFor({ materialsCost: "-100" });
  const negativeValidation = validatePricingForm(negativeElements);
  assert.equal(negativeElements.materialsCost.value, "-100");
  assert.equal(negativeValidation.errors.materialsCost, "O custo dos insumos não pode ser negativo.");
  assert.equal(negativeValidation.inputs, null);

  const textElements = elementsFor({ materialsCost: "abc" });
  const textValidation = validatePricingForm(textElements);
  assert.equal(textElements.materialsCost.value, "abc");
  assert.equal(textValidation.errors.materialsCost, "Informe um número válido.");
  assert.equal(textValidation.inputs, null);
});

test("campos opcionais vazios só viram zero no objeto validado", () => {
  const elements = elementsFor();
  const validation = validatePricingForm(elements);

  assert.equal(validation.isValid, true);
  assert.deepEqual(validation.emptyOptionalFields, ["insuranceCost", "discountAmount", "otherExpenses"]);
  assert.equal(elements.insuranceCost.value, "");
  assert.equal(validation.inputs.insuranceCost, 0);
  assert.equal(validation.inputs.discountAmount, 0);
  assert.equal(validation.inputs.otherExpenses, 0);
});

test("dados válidos preservam o resultado histórico da fórmula", () => {
  const validation = validatePricingForm(elementsFor());
  const result = calculatePrice(validation.inputs);

  assert.equal(validation.isValid, true);
  assert.equal(result.minimumPrice, 29.31);
  assert.equal(Number(result.actualMargin.toFixed(2)), 0.18);
});

test("soma de percentuais inviável é associada à margem antes da fórmula", () => {
  const validation = validatePricingForm(elementsFor({ taxRate: "40", paymentFeeRate: "20", commissionRate: "20", margin: "20" }));

  assert.equal(validation.isValid, false);
  assert.equal(validation.inputs, null);
  assert.equal(validation.errors.margin, "A soma de impostos, taxas, comissão e margem deve ser menor que 100%.");
});

test("HTML inicial não contém tipo de produto, presets nem values nos inputs manuais", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const pricingConfig = readFileSync(new URL("../js/config/pricing.js", import.meta.url), "utf8");
  const mainSource = readFileSync(new URL("../js/main.js", import.meta.url), "utf8");

  assert.doesNotMatch(html, /Tipo de produto|productType/);
  assert.doesNotMatch(pricingConfig, /CATEGORY_PRESETS|comestiveis|cosmeticos/);
  assert.doesNotMatch(mainSource, /applyCategoryPreset|productType|isAboveCompetitorLimit/);
  for (const fieldId of PRICING_FIELD_IDS) {
    const input = html.match(new RegExp(`<input[^>]*id="${fieldId}"[^>]*>`))?.[0];
    assert.ok(input, `Input ${fieldId} deve existir.`);
    assert.doesNotMatch(input, /\svalue=/, `Input ${fieldId} deve iniciar vazio.`);
  }
});

test("salvamento obtém a validação compartilhada antes de montar ou enviar o payload", () => {
  const mainSource = readFileSync(new URL("../js/main.js", import.meta.url), "utf8");
  const payloadFunction = mainSource.slice(
    mainSource.indexOf("function productPayloadFromCalculator"),
    mainSource.indexOf("async function saveProduct"),
  );
  const saveFunction = mainSource.slice(
    mainSource.indexOf("async function saveProduct"),
    mainSource.indexOf("async function loadProducts"),
  );

  assert.match(payloadFunction, /currentPricingValidation\(\)/);
  assert.match(payloadFunction, /if \(!validation\.isValid\)/);
  assert.match(payloadFunction, /throw new ApiError\("Corrija os campos indicados antes de salvar\./);
  assert.ok(saveFunction.indexOf("productPayloadFromCalculator()") < saveFunction.indexOf('api.post("/products"'));
});
