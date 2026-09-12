import { aiRequestSchema, AiAssistantError, validateAiExtraction } from "./ai-pricing-schema.js";
import { createGeminiFormProvider } from "./gemini-form-provider.js";

export function createAiFormProvider(config, dependencies) {
  if (!config.isConfigured || config.provider !== "gemini") return null;
  return createGeminiFormProvider(config, dependencies);
}

export async function parsePricingMessage({ provider, input }) {
  const parsed = aiRequestSchema.safeParse(input);
  if (!parsed.success) throw new AiAssistantError("INVALID_AI_REQUEST", 400);
  if (!provider) throw new AiAssistantError("GEMINI_NOT_CONFIGURED", 503);
  try {
    const extraction = await provider.extract(parsed.data.message);
    return validateAiExtraction(extraction, parsed.data.message, parsed.data.currentRates);
  } catch (error) {
    if (error instanceof AiAssistantError && error.code === "AI_INVALID_RESPONSE") throw new AiAssistantError("GEMINI_INVALID_RESPONSE", 502);
    throw error instanceof AiAssistantError ? error : new AiAssistantError("AI_INTERNAL_ERROR", 500);
  }
}
