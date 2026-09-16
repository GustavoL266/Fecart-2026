import { aiRequestSchema, AiAssistantError, finalizeAiPricingAnalysis, mergeAiClarification, normalizeAiExtraction, validateAiExtraction } from "./ai-pricing-schema.js";
import { createGeminiFormProvider } from "./gemini-form-provider.js";

export function createAiFormProvider(config, dependencies) {
  if (!config.isConfigured || config.provider !== "gemini") return null;
  return createGeminiFormProvider(config, dependencies);
}

function reportDiagnostic(callback, details) {
  try { callback?.(details); } catch { /* Diagnostics must never affect the request. */ }
}

function copySafeValidationMetadata(target, source) {
  for (const key of [
    "validationPath", "validationIssueType", "invalidField", "expectedType", "receivedType", "validationRule",
  ]) {
    if (typeof source?.[key] === "string") target[key] = source[key];
  }
  return target;
}

function validationDiagnostic(error, code) {
  return {
    validationSuccess: false,
    validationPath: error?.validationPath,
    validationIssueType: error?.validationIssueType,
    invalidField: error?.invalidField,
    expectedType: error?.expectedType,
    receivedType: error?.receivedType,
    validationRule: error?.validationRule,
    code,
  };
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
      reportDiagnostic(onDiagnostic, { upstreamStatus: 200, parseSuccess: true });
    } catch (error) {
      reportDiagnostic(onDiagnostic, { upstreamStatus: error?.upstreamStatus ?? null, parseSuccess: false });
      throw error;
    }

    const evidenceMessage = clarification
      ? `${clarification.context}\n\nEsclarecimento do usuário: ${parsed.data.message}`
      : parsed.data.message;
    const rateFields = ["taxRate", "paymentFeeRate", "commissionRate", "marketplaceFeeRate", "postSaleLossRate", "desiredNetMargin"];
    const previousRates = clarification ? Object.fromEntries(rateFields.flatMap((field) => (
      Object.hasOwn(clarification.previousAnalysis.fields, field) ? [[field, clarification.previousAnalysis.fields[field]]] : []
    ))) : {};
    const currentFieldRates = Object.fromEntries(rateFields.flatMap((field) => (
      Object.hasOwn(parsed.data.currentFields || {}, field) ? [[field, parsed.data.currentFields[field]]] : []
    )));
    const currentRates = { ...parsed.data.currentRates, ...currentFieldRates, ...previousRates };
    let validation;
    try {
      validation = validateAiExtraction(normalizeAiExtraction(extraction), evidenceMessage, currentRates, clarification ? {
        clarification: {
          answer: parsed.data.message,
          context: clarification.context,
          pendingFields: clarification.previousAnalysis.pending.map(({ field }) => field),
          pending: clarification.previousAnalysis.pending,
        },
      } : undefined);
    } catch (error) {
      reportDiagnostic(onDiagnostic, validationDiagnostic(
        error,
        error?.code === "AI_INVALID_RESPONSE" ? "GEMINI_INVALID_RESPONSE" : error?.code,
      ));
      throw error;
    }

    if (!clarification) {
      reportDiagnostic(onDiagnostic, { validationSuccess: true });
      return finalizeAiPricingAnalysis(validation, parsed.data.currentFields, provider.fillMode);
    }
    try {
      const merged = mergeAiClarification(clarification.previousAnalysis, validation, currentRates);
      reportDiagnostic(onDiagnostic, { mergeSuccess: true, validationSuccess: true });
      return finalizeAiPricingAnalysis(merged, parsed.data.currentFields, provider.fillMode);
    } catch (error) {
      reportDiagnostic(onDiagnostic, {
        mergeSuccess: error?.code === "AI_VALIDATION_FAILED",
        ...validationDiagnostic(error, error?.code),
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
