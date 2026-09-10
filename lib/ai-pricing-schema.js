import { z } from "zod";

export class AiAssistantError extends Error {
  constructor(code = "AI_UNAVAILABLE", status = 503) {
    const messages = {
      AI_UNAVAILABLE: "O assistente está temporariamente indisponível. Você ainda pode preencher os dados manualmente.",
      AI_NOT_CONFIGURED: "O assistente ainda não está configurado neste ambiente. Você pode preencher os dados manualmente.",
      AI_PROVIDER_AUTH_ERROR: "Não foi possível autenticar o assistente no provedor de IA. A configuração precisa ser revisada pelo responsável pelo site.",
      AI_PROVIDER_FORBIDDEN: "O provedor de IA não autorizou esta operação. O responsável pelo site precisa revisar o acesso da integração.",
      AI_MODEL_UNAVAILABLE: "O modelo de IA configurado não está disponível para esta integração. Avise o responsável pelo site.",
      AI_PROVIDER_BAD_REQUEST: "O provedor recusou a configuração da análise. Avise o responsável pelo site.",
      AI_PROVIDER_QUOTA_EXCEEDED: "O limite de uso ou de créditos da integração de IA foi atingido. Avise o responsável pelo site.",
      AI_PROVIDER_RATE_LIMITED: "O provedor de IA está limitando as análises. Aguarde um pouco e tente novamente.",
      AI_TIMEOUT: "A análise demorou mais que o esperado. Tente novamente em alguns instantes.",
      AI_CONNECTION_ERROR: "Não foi possível conectar ao provedor de IA. Tente novamente em alguns instantes.",
      AI_INTERNAL_ERROR: "Não foi possível concluir a análise devido a uma falha interna. Você pode preencher os dados manualmente.",
      AI_INVALID_RESPONSE: "Não foi possível validar a resposta do assistente. Tente informar os dados novamente.",
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
  materialCost: { schema: money, label: "Matéria-prima por unidade", kind: "money", hint: /mat[eé]ria|insumos?|ingredientes?|custo|gasto/i, batch: true },
  wasteRate: { schema: percentage, label: "Perda e desperdício", kind: "percent", hint: /perdas?|desperd[ií]cio/i },
  packagingCost: { schema: money, label: "Embalagem por unidade", kind: "money", hint: /embalage|embalo|r[oó]tulo|rotulagem/i, batch: true },
  deliveryCost: { schema: money, label: "Frete e entrega por unidade", kind: "money", hint: /frete|entrega|transporte/i, batch: true },
  insuranceCost: { schema: money, label: "Seguro por unidade", kind: "money", hint: /seguro/i, batch: true },
  otherDirectExpenses: { schema: money, label: "Outras despesas diretas por unidade", kind: "money", hint: /outr[oa]s?.*(?:custos?|despesas?|gastos?)/i, batch: true },
  monthlyPayroll: { schema: money, label: "Folha salarial mensal", kind: "money", hint: /folha|sal[aá]rios?|salaria[ls]|remunera[cç]/i },
  monthlyFixedCosts: { schema: money, label: "Custos fixos mensais", kind: "money", hint: /fix[oa]s?/i },
  workerCount: { schema: count.int().max(1_000_000), label: "Funcionários", kind: "number", hint: /funcion[aá]rios?|trabalhador|pessoas?|colaboradores?/i },
  productiveHoursPerWorkerMonth: { schema: count.max(744), label: "Horas produtivas por funcionário/mês", kind: "number", hint: /horas?/i },
  unitsPerWorkerHour: { schema: count, label: "Unidades por funcionário/hora", kind: "number", hint: /hora/i },
  expectedMonthlyUnits: { schema: count.positive(), label: "Quantidade mensal prevista", kind: "number", hint: /m[eê]s|mensal|mensais/i },
  taxRate: { schema: percentage, label: "Carga tributária estimada manualmente", kind: "percent", hint: /carga tribut[aá]ria|tributos? totais?|impostos? totais?|taxa total de impostos/i },
  paymentFeeRate: { schema: percentage, label: "Taxa de pagamento", kind: "percent", hint: /pagamento|cart[aã]o|maquininha|gateway/i },
  commissionRate: { schema: percentage, label: "Comissão", kind: "percent", hint: /comiss[aã]o/i },
  desiredNetMargin: { schema: percentage, label: "Margem líquida desejada", kind: "percent", hint: /margem/i },
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

export const aiRequestSchema = z.object({ message: z.string().trim().min(1).max(4000) }).strict();
export const aiFieldsSchema = z.object(Object.fromEntries(Object.entries(AI_FIELD_RULES).map(([key, rule]) => [key, rule.schema.nullable().optional()]))).strict();

const extractionEntry = z.object({
  field: z.enum(Object.keys(AI_FIELD_RULES)),
  value: z.union([z.string().max(2000), z.number().finite(), z.null()]),
  evidence: z.string().max(4000),
  batchUnits: z.number().finite().positive().int().max(1_000_000_000).nullable(),
  batchEvidence: z.string().max(4000).nullable(),
}).strict();
export const aiExtractionSchema = z.object({ entries: z.array(extractionEntry).max(Object.keys(AI_FIELD_RULES).length) }).strict();

export const AI_OUTPUT_JSON_SCHEMA = {
  type: "object", additionalProperties: false, required: ["entries"], properties: {
    entries: { type: "array", maxItems: Object.keys(AI_FIELD_RULES).length, items: {
      type: "object", additionalProperties: false,
      required: ["field", "value", "evidence", "batchUnits", "batchEvidence"],
      properties: {
        field: { type: "string", enum: Object.keys(AI_FIELD_RULES) },
        value: { type: ["number", "string", "null"] },
        evidence: { type: "string" },
        batchUnits: { type: ["integer", "null"] },
        batchEvidence: { type: ["string", "null"] },
      },
    } },
  },
};

function normalized(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[-\s]+/g, " ").trim();
}

function containsText(source, value) {
  return normalized(source).includes(normalized(value));
}

function containsNumber(evidence, value) {
  const numbers = evidence.match(/[+-]?\d+(?:[.,]\d+)*/g) || [];
  return numbers.some((token) => {
    // Brazilian comma decimals and grouped thousands; a plain dot also accepts decimal input.
    const parsed = token.includes(",") ? Number(token.replace(/\./g, "").replace(",", "."))
      : /^\d{1,3}(\.\d{3})+$/.test(token) ? Number(token.replace(/\./g, "")) : Number(token);
    return Number.isFinite(parsed) && Math.abs(parsed - value) < 1e-9;
  });
}

function isDiscountRemoval(evidence) {
  return /(?:retir\w*|remov\w*|zer\w*|sem|cancel\w*|exclu\w*)\s+(?:o\s+|os\s+|qualquer\s+)?descontos?/i.test(evidence);
}

function validateGrounding(entry, message) {
  const rule = AI_FIELD_RULES[entry.field];
  if (!entry.evidence.trim() || !message.includes(entry.evidence)) return false;
  if (rule.hint && !rule.hint.test(entry.evidence)) return false;
  if (typeof entry.value === "number") {
    const removingDiscount = ["discountRate", "fixedDiscountAmount"].includes(entry.field)
      && entry.value === 0 && isDiscountRemoval(entry.evidence);
    if (!removingDiscount && !containsNumber(entry.evidence, entry.value)) return false;
    if (rule.kind === "percent" && !removingDiscount && !/%|por\s*cento|percentua[li]/i.test(entry.evidence)) return false;
    // An individual tax must never be silently repurposed as the total burden.
    if (entry.field === "taxRate" && /(?:icms|ipi|pis|cofins|difal|ibs|cbs)\s*(?:de|:|=)?\s*[\d.,]+\s*%/i.test(entry.evidence)) return false;
  } else if (rule.kind === "enum") {
    if (!containsText(entry.evidence, rule.options[entry.value])) return false;
    if (entry.field === "customerType" && entry.value === "contribuinte" && /n[aã]o\s+contribuinte/i.test(entry.evidence)) return false;
  } else if (!containsText(entry.evidence, entry.value)) return false;
  if (entry.field === "marketQuery" && !/pesquis|procur|busqu|busca|consult/i.test(message)) return false;
  if (entry.batchUnits !== null) {
    if (!rule.batch || !entry.batchEvidence || !message.includes(entry.batchEvidence)) return false;
    if (!containsNumber(entry.batchEvidence, entry.batchUnits) || !/unidades?|pe[cç]as?|por[cç][oõ]es?|lote|rende|produz|produzir/i.test(entry.batchEvidence)) return false;
  } else if (entry.batchEvidence !== null) return false;
  return true;
}

const numberFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 8 });
const moneyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 8 });

export function validateAiExtraction(raw, message) {
  const parsed = aiExtractionSchema.safeParse(raw);
  if (!parsed.success) throw new AiAssistantError("AI_INVALID_RESPONSE", 502);
  const fields = {};
  const seen = new Set();
  const batches = new Map();
  for (const entry of parsed.data.entries) {
    if (seen.has(entry.field)) throw new AiAssistantError("AI_INVALID_RESPONSE", 502);
    seen.add(entry.field);
    if (entry.value === null) continue;
    const checked = AI_FIELD_RULES[entry.field].schema.safeParse(entry.value);
    if (!checked.success || !validateGrounding(entry, message)) throw new AiAssistantError("AI_INVALID_RESPONSE", 502);
    fields[entry.field] = entry.batchUnits === null ? checked.data : Number((checked.data / entry.batchUnits).toFixed(8));
    if (entry.batchUnits !== null) batches.set(entry.field, entry.batchUnits);
    if (["discountRate", "fixedDiscountAmount"].includes(entry.field) && entry.value === 0 && isDiscountRemoval(entry.evidence)) {
      fields.discountRate = 0;
      fields.fixedDiscountAmount = 0;
    }
  }
  if (!Object.keys(fields).length) throw new AiAssistantError("AI_INSUFFICIENT_INFORMATION", 422);
  if ((fields.discountRate || 0) > 0 && (fields.fixedDiscountAmount || 0) > 0) throw new AiAssistantError("AI_INVALID_RESPONSE", 502);
  const rateSum = ["taxRate", "paymentFeeRate", "commissionRate", "desiredNetMargin"].reduce((sum, field) => sum + (fields[field] || 0), 0);
  if (rateSum >= 100 || !aiFieldsSchema.safeParse(fields).success) throw new AiAssistantError("AI_INVALID_RESPONSE", 502);
  const summary = Object.entries(fields).map(([field, value]) => {
    const rule = AI_FIELD_RULES[field];
    const formatted = rule.kind === "money" ? moneyFormatter.format(value)
      : rule.kind === "percent" ? `${numberFormatter.format(value)}%`
        : rule.kind === "days" ? `${numberFormatter.format(value)} dias`
          : rule.kind === "number" ? numberFormatter.format(value)
            : rule.options?.[value] || value;
    return { field, label: rule.label, value: batches.has(field) ? `${formatted} (total dividido por ${numberFormatter.format(batches.get(field))} unidades)` : formatted };
  });
  return { fields, summary };
}
