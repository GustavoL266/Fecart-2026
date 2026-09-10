import assert from "node:assert/strict";
import test from "node:test";
import { getAiAssistantConfig } from "../lib/config.js";
import { createAiFormProvider, parsePricingMessage } from "../lib/ai-form-assistant.js";
import { applyAssistantFields, PRICING_FIELD_IDS, CAPACITY_FIELD_IDS, validatePricingForm } from "../js/ui/form.js";

const entry = (field, value, evidence) => ({ field, value, evidence, batchUnits: null, batchEvidence: null });
const cases = [
  ["Quero vender bolo, gastei R$ 15 para fazer e quero margem de 10%", [
    entry("productName", "bolo", "Quero vender bolo"),
    entry("materialCost", 15, "gastei R$ 15 para fazer"),
    entry("desiredNetMargin", 10, "margem de 10%"),
  ], { productName: "bolo", materialCost: 15, desiredNetMargin: 10 }],
  ["Faço brigadeiro. Ingredientes custam R$ 20, embalagem R$ 5 e quero margem de 30%.", [
    entry("productName", "brigadeiro", "Faço brigadeiro"),
    entry("materialCost", 20, "Ingredientes custam R$ 20"),
    entry("packagingCost", 5, "embalagem R$ 5"),
    entry("desiredNetMargin", 30, "margem de 30%"),
  ], { productName: "brigadeiro", materialCost: 20, packagingCost: 5, desiredNetMargin: 30 }],
  ["Quero mudar minha margem para 20%.", [entry("desiredNetMargin", 20, "margem para 20%")], { desiredNetMargin: 20 }],
];

for (const [message, entries, expected] of cases) {
  test(`Gemini: prévia parcial e aplicação preservam ausentes — ${message}`, async () => {
    // Simulate the provider response, then exercise the real adapter, schema and form.
    const provider = createAiFormProvider(getAiAssistantConfig({ GEMINI_API_KEY: "test-only-secret" }), {
      fetchImpl: async (_url, options) => {
        assert.equal(JSON.parse(options.body).contents[0].parts[0].text, message);
        return Response.json({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: JSON.stringify({ entries }) }] } }] });
      },
    });
    const fields = Object.fromEntries([...PRICING_FIELD_IDS, ...CAPACITY_FIELD_IDS, "productName", "productDescription"].map(id => [id, { value: "" }]));
    fields.deliveryCost.value = "7";
    const result = await parsePricingMessage({ provider, input: { message } });
    assert.deepEqual(result.fields, expected);
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
  const provider = createAiFormProvider(getAiAssistantConfig({ GEMINI_API_KEY: "test-only-secret" }), {
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
