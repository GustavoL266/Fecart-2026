import { getAiAssistantConfig } from "../lib/config.js";
import { parsePricingMessage } from "../lib/ai-form-assistant.js";
import { createGeminiFormProvider, verifyGeminiModelAccess } from "../lib/gemini-form-provider.js";

const config = getAiAssistantConfig();
const safeFailure = (error) => ({
  ok: false,
  code: typeof error?.code === "string" ? error.code : "AI_INTERNAL_ERROR",
  status: Number.isInteger(error?.status) ? error.status : 500,
  upstreamStatus: Number.isInteger(error?.upstreamStatus) ? error.upstreamStatus : null,
  ...(typeof error?.upstreamCode === "string" ? { upstreamCode: error.upstreamCode } : {}),
  ...(typeof error?.upstreamField === "string" ? { upstreamField: error.upstreamField } : {}),
});

if (!config.isConfigured) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: "GEMINI_NOT_CONFIGURED",
    configurationErrors: config.configurationErrors,
  }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  try {
    const access = await verifyGeminiModelAccess(config);
    const provider = createGeminiFormProvider(config);
    const result = await parsePricingMessage({
      provider,
      input: {
        message: "quero vender brigadeiros. gasto R$ 40 em ingredientes para produzir 100 unidades, R$ 10 em embalagens e quero margem de 30%.",
      },
    });
    const expected = { productName: "brigadeiros", materialCost: 0.4, packagingCost: 0.1, desiredNetMargin: 30 };
    const fieldsMatch = Object.keys(result.fields).length === Object.keys(expected).length
      && Object.entries(expected).every(([field, value]) => result.fields[field] === value);
    if (!fieldsMatch) {
      throw Object.assign(new Error("Resposta válida, mas diferente da regressão esperada."), { code: "GEMINI_INVALID_RESPONSE", status: 502 });
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      provider: "gemini",
      model: access.model,
      generateContent: access.generateContent,
      structuredOutput: "generationConfig.responseFormat.text",
      regression: "brigadeiros-batch",
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify(safeFailure(error), null, 2)}\n`);
    process.exitCode = 1;
  }
}
