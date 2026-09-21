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
  averageOrderFreight: { schema: money, label: "Frete médio do pedido", kind: "money", hint: /frete|entrega|transporte/i, aggregate: true },
  averageOrderUnits: { schema: count.positive(), label: "Quantidade média de unidades por pedido", kind: "number", hint: /unidades?.*(?:pedido|venda)|pedido.*unidades?/i },
  companyFreightShare: { schema: z.number().finite().min(0).max(100), label: "Percentual do frete pago pela empresa", kind: "percent", hint: /frete.*(?:empresa|neg[oó]cio)|empresa.*frete/i },
  freightPayer: { schema: z.enum(["company", "customer", "shared"]), label: "Responsável pelo frete", kind: "enum", options: { company: "Empresa paga 100%", customer: "Cliente paga 100%", shared: "Dividido" } },
  otherVariableCost: { schema: money, label: "Outros custos variáveis de produção por unidade", kind: "money", hint: /energia|g[aá]s|[aá]gua|custos? vari[aá]ve/i, batch: true, aggregate: true },
  otherDirectExpenses: { schema: money, label: "Outras despesas diretas por unidade", kind: "money", hint: /seguro|despesas? diretas?|outros? (?:custos?|gastos?)|estamp(?:a|agem)|impress[aã]o|etiquet(?:a|agem)/i, batch: true, aggregate: true },
  monthlyLaborCost: { schema: money, label: "Custo mensal total da mão de obra de produção", kind: "money", hint: /m[aã]o de obra|folha|sal[aá]rios?|salaria[ls]|remunera[cç]/i, monthly: true, aggregate: true },
  monthlyProductiveHours: { schema: count.positive().max(1_000_000), label: "Horas produtivas totais da equipe no mês", kind: "number", hint: /horas? produtivas?.*(?:equipe|m[eê]s)|equipe.*horas?/i },
  laborHourlyCost: { schema: money, label: "Custo da mão de obra por hora", kind: "money", hint: /m[aã]o de obra.*hora|custo.*hora/i },
  productionTimeMinutes: { schema: count, label: "Tempo médio para produzir uma unidade em minutos", kind: "number", hint: /tempo.*(?:unidade|produ)|minutos?|horas?.*(?:unidade|produ)/i },
  monthlyFixedCosts: { schema: money, label: "Custos fixos mensais", kind: "money", hint: /fix[oa]s?|mensal|energia/i, monthly: true, aggregate: true },
  expectedMonthlyUnits: { schema: count.positive(), label: "Quantidade mensal prevista", kind: "number", hint: /m[eê]s|mensal|mensais/i },
  laborCostMode: { schema: z.enum(["automatic", "manual"]), label: "Modo de cálculo da mão de obra", kind: "enum", options: { automatic: "Calcular automaticamente", manual: "Custo/hora manual" } },
  allocationMethod: { schema: z.enum(["quantity", "labor-hours", "machine-hours", "revenue"]), label: "Método de rateio", kind: "enum", options: { quantity: "Quantidade", "labor-hours": "Horas de mão de obra", "machine-hours": "Horas de máquina", revenue: "Faturamento" } },
  allocationLaborHours: { schema: count.positive(), label: "Horas totais de mão de obra para rateio", kind: "number", hint: /horas?.*rateio/i },
  machineTimeMinutes: { schema: count, label: "Tempo de máquina por unidade em minutos", kind: "number", hint: /m[aá]quina.*(?:minutos?|unidade)/i },
  monthlyMachineHours: { schema: count.positive(), label: "Horas totais de máquina no mês", kind: "number", hint: /horas?.*m[aá]quina.*m[eê]s|m[aá]quina.*horas?.*m[eê]s/i },
  monthlyBusinessRevenue: { schema: money.positive(), label: "Faturamento mensal total da empresa", kind: "money", hint: /faturamento.*empresa|faturamento total/i, monthly: true },
  monthlyProductRevenue: { schema: money.positive(), label: "Faturamento mensal esperado deste produto", kind: "money", hint: /faturamento.*produto/i, monthly: true },
  equipmentValue: { schema: money, label: "Valor total dos equipamentos", kind: "money", hint: /equipamentos?|m[aá]quinas?/i },
  equipmentUsefulLifeMonths: { schema: count.positive(), label: "Vida útil dos equipamentos em meses", kind: "number", hint: /vida [uú]til/i },
  equipmentMaintenanceMonthly: { schema: money, label: "Manutenção média mensal", kind: "money", hint: /manuten[cç][aã]o/i, monthly: true },
  taxRate: { schema: percentage, label: "Percentual efetivo de impostos sobre a venda", kind: "percent", hint: /carga tribut[aá]ria|tributos? totais?|impostos? (?:totais?|sobre a venda|da venda)|taxa total de impostos/i },
  paymentFeeRate: { schema: percentage, label: "Taxa de pagamento/cartão", kind: "percent", hint: /pagamento|cart[aã]o|maquininha|gateway/i },
  commissionRate: { schema: percentage, label: "Comissão", kind: "percent", hint: /comiss[aã]o/i },
  marketplaceFeeRate: { schema: percentage, label: "Taxa de marketplace/plataforma", kind: "percent", hint: /marketplace|plataforma/i },
  fixedFeePerOrder: { schema: money, label: "Taxa fixa por pedido", kind: "money", hint: /taxa fixa.*(?:pedido|venda)|(?:pedido|venda).*taxa fixa/i },
  postSaleLossRate: { schema: percentage, label: "Perdas pós-venda", kind: "percent", hint: /devolu[cç]|trocas?|inadimpl|estornos?|p[oó]s-venda/i },
  minimumMargin: { schema: percentage, label: "Margem mínima", kind: "percent", hint: /margem m[ií]nima/i },
  desiredNetMargin: { schema: percentage, label: "Margem de lucro desejada", kind: "percent", hint: /margem|lucr(?:o|ar)|ganh(?:o|ar)/i },
  inventoryDays: { schema: days, label: "Dias entre comprar/produzir e vender", kind: "days", hint: /estoque|produ[cç][aã]o|antes da venda/i },
  receivingDays: { schema: days, label: "Prazo para receber do cliente", kind: "days", hint: /receb/i },
  paymentDays: { schema: days, label: "Prazo para pagar fornecedores", kind: "days", hint: /pagamento|pag[oa]r?|fornecedor/i },
  monthlyCapitalRate: { schema: percentage, label: "Custo mensal do capital", kind: "percent", hint: /capital|juros/i },
  capitalRateSource: { schema: z.enum(["informed", "zero", "estimated"]), label: "Origem do custo mensal do capital", kind: "enum", options: { informed: "Informado", zero: "Não sei — usar 0%", estimated: "Estimativa informada" } },
  discountRate: { schema: percentage, label: "Desconto percentual", kind: "percent", hint: /desconto/i },
  fixedDiscountAmount: { schema: money, label: "Desconto fixo", kind: "money", hint: /desconto/i },
  discountType: { schema: z.enum(["none", "percentage", "fixed"]), label: "Tipo de desconto", kind: "enum", options: { none: "Sem desconto", percentage: "Percentual", fixed: "Valor fixo" } },
  marketPrice: { schema: money.positive(), label: "Preço de mercado informado", kind: "money", hint: /concorr[eê]ncia|concorrentes?|pre[cç]o (?:m[eé]dio )?(?:da |de )?mercado|m[eé]dia do mercado|outras? lojas?|(?:na|em) minha regi[aã]o[^.!?;]*(?:cust|m[eé]dia)/i },
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
// Universo de inputs usado na validação contextual. A obrigatoriedade real é
// calculada por requiredPricingFields de acordo com os custos e métodos ativos.
export const AI_REQUIRED_PRICING_FIELDS = Object.freeze([
  "materialCost", "wasteRate", "packagingCost", "averageOrderFreight", "averageOrderUnits",
  "monthlyLaborCost", "monthlyProductiveHours", "productionTimeMinutes", "monthlyFixedCosts", "expectedMonthlyUnits",
  "taxRate", "desiredNetMargin",
  "inventoryDays", "receivingDays", "paymentDays", "monthlyCapitalRate",
]);

function requiredPricingFields(fields = {}) {
  const required = new Set(["materialCost", "desiredNetMargin"]);
  const hasOrderBasedCost = (fields.averageOrderFreight || 0) > 0 || (fields.fixedFeePerOrder || 0) > 0;
  const hasAllocatableMonthlyCost = (fields.monthlyFixedCosts || 0) > 0 || (fields.equipmentValue || 0) > 0
    || (fields.equipmentMaintenanceMonthly || 0) > 0;
  if (hasOrderBasedCost) required.add("averageOrderUnits");
  if ((fields.averageOrderFreight || 0) > 0 && fields.freightPayer === "shared") required.add("companyFreightShare");
  if ((fields.monthlyLaborCost || 0) > 0) {
    required.add("monthlyProductiveHours");
    required.add("productionTimeMinutes");
  }
  if ((fields.laborHourlyCost || 0) > 0) required.add("productionTimeMinutes");
  if (hasAllocatableMonthlyCost && (fields.allocationMethod || "quantity") === "quantity") required.add("expectedMonthlyUnits");
  if (hasAllocatableMonthlyCost && fields.allocationMethod === "labor-hours") {
    required.add("productionTimeMinutes");
    if (fields.laborCostMode === "manual") required.add("allocationLaborHours");
    else required.add("monthlyProductiveHours");
  }
  if (hasAllocatableMonthlyCost && fields.allocationMethod === "machine-hours") {
    required.add("machineTimeMinutes");
    required.add("monthlyMachineHours");
  }
  if (hasAllocatableMonthlyCost && fields.allocationMethod === "revenue") {
    required.add("monthlyBusinessRevenue");
    required.add("monthlyProductRevenue");
    required.add("expectedMonthlyUnits");
  }
  if ((fields.equipmentValue || 0) > 0) required.add("equipmentUsefulLifeMonths");
  if (fields.discountType === "percentage") required.add("discountRate");
  if (fields.discountType === "fixed") required.add("fixedDiscountAmount");
  return [...required];
}
export const AI_COMPLETE_CONTEXT_FIELDS = Object.freeze([
  "productName", "productDescription", ...AI_REQUIRED_PRICING_FIELDS,
  "companyFreightShare", "freightPayer", "otherVariableCost", "otherDirectExpenses", "laborHourlyCost",
  "paymentFeeRate", "commissionRate", "marketplaceFeeRate", "fixedFeePerOrder", "postSaleLossRate", "minimumMargin",
  "laborCostMode", "allocationMethod", "allocationLaborHours", "machineTimeMinutes", "monthlyMachineHours",
  "monthlyBusinessRevenue", "monthlyProductRevenue", "equipmentValue", "equipmentUsefulLifeMonths", "equipmentMaintenanceMonthly",
  "capitalRateSource", "discountRate", "fixedDiscountAmount", "discountType",
]);
export const AI_PENDING_CODES = Object.freeze([
  "AI_COST_BASIS_UNKNOWN", "AI_BATCH_UNITS_REQUIRED", "AI_BATCH_UNITS_INVALID",
  "AI_NEGATIVE_VALUE", "AI_VALUE_OUT_OF_RANGE", "AI_AMBIGUOUS_VALUE",
  "AI_CONFIRM_FIELD", "AI_MEANING_UNCERTAIN", "AI_RATE_SUM_INVALID", "AI_REQUIRED_FIELD_MISSING",
  "AI_USER_VALUE_REQUIRED",
]);
export const AI_MAX_EXTRACTION_ENTRIES = 100;

const currentRatesSchema = z.object({
  taxRate: percentage.nullable().optional(),
  paymentFeeRate: percentage.nullable().optional(),
  commissionRate: percentage.nullable().optional(),
  marketplaceFeeRate: percentage.nullable().optional(),
  postSaleLossRate: percentage.nullable().optional(),
  desiredNetMargin: percentage.nullable().optional(),
}).strict();

export const aiFieldsSchema = z.object(Object.fromEntries(Object.entries(AI_FIELD_RULES).map(([key, rule]) => [key, rule.schema.nullable().optional()]))).strict();
const resolvedAiFieldsSchema = z.object(Object.fromEntries(Object.entries(AI_FIELD_RULES).map(([key, rule]) => [key, rule.schema.optional()]))).strict();
const aiSourcesSchema = z.object(Object.fromEntries(Object.keys(AI_FIELD_RULES).map((key) => [key, z.enum(AI_VALUE_SOURCES).optional()]))).strict();
const skippedValueSchema = z.object({ value: z.null(), source: z.literal("skipped") }).strict();
const aiSkippedSchema = z.object(Object.fromEntries(Object.keys(AI_FIELD_RULES).map((key) => [key, skippedValueSchema.optional()]))).strict();
const currentFieldsSchema = z.object(Object.fromEntries(AI_COMPLETE_CONTEXT_FIELDS.map((key) => [key, AI_FIELD_RULES[key].schema.optional()]))).strict();
const pendingReferenceSchema = z.object({
  code: z.enum(AI_PENDING_CODES),
  field: z.enum(Object.keys(AI_FIELD_RULES)),
}).strict();
export const aiPreviousAnalysisSchema = z.object({
  fields: resolvedAiFieldsSchema,
  sources: aiSourcesSchema,
  skipped: aiSkippedSchema.optional().default({}),
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
    if (Object.hasOwn(analysis.skipped, item.field)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["skipped", item.field], message: "pending_field_already_skipped" });
    }
  }
  for (const field of Object.keys(analysis.skipped)) {
    if (Object.hasOwn(analysis.fields, field) || Object.hasOwn(analysis.sources, field)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["skipped", field], message: "skipped_field_already_resolved" });
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
const extractionEnvelope = z.object({ entries: z.array(z.unknown()).max(AI_MAX_EXTRACTION_ENTRIES) }).strict();
export const aiExtractionSchema = z.object({ entries: z.array(extractionEntry).max(AI_MAX_EXTRACTION_ENTRIES) }).strict();

function parseStructuredNumericString(value) {
  const match = value.trim().match(/^(?:r\$\s*)?([+-]?(?:\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?))\s*(?:%|por\s*cento)?$/i);
  if (!match) return null;
  const token = match[1];
  const comma = token.lastIndexOf(",");
  const dot = token.lastIndexOf(".");
  let canonical = token;
  if (comma >= 0 && dot >= 0) {
    canonical = comma > dot ? token.replace(/\./g, "").replace(",", ".") : token.replace(/,/g, "");
  } else if (comma >= 0) canonical = token.replace(",", ".");
  else if (/^[+-]?\d{1,3}(?:\.\d{3})+$/.test(token)) canonical = token.replace(/\./g, "");
  const parsed = Number(canonical);
  return Number.isFinite(parsed) ? parsed : null;
}

// Structured Output pode representar números como strings mesmo quando a
// instrução pede JSON numérico. A normalização aceita apenas uma representação
// numérica brasileira/decimal completa; texto livre continua inválido e todas
// as regras de domínio/evidência abaixo continuam obrigatórias.
export function normalizeAiExtraction(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.entries)) return raw;
  return {
    ...raw,
    entries: raw.entries.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
      const normalizedEntry = { ...entry };
      if (entry.field === "otherVariableCost"
        && /\b(?:outros? custos?|outros? gastos?|outras? despesas?)\b/i.test(entry.evidence || "")
        && !/\b(?:vari[aá]ve(?:l|is)|energia|g[aá]s|[aá]gua)\b/i.test(entry.evidence || "")) {
        normalizedEntry.field = "otherDirectExpenses";
      }
      const rule = AI_FIELD_RULES[normalizedEntry.field];
      if (rule && !["text", "enum"].includes(rule.kind) && typeof entry.value === "string") {
        const parsed = parseStructuredNumericString(entry.value);
        if (parsed !== null) normalizedEntry.value = parsed;
      }
      if (typeof entry.batchUnits === "string") {
        const parsed = parseStructuredNumericString(entry.batchUnits);
        if (Number.isInteger(parsed)) normalizedEntry.batchUnits = parsed;
      }
      for (const property of ["batchEvidence", "correctionEvidence"]) {
        if (typeof normalizedEntry[property] === "string" && normalizedEntry[property].trim() === "") normalizedEntry[property] = null;
      }
      return normalizedEntry;
    }),
  };
}

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
  return /na verdade|corrig\w*|esque[cç]\w*|quis dizer|(?:alter|troc|mud)\w*\s+(?:.+?\s+)?para/i.test(evidence);
}

function isOpenMaterialEvidence(evidence) {
  const source = normalized(evidence);
  if (!/(?:r\$|reais?|cust\w*|gast\w*|pag\w*|compr\w*)/i.test(source)
    || /\b(?:vend\w*|preco de venda|cobr\w*|receita|fatur\w*|lucro|margem)\b/i.test(source)) return false;
  const competingFields = [
    "packagingCost", "averageOrderFreight", "otherVariableCost", "otherDirectExpenses",
    "monthlyLaborCost", "monthlyFixedCosts", "fixedDiscountAmount", "fixedFeePerOrder", "marketPrice",
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

function evidenceContexts(message, evidence) {
  const excerpt = normalized(evidence);
  if (!excerpt) return [];
  // Keep decimal dots and commas inside monetary values, but isolate nearby
  // clauses so a sale price elsewhere in the message cannot ground a cost.
  const clauses = normalized(message)
    .split(/\.(?=\s|$)|[!?;]|,\s+|\s+e\s+(?=(?:quero|pretendo|gasto|pago|compro|custo|frete|entrega|embalag|margem|concorr|outras? lojas?|na minha regi[aã]o)\b)/iu)
    .map((context) => context.trim())
    .filter(Boolean);
  return [...new Set(clauses.flatMap((context, index) => {
    const previous = clauses[index - 1] || "";
    // A short, number-free prefix such as "na minha região," can name the
    // field for the value in the next clause. Never bridge two numeric clauses.
    const prefixed = previous && !/\d/u.test(previous) && writtenNumberCandidates(previous).length === 0
      ? `${previous} ${context}` : "";
    return [context, prefixed];
  }))].filter((context) => context.includes(excerpt));
}

function contextGroundsCompactEvidence(field, evidence, message) {
  return evidenceContexts(message, evidence).some((context) => evidenceMatchesField(field, context));
}

function isOwnSalePriceAmbiguity(entry, message) {
  if (entry.field !== "marketPrice" || entry.source !== "user_provided"
    || typeof entry.value !== "number" || !containsLiteralEvidence(message, entry.evidence)
    || !containsNumber(entry.evidence, entry.value)) return false;
  return evidenceContexts(message, entry.evidence).some((context) =>
    /\b(?:(?:quero|vou|pretendo)\s+vend\w*|vendo|meu pre[cç]o|pre[cç]o de venda)\b/i.test(context)
    && !evidenceMatchesField("marketPrice", context));
}

function isSoleMissingMonthlyQuestion(clarification, field = "expectedMonthlyUnits") {
  const pending = Array.isArray(clarification?.pending) ? clarification.pending : [];
  return field === "expectedMonthlyUnits" && pending.length === 1
    && pending[0].code === "AI_REQUIRED_FIELD_MISSING"
    && pending[0].field === field;
}

function clarificationTargetsField(clarification, field) {
  const pending = Array.isArray(clarification?.pending) ? clarification.pending : null;
  const explicitPending = pending?.filter(({ code }) => code !== "AI_REQUIRED_FIELD_MISSING") || [];
  // Explicit ambiguity/basis questions take precedence over required fields
  // added by complete mode. Once only the controlled monthly-volume question
  // remains, its wording supplies the meaning for a short numeric answer.
  const actionablePending = pending
    ? (explicitPending.length ? explicitPending : isSoleMissingMonthlyQuestion(clarification) ? pending : [])
      .map(({ field: pendingField }) => pendingField)
    : clarification?.pendingFields || [];
  const pendingFields = new Set(actionablePending);
  return pendingFields.size === 1 && pendingFields.has(field);
}

function isDirectFieldInputClarification(clarification, field) {
  return clarificationTargetsField(clarification, field)
    && clarification?.pending?.some((item) => item.code === "AI_USER_VALUE_REQUIRED" && item.field === field);
}

function clarificationSuppliesMissingMonthlyUnits(entry, clarification) {
  const pending = Array.isArray(clarification?.pending) ? clarification.pending : [];
  return entry.field === "expectedMonthlyUnits"
    && entry.source === "user_provided"
    && typeof entry.value === "number"
    && clarificationTargetsField(clarification, entry.field)
    && pending.some(({ code, field }) => code === "AI_REQUIRED_FIELD_MISSING" && field === entry.field)
    && containsLiteralEvidence(clarification?.answer || "", entry.evidence)
    && containsNumber(entry.evidence, entry.value);
}

function clarificationGroundsField(entry, clarification) {
  if (isDirectFieldInputClarification(clarification, entry.field)) {
    return containsLiteralEvidence(clarification?.answer || "", entry.evidence);
  }
  if (isSoleMissingMonthlyQuestion(clarification, entry.field)) {
    return clarificationSuppliesMissingMonthlyUnits(entry, clarification);
  }
  return clarificationTargetsField(clarification, entry.field)
    && containsLiteralEvidence(clarification.answer || "", entry.evidence)
    && (evidenceMatchesField(entry.field, clarification.context || "")
      || (typeof entry.value === "number" && containsNumber(clarification.context || "", entry.value)));
}

function validateGrounding(entry, message, clarification) {
  const rule = AI_FIELD_RULES[entry.field];
  if (entry.source === "estimated") {
    return entry.certainty === "certain" && entry.value !== null && entry.evidence === ""
      && entry.correctionEvidence === null && rule.kind !== "text" && rule.kind !== "enum";
  }
  if (!containsLiteralEvidence(message, entry.evidence)) return false;
  if (entry.correctionEvidence !== null
    && (!containsLiteralEvidence(message, entry.correctionEvidence) || !hasCorrectionLanguage(entry.correctionEvidence))) return false;
  if (rule.hint && !evidenceMatchesField(entry.field, entry.evidence)
    && !contextGroundsCompactEvidence(entry.field, entry.evidence, message)
    && !clarificationGroundsField(entry, clarification) && entry.certainty !== "meaning-uncertain") {
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
    // A clarification may legitimately split its evidence: the original
    // context supplies the numeric value while the short answer supplies only
    // the missing basis (for example, "são por unidade"). The controlled
    // monthly question is narrower: its short answer must contain the value
    // itself. Both exceptions require a single actionable pending field.
    const groundedByMonthlyAnswer = clarificationSuppliesMissingMonthlyUnits(entry, clarification);
    const groundedByOriginalContext = clarificationGroundsField(entry, clarification)
      && containsNumber(clarification?.context || "", entry.value);
    const groundedByClarification = groundedByMonthlyAnswer || groundedByOriginalContext;
    if (!removingDiscount && !containsNumber(entry.evidence, entry.value) && !groundedByClarification) return false;
    const implicitMarginPercent = entry.field === "desiredNetMargin" && /margem|lucr(?:o|ar)|ganh(?:o|ar)/i.test(entry.evidence);
    if (rule.kind === "percent" && !removingDiscount && !implicitMarginPercent
      && !isDirectFieldInputClarification(clarification, entry.field)
      && !/%|por\s*cento|percentua[li]/i.test(entry.evidence)) return false;
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
  if (isDirectFieldInputClarification(clarification, entry.field)) return true;
  const explicitMarker = /\b(?:cada|por\s+(?:uma?\s+)?unidade|unit[aá]ri[oa]|por\s+(?:pe[cç]a|item|produto|venda))\b/i;
  const explicitSinglePurchase = entry.field === "materialCost" && (
    /\bcompr(?:o|ei)\s+um(?:a)?\s+[^.!?;,]{1,100}\s+por\s+(?:r\$\s*)?[+-]?\d/iu.test(entry.evidence)
    || /\bpag(?:o|uei)\s+(?:r\$\s*)?[+-]?\d[^.!?;,]{0,40}\bpelo\s+produto\b/iu.test(entry.evidence)
  );
  if (explicitSinglePurchase) return true;
  if (clarificationTargetsField(clarification, entry.field)
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

function clarificationGroundsBatch(entry, clarification) {
  if (!clarificationTargetsField(clarification, entry.field)
    || !containsLiteralEvidence(clarification?.answer || "", entry.batchEvidence || "")
    || !containsNumber(entry.batchEvidence || "", entry.batchUnits)) return false;
  const pending = Array.isArray(clarification?.pending) ? clarification.pending : [];
  const quantityQuestion = pending.some(({ code, field }) => field === entry.field && code === "AI_BATCH_UNITS_REQUIRED");
  return quantityQuestion || (hasBatchContext(clarification.answer) && containsNumber(clarification.answer, entry.batchUnits));
}

function messageGroundsReferencedBatch(entry, message) {
  if (!containsLiteralEvidence(message, entry.batchEvidence || "")
    || !/\b(?:(?:para\s+)?(?:esse|este|o|mesmo)\s+lote|(?:desse|deste|do)\s+lote)\b/i.test(entry.batchEvidence || "")) return false;
  return normalized(message)
    .split(/\.(?=\s|$)|[!?;]|,\s+/u)
    .some((context) => containsNumber(context, entry.batchUnits)
      && /\b(?:produz\w*|rende\w*|fabric\w*|faz(?:er|endo|emos|em)?|fez|produ[cç][aã]o)\b/i.test(context));
}

const pendingSubjects = Object.freeze({
  materialCost: "O custo de matéria-prima", packagingCost: "O custo de embalagem",
  averageOrderFreight: "O frete médio do pedido", otherVariableCost: "O custo variável adicional",
  otherDirectExpenses: "O custo direto adicional", monthlyLaborCost: "O custo mensal da mão de obra",
  monthlyFixedCosts: "O custo fixo mensal", desiredNetMargin: "A margem de lucro desejada",
});

export function getAiPendingQuestion(code, field) {
  const label = AI_FIELD_RULES[field]?.label || "O valor informado";
  const subject = pendingSubjects[field] || label;
  const messages = {
    AI_COST_BASIS_UNKNOWN: `${subject} é por unidade ou pelo lote? Se for pelo lote, quantas unidades ele produz?`,
    AI_BATCH_UNITS_REQUIRED: `Quantas unidades o lote referente a ${label.toLocaleLowerCase("pt-BR")} produz?`,
    AI_BATCH_UNITS_INVALID: "A quantidade produzida deve ser maior que zero.",
    AI_NEGATIVE_VALUE: `${subject} não pode ser negativo. Confira o valor informado.`,
    AI_VALUE_OUT_OF_RANGE: field === "desiredNetMargin"
      ? "A margem deve ser maior ou igual a 0% e menor que 100%."
      : `${label} está fora dos limites aceitos pelo simulador. Confira o valor informado.`,
    AI_AMBIGUOUS_VALUE: `Qual valor deseja usar para ${label.toLocaleLowerCase("pt-BR")}?`,
    AI_CONFIRM_FIELD: `Deseja incluir ${label.toLocaleLowerCase("pt-BR")} no preenchimento?`,
    AI_MEANING_UNCERTAIN: "O valor informado representa custo de produção ou preço de venda?",
    AI_RATE_SUM_INVALID: "A soma de tributos, taxas, comissão e margem deve ser menor que 100%.",
    AI_REQUIRED_FIELD_MISSING: `Não consegui determinar ${label.toLocaleLowerCase("pt-BR")}.`,
    AI_USER_VALUE_REQUIRED: `Informe ${label.toLocaleLowerCase("pt-BR")}.`,
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

const validationDiagnosticToken = /^[A-Za-z0-9_.:-]{1,100}$/;

function runtimeValueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && !Number.isFinite(value)) return "non_finite_number";
  return ["string", "number", "boolean", "object", "undefined"].includes(typeof value) ? typeof value : "unknown";
}

function valueAtPath(value, path = []) {
  return path.reduce((current, segment) => current?.[segment], value);
}

function zodExpectedType(issue) {
  if (issue?.code === "invalid_type" && validationDiagnosticToken.test(String(issue.expected || ""))) return String(issue.expected);
  const expected = {
    invalid_enum_value: "allowed_enum_value",
    invalid_literal: "required_literal",
    unrecognized_keys: "known_properties_only",
    too_small: `${issue?.type || "value"}_within_limits`,
    too_big: `${issue?.type || "value"}_within_limits`,
    invalid_string: "valid_string_format",
    custom: "domain_rule",
  };
  return expected[issue?.code] || "schema_contract";
}

function zodInvalidField(raw, issue, fallback) {
  const path = Array.isArray(issue?.path) ? issue.path : [];
  if (path[0] === "entries" && Number.isInteger(path[1])) {
    const property = typeof path[2] === "string" && Object.hasOwn(extractionEntry.shape, path[2]) ? path[2] : "entry";
    const modelField = raw?.entries?.[path[1]]?.field;
    return typeof modelField === "string" && Object.hasOwn(AI_FIELD_RULES, modelField) ? `${modelField}.${property}` : property;
  }
  const knownField = path.find((segment) => typeof segment === "string" && Object.hasOwn(AI_FIELD_RULES, segment));
  return knownField || fallback;
}

function validationFailure(code, status, path, issueType, metadata = {}) {
  const error = new AiAssistantError(code, status);
  error.validationPath = path || "analysis";
  error.validationIssueType = issueType || "invalid";
  for (const key of ["invalidField", "expectedType", "receivedType", "validationRule"]) {
    if (typeof metadata[key] === "string" && validationDiagnosticToken.test(metadata[key])) error[key] = metadata[key];
  }
  return error;
}

function zodValidationFailure(code, status, raw, issue, fallback) {
  const path = issue?.path || [];
  return validationFailure(code, status, path.join(".") || fallback, issue?.code || "invalid_schema", {
    invalidField: zodInvalidField(raw, issue, fallback),
    expectedType: zodExpectedType(issue),
    receivedType: runtimeValueType(valueAtPath(raw, path)),
    validationRule: `zod.${issue?.code || "invalid_schema"}`,
  });
}

function semanticValidationFailure(entry, property, expectedType, issueType) {
  return validationFailure("AI_INVALID_RESPONSE", 502, `entries.${entry.field}.${property}`, issueType, {
    invalidField: `${entry.field}.${property}`,
    expectedType,
    receivedType: runtimeValueType(entry[property]),
    validationRule: issueType,
  });
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
    averageOrderFreight: Math.max(200, materialCost * 3),
    otherVariableCost: Math.max(500, materialCost * 5),
    otherDirectExpenses: Math.max(500, materialCost * 5),
    monthlyLaborCost: 10_000_000,
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

const AI_NON_ESTIMABLE_FIELDS = new Set([
  "productName", "materialCost", "averageOrderFreight", "averageOrderUnits", "companyFreightShare", "freightPayer",
  "monthlyLaborCost", "monthlyProductiveHours", "laborHourlyCost", "productionTimeMinutes", "monthlyFixedCosts",
  "expectedMonthlyUnits", "allocationMethod", "allocationLaborHours", "machineTimeMinutes", "monthlyMachineHours",
  "monthlyBusinessRevenue", "monthlyProductRevenue", "equipmentValue", "equipmentUsefulLifeMonths", "equipmentMaintenanceMonthly",
  "taxRate", "paymentFeeRate", "commissionRate", "marketplaceFeeRate", "fixedFeePerOrder", "postSaleLossRate",
  "minimumMargin", "desiredNetMargin", "inventoryDays", "receivingDays", "paymentDays", "monthlyCapitalRate",
  "capitalRateSource", "discountRate", "fixedDiscountAmount", "discountType", "marketPrice",
]);

export function validateAiExtraction(raw, message, currentRates = {}, options = {}) {
  const envelope = extractionEnvelope.safeParse(raw);
  if (!envelope.success) {
    const issue = envelope.error.issues[0];
    throw zodValidationFailure("AI_INVALID_RESPONSE", 502, raw, issue, "entries");
  }
  const entries = [];
  const invalidKnownFields = new Set();
  const deferredFailures = [];
  let firstUnknownEntryIssue = null;
  for (let index = 0; index < envelope.data.entries.length; index += 1) {
    const candidate = envelope.data.entries[index];
    const parsedEntry = extractionEntry.safeParse(candidate);
    if (parsedEntry.success) {
      entries.push(parsedEntry.data);
      continue;
    }
    const field = candidate && typeof candidate === "object" && !Array.isArray(candidate)
      && typeof candidate.field === "string" && Object.hasOwn(AI_FIELD_RULES, candidate.field)
      ? candidate.field : null;
    if (field) {
      invalidKnownFields.add(field);
      const issue = parsedEntry.error.issues[0];
      deferredFailures.push(zodValidationFailure("AI_INVALID_RESPONSE", 502, raw, {
        ...issue, path: ["entries", index, ...issue.path],
      }, "entries"));
    }
    else if (!firstUnknownEntryIssue) {
      const issue = parsedEntry.error.issues[0];
      firstUnknownEntryIssue = { issue: { ...issue, path: ["entries", index, ...issue.path] }, candidate };
    }
  }
  const groups = new Map();
  const blockedFields = new Set();
  const pending = [];
  const pendingKeys = new Set();
  const addPending = (code, field) => {
    const key = `${code}:${field || ""}`;
    if (pendingKeys.has(key)) return;
    pendingKeys.add(key);
    pending.push({ code, field, message: getAiPendingQuestion(code, field) });
    if (field) blockedFields.add(field);
  };
  for (const field of invalidKnownFields) addPending("AI_USER_VALUE_REQUIRED", field);
  if (!entries.length && !pending.length && firstUnknownEntryIssue) {
    throw zodValidationFailure("AI_INVALID_RESPONSE", 502, raw, firstUnknownEntryIssue.issue, "entries");
  }

  for (const entry of entries) {
    const rule = AI_FIELD_RULES[entry.field];
    // Monthly scale is business data, not a conservative product estimate.
    // Ignore provider attempts to synthesize it; finalizeAiPricingAnalysis will
    // expose the missing field as a controlled pending question.
    if (entry.source === "estimated" && AI_NON_ESTIMABLE_FIELDS.has(entry.field)) continue;
    if (entry.value === null && entry.certainty === "certain") continue;
    if (!validateGrounding(entry, message, options.clarification)) {
      if (isOwnSalePriceAmbiguity(entry, message)) {
        addPending("AI_MEANING_UNCERTAIN", entry.field);
        continue;
      }
      deferredFailures.push(semanticValidationFailure(entry, "evidence", "grounded_literal_string", `invalid_${entry.source}_grounding`));
      addPending("AI_MEANING_UNCERTAIN", entry.field);
      continue;
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
      if (typeof entry.value !== "number") {
        deferredFailures.push(semanticValidationFailure(entry, "value", rule.kind, "invalid_field_value_type"));
        addPending("AI_USER_VALUE_REQUIRED", entry.field);
        continue;
      }
      addPending(entry.value < 0 ? "AI_NEGATIVE_VALUE" : "AI_VALUE_OUT_OF_RANGE", entry.field);
      continue;
    }
    const basis = rule.batch && entry.basis === "unknown" && isExplicitUnitCost(entry, message, options.clarification)
      ? "unit" : entry.basis;

    if (rule.batch) {
      if (!["unit", "batch-total", "unknown"].includes(basis)) {
        deferredFailures.push(semanticValidationFailure(entry, "basis", "unit_or_batch_total_or_unknown", "invalid_cost_basis"));
        addPending("AI_COST_BASIS_UNKNOWN", entry.field);
        continue;
      }
      if (basis === "unknown") { addPending("AI_COST_BASIS_UNKNOWN", entry.field); continue; }
      if (basis === "unit") {
        if (entry.batchUnits !== null || entry.batchEvidence !== null) {
          const property = entry.batchUnits !== null ? "batchUnits" : "batchEvidence";
          deferredFailures.push(semanticValidationFailure(entry, property, "null", `unit_cost_has_${property === "batchUnits" ? "batch_units" : "batch_evidence"}`));
          addPending("AI_COST_BASIS_UNKNOWN", entry.field);
          continue;
        }
        if (!isExplicitUnitCost(entry, message, options.clarification)) { addPending("AI_COST_BASIS_UNKNOWN", entry.field); continue; }
      }
      if (basis === "batch-total") {
        if (entry.batchUnits === null) { addPending("AI_BATCH_UNITS_REQUIRED", entry.field); continue; }
        if (entry.batchUnits <= 0) { addPending("AI_BATCH_UNITS_INVALID", entry.field); continue; }
        const directlyGroundedBatch = entry.batchEvidence && containsLiteralEvidence(message, entry.batchEvidence)
          && containsNumber(entry.batchEvidence, entry.batchUnits) && hasBatchContext(entry.batchEvidence);
        if (!directlyGroundedBatch && !clarificationGroundsBatch(entry, options.clarification)
          && !messageGroundsReferencedBatch(entry, message)) {
          deferredFailures.push(semanticValidationFailure(entry, "batchEvidence", "grounded_batch_literal_string", "invalid_batch_grounding"));
          addPending("AI_BATCH_UNITS_REQUIRED", entry.field);
          continue;
        }
      }
    } else if (rule.monthly) {
      if (basis !== "monthly-total" || entry.batchUnits !== null || entry.batchEvidence !== null) {
        const property = basis !== "monthly-total" ? "basis" : entry.batchUnits !== null ? "batchUnits" : "batchEvidence";
        deferredFailures.push(semanticValidationFailure(entry, property, property === "basis" ? "monthly_total" : "null", "invalid_monthly_metadata"));
        addPending("AI_MEANING_UNCERTAIN", entry.field);
        continue;
      }
    } else if ((basis !== "not-applicable" && !(entry.field === "marketPrice" && basis === "unit"))
      || entry.batchUnits !== null || entry.batchEvidence !== null) {
      const property = basis !== "not-applicable" && !(entry.field === "marketPrice" && basis === "unit")
        ? "basis" : entry.batchUnits !== null ? "batchUnits" : "batchEvidence";
      deferredFailures.push(semanticValidationFailure(entry, property, property === "basis" ? "not_applicable" : "null", "invalid_non_cost_metadata"));
      addPending("AI_MEANING_UNCERTAIN", entry.field);
      continue;
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
  const discountRemoval = entries.some((entry) => ["discountRate", "fixedDiscountAmount"].includes(entry.field)
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

  const rateFields = ["taxRate", "paymentFeeRate", "commissionRate", "marketplaceFeeRate", "postSaleLossRate", "desiredNetMargin"];
  const extractedRateFields = rateFields.filter((field) => Object.hasOwn(fields, field));
  const combinedRates = Object.fromEntries(rateFields.map((field) => [field, fields[field] ?? currentRates?.[field] ?? 0]));
  if (extractedRateFields.length && rateFields.reduce((sum, field) => sum + combinedRates[field], 0) >= 100) {
    extractedRateFields.forEach((field) => { delete fields[field]; delete sources[field]; groups.delete(field); });
    addPending("AI_RATE_SUM_INVALID", "desiredNetMargin");
  }

  const parsedFields = aiFieldsSchema.safeParse(fields);
  if (!parsedFields.success) {
    const issue = parsedFields.error.issues[0];
    throw zodValidationFailure("AI_INVALID_RESPONSE", 502, fields, issue, "fields");
  }
  if (!Object.keys(fields).length && deferredFailures.length) throw deferredFailures[0];
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
    ...previous.data.pending.filter(({ field }) => !addressedFields.has(field)).map(({ code, field }) => ({ code, field, message: getAiPendingQuestion(code, field) })),
    ...returnedPending,
  ];
  const fields = { ...previous.data.fields, ...clarificationResult.fields };
  const sources = { ...previous.data.sources, ...clarificationResult.sources };
  const skipped = { ...previous.data.skipped };
  for (const item of pending) delete fields[item.field];
  for (const item of pending) delete sources[item.field];
  for (const field of Object.keys(fields)) delete skipped[field];

  const parsedFields = resolvedAiFieldsSchema.safeParse(fields);
  if (!parsedFields.success) {
    const issue = parsedFields.error.issues[0];
    throw validationFailure("AI_VALIDATION_FAILED", 422, issue?.path?.join(".") || "fields", issue?.code || "invalid_fields");
  }
  if ((fields.discountRate || 0) > 0 && (fields.fixedDiscountAmount || 0) > 0) {
    throw validationFailure("AI_VALIDATION_FAILED", 422, "fields.discountRate", "conflicting_discount");
  }
  const rateFields = ["taxRate", "paymentFeeRate", "commissionRate", "marketplaceFeeRate", "postSaleLossRate", "desiredNetMargin"];
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
  return { fields, sources, skipped, summary, pending, needsClarification: pending.length > 0 };
}

function domainValidationForAssistantFields(fields) {
  const percentageFields = new Set([
    "wasteRate", "companyFreightShare", "taxRate", "paymentFeeRate", "commissionRate", "marketplaceFeeRate",
    "postSaleLossRate", "minimumMargin", "desiredNetMargin", "monthlyCapitalRate", "discountRate",
  ]);
  const input = {};
  for (const field of [
    ...AI_REQUIRED_PRICING_FIELDS, "companyFreightShare", "otherVariableCost", "otherDirectExpenses", "laborHourlyCost",
    "allocationLaborHours", "machineTimeMinutes", "monthlyMachineHours", "monthlyBusinessRevenue", "monthlyProductRevenue",
    "equipmentValue", "equipmentUsefulLifeMonths", "equipmentMaintenanceMonthly", "paymentFeeRate", "commissionRate",
    "marketplaceFeeRate", "fixedFeePerOrder", "postSaleLossRate", "minimumMargin", "discountRate", "fixedDiscountAmount", "marketPrice",
  ]) {
    if (Object.hasOwn(fields, field)) input[field] = percentageFields.has(field) ? fields[field] / 100 : fields[field];
  }
  input.freightPayer = fields.freightPayer || "company";
  input.laborCostMode = fields.laborCostMode || "automatic";
  input.allocationMethod = fields.allocationMethod || "quantity";
  input.capitalRateSource = fields.capitalRateSource || "informed";
  input.discountType = fields.discountType || (input.discountRate > 0 ? "percentage" : input.fixedDiscountAmount > 0 ? "fixed" : "none");
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
  const skipped = { ...(analysis.skipped || {}) };
  let pending = [...analysis.pending];

  for (const [field, value] of Object.entries(parsedCurrent.data)) {
    if (!Object.hasOwn(fields, field) || sources[field] === "estimated") {
      fields[field] = value;
      sources[field] = "user_provided";
      delete skipped[field];
      pending = pending.filter((item) => item.field !== field);
    }
  }

  let calculationReady = false;
  if (fillMode === "complete") {
    const pendingFields = new Set(pending.map(({ field }) => field));
    const requiredFields = requiredPricingFields(fields);
    for (const field of requiredFields) {
      if (!Object.hasOwn(fields, field) && !Object.hasOwn(skipped, field) && !pendingFields.has(field)) {
        pending.push({ code: "AI_REQUIRED_FIELD_MISSING", field, message: getAiPendingQuestion("AI_REQUIRED_FIELD_MISSING", field) });
        pendingFields.add(field);
      }
    }
    if (!requiredFields.some((field) => !Object.hasOwn(fields, field))) {
      const domainValidation = domainValidationForAssistantFields(fields);
      if (domainValidation.isValid) calculationReady = true;
      else {
        for (const field of Object.keys(domainValidation.errors)) {
          const target = field === "desiredNetMargin" ? "desiredNetMargin" : field;
          if (!Object.hasOwn(AI_FIELD_RULES, target) || pendingFields.has(target)) continue;
          const code = field === "desiredNetMargin" ? "AI_RATE_SUM_INVALID" : "AI_VALUE_OUT_OF_RANGE";
          pending.push({ code, field: target, message: getAiPendingQuestion(code, target) });
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
  for (const field of Object.keys(skipped)) {
    summary.push({ field, label: AI_FIELD_RULES[field].label, value: "Não informado", source: "skipped" });
  }
  const requiredFields = new Set(requiredPricingFields(fields));
  const pendingWithMetadata = pending.map((item) => ({
    ...item,
    label: AI_FIELD_RULES[item.field].label,
    required: requiredFields.has(item.field),
  }));
  return { fields, sources, skipped, summary, pending: pendingWithMetadata, needsClarification: pending.length > 0, calculationReady };
}
