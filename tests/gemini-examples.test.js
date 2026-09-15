import assert from "node:assert/strict";
import test from "node:test";
import { getAiAssistantConfig } from "../lib/config.js";
import { createAiFormProvider, parsePricingMessage } from "../lib/ai-form-assistant.js";
import { applyAssistantFields, FORM_OPTION_FIELD_IDS, PRICING_FIELD_IDS, validatePricingForm } from "../js/ui/form.js";

const directCosts = new Set(["materialCost", "packagingCost", "otherVariableCost", "otherDirectExpenses"]);
const entry = (field, value, evidence) => ({
  field, value, source: "user_provided", evidence, basis: directCosts.has(field) ? "unit" : "not-applicable",
  certainty: "certain", batchUnits: null, batchEvidence: null, correctionEvidence: null,
});
const monthlyFields = new Set(["monthlyLaborCost", "monthlyFixedCosts"]);
const estimatedEntry = (field, value) => ({
  field, value, source: "estimated", evidence: "",
  basis: monthlyFields.has(field) ? "monthly-total" : directCosts.has(field) ? "unit" : "not-applicable",
  certainty: "certain", batchUnits: null, batchEvidence: null, correctionEvidence: null,
});
const completeEstimates = ({ wasteRate = 5, packagingCost = 2 } = {}) => [
  estimatedEntry("wasteRate", wasteRate),
  estimatedEntry("packagingCost", packagingCost),
  estimatedEntry("otherVariableCost", 0),
  estimatedEntry("otherDirectExpenses", 0),
];
const completeCurrentFields = (overrides = {}) => ({
  averageOrderFreight: 0, averageOrderUnits: 1, monthlyLaborCost: 0, monthlyProductiveHours: 160,
  productionTimeMinutes: 0, monthlyFixedCosts: 0, taxRate: 0, inventoryDays: 0, receivingDays: 0,
  paymentDays: 0, monthlyCapitalRate: 0, ...overrides,
});
const controls = () => Object.fromEntries([
  ...PRICING_FIELD_IDS, ...FORM_OPTION_FIELD_IDS, "productName", "productDescription",
].map((id) => [id, { value: ({ laborCostMode: "automatic", freightPayer: "company", allocationMethod: "quantity", capitalRateSource: "informed", discountType: "none" })[id] || "" }]));
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
    const fields = controls();
    fields.averageOrderFreight.value = "7";
    const result = await parsePricingMessage({ provider, input: { message } });
    assert.deepEqual(result.fields, expected);
    assert.deepEqual(result.pending, []);
    assert.equal(result.summary.length, Object.keys(expected).length);
    assert.equal(fields.materialCost.value, "");
    assert.equal(fields.desiredNetMargin.value, "");
    applyAssistantFields(result.fields, fields);
    assert.equal(fields.desiredNetMargin.value, String(expected.desiredNetMargin));
    assert.equal(fields.averageOrderFreight.value, "7");
    for (const id of ["monthlyLaborCost", "expectedMonthlyUnits", "taxRate", "wasteRate"]) assert.equal(fields[id].value, "");
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

test("modo complete resolve o bolo após 'são por unidade' sem exigir que a resposta repita o valor", async () => {
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
      assert.equal(_message, "são por unidade");
      return { entries: [{ ...entry("materialCost", 15, "são por unidade"), basis: "unit" }] };
    },
  };
  const first = await parsePricingMessage({ provider, input: { message, currentFields: completeCurrentFields() } });
  assert.equal(first.calculationReady, false);
  assert.deepEqual(first.pending.map(({ code, field }) => ({ code, field })), [
    { code: "AI_COST_BASIS_UNKNOWN", field: "materialCost" },
    { code: "AI_REQUIRED_FIELD_MISSING", field: "expectedMonthlyUnits" },
  ]);
  assert.equal(first.sources.packagingCost, "estimated");

  const result = await parsePricingMessage({ provider, input: {
    message: "são por unidade",
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
  assert.equal(result.needsClarification, true);
  assert.equal(result.calculationReady, false);
  assert.equal(result.fields.materialCost, 15);
  assert.equal("expectedMonthlyUnits" in result.fields, false);
  assert.equal(result.sources.materialCost, "user_provided");
  assert.equal(result.sources.packagingCost, "estimated");

  const fields = controls();
  applyAssistantFields(result.fields, fields);
  const validation = validatePricingForm(fields);
  assert.equal(validation.isValid, false);
});

test("modo complete resolve '15 reais de um lote de 3' usando o contexto e preserva estimativas", async () => {
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
        ...completeEstimates({ wasteRate: 5, packagingCost: 1 }),
      ] };
      assert.equal(_message, "15 reais de um lote de 3");
      assert.equal(clarification.context, message);
      return { entries: [{
        ...entry("materialCost", 15, "15 reais"),
        basis: "batch-total", batchUnits: 3, batchEvidence: "3",
      }] };
    },
  };
  const first = await parsePricingMessage({ provider, input: { message, currentFields: completeCurrentFields() } });
  const result = await parsePricingMessage({ provider, input: {
    message: "15 reais de um lote de 3",
    clarification: {
      context: message,
      previousAnalysis: {
        fields: first.fields,
        sources: first.sources,
        pending: first.pending.map(({ code, field }) => ({ code, field })),
        needsClarification: first.needsClarification,
      },
    },
  } });
  assert.equal(calls, 2);
  assert.equal(result.fields.productName, "bolo");
  assert.equal(result.fields.desiredNetMargin, 10);
  assert.equal(result.fields.materialCost, 5);
  assert.equal(result.fields.packagingCost, 1);
  assert.equal(result.sources.packagingCost, "estimated");
  assert.equal(result.sources.materialCost, "user_provided");
  assert.deepEqual(result.pending.map(({ code, field }) => ({ code, field })), [
    { code: "AI_REQUIRED_FIELD_MISSING", field: "expectedMonthlyUnits" },
  ]);
  assert.equal(result.needsClarification, true);
  assert.equal(result.calculationReady, false);
});

for (const answer of ["10", "é 10", "é de 10", "10 por mês", "produzo 10 mensalmente", "É DE 10"]) {
  test(`quantidade mensal pendente usa a pergunta controlada para interpretar '${answer}'`, async () => {
    const message = "Quero vender bolo, meu custo de ingredientes por unidade é R$ 15 e quero margem de 10%";
    let calls = 0;
    const provider = {
      fillMode: "complete",
      extract: async (_message, clarification) => {
        calls += 1;
        if (!clarification) return { entries: [
          entry("productName", "bolo", "vender bolo"),
          entry("materialCost", 15, "custo de ingredientes por unidade é R$ 15"),
          entry("desiredNetMargin", 10, "margem de 10%"),
          ...completeEstimates(),
        ] };
        assert.equal(_message, answer);
        assert.deepEqual(clarification.previousAnalysis.pending, [
          { code: "AI_REQUIRED_FIELD_MISSING", field: "expectedMonthlyUnits" },
        ]);
        return { entries: [entry("expectedMonthlyUnits", 10, answer)] };
      },
    };
    const first = await parsePricingMessage({ provider, input: { message, currentFields: completeCurrentFields() } });
    assert.deepEqual(first.pending.map(({ code, field }) => ({ code, field })), [
      { code: "AI_REQUIRED_FIELD_MISSING", field: "expectedMonthlyUnits" },
    ]);

    const result = await parsePricingMessage({ provider, input: {
      message: answer,
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
    assert.equal(result.fields.expectedMonthlyUnits, 10);
    assert.equal(result.fields.productName, "bolo");
    assert.equal(result.fields.materialCost, 15);
    assert.equal(result.fields.desiredNetMargin, 10);
    assert.equal(result.sources.expectedMonthlyUnits, "user_provided");
    assert.deepEqual(result.pending, []);
    assert.equal(result.needsClarification, false);
    assert.equal(result.calculationReady, true);
    const fields = controls();
    applyAssistantFields(result.fields, fields);
    assert.equal(validatePricingForm(fields).isValid, true);
  });
}

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
  test(`modo complete preserva fontes e mantém escala mensal ausente — ${scenario.name}`, async () => {
    const provider = { fillMode: "complete", extract: async () => ({ entries: [
      ...scenario.userEntries,
      ...completeEstimates(scenario.estimates),
    ] }) };
    const result = await parsePricingMessage({ provider, input: { message: scenario.message, currentFields: completeCurrentFields() } });
    assert.equal(result.calculationReady, false);
    assert.equal(result.needsClarification, true);
    assert.equal(result.pending.some(({ code, field }) => code === "AI_REQUIRED_FIELD_MISSING" && field === "expectedMonthlyUnits"), true);
    assert.equal(result.fields.materialCost, scenario.expectedMaterial);
    assert.equal(result.sources.materialCost, "user_provided");
    assert.equal(result.sources.packagingCost, "estimated");
    const fields = controls();
    applyAssistantFields(result.fields, fields);
    const validation = validatePricingForm(fields);
    assert.equal(validation.isValid, false);
  });
}
