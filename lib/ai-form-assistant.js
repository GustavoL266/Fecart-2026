import { aiRequestSchema, AiAssistantError, validateAiExtraction } from "./ai-pricing-schema.js";
import { createOpenAiFormProvider } from "./openai-form-provider.js";

export function createAiFormProvider(config, dependencies) {
  if (!config.isConfigured || config.provider !== "openai") return null;
  return createOpenAiFormProvider(config, dependencies);
}

export async function parsePricingMessage({ provider, input }) {
  const parsed = aiRequestSchema.safeParse(input);
  if (!parsed.success) throw new AiAssistantError("INVALID_AI_REQUEST", 400);
  if (!provider) throw new AiAssistantError();
  try {
    const extraction = await provider.extract(parsed.data.message);
    return validateAiExtraction(extraction, parsed.data.message);
  } catch (error) {
    throw error instanceof AiAssistantError ? error : new AiAssistantError();
  }
}
