import { z } from "zod";
import { validatePricingInputs } from "../js/domain/pricing-calculator.js";

export class AiAssistantError extends Error {
  constructor(code = "AI_UNAVAILABLE", status = 503) {
    const messages = {
      AI_UNAVAILABLE: "O assistente está temporariamente indisponível. Você ainda pode preencher os dados manualmente.",
      GEMINI_UNAVAILABLE: "A Gemini está temporariamente indisponível. Você ainda pode preencher os dados manualmente.",
      GEMINI_INVALID_RESPONSE: "Não foi possível validar a resposta da Gemini. Nenhum campo foi alterado. Tente novamente.",
      GEMINI_NOT_CONFIGURED: "O assistente ainda não está configurado neste ambiente. Você pode preencher os dados manualmente.",
      GEMINI_UNAUTHORIZED: "Não foi possível autenticar o assistente no provedor de IA. A configuração precisa ser revisada pelo responsável pelo site.",
      GEMINI_FORBIDDEN: "O provedor de IA não autorizou esta operação. O responsável pelo site precisa revisar o acesso da integração.",
      GEMINI_MODEL_UNAVAILABLE: "O modelo de IA configurado não está disponível para esta integração. Avise o responsável pelo site.",
      GEMINI_BAD_REQUEST: "O provedor recusou a configuração da análise. Avise o responsável pelo site.",
      GEMINI_QUOTA_EXCEEDED: "O limite de uso ou de créditos da integração de IA foi atingido. Avise o responsável pelo site.",
      GEMINI_RATE_LIMITED: "O provedor de IA está limitando as análises. Aguarde um pouco e tente novamente.",
      GEMINI_TIMEOUT: "A análise demorou mais que o esperado. Tente novamente em alguns instantes.",
      GEMINI_CONNECTION_ERROR: "Não foi possível conectar ao provedor de IA. Tente novamente em alguns instantes.",
      AI_INTERNAL_ERROR: "Não foi possível concluir a análise devido a uma falha interna. Você pode preencher os dados manualmente.",
      AI_INVALID_RESPONSE: "Não foi possível validar a resposta do assistente. Tente informar os dados novamente.",
      AI_CLARIFICATION_MERGE_FAILED: "Não foi possível combinar o esclarecimento com a análise anterior. A prévia anterior foi preservada.",
      AI_VALIDATION_FAILED: "O resultado combinado do esclarecimento não passou pela validação. A prévia anterior foi preservada.",
      AI_INSUFFICIENT_INFORMATION: "Não consegui identificar informações suficientes. Tente informar custos, margem ou dados do produto.",
      INVALID_AI_REQUEST: "Informe uma mensagem com até 4000 caracteres.",
    };
    super(messages[code] || messages.AI_UNAVAILABLE);
    this.name = "AiAssistantError";
    this.code = code;
    this.status = status;
  }
}

const money = z.number().finite().min(0).max(1_000_000_000);
const percentage = z.number().finite().min(0).lt(100);
const count = z.number().finite().min(0).max(1_000_000_000);
const days = z.number().finite().min(0).max(3650);
const text = (max) => z.string().trim().min(1).max(max).refine((value) => !/[\u0000-\u001f<>]/u.test(value));
const states = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

// These are existing form IDs. Rates cross the API as displayed percentages (25).
// Never add a calculated price or a confirmed NCM to this allowlist.
export const AI_FIELD_RULES = Object.freeze({
  productName: { schema: text(160), label: "Produto", kind: "text" },
  productDescription: { schema: text(2000), label: "Descrição", kind: "text", hint: /descri[cç][aã]o|detalhes?/i },
  materialCost: { schema: money, label: "Matéria-prima por unidade", kind: "money", hint: /mat[eé]ria|insumos?|ingredientes?|compr(?:a|ar)|camisetas?|canecas?|cust(?:o|a|ou)|gast(?:o|ei)|pag(?:o|uei)/i, batch: true, aggregate: true },
  wasteRate: { schema: percentage, label: "Perda e desperdício", kind: "percent", hint: /perdas?|desperd[ií]cio/i },
  packagingCost: { schema: money, label: "Embalagem por unidade", kind: "money", hint: /embalag|embalo|caixas?|sacolas?|potes?|frascos?|recipientes?/i, batch: true, aggregate: true },
  deliveryCost: { schema: money, label: "Frete e entrega por unidade", kind: "money", hint: /frete|entrega|transporte/i, batch: true, aggregate: true },
  insuranceCost: { schema: money, label: "Seguro por unidade", kind: "money", hint: /seguro/i, batch: true, aggregate: true },
  otherDirectExpenses: { schema: money, label: "Outras despesas diretas por unidade", kind: "money", hint: /despesas? diretas?|outros? (?:custos?|gastos?)|estamp(?:a|agem)|impress[aã]o|etiquet(?:a|agem)|energia/i, batch: true, aggregate: true },
  monthlyPayroll: { schema: money, label: "Folha salarial mensal", kind: "money", hint: /folha|sal[aá]rios?|salaria[ls]|remunera[cç]/i, monthly: true, aggregate: true },
  monthlyFixedCosts: { schema: money, label: "Custos fixos mensais", kind: "money", hint: /fix[oa]s?|mensal|energia/i, monthly: true, aggregate: true },
  workerCount: { schema: count.int().max(1_000_000), label: "Funcionários", kind: "number", hint: /funcion[aá]rios?|trabalhador|pessoas?|colaboradores?/i },
  productiveHoursPerWorkerMonth: { schema: count.max(744), label: "Horas produtivas por funcionário/mês", kind: "number", hint: /horas?/i },
  unitsPerWorkerHour: { schema: count, label: "Unidades por funcionário/hora", kind: "number", hint: /hora/i },
  expectedMonthlyUnits: { schema: count.positive(), label: "Quantidade mensal prevista", kind: "number", hint: /m[eê]s|mensal|mensais/i },
  taxRate: { schema: percentage, label: "Carga tributária estimada manualmente", kind: "percent", hint: /carga tribut[aá]ria|tributos? totais?|impostos? totais?|taxa total de impostos/i },
  paymentFeeRate: { schema: percentage, label: "Taxa de pagamento", kind: "percent", hint: /pagamento|cart[aã]o|maquininha|gateway/i },
  commissionRate: { schema: percentage, label: "Comissão", kind: "percent", hint: /comiss[aã]o/i },
  desiredNetMargin: { schema: percentage, label: "Margem líquida desejada", kind: "percent", hint: /margem|lucr(?:o|ar)|ganh(?:o|ar)/i },
  inventoryDays: { schema: days, label: "Prazo de estoque/produção", kind: "days", hint: /estoque|produ[cç][aã]o/i },
  receivingDays: { schema: days, label: "Prazo de recebimento", kind: "days", hint: /receb/i },
  paymentDays: { schema: days, label: "Prazo de pagamento", kind: "days", hint: /pagamento|pag[oa]r?|fornecedor/i },
  monthlyCapitalRate: { schema: percentage, label: "Custo do capital ao mês", kind: "percent", hint: /capital|juros/i },
  discountRate: { schema: percentage, label: "Desconto percentual", kind: "percent", hint: /desconto/i },
  fixedDiscountAmount: { schema: money, label: "Desconto fixo", kind: "money", hint: /desconto/i },
  marketPrice: { schema: money.positive(), label: "Preço de mercado informado", kind: "money", hint: /concorr[eê]ncia|concorrentes?|pre[cç]o de mercado|m[eé]dia do mercado/i },
  marketQuery: { schema: text(160), label: "Consulta de Mercado", kind: "text" },
  cfop: { schema: z.string().regex(/^[1-7]\d{3}$/), label: "CFOP informado", kind: "text", hint: /cfop/i },
  taxSituation: { schema: z.string().regex(/^\d{2,4}$/), label: "CST/CSOSN informado", kind: "text", hint: /cst|csosn/i },
  taxRegime: { schema: z.enum(["simples-nacional", "lucro-presumido", "lucro-real", "mei", "outro"]), label: "Regime tributário", kind: "enum", options: { "simples-nacional": "Simples Nacional", "lucro-presumido": "Lucro Presumido", "lucro-real": "Lucro Real", mei: "MEI", outro: "Outro" } },
  customerType: { schema: z.enum(["contribuinte", "nao-contribuinte", "consumidor-final"]), label: "Tipo de cliente", kind: "enum", options: { contribuinte: "Contribuinte", "nao-contribuinte": "Não contribuinte", "consumidor-final": "Consumidor final" } },
  operationPurpose: { schema: z.enum(["venda", "revenda", "industrializacao", "consumo", "ativo", "outra"]), label: "Finalidade da operação", kind: "enum", options: { venda: "Venda", revenda: "Revenda", industrializacao: "Industrialização", consumo: "Consumo", ativo: "Ativo", outra: "Outra" } },
  productOrigin: { schema: z.enum(["nacional", "importado"]), label: "Origem do produto", kind: "enum", options: { nacional: "Nacional", importado: "Importado" } },
  originState: { schema: z.enum(states), label: "UF de origem", kind: "text", hint: /origem|sai de|de /i },
  destinationState: { schema: z.enum(states), label: "UF de destino", kind: "text", hint: /destino|para /i },
  countryOfOrigin: { schema: text(80), label: "País de origem", kind: "text", hint: /pa[ií]s|origem|importado|de /i },
});

export const AI_COST_BASES = Object.freeze(["unit", "batch-total", "monthly-total", "not-applicable", "unknown"]);
export const AI_CERTAINTIES = Object.freeze(["certain", "ambiguous-value", "include-uncertain", "meaning-uncertain"]);
export const AI_VALUE_SOURCES = Object.freeze(["user_provided", "inferred", "estimated"]);
export const AI_REQUIRED_PRICING_FIELDS = Object.freeze([
  "materialCost", "wasteRate", "packagingCost", "deliveryCost",
  "monthlyPayroll", "monthlyFixedCosts", "expectedMonthlyUnits",
  "taxRate", "paymentFeeRate", "commissionRate", "desiredNetMargin",
  "inventoryDays", "receivingDays", "paymentDays", "monthlyCapitalRate",
]);
export const AI_COMPLETE_CONTEXT_FIELDS = Object.freeze([
  "productName", "productDescription", ...AI_REQUIRED_PRICING_FIELDS,
  "insuranceCost", "otherDirectExpenses", "discountRate", "fixedDiscountAmount",
]);
export const AI_PENDING_CODES = Object.freeze([
  "AI_COST_BASIS_UNKNOWN", "AI_BATCH_UNITS_REQUIRED", "AI_BATCH_UNITS_INVALID",
  "AI_NEGATIVE_VALUE", "AI_VALUE_OUT_OF_RANGE", "AI_AMBIGUOUS_VALUE",
  "AI_CONFIRM_FIELD", "AI_MEANING_UNCERTAIN", "AI_RATE_SUM_INVALID", "AI_REQUIRED_FIELD_MISSING",
]);
export const AI_MAX_EXTRACTION_ENTRIES = 100;

const currentRatesSchema = z.object({
  taxRate: percentage.nullable().optional(),
  paymentFeeRate: percentage.nullable().optional(),
  commissionRate: percentage.nullable().optional(),
  desiredNetMargin: percentage.nullable().optional(),
}).strict();

export const aiFieldsSchema = z.object(Object.fromEntries(Object.entries(AI_FIELD_RULES).map(([key, rule]) => [key, rule.schema.nullable().optional()]))).strict();
const resolvedAiFieldsSchema = z.object(Object.fromEntries(Object.entries(AI_FIELD_RULES).map(([key, rule]) => [key, rule.schema.optional()]))).strict();
const aiSourcesSchema = z.object(Object.fromEntries(Object.keys(AI_FIELD_RULES).map((key) => [key, z.enum(AI_VALUE_SOURCES).optional()]))).strict();
const currentFieldsSchema = z.object(Object.fromEntries(AI_COMPLETE_CONTEXT_FIELDS.map((key) => [key, AI_FIELD_RULES[key].schema.optional()]))).strict();
const pendingReferenceSchema = z.object({
  code: z.enum(AI_PENDING_CODES),
  field: z.enum(Object.keys(AI_FIELD_RULES)),
}).strict();
export const aiPreviousAnalysisSchema = z.object({
  fields: resolvedAiFieldsSchema,
  sources: aiSourcesSchema,
  pending: z.array(pendingReferenceSchema).min(1).max(AI_MAX_EXTRACTION_ENTRIES),
  needsClarification: z.literal(true),
}).strict().superRefine((analysis, context) => {
  const seen = new Set();
  for (const field of Object.keys(analysis.fields)) {
    if (!analysis.sources[field]) context.addIssue({ code: z.ZodIssueCode.custom, path: ["sources", field], message: "source_required" });
  }
  for (const field of Object.keys(analysis.sources)) {
    if (!Object.hasOwn(analysis.fields, field)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["sources", field], message: "source_without_field" });
  }
  for (const item of analysis.pending) {
    const key = `${item.code}:${item.field}`;
    if (seen.has(key)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["pending"], message: "duplicate_pending" });
    seen.add(key);
    if (Object.hasOwn(analysis.fields, item.field)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", item.field], message: "pending_field_already_resolved" });
    }
  }
});
const clarificationContextSchema = z.object({
  context: z.string().trim().min(1).max(4000),
  previousAnalysis: aiPreviousAnalysisSchema,
}).strict();
export const aiRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  currentRates: currentRatesSchema.optional(),
  currentFields: currentFieldsSchema.optional(),
  clarification: clarificationContextSchema.optional(),
}).strict().superRefine((request, context) => {
  if (!request.clarification) return;
  const combined = `${request.clarification.context}\n\nEsclarecimento do usuário: ${request.message}`;
  if (combined.length > 4000) {
    context.addIssue({ code: z.ZodIssueCode.too_big, maximum: 4000, inclusive: true, type: "string", path: ["clarification", "context"] });
  }
});

const extractionEntry = z.object({
  field: z.enum(Object.keys(AI_FIELD_RULES)),
  value: z.union([z.string().max(2000), z.number().finite(), z.null()]),
  source: z.enum(AI_VALUE_SOURCES),
  evidence: z.string().max(4000),
  basis: z.enum(AI_COST_BASES),
  certainty: z.enum(AI_CERTAINTIES),
  batchUnits: z.number().finite().int().min(-1_000_000_000).max(1_000_000_000).nullable(),
  batchEvidence: z.string().max(4000).nullable(),
  correctionEvidence: z.string().max(4000).nullable(),
}).strict();
export const aiExtractionSchema = z.object({ entries: z.array(extractionEntry).max(AI_MAX_EXTRACTION_ENTRIES) }).strict();

export function buildAiOutputJsonSchema(allowedFields = Object.keys(AI_FIELD_RULES)) {
  const fields = [...new Set(allowedFields)].filter((field) => Object.hasOwn(AI_FIELD_RULES, field));
  if (!fields.length) throw new AiAssistantError("AI_CLARIFICATION_MERGE_FAILED", 422);
  return {
    type: "object", additionalProperties: false, required: ["entries"], properties: {
      // Gemini rejects the combination of maxItems=35 and the 35-value field enum
      // as too complex. The strict Zod schema below still enforces a finite limit.
      entries: { type: "array", items: {
        type: "object", additionalProperties: false,
        required: ["field", "value", "source", "evidence", "basis", "certainty", "batchUnits", "batchEvidence", "correctionEvidence"],
        properties: {
          field: { type: "string", enum: fields },
          value: { type: ["number", "string", "null"] },
          source: { type: "string", enum: AI_VALUE_SOURCES },
          evidence: { type: "string" },
          basis: { type: "string", enum: AI_COST_BASES },
          certainty: { type: "string", enum: AI_CERTAINTIES },
          batchUnits: { type: ["integer", "null"] },
          batchEvidence: { type: ["string", "null"] },
          correctionEvidence: { type: ["string", "null"] },
        },
      } },
    },
  };
}

export const AI_OUTPUT_JSON_SCHEMA = buildAiOutputJsonSchema();

function normalized(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[-\s]+/g, " ").trim();
}

function containsText(source, value) {
  return normalized(source).includes(normalized(value));
}

function containsLiteralEvidence(message, evidence) {
  const canonical = (value) => String(value).normalize("NFKC").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
  const excerpt = canonical(evidence);
  return excerpt.length > 0 && canonical(message).includes(excerpt);
}

const writtenSmall = Object.freeze({
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16,
  dezassete: 17, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40,
  cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
});
const writtenHundreds = Object.freeze({
  cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300,
  quatrocentos: 400, quatrocentas: 400, quinhentos: 500, quinhentas: 500, seiscentos: 600,
  seiscentas: 600, setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800,
  novecentos: 900, novecentas: 900,
});
const writtenScales = Object.freeze({ mil: 1_000, milhao: 1_000_000, milhoes: 1_000_000, bilhao: 1_000_000_000, bilhoes: 1_000_000_000 });
const writtenNumberWords = new Set([...Object.keys(writtenSmall), ...Object.keys(writtenHundreds), ...Object.keys(writtenScales), "e", "menos", "virgula"]);

function parseWrittenInteger(tokens) {
  let total = 0;
  let group = 0;
  let found = false;
  for (const token of tokens) {
    if (token === "e") continue;
    if (Object.hasOwn(writtenSmall, token)) { group += writtenSmall[token]; found = true; continue; }
    if (Object.hasOwn(writtenHundreds, token)) { group += writtenHundreds[token]; found = true; continue; }
    if (Object.hasOwn(writtenScales, token)) {
      const scale = writtenScales[token];
      total += (group || 1) * scale;
      group = 0;
      found = true;
      continue;
    }
    return null;
  }
  return found ? total + group : null;
}

function parseWrittenNumber(tokens) {
  const words = [...tokens];
  const negative = words[0] === "menos";
  if (negative) words.shift();
  const comma = words.indexOf("virgula");
  const integer = parseWrittenInteger(comma < 0 ? words : words.slice(0, comma));
  if (integer === null) return null;
  if (comma < 0) return negative ? -integer : integer;
  const decimalWords = words.slice(comma + 1).filter((word) => word !== "e");
  if (!decimalWords.length) return null;
  const singleDigits = decimalWords.every((word) => Object.hasOwn(writtenSmall, word) && writtenSmall[word] < 10);
  const decimalText = singleDigits
    ? decimalWords.map((word) => writtenSmall[word]).join("")
    : String(parseWrittenInteger(words.slice(comma + 1)) ?? "");
  if (!decimalText) return null;
  const result = integer + Number(`0.${decimalText}`);
  return negative ? -result : result;
}

function writtenNumberCandidates(source) {
  const words = normalized(source).match(/[a-z]+/g) || [];
  const candidates = [];
  let run = [];
  const flush = () => {
    while (run.at(-1) === "e") run.pop();
    const parsed = parseWrittenNumber(run);
    if (parsed !== null && Number.isFinite(parsed)) candidates.push(parsed);
    run = [];
  };
  for (const word of words) {
    if (writtenNumberWords.has(word) && !(word === "e" && run.length === 0)) run.push(word);
    else flush();
  }
  flush();
  return candidates;
}

function containsNumber(evidence, value) {
  const digitNumbers = (evidence.match(/[+-]?\d+(?:[.,]\d+)*/g) || []).map((token) => token.includes(",")
    ? Number(token.replace(/\./g, "").replace(",", "."))
    : /^\d{1,3}(\.\d{3})+$/.test(token) ? Number(token.replace(/\./g, "")) : Number(token));
  return [...digitNumbers, ...writtenNumberCandidates(evidence)]
    .some((number) => Number.isFinite(number) && Math.abs(number - value) < 1e-9);
}

function isDiscountRemoval(evidence) {
  return /(?:retir\w*|remov\w*|zer\w*|sem|cancel\w*|exclu\w*)\s+(?:o\s+|os\s+|qualquer\s+)?descontos?/i.test(evidence);
}

function hasCorrectionLanguage(evidence) {
  return /na verdade|corrig\w*|esque[cç]\w*|quis dizer|alter\w* para|troc\w* para/i.test(evidence);
}

function isOpenMaterialEvidence(evidence) {
  const source = normalized(evidence);
  if (!/(?:r\$|reais?|cust\w*|gast\w*|pag\w*|compr\w*)/i.test(source)
    || /\b(?:vend\w*|preco de venda|cobr\w*|receita|fatur\w*|lucro|margem)\b/i.test(source)) return false;
  const competingFields = [
    "packagingCost", "deliveryCost", "insuranceCost", "otherDirectExpenses",
    "monthlyPayroll", "monthlyFixedCosts", "fixedDiscountAmount", "marketPrice",
  ];
  if (competingFields.some((field) => AI_FIELD_RULES[field].hint?.test(evidence))) return false;
  const description = source
    .replace(/[+-]?\d+(?:[.,]\d+)*/g, " ")
    .replace(/\b(?:r|reais?|centavos?|cust\w*|gast\w*|pag\w*|compr\w*|por|para|de|do|da|em|um|uma)\b/g, " ");
  return /\b[a-z]{3,}\b/.test(description);
}

function evidenceMatchesField(field, evidence) {
  return AI_FIELD_RULES[field].hint?.test(evidence) || (field === "materialCost" && isOpenMaterialEvidence(evidence));
}

function validateGrounding(entry, message) {
  const rule = AI_FIELD_RULES[entry.field];
  if (entry.source === "estimated") {
    return entry.certainty === "certain" && entry.value !== null && entry.evidence === ""
      && entry.correctionEvidence === null && rule.kind !== "text" && rule.kind !== "enum";
  }
  if (!containsLiteralEvidence(message, entry.evidence)) return false;
  if (entry.correctionEvidence !== null
    && (!containsLiteralEvidence(message, entry.correctionEvidence) || !hasCorrectionLanguage(entry.correctionEvidence))) return false;
  if (rule.hint && !evidenceMatchesField(entry.field, entry.evidence) && entry.certainty !== "meaning-uncertain") {
    if (entry.correctionEvidence === null) return false;
    // A compact correction can contain only the replacement numbers (for
    // example "na verdade, R$ 120 para 150"). Require that its preceding
    // context explicitly established the same field instead of rejecting a
    // grounded correction or accepting a field invented from nowhere.
    const correctionIndex = normalized(message).indexOf(normalized(entry.correctionEvidence));
    if (correctionIndex < 0 || !evidenceMatchesField(entry.field, normalized(message).slice(0, correctionIndex))) return false;
  }
  if (typeof entry.value === "number" && entry.source === "user_provided") {
    const removingDiscount = ["discountRate", "fixedDiscountAmount"].includes(entry.field)
      && entry.value === 0 && isDiscountRemoval(entry.evidence);
    if (!removingDiscount && !containsNumber(entry.evidence, entry.value)) return false;
    if (rule.kind === "percent" && !removingDiscount && !/%|por\s*cento|percentua[li]/i.test(entry.evidence)) return false;
    if (entry.field === "taxRate" && /(?:icms|ipi|pis|cofins|difal|ibs|cbs)\s*(?:de|:|=)?\s*(?:[\d.,]+|[a-zá-ú\s]+)\s*(?:%|por\s*cento)/i.test(entry.evidence)) return false;
  } else if (entry.value !== null && rule.kind === "enum" && entry.source === "user_provided") {
    if (!containsText(entry.evidence, rule.options[entry.value])) return false;
    if (entry.field === "customerType" && entry.value === "contribuinte" && /n[aã]o\s+contribuinte/i.test(entry.evidence)) return false;
  } else if (entry.value !== null && entry.source === "user_provided" && !containsText(entry.evidence, entry.value)) return false;
  if (entry.field === "marketQuery" && !/pesquis|procur|busqu|busca|consult/i.test(message)) return false;
  return true;
}

function isExplicitUnitCost(entry, message, clarification) {
  if (entry.source === "estimated") return true;
  if (entry.source === "inferred" && entry.value === 0 && /\b(?:sem|gr[aá]tis|inclu[ií]d[oa]|retirada)\b/i.test(entry.evidence)) return true;
  const explicitMarker = /\b(?:cada|por\s+(?:uma?\s+)?unidade|unit[aá]ri[oa]|por\s+(?:pe[cç]a|item|produto|venda))\b/i;
  const clarificationFields = new Set(clarification?.pendingFields || []);
  if (clarificationFields.size === 1 && clarificationFields.has(entry.field)
    && explicitMarker.test(clarification?.answer || "")) return true;
  if (explicitMarker.test(entry.evidence)) return true;
  const source = normalized(message);
  const excerpt = normalized(entry.evidence);
  const index = source.indexOf(excerpt);
  const prefix = index < 0 ? "" : source.slice(Math.max(0, index - 140), index);
  const localContext = prefix.split(/[,;.]|\be\s+(?:gast\w*|pag\w*|cust\w*|compr\w*)\b|\bmais\b/i).at(-1) || "";
  return explicitMarker.test(localContext)
    || /\b(?:coloque|adicione|defina|ajuste|mude|troque|altere)\b/i.test(message)
    || /\bagora\s+cust(?:a|ou)\b/i.test(entry.evidence);
}

function hasBatchContext(evidence) {
  if (/unidades?|pe[cç]as?|por[cç][oõ]es?|lote|rende|produz|produzir|produ[cç][aã]o|fabric\w*|faz(?:er|endo)?|s[aã]o\s+/i.test(evidence)) return true;
  // Product names are open-ended. Accept an explicit numeric count followed by
  // a counted noun, while excluding common monetary/rate/time units that are
  // not production quantities.
  const excludedUnit = /\b(?:reais?|centavos?|por\s*cento|percento|dias?|horas?|meses?)\b/iu;
  return /\b\d+(?:[.,]\d+)?\s+(?!(?:reais?|centavos?|por\s*cento|percento|dias?|horas?|meses?)\b)[\p{L}][\p{L}-]*/iu.test(evidence)
    || (writtenNumberCandidates(evidence).length > 0 && !excludedUnit.test(evidence));
}

const pendingSubjects = Object.freeze({
  materialCost: "O custo de matéria-prima", packagingCost: "O custo de embalagem",
  deliveryCost: "O frete ou transporte", insuranceCost: "O seguro",
  otherDirectExpenses: "O custo direto adicional", monthlyPayroll: "A folha salarial mensal",
  monthlyFixedCosts: "O custo fixo mensal", desiredNetMargin: "A margem líquida desejada",
});

function pendingMessage(code, field) {
  const label = AI_FIELD_RULES[field]?.label || "O valor informado";
  const subject = pendingSubjects[field] || label;
  const messages = {
    AI_COST_BASIS_UNKNOWN: `${subject} é por unidade ou pelo lote? Se for pelo lote, quantas unidades ele produz?`,
    AI_BATCH_UNITS_REQUIRED: `Quantas unidades o lote referente a ${label.toLocaleLowerCase("pt-BR")} produz?`,
    AI_BATCH_UNITS_INVALID: "A quantidade produzida deve ser maior que zero.",
    AI_NEGATIVE_VALUE: `${subject} não pode ser negativo. Confira o valor informado.`,
    AI_VALUE_OUT_OF_RANGE: `${label} está fora dos limites aceitos pelo simulador. Confira o valor informado.`,
    AI_AMBIGUOUS_VALUE: `Qual valor deseja usar para ${label.toLocaleLowerCase("pt-BR")}?`,
    AI_CONFIRM_FIELD: `Deseja incluir ${label.toLocaleLowerCase("pt-BR")} no preenchimento?`,
    AI_MEANING_UNCERTAIN: "O valor informado representa custo de produção ou preço de venda?",
    AI_RATE_SUM_INVALID: "A soma de tributos, taxas, comissão e margem deve ser menor que 100%.",
    AI_REQUIRED_FIELD_MISSING: `Não foi possível estimar ${label.toLocaleLowerCase("pt-BR")} com segurança. Informe esse valor.`,
  };
  return messages[code];
}

const numberFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 8 });
const normalMoneyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const smallMoneyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 12 });

function stableNumber(value) {
  return Number(value.toPrecision(15));
}

function formatMoney(value) {
  return value > 0 && value < 0.005 ? smallMoneyFormatter.format(value) : normalMoneyFormatter.format(value);
}

function formatSummaryValue(field, value, group) {
  const rule = AI_FIELD_RULES[field];
  if (rule.kind !== "money") {
    return rule.kind === "percent" ? `${numberFormatter.format(value)}%`
      : rule.kind === "days" ? `${numberFormatter.format(value)} dias`
        : rule.kind === "number" ? numberFormatter.format(value)
          : rule.options?.[value] || value;
  }
  const formatted = formatMoney(value);
  if (!group?.components?.length) return formatted;
  const components = group.components;
  if (components.length === 1 && components[0].basis === "batch-total") {
    const component = components[0];
    return `${formatted} (${formatMoney(component.rawValue)} ÷ ${numberFormatter.format(component.batchUnits)} unidades)`;
  }
  if (components.length === 1) return components[0].corrected ? `${formatted} (valor corrigido)` : formatted;
  const details = components.slice(0, 8).map((component) => component.basis === "batch-total"
    ? `${formatMoney(component.rawValue)} ÷ ${numberFormatter.format(component.batchUnits)}`
    : component.basis === "monthly-total" ? `${formatMoney(component.rawValue)} por mês` : `${formatMoney(component.rawValue)} por unidade`);
  if (components.length > details.length) details.push(`mais ${components.length - details.length} componente(s)`);
  return `${formatted}\nComponentes: ${details.join("; ")}`;
}

function validationFailure(code, status, path, issueType) {
  const error = new AiAssistantError(code, status);
  error.validationPath = path || "analysis";
  error.validationIssueType = issueType || "invalid";
  return error;
}

const sourcePriority = Object.freeze({ user_provided: 0, inferred: 1, estimated: 2 });

function combineSource(current, next) {
  if (!current) return next;
  return sourcePriority[next] > sourcePriority[current] ? next : current;
}

function estimatedValueIsReasonable(field, value, fields) {
  const materialCost = typeof fields.materialCost === "number" ? fields.materialCost : 0;
  const maximums = {
    wasteRate: 30,
    packagingCost: Math.max(100, materialCost * 2),
    deliveryCost: Math.max(200, materialCost * 3),
    insuranceCost: Math.max(100, materialCost),
    otherDirectExpenses: Math.max(500, materialCost * 5),
    monthlyPayroll: 10_000_000,
    monthlyFixedCosts: 10_000_000,
    expectedMonthlyUnits: 1_000_000,
    taxRate: 35,
    paymentFeeRate: 15,
    commissionRate: 40,
    desiredNetMargin: 60,
    inventoryDays: 365,
    receivingDays: 365,
    paymentDays: 365,
    monthlyCapitalRate: 20,
    discountRate: 50,
    fixedDiscountAmount: Math.max(500, materialCost * 5),
  };
  return !Object.hasOwn(maximums, field) || value <= maximums[field];
}

export function validateAiExtraction(raw, message, currentRates = {}, options = {}) {
  const parsed = aiExtractionSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw validationFailure("AI_INVALID_RESPONSE", 502, issue?.path?.join(".") || "entries", issue?.code || "invalid_schema");
  }
  const groups = new Map();
  const blockedFields = new Set();
  const pending = [];
  const pendingKeys = new Set();
  const addPending = (code, field) => {
    const key = `${code}:${field || ""}`;
    if (pendingKeys.has(key)) return;
    pendingKeys.add(key);
    pending.push({ code, field, message: pendingMessage(code, field) });
    if (field) blockedFields.add(field);
  };

  for (const entry of parsed.data.entries) {
    const rule = AI_FIELD_RULES[entry.field];
    if (entry.value === null && entry.certainty === "certain") continue;
    if (!validateGrounding(entry, message)) {
      throw validationFailure("AI_INVALID_RESPONSE", 502, `entries.${entry.field}.evidence`, `invalid_${entry.source}_grounding`);
    }

    if (entry.certainty !== "certain") {
      const code = entry.certainty === "ambiguous-value" ? "AI_AMBIGUOUS_VALUE"
        : entry.certainty === "include-uncertain" ? "AI_CONFIRM_FIELD" : "AI_MEANING_UNCERTAIN";
      addPending(code, entry.field);
      if (entry.certainty === "include-uncertain" && entry.basis === "unknown") addPending("AI_COST_BASIS_UNKNOWN", entry.field);
      continue;
    }
    if (entry.value === null) continue;

    // Classify recognized-but-invalid numeric values as field-level pending
    // before checking cost basis, so a negative or impossible amount never
    // produces the less useful "unit or batch?" question.
    const checked = rule.schema.safeParse(entry.value);
    if (!checked.success) {
      if (typeof entry.value !== "number") throw new AiAssistantError("AI_INVALID_RESPONSE", 502);
      addPending(entry.value < 0 ? "AI_NEGATIVE_VALUE" : "AI_VALUE_OUT_OF_RANGE", entry.field);
      continue;
    }
    const basis = rule.batch && entry.basis === "unknown" && isExplicitUnitCost(entry, message, options.clarification)
      ? "unit" : entry.basis;

    if (rule.batch) {
      if (!["unit", "batch-total", "unknown"].includes(basis)) throw new AiAssistantError("AI_INVALID_RESPONSE", 502);
      if (basis === "unknown") { addPending("AI_COST_BASIS_UNKNOWN", entry.field); continue; }
      if (basis === "unit") {
        if (entry.batchUnits !== null || entry.batchEvidence !== null) throw new AiAssistantError("AI_INVALID_RESPONSE", 502);
        if (!isExplicitUnitCost(entry, message, options.clarification)) { addPending("AI_COST_BASIS_UNKNOWN", entry.field); continue; }
      }
      if (basis === "batch-total") {
        if (entry.batchUnits === null) { addPending("AI_BATCH_UNITS_REQUIRED", entry.field); continue; }
        if (entry.batchUnits <= 0) { addPending("AI_BATCH_UNITS_INVALID", entry.field); continue; }
        if (!entry.batchEvidence || !containsLiteralEvidence(message, entry.batchEvidence)
          || !containsNumber(entry.batchEvidence, entry.batchUnits) || !hasBatchContext(entry.batchEvidence)) {
          throw new AiAssistantError("AI_INVALID_RESPONSE", 502);
        }
      }
    } else if (rule.monthly) {
      if (basis !== "monthly-total" || entry.batchUnits !== null || entry.batchEvidence !== null) throw new AiAssistantError("AI_INVALID_RESPONSE", 502);
    } else if (basis !== "not-applicable" || entry.batchUnits !== null || entry.batchEvidence !== null) {
      throw new AiAssistantError("AI_INVALID_RESPONSE", 502);
    }

    const normalizedValue = basis === "batch-total"
      ? stableNumber(checked.data / entry.batchUnits) : checked.data;
    const component = {
      rawValue: checked.data,
      normalizedValue,
      basis,
      batchUnits: entry.batchUnits,
      corrected: entry.correctionEvidence !== null,
    };
    const current = groups.get(entry.field);
    if (!current || entry.correctionEvidence !== null) {
      groups.set(entry.field, { value: normalizedValue, source: entry.source, components: [component] });
    } else if (rule.aggregate) {
      current.value = stableNumber(current.value + normalizedValue);
      current.source = combineSource(current.source, entry.source);
      current.components.push(component);
    } else if (current.value !== normalizedValue) {
      addPending("AI_AMBIGUOUS_VALUE", entry.field);
    }
  }

  for (const [field, group] of groups) {
    if (!AI_FIELD_RULES[field].schema.safeParse(group.value).success) addPending("AI_VALUE_OUT_OF_RANGE", field);
  }
  for (const field of blockedFields) groups.delete(field);
  const fields = Object.fromEntries([...groups].map(([field, group]) => [field, group.value]));
  const sources = Object.fromEntries([...groups].map(([field, group]) => [field, group.source]));
  for (const [field, source] of Object.entries(sources)) {
    if (source === "estimated" && !estimatedValueIsReasonable(field, fields[field], fields)) {
      delete fields[field];
      delete sources[field];
      groups.delete(field);
      addPending("AI_VALUE_OUT_OF_RANGE", field);
    }
  }
  const discountRemoval = parsed.data.entries.some((entry) => ["discountRate", "fixedDiscountAmount"].includes(entry.field)
    && entry.value === 0 && entry.certainty === "certain" && isDiscountRemoval(entry.evidence));
  if (discountRemoval) {
    fields.discountRate = 0;
    fields.fixedDiscountAmount = 0;
    sources.discountRate = "user_provided";
    sources.fixedDiscountAmount = "user_provided";
  }
  if ((fields.discountRate || 0) > 0 && (fields.fixedDiscountAmount || 0) > 0) {
    delete fields.discountRate;
    delete fields.fixedDiscountAmount;
    delete sources.discountRate;
    delete sources.fixedDiscountAmount;
    addPending("AI_AMBIGUOUS_VALUE", "discountRate");
  }

  const rateFields = ["taxRate", "paymentFeeRate", "commissionRate", "desiredNetMargin"];
  const extractedRateFields = rateFields.filter((field) => Object.hasOwn(fields, field));
  const combinedRates = Object.fromEntries(rateFields.map((field) => [field, fields[field] ?? currentRates?.[field] ?? 0]));
  if (extractedRateFields.length && rateFields.reduce((sum, field) => sum + combinedRates[field], 0) >= 100) {
    extractedRateFields.forEach((field) => { delete fields[field]; delete sources[field]; groups.delete(field); });
    addPending("AI_RATE_SUM_INVALID", "desiredNetMargin");
  }

  const parsedFields = aiFieldsSchema.safeParse(fields);
  if (!parsedFields.success) {
    const issue = parsedFields.error.issues[0];
    throw validationFailure("AI_INVALID_RESPONSE", 502, issue?.path?.join(".") || "fields", issue?.code || "invalid_fields");
  }
  if (!Object.keys(fields).length && !pending.length) throw new AiAssistantError("AI_INSUFFICIENT_INFORMATION", 422);
  const summary = Object.entries(fields).map(([field, value]) => ({
    field,
    label: AI_FIELD_RULES[field].label,
    value: formatSummaryValue(field, value, groups.get(field)),
    source: sources[field],
  }));
  return { fields, sources, summary, pending, needsClarification: pending.length > 0 };
}

export function mergeAiClarification(previousAnalysis, clarificationResult, currentRates = {}) {
  const previous = aiPreviousAnalysisSchema.safeParse(previousAnalysis);
  if (!previous.success) {
    const issue = previous.error.issues[0];
    throw validationFailure("AI_CLARIFICATION_MERGE_FAILED", 422, issue?.path?.join(".") || "previousAnalysis", issue?.code || "invalid_previous_analysis");
  }
  const allowedFields = new Set(previous.data.pending.map(({ field }) => field));
  const returnedFields = Object.keys(clarificationResult?.fields || {});
  const returnedPending = Array.isArray(clarificationResult?.pending) ? clarificationResult.pending : [];
  if ([...returnedFields, ...returnedPending.map(({ field }) => field)].some((field) => !allowedFields.has(field))) {
    throw validationFailure("AI_CLARIFICATION_MERGE_FAILED", 422, "clarification.fields", "field_not_pending");
  }

  const addressedFields = new Set([...returnedFields, ...returnedPending.map(({ field }) => field)]);
  const pending = [
    ...previous.data.pending.filter(({ field }) => !addressedFields.has(field)).map(({ code, field }) => ({ code, field, message: pendingMessage(code, field) })),
    ...returnedPending,
  ];
  const fields = { ...previous.data.fields, ...clarificationResult.fields };
  const sources = { ...previous.data.sources, ...clarificationResult.sources };
  for (const item of pending) delete fields[item.field];
  for (const item of pending) delete sources[item.field];

  const parsedFields = resolvedAiFieldsSchema.safeParse(fields);
  if (!parsedFields.success) {
    const issue = parsedFields.error.issues[0];
    throw validationFailure("AI_VALIDATION_FAILED", 422, issue?.path?.join(".") || "fields", issue?.code || "invalid_fields");
  }
  if ((fields.discountRate || 0) > 0 && (fields.fixedDiscountAmount || 0) > 0) {
    throw validationFailure("AI_VALIDATION_FAILED", 422, "fields.discountRate", "conflicting_discount");
  }
  const rateFields = ["taxRate", "paymentFeeRate", "commissionRate", "desiredNetMargin"];
  const rateTotal = rateFields.reduce((sum, field) => sum + (fields[field] ?? currentRates?.[field] ?? 0), 0);
  if (rateTotal >= 100) {
    throw validationFailure("AI_VALIDATION_FAILED", 422, "fields.desiredNetMargin", "invalid_rate_sum");
  }

  const clarifiedSummary = new Map((clarificationResult.summary || []).map((item) => [item.field, item]));
  const summary = Object.entries(fields).map(([field, value]) => clarifiedSummary.get(field) || ({
    field,
    label: AI_FIELD_RULES[field].label,
    value: formatSummaryValue(field, value),
    source: sources[field],
  }));
  return { fields, sources, summary, pending, needsClarification: pending.length > 0 };
}

function domainValidationForAssistantFields(fields) {
  const percentageFields = new Set([
    "wasteRate", "taxRate", "paymentFeeRate", "commissionRate", "desiredNetMargin",
    "monthlyCapitalRate", "discountRate",
  ]);
  const input = {};
  for (const field of AI_REQUIRED_PRICING_FIELDS) {
    if (Object.hasOwn(fields, field)) input[field] = percentageFields.has(field) ? fields[field] / 100 : fields[field];
  }
  for (const field of ["insuranceCost", "otherDirectExpenses", "discountRate", "fixedDiscountAmount", "marketPrice"]) {
    if (Object.hasOwn(fields, field)) input[field] = percentageFields.has(field) ? fields[field] / 100 : fields[field];
  }
  input.productionCapacity = null;
  input.fiscalContext = {};
  return validatePricingInputs(input);
}

/** Merge safe current form values and verify the exact canonical calculator contract. */
export function finalizeAiPricingAnalysis(analysis, currentFields = {}, fillMode = "partial") {
  const parsedCurrent = currentFieldsSchema.safeParse(currentFields || {});
  if (!parsedCurrent.success) {
    const issue = parsedCurrent.error.issues[0];
    throw validationFailure("INVALID_AI_REQUEST", 400, issue?.path?.join(".") || "currentFields", issue?.code || "invalid_current_fields");
  }
  const fields = { ...analysis.fields };
  const sources = { ...analysis.sources };
  let pending = [...analysis.pending];

  for (const [field, value] of Object.entries(parsedCurrent.data)) {
    if (!Object.hasOwn(fields, field) || sources[field] === "estimated") {
      fields[field] = value;
      sources[field] = "user_provided";
      pending = pending.filter((item) => item.field !== field);
    }
  }

  let calculationReady = false;
  if (fillMode === "complete") {
    const pendingFields = new Set(pending.map(({ field }) => field));
    for (const field of AI_REQUIRED_PRICING_FIELDS) {
      if (!Object.hasOwn(fields, field) && !pendingFields.has(field)) {
        pending.push({ code: "AI_REQUIRED_FIELD_MISSING", field, message: pendingMessage("AI_REQUIRED_FIELD_MISSING", field) });
        pendingFields.add(field);
      }
    }
    if (!AI_REQUIRED_PRICING_FIELDS.some((field) => !Object.hasOwn(fields, field))) {
      const domainValidation = domainValidationForAssistantFields(fields);
      if (domainValidation.isValid) calculationReady = true;
      else {
        for (const field of Object.keys(domainValidation.errors)) {
          const target = field === "desiredNetMargin" ? "desiredNetMargin" : field;
          if (!Object.hasOwn(AI_FIELD_RULES, target) || pendingFields.has(target)) continue;
          const code = field === "desiredNetMargin" ? "AI_RATE_SUM_INVALID" : "AI_VALUE_OUT_OF_RANGE";
          pending.push({ code, field: target, message: pendingMessage(code, target) });
          pendingFields.add(target);
          delete fields[target];
          delete sources[target];
        }
      }
    }
  }

  const previousSummary = new Map((analysis.summary || []).map((item) => [item.field, item]));
  const summary = Object.entries(fields).map(([field, value]) => {
    const previousItem = previousSummary.get(field);
    return previousItem && previousItem.source === sources[field] && analysis.fields[field] === value
      ? previousItem
      : { field, label: AI_FIELD_RULES[field].label, value: formatSummaryValue(field, value), source: sources[field] };
  });
  return { fields, sources, summary, pending, needsClarification: pending.length > 0, calculationReady };
}
