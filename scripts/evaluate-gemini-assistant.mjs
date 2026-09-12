import { getAiAssistantConfig } from "../lib/config.js";
import { validateAiExtraction } from "../lib/ai-pricing-schema.js";
import { createGeminiFormProvider, verifyGeminiModelAccess } from "../lib/gemini-form-provider.js";

// Fixed, non-personal prompts only. Output is intentionally limited to public
// validated fields and controlled pending codes; raw model data/evidence is never logged.
const cases = [
  { id: "bolo-minimal", message: "Quero vender bolo e quero margem de 10%", fields: { productName: "bolo", desiredNetMargin: 10 }, pending: [] },
  { id: "brigadeiros-lote", message: "Quero vender brigadeiros. Gasto R$ 40 em ingredientes para produzir 100 unidades, R$ 10 em embalagens e quero margem de 30%.", fields: { productName: "brigadeiros", materialCost: 0.4, packagingCost: 0.1, desiredNetMargin: 30 }, pending: [] },
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
];
const selectedIds = new Set(process.argv.slice(2).filter((argument) => argument !== "--"));
const selectedCases = selectedIds.size ? cases.filter(({ id }) => selectedIds.has(id)) : cases;
const sameObject = (actual, expected) => Object.keys(actual).length === Object.keys(expected).length
  && Object.entries(expected).every(([field, value]) => actual[field] === value);

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
    let extraction;
    try {
      extraction = await provider.extract(message);
      const result = validateAiExtraction(extraction, message);
      const pendingCodes = result.pending.map(({ code }) => code);
      const matchesExpected = !expected.error && sameObject(result.fields, expected.fields)
        && pendingCodes.length === expected.pending.length
        && expected.pending.every((code, index) => pendingCodes[index] === code);
      if (!matchesExpected) failed = true;
      process.stdout.write(`${JSON.stringify({
        id, upstreamStatus: 200, fields: result.fields,
        pendingCodes: result.pending.map(({ code, field }) => ({ code, field })),
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
          valueType: entry?.value === null ? "null" : typeof entry?.value,
          value: ["number", "string"].includes(typeof entry?.value) ? entry.value : null,
          basis: typeof entry?.basis === "string" ? entry.basis : null,
          certainty: typeof entry?.certainty === "string" ? entry.certainty : null,
          batchUnits: Number.isFinite(entry?.batchUnits) ? entry.batchUnits : null,
          hasBatchEvidence: typeof entry?.batchEvidence === "string" && entry.batchEvidence.length > 0,
          hasCorrectionEvidence: typeof entry?.correctionEvidence === "string" && entry.correctionEvidence.length > 0,
          evidenceIsLiteral: typeof entry?.evidence === "string" && canonical(message).includes(canonical(entry.evidence)),
          batchEvidenceIsLiteral: entry?.batchEvidence === null || (typeof entry?.batchEvidence === "string" && canonical(message).includes(canonical(entry.batchEvidence))),
          correctionEvidenceIsLiteral: entry?.correctionEvidence === null || (typeof entry?.correctionEvidence === "string" && canonical(message).includes(canonical(entry.correctionEvidence))),
          validation,
        };
      }) : undefined;
      process.stdout.write(`${JSON.stringify({
        id, upstreamStatus: extraction ? 200 : Number.isInteger(error?.upstreamStatus) ? error.upstreamStatus : null,
        code: typeof error?.code === "string" ? error.code : "AI_INTERNAL_ERROR",
        status: Number.isInteger(error?.status) ? error.status : 500,
        upstreamErrorCode: Number.isInteger(error?.upstreamErrorCode) ? error.upstreamErrorCode : null,
        upstreamErrorStatus: typeof error?.upstreamErrorStatus === "string" ? error.upstreamErrorStatus : null,
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
