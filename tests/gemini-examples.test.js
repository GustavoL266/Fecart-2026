import assert from "node:assert/strict";
import test from "node:test";
import { getAiAssistantConfig } from "../lib/config.js";
import { createAiFormProvider, parsePricingMessage } from "../lib/ai-form-assistant.js";
import { applyAssistantFields, PRICING_FIELD_IDS, CAPACITY_FIELD_IDS, validatePricingForm } from "../js/ui/form.js";
import { calculatePricing } from "../js/domain/pricing-calculator.js";

const directCosts = new Set(["materialCost", "packagingCost", "deliveryCost", "insuranceCost", "otherDirectExpenses"]);
const entry = (field, value, evidence) => ({
  field, value, source: "user_provided", evidence, basis: directCosts.has(field) ? "unit" : "not-applicable",
  certainty: "certain", batchUnits: null, batchEvidence: null, correctionEvidence: null,
});
const monthlyFields = new Set(["monthlyPayroll", "monthlyFixedCosts"]);
const estimatedEntry = (field, value) => ({
  field, value, source: "estimated", evidence: "",
  basis: monthlyFields.has(field) ? "monthly-total" : directCosts.has(field) ? "unit" : "not-applicable",
  certainty: "certain", batchUnits: null, batchEvidence: null, correctionEvidence: null,
});
const completeEstimates = ({ wasteRate = 5, packagingCost = 2 } = {}) => [
  estimatedEntry("wasteRate", wasteRate),
  estimatedEntry("packagingCost", packagingCost),
  estimatedEntry("deliveryCost", 0),
  estimatedEntry("insuranceCost", 0),
  estimatedEntry("otherDirectExpenses", 0),
  estimatedEntry("monthlyPayroll", 0),
  estimatedEntry("monthlyFixedCosts", 0),
  estimatedEntry("expectedMonthlyUnits", 1),
  estimatedEntry("taxRate", 0),
  estimatedEntry("paymentFeeRate", 0),
  estimatedEntry("commissionRate", 0),
  estimatedEntry("inventoryDays", 0),
  estimatedEntry("receivingDays", 0),
  estimatedEntry("paymentDays", 0),
  estimatedEntry("monthlyCapitalRate", 0),
  estimatedEntry("discountRate", 0),
  estimatedEntry("fixedDiscountAmount", 0),
];
const controls = () => Object.fromEntries([
  ...PRICING_FIELD_IDS, ...CAPACITY_FIELD_IDS, "productName", "productDescription",
].map((id) => [id, { value: "" }]));
const cases = [
  ["Quero vender bolo, meu custo de ingredientes por unidade é R$ 15 e quero margem de 10%", [
    entry("productName", "bolo", "Quero vender bolo"),
    entry("materialCost", 15, "custo de ingredientes por unidade é R$ 15"),
    entry("desiredNetMargin", 10, "margem de 10%"),
  ], { productName: "bolo", materialCost: 15, desiredNetMargin: 10 }],
  ["Faço brigadeiro. Ingredientes por unidade custam R$ 20, embalagem por unidade R$ 5 e quero margem de 30%.", [
    entry("productName", "brigadeiro", "Faço brigadeiro"),
    entry("materialCost", 20, "Ingredientes por unidade custam R$ 20"),
    entry("packagingCost", 5, "embalagem por unidade R$ 5"),
    entry("desiredNetMargin", 30, "margem de 30%"),
  ], { productName: "brigadeiro", materialCost: 20, packagingCost: 5, desiredNetMargin: 30 }],
  ["Quero mudar minha margem para 20%.", [entry("desiredNetMargin", 20, "margem para 20%")], { desiredNetMargin: 20 }],
];

for (const [message, entries, expected] of cases) {
  test(`Gemini: prévia parcial e aplicação preservam ausentes — ${message}`, async () => {
    // Simulate the provider response, then exercise the real adapter, schema and form.
    const provider = createAiFormProvider(getAiAssistantConfig({ GEMINI_API_KEY: "test-only-secret", AI_FILL_MODE: "partial" }), {
      fetchImpl: async (_url, options) => {
        assert.equal(JSON.parse(options.body).contents[0].parts[0].text, message);
        return Response.json({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: JSON.stringify({ entries }) }] } }] });
      },
    });
    const fields = Object.fromEntries([...PRICING_FIELD_IDS, ...CAPACITY_FIELD_IDS, "productName", "productDescription"].map(id => [id, { value: "" }]));
    fields.deliveryCost.value = "7";
    const result = await parsePricingMessage({ provider, input: { message } });
    assert.deepEqual(result.fields, expected);
    assert.deepEqual(result.pending, []);
    assert.equal(result.summary.length, Object.keys(expected).length);
    assert.equal(fields.materialCost.value, "");
    assert.equal(fields.desiredNetMargin.value, "");
    applyAssistantFields(result.fields, fields);
    assert.equal(fields.desiredNetMargin.value, String(expected.desiredNetMargin));
    assert.equal(fields.deliveryCost.value, "7");
    for (const id of ["monthlyPayroll", "expectedMonthlyUnits", "taxRate", "wasteRate"]) assert.equal(fields[id].value, "");
    assert.equal(validatePricingForm(fields).isValid, false);
  });
}

test("Gemini não inventa campos para frase incompleta e rejeita texto inválido antes da API", async () => {
  let calls = 0;
  const provider = createAiFormProvider(getAiAssistantConfig({ GEMINI_API_KEY: "test-only-secret", AI_FILL_MODE: "partial" }), {
    fetchImpl: async () => {
      calls += 1;
      return Response.json({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: '{"entries":[]}' }] } }] });
    },
  });
  await assert.rejects(() => parsePricingMessage({ provider, input: { message: "Quero vender, mas ainda não sei o quê." } }), { code: "AI_INSUFFICIENT_INFORMATION", status: 422 });
  assert.equal(calls, 1);
  for (const message of [null, 15, {}, "", "   ", "x".repeat(4001)]) {
    await assert.rejects(() => parsePricingMessage({ provider, input: { message } }), { code: "INVALID_AI_REQUEST", status: 400 });
  }
  assert.equal(calls, 1);
});

test("configuração antiga não habilita Gemini nem é usada como fallback", () => {
  const old = getAiAssistantConfig({ OPENAI_API_KEY: "test-only-unused" });
  assert.equal(old.isConfigured, false);
  assert.equal(old.apiKey, "");
  assert.equal(createAiFormProvider(old), null);
  const wrongModel = getAiAssistantConfig({ GEMINI_API_KEY: "test-only-secret", AI_MODEL: "gpt-4.1-mini" });
  assert.deepEqual(wrongModel.configurationErrors, ["AI_MODEL_INVALID"]);
  const wrongProvider = getAiAssistantConfig({ GEMINI_API_KEY: "test-only-secret", AI_PROVIDER: "openai" });
  assert.deepEqual(wrongProvider.configurationErrors, ["AI_PROVIDER_UNSUPPORTED"]);
});

test("modo complete resolve o bolo após 'por unidade', aplica tudo e produz preço sustentável", async () => {
  const message = "Quero vender um bolo, usei 15 reais para fazer e quero lucro de 10%";
  let calls = 0;
  const provider = {
    fillMode: "complete",
    extract: async (_message, clarification) => {
      calls += 1;
      if (!clarification) return { entries: [
        entry("productName", "bolo", "vender um bolo"),
        { ...entry("materialCost", 15, "usei 15 reais para fazer"), basis: "unknown" },
        entry("desiredNetMargin", 10, "lucro de 10%"),
        ...completeEstimates(),
      ] };
      assert.equal(_message, "por unidade");
      return { entries: [{ ...entry("materialCost", 15, "usei 15 reais para fazer"), basis: "unit" }] };
    },
  };
  const first = await parsePricingMessage({ provider, input: { message } });
  assert.equal(first.calculationReady, false);
  assert.deepEqual(first.pending.map(({ code, field }) => ({ code, field })), [
    { code: "AI_COST_BASIS_UNKNOWN", field: "materialCost" },
  ]);
  assert.equal(first.sources.packagingCost, "estimated");

  const result = await parsePricingMessage({ provider, input: {
    message: "por unidade",
    clarification: {
      context: message,
      previousAnalysis: {
        fields: first.fields,
        sources: first.sources,
        pending: first.pending.map(({ code, field }) => ({ code, field })),
        needsClarification: true,
      },
    },
  } });
  assert.equal(calls, 2);
  assert.equal(result.needsClarification, false);
  assert.equal(result.calculationReady, true);
  assert.equal(result.fields.materialCost, 15);
  assert.equal(result.fields.expectedMonthlyUnits, 1);
  assert.equal(result.sources.materialCost, "user_provided");
  assert.equal(result.sources.packagingCost, "estimated");

  const fields = controls();
  applyAssistantFields(result.fields, fields);
  const validation = validatePricingForm(fields);
  assert.equal(validation.isValid, true);
  assert.equal(calculatePricing(validation.inputs).technicalPrice > 0, true);
});

for (const scenario of [
  {
    name: "brigadeiros",
    message: "Faço brigadeiros, gasto R$ 40 por lote de 100 unidades e quero margem de 30%.",
    userEntries: [
      entry("productName", "brigadeiros", "Faço brigadeiros"),
      { ...entry("materialCost", 40, "gasto R$ 40 por lote de 100 unidades"), basis: "batch-total", batchUnits: 100, batchEvidence: "lote de 100 unidades" },
      entry("desiredNetMargin", 30, "margem de 30%"),
    ],
    estimates: { wasteRate: 5, packagingCost: 0.1 },
    expectedMaterial: 0.4,
  },
  {
    name: "camiseta",
    message: "Quero vender camiseta, pago R$ 25 por peça e quero margem de 20%.",
    userEntries: [
      entry("productName", "camiseta", "vender camiseta"),
      entry("materialCost", 25, "pago R$ 25 por peça"),
      entry("desiredNetMargin", 20, "margem de 20%"),
    ],
    estimates: { wasteRate: 0, packagingCost: 1 },
    expectedMaterial: 25,
  },
  {
    name: "marmita",
    message: "Quero vender marmita, gasto R$ 12 por unidade e quero margem de 25%.",
    userEntries: [
      entry("productName", "marmita", "vender marmita"),
      entry("materialCost", 12, "gasto R$ 12 por unidade"),
      entry("desiredNetMargin", 25, "margem de 25%"),
    ],
    estimates: { wasteRate: 5, packagingCost: 1.5 },
    expectedMaterial: 12,
  },
]) {
  test(`modo complete gera conjunto calculável e fontes coerentes — ${scenario.name}`, async () => {
    const provider = { fillMode: "complete", extract: async () => ({ entries: [
      ...scenario.userEntries,
      ...completeEstimates(scenario.estimates),
    ] }) };
    const result = await parsePricingMessage({ provider, input: { message: scenario.message } });
    assert.equal(result.calculationReady, true);
    assert.equal(result.needsClarification, false);
    assert.equal(result.fields.materialCost, scenario.expectedMaterial);
    assert.equal(result.sources.materialCost, "user_provided");
    assert.equal(result.sources.packagingCost, "estimated");
    const fields = controls();
    applyAssistantFields(result.fields, fields);
    const validation = validatePricingForm(fields);
    assert.equal(validation.isValid, true);
    assert.equal(Number.isFinite(calculatePricing(validation.inputs).technicalPrice), true);
  });
}
