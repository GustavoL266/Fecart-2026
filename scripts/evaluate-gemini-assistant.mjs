import { getAiAssistantConfig } from "../lib/config.js";
import { finalizeAiPricingAnalysis, validateAiExtraction } from "../lib/ai-pricing-schema.js";
import { createGeminiFormProvider, verifyGeminiModelAccess } from "../lib/gemini-form-provider.js";
import { parsePricingMessage } from "../lib/ai-form-assistant.js";
import { calculatePricing } from "../js/domain/pricing-calculator.js";
import { applyAssistantFields, CAPACITY_FIELD_IDS, PRICING_FIELD_IDS, validatePricingForm } from "../js/ui/form.js";

// Fixed, non-personal prompts only. Output is intentionally limited to public
// validated fields and controlled pending codes; raw model data/evidence is never logged.
const cases = [
  { id: "bolo-minimal", message: "Quero vender bolo e quero margem de 10%", fields: { productName: "bolo", desiredNetMargin: 10 }, pending: [] },
  { id: "brigadeiros-lote", message: "Faço brigadeiros, gasto R$ 40 por lote de 100 unidades e quero margem de 30%.", fields: { productName: "brigadeiros", materialCost: 0.4, desiredNetMargin: 30 }, pending: [], ready: true },
  { id: "camiseta-complete", message: "Quero vender camiseta, pago R$ 25 por peça e quero margem de 20%.", fields: { productName: "camiseta", materialCost: 25, desiredNetMargin: 20 }, pending: [], ready: true },
  { id: "marmita-complete", message: "Quero vender marmita, gasto R$ 12 por unidade e quero margem de 25%.", fields: { productName: "marmita", materialCost: 12, desiredNetMargin: 25 }, pending: [], ready: true },
  { id: "componentes", message: "Pago R$ 600 por um lote de 50 camisetas, mais R$ 150 de estampagem para as mesmas 50 peças, R$ 2 de embalagem por unidade e margem de 35%.", fields: { materialCost: 12, otherDirectExpenses: 3, packagingCost: 2, desiredNetMargin: 35 }, pending: [] },
  { id: "total-sem-quantidade", message: "Gastei R$ 350 em ingredientes e R$ 80 em embalagens. Quero margem de 30%.", fields: { desiredNetMargin: 30 }, pending: ["AI_COST_BASIS_UNKNOWN", "AI_COST_BASIS_UNKNOWN"] },
  { id: "misto", message: "Cada bolo usa R$ 18,50 de ingredientes e gasto R$ 50 de caixas para 100 bolos. Quero margem de 20%.", fields: { materialCost: 18.5, packagingCost: 0.5, desiredNetMargin: 20 }, pending: [] },
  { id: "por-extenso", message: "Produzo cinquenta sabonetes; gasto cento e vinte reais de insumos no lote e quero margem de trinta por cento.", fields: { productName: "sabonetes", materialCost: 2.4, desiredNetMargin: 30 }, pending: [] },
  { id: "correcao", message: "Gasto R$ 100 em ingredientes para 100 brigadeiros. Na verdade, corrigi: são R$ 120 para 150 brigadeiros. Margem 25%.", fields: { materialCost: 0.8, desiredNetMargin: 25 }, pending: [] },
  { id: "ambiguidade", message: "Minha margem deve ser 25% ou 30%, ainda não decidi.", fields: {}, pending: ["AI_AMBIGUOUS_VALUE"] },
  { id: "negativo", message: "O frete por unidade ficou R$ -5 e quero margem de 15%.", fields: { desiredNetMargin: 15 }, pending: ["AI_NEGATIVE_VALUE"] },
  {
    id: "venda-nao-custo", message: "Quero vender um lote de 100 canecas por R$ 2.000, mas não informei meus custos.",
    fields: { productName: "canecas" }, pending: [], acceptableErrors: ["AI_INSUFFICIENT_INFORMATION"],
  },
  {
    id: "clarification-unit",
    message: "Quero vender um bolo, usei 15 reais para fazer e quero lucro de 10%",
    clarification: "por unidade",
    initialPending: ["AI_COST_BASIS_UNKNOWN"],
    fields: { productName: "bolo", desiredNetMargin: 10, materialCost: 15 },
    pending: [], ready: true,
  },
];
const selectedIds = new Set(process.argv.slice(2).filter((argument) => argument !== "--"));
const selectedCases = selectedIds.size ? cases.filter(({ id }) => selectedIds.has(id)) : cases;
const includesExpected = (actual, expected) => Object.entries(expected).every(([field, value]) => actual[field] === value);
const simulatorCheck = (fields) => {
  const controls = Object.fromEntries([
    ...PRICING_FIELD_IDS, ...CAPACITY_FIELD_IDS, "productName", "productDescription",
  ].map((id) => [id, { value: "" }]));
  applyAssistantFields(fields, controls);
  const validation = validatePricingForm(controls);
  if (!validation.isValid) return { formValid: false, technicalPrice: null };
  return { formValid: true, technicalPrice: calculatePricing(validation.inputs).technicalPrice };
};

const config = getAiAssistantConfig();
if (!config.isConfigured) {
  process.stderr.write(`${JSON.stringify({ ok: false, code: "GEMINI_NOT_CONFIGURED", configurationErrors: config.configurationErrors })}\n`);
  process.exit(1);
}

let failed = false;
try {
  const access = await verifyGeminiModelAccess(config);
  process.stdout.write(`${JSON.stringify({ stage: "model-access", upstreamStatus: 200, model: access.model, generateContent: access.generateContent })}\n`);
  const provider = createGeminiFormProvider(config);
  for (const expected of selectedCases) {
    const { id, message } = expected;
    if (expected.clarification) {
      try {
        const first = await parsePricingMessage({ provider, input: { message } });
        const initialCodes = first.pending.map(({ code }) => code);
        const previousAnalysis = {
          fields: first.fields,
          sources: first.sources,
          pending: first.pending.map(({ code, field }) => ({ code, field })),
          needsClarification: first.needsClarification,
        };
        const result = await parsePricingMessage({ provider, input: {
          message: expected.clarification,
          clarification: { context: message, previousAnalysis },
        } });
        const simulator = simulatorCheck(result.fields);
        const pendingCodes = result.pending.map(({ code }) => code);
        const initialMatches = first.needsClarification === true
          && expected.initialPending.every((code) => initialCodes.includes(code));
        const matchesExpected = initialMatches && includesExpected(result.fields, expected.fields)
          && result.needsClarification === false && result.calculationReady === expected.ready
          && expected.pending.every((code) => pendingCodes.includes(code))
          && (!expected.ready || simulator.formValid);
        if (!matchesExpected) failed = true;
        process.stdout.write(`${JSON.stringify({
          id, upstreamStatus: 200, initialPendingCodes: initialCodes,
          fields: result.fields, pendingCodes: result.pending.map(({ code, field }) => ({ code, field })),
          sources: result.sources, needsClarification: result.needsClarification,
          calculationReady: result.calculationReady, ...simulator, matchesExpected,
        })}\n`);
      } catch (error) {
        failed = true;
        process.stdout.write(`${JSON.stringify({
          id, upstreamStatus: Number.isInteger(error?.upstreamStatus) ? error.upstreamStatus : null,
          code: typeof error?.code === "string" ? error.code : "AI_INTERNAL_ERROR",
          status: Number.isInteger(error?.status) ? error.status : 500,
          validationPath: typeof error?.validationPath === "string" ? error.validationPath : null,
          validationIssueType: typeof error?.validationIssueType === "string" ? error.validationIssueType : null,
          matchesExpected: false,
        })}\n`);
      }
      continue;
    }
    let extraction;
    try {
      extraction = await provider.extract(message);
      const result = finalizeAiPricingAnalysis(validateAiExtraction(extraction, message), {}, config.fillMode);
      const simulator = simulatorCheck(result.fields);
      const pendingCodes = result.pending.map(({ code }) => code);
      const matchesExpected = !expected.error && includesExpected(result.fields, expected.fields)
        && expected.pending.every((code) => pendingCodes.includes(code))
        && (expected.ready === undefined || result.calculationReady === expected.ready)
        && (!expected.ready || (result.needsClarification === false && simulator.formValid));
      if (!matchesExpected) failed = true;
      process.stdout.write(`${JSON.stringify({
        id, upstreamStatus: 200, fields: result.fields, sources: result.sources,
        pendingCodes: result.pending.map(({ code, field }) => ({ code, field })),
        calculationReady: result.calculationReady, ...simulator,
        matchesExpected,
      })}\n`);
    } catch (error) {
      const matchesExpected = error?.code === expected.error || expected.acceptableErrors?.includes(error?.code) === true;
      if (!matchesExpected) failed = true;
      const canonical = (value) => String(value ?? "").normalize("NFKC").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
      const safeEntries = Array.isArray(extraction?.entries) ? extraction.entries.map((entry) => {
        let validation = "ok";
        try { validateAiExtraction({ entries: [entry] }, message); } catch (entryError) { validation = entryError?.code || "AI_INTERNAL_ERROR"; }
        return {
          field: typeof entry?.field === "string" ? entry.field : null,
          source: typeof entry?.source === "string" ? entry.source : null,
          valueType: entry?.value === null ? "null" : typeof entry?.value,
          basis: typeof entry?.basis === "string" ? entry.basis : null,
          certainty: typeof entry?.certainty === "string" ? entry.certainty : null,
          batchUnits: Number.isFinite(entry?.batchUnits) ? entry.batchUnits : null,
          evidenceIsEmpty: entry?.evidence === "",
          evidenceIsLiteral: typeof entry?.evidence === "string" && canonical(message).includes(canonical(entry.evidence)),
          validation,
        };
      }) : undefined;
      process.stdout.write(`${JSON.stringify({
        id, upstreamStatus: extraction ? 200 : Number.isInteger(error?.upstreamStatus) ? error.upstreamStatus : null,
        code: typeof error?.code === "string" ? error.code : "AI_INTERNAL_ERROR",
        status: Number.isInteger(error?.status) ? error.status : 500,
        upstreamErrorCode: Number.isInteger(error?.upstreamErrorCode) ? error.upstreamErrorCode : null,
        upstreamErrorStatus: typeof error?.upstreamErrorStatus === "string" ? error.upstreamErrorStatus : null,
        validationPath: typeof error?.validationPath === "string" ? error.validationPath : null,
        validationIssueType: typeof error?.validationIssueType === "string" ? error.validationIssueType : null,
        matchesExpected,
        ...(!matchesExpected && safeEntries ? { safeEntries } : {}),
      })}\n`);
    }
  }
} catch (error) {
  failed = true;
  process.stderr.write(`${JSON.stringify({
    stage: "model-access", upstreamStatus: Number.isInteger(error?.upstreamStatus) ? error.upstreamStatus : null,
    code: typeof error?.code === "string" ? error.code : "AI_INTERNAL_ERROR",
    status: Number.isInteger(error?.status) ? error.status : 500,
  })}\n`);
}
process.exitCode = failed ? 1 : 0;
