import { getAiAssistantConfig } from "../lib/config.js";
import { validateAiExtraction } from "../lib/ai-pricing-schema.js";
import { createGeminiFormProvider, verifyGeminiModelAccess } from "../lib/gemini-form-provider.js";

const config = getAiAssistantConfig();
let currentStage = "configuration";
const safeFailure = (error) => ({
  ok: false,
  stage: currentStage,
  code: typeof error?.code === "string" ? error.code : "AI_INTERNAL_ERROR",
  status: Number.isInteger(error?.status) ? error.status : 500,
  upstreamStatus: Number.isInteger(error?.upstreamStatus) ? error.upstreamStatus : null,
  ...(Number.isInteger(error?.upstreamErrorCode) ? { upstreamErrorCode: error.upstreamErrorCode } : {}),
  ...(typeof error?.upstreamErrorStatus === "string" ? { upstreamErrorStatus: error.upstreamErrorStatus } : {}),
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
    currentStage = "model-access";
    const access = await verifyGeminiModelAccess(config);
    const provider = createGeminiFormProvider(config);
    const regressions = [
      {
        name: "bolo-minimal",
        message: "Quero vender bolo e quero margem de 10%",
        expected: { productName: "bolo", desiredNetMargin: 10 },
      },
      {
        name: "brigadeiros-batch",
        message: "quero vender brigadeiros. gasto R$ 40 em ingredientes para produzir 100 unidades, R$ 10 em embalagens e quero margem de 30%.",
        expected: { productName: "brigadeiros", materialCost: 0.4, packagingCost: 0.1, desiredNetMargin: 30 },
      },
    ];
    for (const regression of regressions) {
      currentStage = `${regression.name}-provider`;
      const extraction = await provider.extract(regression.message);
      currentStage = `${regression.name}-backend-validation`;
      const result = validateAiExtraction(extraction, regression.message);
      currentStage = `${regression.name}-expected-fields`;
      const fieldsMatch = Object.keys(result.fields).length === Object.keys(regression.expected).length
        && Object.entries(regression.expected).every(([field, value]) => result.fields[field] === value);
      if (!fieldsMatch) {
        throw Object.assign(new Error("Resposta válida, mas diferente da regressão esperada."), { code: "GEMINI_INVALID_RESPONSE", status: 502 });
      }
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      provider: "gemini",
      model: access.model,
      generateContent: access.generateContent,
      structuredOutput: "generationConfig.responseMimeType+responseJsonSchema",
      regressions: regressions.map(({ name }) => name),
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify(safeFailure(error), null, 2)}\n`);
    process.exitCode = 1;
  }
}
