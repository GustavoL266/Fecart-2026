import { getAiAssistantConfig } from "../lib/config.js";
import { AI_OUTPUT_JSON_SCHEMA } from "../lib/ai-pricing-schema.js";
import { buildGeminiGenerateContentRequest } from "../lib/gemini-form-provider.js";

const prompt = "Quero vender bolo e quero margem de 10%";
const selectedStage = process.argv.slice(2).find((argument) => argument !== "--")?.trim() || "";
const config = getAiAssistantConfig();
const safeStatuses = new Set([
  "INVALID_ARGUMENT", "NOT_FOUND", "PERMISSION_DENIED", "RESOURCE_EXHAUSTED",
  "UNAUTHENTICATED", "UNAVAILABLE",
]);
const minimalSchema = {
  type: "object",
  additionalProperties: false,
  required: ["productName", "desiredNetMargin"],
  properties: {
    productName: { type: "string" },
    desiredNetMargin: { type: "number" },
  },
};

if (!config.isConfigured) {
  process.stderr.write(`${JSON.stringify({ code: "GEMINI_NOT_CONFIGURED", configurationErrors: config.configurationErrors })}\n`);
  process.exit(1);
}

const full = buildGeminiGenerateContentRequest(prompt);
const contents = full.contents;
const schemaWithMaxItems = structuredClone(AI_OUTPUT_JSON_SCHEMA);
schemaWithMaxItems.properties.entries.maxItems =
  AI_OUTPUT_JSON_SCHEMA.properties.entries.items.properties.field.enum.length;
const stages = [
  ["minimal-response-format", {
    contents,
    generationConfig: { responseFormat: { text: { mimeType: "application/json", schema: minimalSchema } } },
  }, false],
  ["minimal-response-json-schema", {
    contents,
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: minimalSchema },
  }, true],
  ["full-json-schema-with-max-items", {
    contents,
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: schemaWithMaxItems },
  }, false],
  ["full-json-schema", {
    contents,
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: AI_OUTPUT_JSON_SCHEMA },
  }, true],
  ["with-system-instruction", {
    systemInstruction: full.systemInstruction,
    contents,
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: AI_OUTPUT_JSON_SCHEMA },
  }, true],
  ["with-candidate-count", {
    systemInstruction: full.systemInstruction,
    contents,
    generationConfig: {
      candidateCount: full.generationConfig.candidateCount,
      responseMimeType: "application/json",
      responseJsonSchema: AI_OUTPUT_JSON_SCHEMA,
    },
  }, true],
  ["complete-provider-payload", full, true],
];

async function runStage(stage, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" },
      redirect: "error",
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    const upstreamErrorCode = Number.isInteger(payload?.error?.code) ? payload.error.code : null;
    const upstreamErrorStatus = typeof payload?.error?.status === "string" && safeStatuses.has(payload.error.status)
      ? payload.error.status
      : null;
    let structuredJson = false;
    const candidate = payload?.candidates?.[0];
    const responseParts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    if (response.ok) {
      const text = responseParts
        .filter((part) => part?.thought !== true && typeof part?.text === "string")
        .map((part) => part.text).join("");
      try { JSON.parse(text); structuredJson = true; } catch { structuredJson = false; }
    }
    process.stdout.write(`${JSON.stringify({
      stage,
      upstreamStatus: response.status,
      upstreamErrorCode,
      upstreamErrorStatus,
      structuredJson,
      candidateCount: Array.isArray(payload?.candidates) ? payload.candidates.length : null,
      finishReason: typeof candidate?.finishReason === "string" ? candidate.finishReason : null,
      contentRole: typeof candidate?.content?.role === "string" ? candidate.content.role : null,
      partCount: responseParts.length,
      thoughtPartCount: responseParts.filter((part) => part?.thought === true).length,
      textPartCount: responseParts.filter((part) => typeof part?.text === "string").length,
      functionCallPartCount: responseParts.filter((part) => Object.hasOwn(part || {}, "functionCall")).length,
    })}\n`);
    return response.ok && structuredJson;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      stage,
      upstreamStatus: null,
      upstreamErrorCode: null,
      upstreamErrorStatus: error?.name === "AbortError" ? "TIMEOUT" : "CONNECTION_ERROR",
      structuredJson: false,
    })}\n`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let failed = false;
for (const [stage, body, expectedOk] of stages) {
  if (selectedStage && stage !== selectedStage) continue;
  const ok = await runStage(stage, body);
  if (expectedOk !== null && ok !== expectedOk) failed = true;
}
process.exitCode = failed ? 1 : 0;
