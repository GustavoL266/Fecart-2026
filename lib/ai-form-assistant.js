import { aiRequestSchema, AiAssistantError, mergeAiClarification, validateAiExtraction } from "./ai-pricing-schema.js";
import { createGeminiFormProvider } from "./gemini-form-provider.js";

export function createAiFormProvider(config, dependencies) {
  if (!config.isConfigured || config.provider !== "gemini") return null;
  return createGeminiFormProvider(config, dependencies);
}

function reportDiagnostic(callback, details) {
  try { callback?.(details); } catch { /* Diagnostics must never affect the request. */ }
}

function copySafeValidationMetadata(target, source) {
  if (typeof source?.validationPath === "string") target.validationPath = source.validationPath;
  if (typeof source?.validationIssueType === "string") target.validationIssueType = source.validationIssueType;
  return target;
}

export async function parsePricingMessage({ provider, input, onDiagnostic }) {
  const parsed = aiRequestSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const clarificationFailure = Boolean(input?.clarification) && issue?.path?.[0] === "clarification";
    const error = new AiAssistantError(clarificationFailure ? "AI_CLARIFICATION_MERGE_FAILED" : "INVALID_AI_REQUEST", clarificationFailure ? 422 : 400);
    error.validationPath = issue?.path?.join(".") || (clarificationFailure ? "clarification" : "request");
    error.validationIssueType = issue?.code || "invalid_request";
    throw error;
  }
  if (!provider) throw new AiAssistantError("GEMINI_NOT_CONFIGURED", 503);
  const clarification = parsed.data.clarification;
  try {
    let extraction;
    try {
      extraction = clarification
        ? await provider.extract(parsed.data.message, clarification)
        : await provider.extract(parsed.data.message);
      reportDiagnostic(onDiagnostic, { upstreamStatus: 200, responseParsed: true });
    } catch (error) {
      reportDiagnostic(onDiagnostic, { upstreamStatus: error?.upstreamStatus ?? null, responseParsed: false });
      throw error;
    }

    const evidenceMessage = clarification
      ? `${clarification.context}\n\nEsclarecimento do usuário: ${parsed.data.message}`
      : parsed.data.message;
    const rateFields = ["taxRate", "paymentFeeRate", "commissionRate", "desiredNetMargin"];
    const previousRates = clarification ? Object.fromEntries(rateFields.flatMap((field) => (
      Object.hasOwn(clarification.previousAnalysis.fields, field) ? [[field, clarification.previousAnalysis.fields[field]]] : []
    ))) : {};
    const currentRates = { ...parsed.data.currentRates, ...previousRates };
    let validation;
    try {
      validation = validateAiExtraction(extraction, evidenceMessage, currentRates, clarification ? {
        clarification: {
          answer: parsed.data.message,
          pendingFields: clarification.previousAnalysis.pending.map(({ field }) => field),
        },
      } : undefined);
    } catch (error) {
      reportDiagnostic(onDiagnostic, {
        validationSucceeded: false,
        validationPath: error?.validationPath,
        validationIssueType: error?.validationIssueType,
        code: error?.code === "AI_INVALID_RESPONSE" ? "GEMINI_INVALID_RESPONSE" : error?.code,
      });
      throw error;
    }

    if (!clarification) {
      reportDiagnostic(onDiagnostic, { validationSucceeded: true });
      return validation;
    }
    try {
      const merged = mergeAiClarification(clarification.previousAnalysis, validation, parsed.data.currentRates);
      reportDiagnostic(onDiagnostic, { mergeSucceeded: true, validationSucceeded: true });
      return merged;
    } catch (error) {
      reportDiagnostic(onDiagnostic, {
        mergeSucceeded: error?.code === "AI_VALIDATION_FAILED",
        validationSucceeded: false,
        validationPath: error?.validationPath,
        validationIssueType: error?.validationIssueType,
        code: error?.code,
      });
      throw error;
    }
  } catch (error) {
    if (error instanceof AiAssistantError && error.code === "AI_INVALID_RESPONSE") {
      const mapped = copySafeValidationMetadata(new AiAssistantError("GEMINI_INVALID_RESPONSE", 502), error);
      mapped.upstreamStatus = error.upstreamStatus ?? 200;
      throw mapped;
    }
    throw error instanceof AiAssistantError ? error : new AiAssistantError("AI_INTERNAL_ERROR", 500);
  }
}
