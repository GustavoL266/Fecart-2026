/* Gerado por scripts/build.mjs. Edite os arquivos em js/ e execute npm run build. */

const PRODUCTIVE_HOURS_PER_WORKER_MONTH = 176;

const AMAZON_MARKET_CONFIG = {
  minComparableResults: 3,
};

const MARKET_RULES = {
  closeGap: 0.08,
  attentionGap: 0.18,
};

const PERCENTAGE_FIELDS = new Set([
  "waste",
  "taxRate",
  "paymentFeeRate",
  "commissionRate",
  "margin",
  "capitalRate",
]);


const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function percent(value) {
  return `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[character];
  });
}



const RATE_SCALE = 1_000_000;

function toCents(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

function fromCents(value) {
  return value / 100;
}

function toRateParts(value) {
  return Math.round(value * RATE_SCALE);
}

function roundedRatio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Math.round(numerator / denominator);
}

function multiplyCentsByRate(cents, rate) {
  const numerator = BigInt(cents) * BigInt(toRateParts(rate));
  return Number((numerator + BigInt(RATE_SCALE / 2)) / BigInt(RATE_SCALE));
}

function ceilPriceCents(baseCostCents, availableRateParts) {
  const numerator = BigInt(baseCostCents) * BigInt(RATE_SCALE);
  const denominator = BigInt(availableRateParts);
  return Number((numerator + denominator - 1n) / denominator);
}

function moneyFields(cents) {
  return Object.fromEntries(Object.entries(cents).map(([key, value]) => [key.replace(/Cents$/, ""), fromCents(value)]));
}

function calculateCosts(inputs) {
  const materialsCostCents = toCents(inputs.materialsCost);
  const materialsWithWasteCents = materialsCostCents + multiplyCentsByRate(materialsCostCents, inputs.waste);
  const totalPayrollCents = toCents(inputs.totalPayroll);
  const monthlyProductionCapacity = inputs.workerCount * inputs.outputPerWorkerHour * PRODUCTIVE_HOURS_PER_WORKER_MONTH;
  const laborHourlyCostCents = roundedRatio(totalPayrollCents, inputs.workerCount * PRODUCTIVE_HOURS_PER_WORKER_MONTH);
  const directLaborCents = roundedRatio(totalPayrollCents, monthlyProductionCapacity);
  const packagingCostCents = toCents(inputs.packagingCost);
  const deliveryCostCents = toCents(inputs.deliveryCost);
  const insuranceCostCents = toCents(inputs.insuranceCost || 0);
  const discountAmountCents = toCents(inputs.discountAmount || 0);
  const otherExpensesCents = toCents(inputs.otherExpenses || 0);
  const grossDirectCashCostCents = materialsWithWasteCents + packagingCostCents + deliveryCostCents + insuranceCostCents + otherExpensesCents + directLaborCents;
  const directCashCostCents = Math.max(0, grossDirectCashCostCents - discountAmountCents);
  const cashGapDays = Math.max(inputs.receiveDays - inputs.payDays, 0);
  const workingCapitalCostCents = multiplyCentsByRate(directCashCostCents, inputs.capitalRate * (cashGapDays / 30));
  const fixedCostAllocationCents = roundedRatio(toCents(inputs.monthlyFixedCosts), inputs.monthlyVolume);
  const baseCostCents = directCashCostCents + workingCapitalCostCents + fixedCostAllocationCents;
  const salesRateParts = toRateParts(inputs.taxRate) + toRateParts(inputs.paymentFeeRate) + toRateParts(inputs.commissionRate);

  const cents = {
    materialsCostCents,
    materialsWithWasteCents,
    laborHourlyCostCents,
    directLaborCents,
    packagingCostCents,
    deliveryCostCents,
    insuranceCostCents,
    discountAmountCents,
    otherExpensesCents,
    directCashCostCents,
    workingCapitalCostCents,
    fixedCostAllocationCents,
    baseCostCents,
  };

  return {
    ...moneyFields(cents),
    ...cents,
    monthlyProductionCapacity,
    cashGapDays,
    salesRate: salesRateParts / RATE_SCALE,
    salesRateParts,
  };
}

function calculatePrice(inputs) {
  const costs = calculateCosts(inputs);
  const marginRateParts = toRateParts(inputs.margin);
  const availableRateParts = RATE_SCALE - costs.salesRateParts - marginRateParts;
  const availableRate = availableRateParts / RATE_SCALE;
  const isValid = availableRateParts > 0;
  const minimumPriceCents = isValid ? ceilPriceCents(costs.baseCostCents, availableRateParts) : null;
  const taxExpensesCents = isValid ? multiplyCentsByRate(minimumPriceCents, inputs.taxRate) : 0;
  const paymentFeeCents = isValid ? multiplyCentsByRate(minimumPriceCents, inputs.paymentFeeRate) : 0;
  const commissionCents = isValid ? multiplyCentsByRate(minimumPriceCents, inputs.commissionRate) : 0;
  const salesExpensesCents = taxExpensesCents + paymentFeeCents + commissionCents;
  const profitPerSaleCents = isValid ? minimumPriceCents - costs.baseCostCents - salesExpensesCents : 0;
  const actualMargin = isValid && minimumPriceCents > 0 ? profitPerSaleCents / minimumPriceCents : 0;
  const competitorAverageCents = toCents(inputs.competitorAverage);
  const marketGap = isValid && competitorAverageCents > 0 ? (competitorAverageCents - minimumPriceCents) / competitorAverageCents : 0;
  const marketCostLimitCents = Math.max(0, multiplyCentsByRate(competitorAverageCents, availableRate));
  const requiredCostReductionCents = Math.max(0, costs.baseCostCents - marketCostLimitCents);

  return {
    costs,
    availableRate,
    availableRateParts,
    isValid,
    minimumPrice: minimumPriceCents === null ? null : fromCents(minimumPriceCents),
    minimumPriceCents,
    taxExpenses: fromCents(taxExpensesCents),
    taxExpensesCents,
    paymentFee: fromCents(paymentFeeCents),
    paymentFeeCents,
    commission: fromCents(commissionCents),
    commissionCents,
    salesExpenses: fromCents(salesExpensesCents),
    salesExpensesCents,
    profitPerSale: fromCents(profitPerSaleCents),
    profitPerSaleCents,
    actualMargin,
    marketGap,
    marketCostLimit: fromCents(marketCostLimitCents),
    marketCostLimitCents,
    requiredCostReduction: fromCents(requiredCostReductionCents),
    requiredCostReductionCents,
  };
}


const REQUIRED_FISCAL_FIELDS = Object.freeze([
  ["taxRegime", "regime tributário"],
  ["originState", "UF de origem"],
  ["destinationState", "UF de destino"],
  ["cfop", "CFOP"],
  ["taxSituation", "CST/CSOSN"],
  ["customerType", "tipo de cliente"],
  ["operationPurpose", "finalidade da operação"],
]);

const TAXES_REQUIRING_EXTERNAL_RULES = Object.freeze([
  "ICMS",
  "ICMS-ST",
  "DIFAL",
  "FCP",
  "IPI",
  "PIS/COFINS",
  "IBS/CBS/IS e demais regras da reforma tributária",
]);

class TaxRuleEngine {
  assess() {
    throw new Error("O motor tributário deve implementar assess().");
  }
}

class ConfiguredTaxRuleEngine extends TaxRuleEngine {
  assess(inputs, focusState = {}) {
    const fiscalContext = inputs.fiscalContext || {};
    const missingFields = REQUIRED_FISCAL_FIELDS
      .filter(([key]) => !String(fiscalContext[key] || "").trim())
      .map(([, label]) => label);
    const ncmVerified = focusState.status === "success" && focusState.ncm?.codigo === fiscalContext.ncmCode;
    const focusUnavailable = focusState.unavailable === true;

    return {
      automaticCalculation: false,
      complete: false,
      focusUnavailable,
      fiscalContext,
      missingFields,
      ncm: focusState.ncm || (fiscalContext.ncmCode ? { codigo: fiscalContext.ncmCode } : null),
      ncmSource: ncmVerified ? "Focus NFe" : fiscalContext.ncmCode ? "Usuário (não validado)" : "Não informado",
      taxes: [
        {
          key: "aggregate",
          label: "Carga tributária agregada estimada",
          rate: inputs.taxRate,
          source: "Usuário/regra configurada",
        },
      ],
      unresolvedTaxes: TAXES_REQUIRING_EXTERNAL_RULES,
      warnings: [
        "A Focus NFe confirma apenas a classificação NCM; ela não calcula os tributos desta venda.",
        "O NCM isolado não determina a tributação aplicável.",
        "A carga tributária agregada deve ser validada por contador ou especialista fiscal antes do uso operacional.",
      ],
    };
  }
}

function buildCalculationMemory(inputs, result, assessment) {
  const priceCents = result.minimumPriceCents || 0;
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const rateDescription = (rate) => `Base ${money.format(priceCents / 100)} | alíquota ${(rate * 100).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;

  return [
    { group: "Custo", label: "Custo do produto com perdas", valueCents: result.costs.materialsWithWasteCents, basis: "Custo informado + perda", source: "Usuário" },
    { group: "Custo", label: "Embalagem", valueCents: result.costs.packagingCostCents, basis: "Valor por venda", source: "Usuário" },
    { group: "Custo", label: "Frete/entrega", valueCents: result.costs.deliveryCostCents, basis: "Valor por venda", source: "Usuário" },
    { group: "Custo", label: "Seguro", valueCents: result.costs.insuranceCostCents, basis: "Valor por venda", source: "Usuário" },
    { group: "Custo", label: "Desconto", valueCents: -result.costs.discountAmountCents, basis: "Redução do custo", source: "Usuário" },
    { group: "Custo", label: "Despesas adicionais", valueCents: result.costs.otherExpensesCents, basis: "Valor por venda", source: "Usuário" },
    { group: "Custo", label: "Mão de obra direta", valueCents: result.costs.directLaborCents, basis: "176 h produtivas/mês", source: "Regra configurada" },
    { group: "Custo", label: "Capital de giro", valueCents: result.costs.workingCapitalCostCents, basis: "Prazos informados", source: "Usuário + regra configurada" },
    { group: "Custo", label: "Rateio de custos fixos", valueCents: result.costs.fixedCostAllocationCents, basis: "Volume mensal informado", source: "Usuário + regra configurada" },
    { group: "Tributo", label: assessment.taxes[0].label, valueCents: result.taxExpensesCents, basis: rateDescription(inputs.taxRate), baseCents: priceCents, rate: inputs.taxRate, source: assessment.taxes[0].source },
    { group: "Venda", label: "Taxa de pagamento", valueCents: result.paymentFeeCents, basis: rateDescription(inputs.paymentFeeRate), baseCents: priceCents, rate: inputs.paymentFeeRate, source: "Usuário" },
    { group: "Venda", label: "Comissão", valueCents: result.commissionCents, basis: rateDescription(inputs.commissionRate), baseCents: priceCents, rate: inputs.commissionRate, source: "Usuário" },
    { group: "Margem", label: "Margem líquida", valueCents: result.profitPerSaleCents, basis: rateDescription(inputs.margin), baseCents: priceCents, rate: inputs.margin, source: "Usuário" },
    { group: "Resultado", label: "Preço sugerido", valueCents: priceCents, basis: "Custo-base ÷ percentual disponível", source: "Regra configurada" },
  ];
}

function fiscalDataForStorage(assessment, memory) {
  return {
    automaticCalculation: assessment.automaticCalculation,
    complete: assessment.complete,
    context: assessment.fiscalContext,
    missingFields: assessment.missingFields,
    ncm: assessment.ncm,
    ncmSource: assessment.ncmSource,
    unresolvedTaxes: assessment.unresolvedTaxes,
    memory: memory.map((item) => ({ ...item, value: item.valueCents / 100, base: item.baseCents === undefined ? undefined : item.baseCents / 100 })),
  };
}



function marketBadgeForGap(gap) {
  const absoluteGap = Math.abs(gap);

  if (absoluteGap <= MARKET_RULES.closeGap) return ["ok", "Competitivo"];
  if (absoluteGap <= MARKET_RULES.attentionGap) return ["warning", "Atenção"];

  return ["risk", "Incompatível"];
}



const ACCESSORY_TERMS = new Set([
  "acessorio", "accessory", "cabo", "cable", "capa", "case", "carregador", "charger",
  "pelicula", "protector", "suporte", "holder",
]);

function normalizeText(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function extractTokens(value) {
  return normalizeText(value)
    .match(/[a-z0-9]+/g)
    ?.filter((token) => token.length >= 3 || /^\d+$/.test(token)) || [];
}

function isComparable(item, query) {
  const queryTokens = extractTokens(query);
  const titleTokens = extractTokens(item.title);
  const categoryTokens = extractTokens(item.category);
  const compactTitle = normalizeText(item.title).replace(/\s+/g, "");
  const introducesAccessory = [...ACCESSORY_TERMS].some((term) =>
    (titleTokens.includes(term) || categoryTokens.includes(term)) && !queryTokens.includes(term));
  return !introducesAccessory
    && queryTokens.every((token) => titleTokens.includes(token) || compactTitle.includes(token));
}

function calculateMedian(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function calculateMarketStats(items) {
  const prices = items
    .filter((item) => item.currency === "BRL")
    .map((item) => Number(item.price))
    .filter((price) => Number.isFinite(price) && price > 0);
  if (prices.length === 0) return null;

  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
    average: prices.reduce((sum, price) => sum + price, 0) / prices.length,
    median: calculateMedian(prices),
    count: prices.length,
  };
}

function normalizeItem(item) {
  const price = Number(item?.price);
  if (
    !item?.id
    || !item?.title
    || !item?.url
    || item.currency !== "BRL"
    || !Number.isFinite(price)
    || price <= 0
  ) return null;

  return {
    id: String(item.id),
    asin: String(item.asin || item.id),
    title: String(item.title),
    price,
    source: String(item.source || "Marketplace"),
    currency: "BRL",
    category: String(item.category || ""),
    image: String(item.image || ""),
    url: String(item.url),
    consultedAt: String(item.consultedAt || ""),
  };
}

class MarketService {
  #api;

  constructor(apiClient = api) {
    this.#api = apiClient;
  }

  async search(query) {
    const normalizedQuery = String(query || "").trim().replace(/\s+/g, " ");
    const response = await this.#api.get(`/market/search?q=${encodeURIComponent(normalizedQuery)}`, { handleUnauthorized: false });
    const seenIds = new Set();
    const items = (Array.isArray(response?.results) ? response.results : [])
      .map(normalizeItem)
      .filter((item) => {
        if (!item || seenIds.has(item.id) || !isComparable(item, normalizedQuery)) return false;
        seenIds.add(item.id);
        return true;
      })
      .slice(0, 5);
    return {
      query: normalizedQuery,
      marketplace: response?.marketplace || "Marketplace",
      provider: response?.provider || "Nexscope",
      items,
      stats: calculateMarketStats(items),
    };
  }
}


class ApiError extends Error {
  constructor(message, status = 0, code = "", details = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isGitHubPages() {
  return window.location.hostname.endsWith(".github.io");
}

async function request(path, options = {}) {
  const { method = "GET", body, handleUnauthorized = true } = options;
  if (isGitHubPages() && (path.startsWith("/auth") || path.startsWith("/products") || path.startsWith("/market"))) {
    throw new ApiError(
      "Este endereço do GitHub Pages exibe apenas a interface. Abra a URL da aplicação no Render para criar ou acessar sua conta.",
      503,
      "STATIC_HOSTING",
    );
  }
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    console.error(`[api] Falha de rede em ${method} ${path}:`, error);
    throw new ApiError("Não foi possível conectar ao servidor.", 0);
  }

  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (response.ok) return payload;

  const error = new ApiError(payload?.error || "Não foi possível concluir a operação.", response.status, payload?.code || "", payload || {});
  if (handleUnauthorized && response.status === 401) window.dispatchEvent(new CustomEvent("app:session-expired"));
  throw error;
}

const api = {
  get: (path, options) => request(path, options),
  post: (path, body, options) => request(path, { ...options, method: "POST", body }),
  patch: (path, body, options) => request(path, { ...options, method: "PATCH", body }),
  delete: (path, options) => request(path, { ...options, method: "DELETE" }),
};


const MARKET_REFERENCE_KEY = "assistente-precificacao-market-reference-v1";

function safeMarketItem(value) {
  const price = Number(value?.price);
  if (!value?.id || !value?.title || !Number.isFinite(price) || price <= 0) return null;
  return {
    id: String(value.id),
    asin: String(value.asin || value.id),
    title: String(value.title),
    price,
    source: String(value.source || "Marketplace"),
    currency: String(value.currency || "BRL"),
    category: String(value.category || ""),
    image: String(value.image || ""),
    url: String(value.url || ""),
    consultedAt: String(value.consultedAt || ""),
  };
}

function loadMarketReference(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(MARKET_REFERENCE_KEY) || "null");
    const selectedItem = safeMarketItem(parsed?.selectedItem);
    const manualValue = Number(parsed?.manualValue);
    const hasManualValue = parsed?.manualValue !== null && parsed?.manualValue !== "";
    if (!selectedItem || (hasManualValue && (!Number.isFinite(manualValue) || manualValue <= 0))) return null;
    return { manualValue: hasManualValue ? manualValue : null, query: String(parsed.query || ""), selectedItem };
  } catch {
    return null;
  }
}

function saveMarketReference(storage, { manualValue, query, selectedItem }) {
  const safeItem = safeMarketItem(selectedItem);
  const safeManualValue = Number(manualValue);
  const hasManualValue = manualValue !== null && manualValue !== "";
  if (!safeItem || (hasManualValue && (!Number.isFinite(safeManualValue) || safeManualValue <= 0))) return false;
  try {
    storage?.setItem(MARKET_REFERENCE_KEY, JSON.stringify({ manualValue: hasManualValue ? safeManualValue : null, query, selectedItem: safeItem }));
    return true;
  } catch {
    return false;
  }
}

function clearMarketReference(storage) {
  try {
    storage?.removeItem(MARKET_REFERENCE_KEY);
  } catch {
    // A referência continua válida em memória quando o armazenamento está indisponível.
  }
}



const PRICING_FIELD_RULES = Object.freeze({
  materialsCost: { requiredMessage: "Informe o custo dos insumos.", min: 0, minMessage: "O custo dos insumos não pode ser negativo." },
  waste: { requiredMessage: "Informe a perda e desperdício.", min: 0, max: 100, minMessage: "A perda e desperdício não pode ser negativa.", maxMessage: "A perda e desperdício máxima permitida é 100%." },
  packagingCost: { requiredMessage: "Informe o custo de embalagem.", min: 0, minMessage: "O custo de embalagem não pode ser negativo." },
  deliveryCost: { requiredMessage: "Informe o frete ou custo de entrega.", min: 0, minMessage: "O frete ou custo de entrega não pode ser negativo." },
  insuranceCost: { optional: true, min: 0, minMessage: "O seguro não pode ser negativo." },
  discountAmount: { optional: true, min: 0, minMessage: "O desconto não pode ser negativo." },
  otherExpenses: { optional: true, min: 0, minMessage: "As outras despesas não podem ser negativas." },
  totalPayroll: { requiredMessage: "Informe a folha salarial mensal.", min: 0, minMessage: "A folha salarial não pode ser negativa." },
  workerCount: { requiredMessage: "Informe o número de trabalhadores.", min: 1, integer: true, minMessage: "O número de trabalhadores deve ser pelo menos 1." },
  outputPerWorkerHour: { requiredMessage: "Informe a produção por trabalhador/hora.", min: 0.01, minMessage: "A produção por trabalhador/hora deve ser pelo menos 0,01." },
  monthlyFixedCosts: { requiredMessage: "Informe os custos fixos mensais.", min: 0, minMessage: "Os custos fixos não podem ser negativos." },
  monthlyVolume: { requiredMessage: "Informe as operações previstas no mês.", min: 1, integer: true, minMessage: "As operações previstas devem ser pelo menos 1." },
  taxRate: { requiredMessage: "Informe a carga tributária estimada.", min: 0, max: 60, minMessage: "A carga tributária não pode ser negativa.", maxMessage: "A carga tributária máxima permitida é 60%." },
  paymentFeeRate: { requiredMessage: "Informe a taxa de pagamento.", min: 0, max: 30, minMessage: "A taxa de pagamento não pode ser negativa.", maxMessage: "A taxa de pagamento máxima permitida é 30%." },
  commissionRate: { requiredMessage: "Informe a comissão.", min: 0, max: 50, minMessage: "A comissão não pode ser negativa.", maxMessage: "A comissão máxima permitida é 50%." },
  margin: { requiredMessage: "Informe a margem líquida desejada.", min: 0.1, max: 60, minMessage: "A margem mínima permitida é 0,1%.", maxMessage: "A margem máxima permitida é 60%." },
  competitorAverage: { requiredMessage: "Informe o preço médio local dos concorrentes.", min: 0.01, max: 1_000_000, minMessage: "O preço médio dos concorrentes deve ser pelo menos R$ 0,01.", maxMessage: "O preço médio dos concorrentes não pode ultrapassar R$ 1.000.000,00." },
  receiveDays: { requiredMessage: "Informe o prazo de recebimento.", min: 0, integer: true, minMessage: "O prazo de recebimento não pode ser negativo." },
  payDays: { requiredMessage: "Informe o prazo de pagamento.", min: 0, integer: true, minMessage: "O prazo de pagamento não pode ser negativo." },
  capitalRate: { requiredMessage: "Informe o custo do capital.", min: 0, max: 8, minMessage: "O custo do capital não pode ser negativo.", maxMessage: "O custo do capital máximo permitido é 8% ao mês." },
});

const PRICING_FIELD_IDS = Object.freeze(Object.keys(PRICING_FIELD_RULES));

function parseBrazilianNumber(rawValue) {
  const value = String(rawValue ?? "").trim().replace(/\s/g, "");
  if (value === "") return { status: "empty", value: null };

  const commaCount = (value.match(/,/g) || []).length;
  const normalizedValue = commaCount === 1
    ? value.replace(/\./g, "").replace(",", ".")
    : value;
  if (commaCount > 1 || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalizedValue)) {
    return { status: "invalid", value: null };
  }

  const numericValue = Number(normalizedValue);
  return Number.isFinite(numericValue)
    ? { status: "valid", value: numericValue }
    : { status: "invalid", value: null };
}

function readFiscalContext(elements) {
  return {
    ncmCode: String(elements.ncmCode.value || "").replace(/\D/g, ""),
    taxRegime: elements.taxRegime.value,
    originState: elements.originState.value.trim().toUpperCase(),
    destinationState: elements.destinationState.value.trim().toUpperCase(),
    cfop: String(elements.cfop.value || "").replace(/\D/g, ""),
    taxSituation: elements.taxSituation.value.trim().toUpperCase(),
    customerType: elements.customerType.value,
    operationPurpose: elements.operationPurpose.value,
  };
}

function validatePricingForm(elements) {
  const errors = {};
  const inputs = {};
  const emptyOptionalFields = [];

  for (const [fieldId, rule] of Object.entries(PRICING_FIELD_RULES)) {
    const parsed = parseBrazilianNumber(elements[fieldId]?.value);
    if (parsed.status === "empty") {
      if (rule.optional) {
        inputs[fieldId] = 0;
        emptyOptionalFields.push(fieldId);
      } else {
        errors[fieldId] = rule.requiredMessage;
      }
      continue;
    }
    if (parsed.status === "invalid") {
      errors[fieldId] = "Informe um número válido.";
      continue;
    }
    if (rule.integer && !Number.isInteger(parsed.value)) {
      errors[fieldId] = "Informe um número inteiro.";
      continue;
    }
    if (rule.min !== undefined && parsed.value < rule.min) {
      errors[fieldId] = rule.minMessage;
      continue;
    }
    if (rule.max !== undefined && parsed.value > rule.max) {
      errors[fieldId] = rule.maxMessage;
      continue;
    }
    inputs[fieldId] = PERCENTAGE_FIELDS.has(fieldId) ? parsed.value / 100 : parsed.value;
  }

  const rateFields = ["taxRate", "paymentFeeRate", "commissionRate", "margin"];
  if (rateFields.every((fieldId) => inputs[fieldId] !== undefined)) {
    const totalRate = rateFields.reduce((total, fieldId) => total + inputs[fieldId], 0);
    if (totalRate >= 1) errors.margin = "A soma de impostos, taxas, comissão e margem deve ser menor que 100%.";
  }

  const isValid = Object.keys(errors).length === 0;
  return {
    isValid,
    errors,
    emptyOptionalFields,
    inputs: isValid ? { ...inputs, fiscalContext: readFiscalContext(elements) } : null,
  };
}

function renderPricingErrors(elements, errors, visibleFieldIds = null) {
  for (const fieldId of PRICING_FIELD_IDS) {
    const field = elements[fieldId];
    if (!field) continue;
    const error = errors[fieldId] || "";
    const isVisible = Boolean(error) && (visibleFieldIds === null || visibleFieldIds.has(fieldId));
    field.setCustomValidity?.(error);
    field.setAttribute("aria-invalid", String(isVisible));

    const container = field.closest?.(".sidebar-field");
    if (!container) continue;
    container.classList.toggle("has-error", isVisible);
    const errorId = `${fieldId}Error`;
    let errorElement = field.ownerDocument.getElementById(errorId);
    if (!errorElement) {
      errorElement = field.ownerDocument.createElement("p");
      errorElement.id = errorId;
      errorElement.className = "pricing-field-error";
      errorElement.setAttribute("role", "alert");
      container.append(errorElement);
      const describedBy = new Set(String(field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
      describedBy.add(errorId);
      field.setAttribute("aria-describedby", [...describedBy].join(" "));
    }
    errorElement.textContent = isVisible ? error : "";
    errorElement.hidden = !isVisible;
  }
}

function applySavedInputs(savedInputs, elements, emptyOptionalFields = []) {
  if (!savedInputs || typeof savedInputs !== "object") return false;
  const fieldsToKeepEmpty = new Set(Array.isArray(emptyOptionalFields) ? emptyOptionalFields : []);

  Object.entries(savedInputs).forEach(([field, value]) => {
    if (!elements[field] || !Number.isFinite(value)) return;
    if (fieldsToKeepEmpty.has(field)) {
      elements[field].value = "";
      return;
    }
    const displayValue = PERCENTAGE_FIELDS.has(field) ? value * 100 : value;
    elements[field].value = String(Number(displayValue.toFixed(4))).replace(".", ",");
  });

  if (savedInputs.fiscalContext && typeof savedInputs.fiscalContext === "object") {
    Object.entries(savedInputs.fiscalContext).forEach(([field, value]) => {
      if (elements[field] && typeof value === "string") elements[field].value = value;
    });
  }

  return true;
}



function priceCompositionFrom(result) {
  if (!result.isValid || !result.minimumPriceCents) return [];

  const components = [
    { label: "Custos diretos líquidos", valueCents: result.costs.directCashCostCents },
    { label: "Capital de giro", valueCents: result.costs.workingCapitalCostCents },
    { label: "Rateio de custos fixos", valueCents: result.costs.fixedCostAllocationCents },
    { label: "Impostos, taxas e comissão", valueCents: result.salesExpensesCents },
    { label: "Lucro líquido", valueCents: result.profitPerSaleCents },
  ].filter((item) => item.valueCents > 0);

  const representedTotalCents = components.reduce((total, item) => total + item.valueCents, 0);
  return components.map((item) => ({
    ...item,
    share: representedTotalCents > 0 ? item.valueCents / representedTotalCents : 0,
  }));
}

function priceComparisonFrom(inputs, result) {
  const values = [
    { label: "Custo-base", value: result.costs.baseCost },
    { label: "Preço recomendado", value: result.minimumPrice || 0 },
    { label: "Média do mercado", value: inputs.competitorAverage },
  ];
  const maximum = Math.max(...values.map((item) => item.value), 1);

  return values.map((item) => ({
    ...item,
    width: clamp((item.value / maximum) * 100, 0, 100),
  }));
}

function renderComposition(document, result) {
  const donut = document.querySelector("#priceDonut");
  const segments = document.querySelector("#priceDonutSegments");
  const legend = document.querySelector("#priceCompositionLegend");
  const components = priceCompositionFrom(result);

  if (components.length === 0) {
    segments.innerHTML = "";
    donut.setAttribute("aria-label", "Composição indisponível enquanto o cálculo estiver inválido.");
    legend.innerHTML = '<li class="chart-empty">Revise os percentuais para visualizar a composição.</li>';
    return;
  }

  let cursor = 0;
  segments.innerHTML = components
    .map((item, index) => {
      const segmentSize = item.share * 100;
      const offset = -cursor;
      cursor += segmentSize;
      return `<circle class="donut-segment donut-segment-${index + 1}" cx="60" cy="60" r="48" pathLength="100" stroke-dasharray="${segmentSize.toFixed(4)} ${(100 - segmentSize).toFixed(4)}" stroke-dashoffset="${offset.toFixed(4)}"></circle>`;
    })
    .join("");
  donut.setAttribute(
    "aria-label",
    components.map((item) => `${item.label}: ${percent(item.share)}`).join(". "),
  );
  legend.innerHTML = components
    .map(
      (item, index) => `
        <li>
          <span class="chart-legend-color chart-legend-color-${index + 1}" aria-hidden="true"></span>
          <span>${escapeHtml(item.label)}</span>
          <strong>${currency.format(item.valueCents / 100)}</strong>
          <small>${percent(item.share)}</small>
        </li>`,
    )
    .join("");
}

function renderComparison(document, inputs, result, marketText) {
  const comparison = priceComparisonFrom(inputs, result);
  document.querySelector("#priceComparisonBars").innerHTML = comparison
    .map(
      (item, index) => `
        <li>
          <div><span>${escapeHtml(item.label)}</span><strong>${currency.format(item.value)}</strong></div>
          <progress class="comparison-track comparison-fill-${index + 1}" max="100" value="${item.width.toFixed(2)}" aria-label="${escapeHtml(item.label)}: ${percent(item.width / 100)} da maior referência"></progress>
        </li>`,
    )
    .join("");
  document.querySelector("#detailMarketNarrative").textContent = marketText;
}

function renderPriceDetails(document, inputs, result, marketText, alertCount) {
  const validPrice = result.isValid ? currency.format(result.minimumPrice) : "Revise percentuais";
  const validMargin = result.isValid ? percent(result.actualMargin) : "-";

  document.querySelector("#detailSuggestedPrice").textContent = validPrice;
  document.querySelector("#detailDonutPrice").textContent = result.isValid ? currency.format(result.minimumPrice) : "-";
  document.querySelector("#detailBaseCost").textContent = currency.format(result.costs.baseCost);
  document.querySelector("#detailSalesRate").textContent = percent(result.costs.salesRate);
  document.querySelector("#detailProfit").textContent = result.isValid ? currency.format(result.profitPerSale) : "-";
  document.querySelector("#detailMargin").textContent = validMargin;
  document.querySelector("#detailMarketPrice").textContent = currency.format(inputs.competitorAverage);
  document.querySelector("#detailMarketCostLimit").textContent = currency.format(result.marketCostLimit);
  document.querySelector("#detailAlertCount").textContent = `${alertCount} ${alertCount === 1 ? "ponto de atenção" : "pontos de atenção"}`;

  renderComposition(document, result);
  renderComparison(document, inputs, result, marketText);
}

function renderPriceDetailsUnavailable(document, invalidCount) {
  [
    "detailSuggestedPrice",
    "detailDonutPrice",
    "detailBaseCost",
    "detailSalesRate",
    "detailProfit",
    "detailMargin",
    "detailMarketPrice",
    "detailMarketCostLimit",
  ].forEach((id) => { document.querySelector(`#${id}`).textContent = "-"; });
  document.querySelector("#detailAlertCount").textContent = `${invalidCount} ${invalidCount === 1 ? "campo pendente" : "campos pendentes"}`;
  document.querySelector("#priceDonutSegments").innerHTML = "";
  document.querySelector("#priceDonut").setAttribute("aria-label", "Composição indisponível enquanto o formulário estiver inválido.");
  document.querySelector("#priceCompositionLegend").innerHTML = '<li class="chart-empty">Preencha os campos obrigatórios para visualizar a composição.</li>';
  document.querySelector("#priceComparisonBars").innerHTML = "";
  document.querySelector("#detailMarketNarrative").textContent = "A comparação será exibida depois que os dados da precificação forem validados.";
}



function marketComparisonText(inputs, result, marketStats, marketSource) {
  const difference = Math.abs(inputs.competitorAverage - result.minimumPrice);
  const relativeGap = Math.abs(result.marketGap);
  const confidenceNote = marketStats && marketStats.count < AMAZON_MARKET_CONFIG.minComparableResults ? " A amostra é pequena, então use como sinal preliminar." : "";

  if (relativeGap <= 0.08) return `Seu preço está próximo do mercado, com diferença de ${percent(relativeGap)}.${confidenceNote}`;
  if (result.marketGap >= 0) return `Seu preço está ${percent(relativeGap)} abaixo do mercado. Diferença: ${currency.format(difference)}.${confidenceNote}`;

  return `Seu preço está ${percent(relativeGap)} acima do mercado. Diferença: ${currency.format(difference)}.${confidenceNote}`;
}

function renderExplanation(document, inputs, result, fiscalAssessment) {
  const { costs } = result;
  const items = [
    `Insumos e matéria-prima, já com ${percent(inputs.waste)} de perda: ${currency.format(costs.materialsWithWaste)}.`,
    `Mão de obra direta: ${currency.format(costs.directLabor)} por unidade, usando ${inputs.workerCount} trabalhador(es), folha total de ${currency.format(inputs.totalPayroll)} e ${inputs.outputPerWorkerHour.toLocaleString("pt-BR")} unidade(s) por trabalhador/hora.`,
    `Capacidade mensal de produção: ${costs.monthlyProductionCapacity.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} unidades, considerando ${PRODUCTIVE_HOURS_PER_WORKER_MONTH} horas produtivas por trabalhador no mês.`,
    `Rateio de custos fixos: ${currency.format(costs.fixedCostAllocation)} por venda, usando ${inputs.monthlyVolume.toLocaleString("pt-BR")} operações previstas no mês.`,
    `A carga tributária agregada informada, a taxa de pagamento e a comissão somam ${percent(costs.salesRate)} e incidem sobre o preço final.`,
    "Fórmula aplicada: custo-base ÷ (1 − despesas sobre a venda − margem líquida).",
    "A Focus NFe é usada para validar o NCM, não para calcular impostos. A composição tributária precisa de regras fiscais externas.",
  ];

  if (fiscalAssessment.missingFields.length > 0) {
    items.push(`Contexto fiscal ainda incompleto: ${fiscalAssessment.missingFields.join(", ")}.`);
  }

  document.querySelector("#explanationList").innerHTML = items.map((item) => `<li>${item}</li>`).join("");
}

function renderCostTable(document, memory) {
  document.querySelector("#costRows").innerHTML = memory
    .map(
      (item) => `
        <tr>
          <td><small>${escapeHtml(item.group)}</small><br>${escapeHtml(item.label)}</td>
          <td>${currency.format(item.valueCents / 100)}</td>
          <td>${escapeHtml(item.basis)}</td>
          <td>${escapeHtml(item.source)}</td>
        </tr>`,
    )
    .join("");
}

function dashboardAlerts(inputs, result, fiscalAssessment) {
  const alerts = [];
  const { costs } = result;

  if (!result.isValid) alerts.push(["risk", "A soma de impostos, taxas, comissão e margem não pode chegar a 100% do preço."]);
  if (result.isValid && result.marketGap < 0) alerts.push(["risk", `Para caber na média do mercado mantendo as taxas e a margem, o custo-base precisa cair ${currency.format(result.requiredCostReduction)} por venda.`]);
  if (costs.cashGapDays > 0) alerts.push(["warning", `Você recebe ${costs.cashGapDays} dia(s) depois de pagar. O custo do capital acrescentou ${currency.format(costs.workingCapitalCost)} por venda.`]);
  if (costs.salesRate > 0.2) alerts.push(["warning", `Impostos, taxas e comissão consomem ${percent(costs.salesRate)} do preço final.`]);
  if (fiscalAssessment.focusUnavailable) alerts.push(["warning", "A Focus NFe está indisponível. O cálculo financeiro foi preservado, mas o NCM não está validado."]);
  alerts.push(["warning", "Estimativa fiscal pendente: a carga tributária agregada não substitui o cálculo de ICMS, ICMS-ST, DIFAL, FCP, IPI, PIS/COFINS ou IBS/CBS/IS."]);
  if (alerts.length === 0) alerts.push(["ok", "Preço sustentável: custos, despesas sobre a venda e margem foram cobertos sem ultrapassar a média informada."]);

  return alerts;
}

function renderAlerts(document, alerts) {
  document.querySelector("#alerts").innerHTML = alerts.map(([type, text]) => `<div class="${type}">${text}</div>`).join("");
}

function renderFiscalSummary(document, assessment) {
  const ncmDescription = assessment.ncm?.descricao_completa ? ` — ${assessment.ncm.descricao_completa}` : "";
  const contextStatus = assessment.missingFields.length === 0
    ? "Contexto básico preenchido; ainda requer regra tributária especializada."
    : `Faltam: ${assessment.missingFields.join(", ")}.`;

  document.querySelector("#fiscalSummary").innerHTML = `
    <p><strong>NCM:</strong> ${escapeHtml(assessment.ncm?.codigo || "não informado")}${escapeHtml(ncmDescription)} <small>(${escapeHtml(assessment.ncmSource)})</small></p>
    <p><strong>Status:</strong> ${escapeHtml(contextStatus)}</p>
    <p><strong>Tributos não determinados pela Focus NFe:</strong> ${escapeHtml(assessment.unresolvedTaxes.join(", "))}.</p>
    <p><strong>Resultado:</strong> estimativa financeira; não é uma validação fiscal da operação.</p>`;
}

function renderMarketPanel(document, result, marketState) {
  const panel = document.querySelector("#marketPanel");
  const summary = document.querySelector("#marketSummary");
  const statsContainer = document.querySelector("#marketStats");
  const resultsContainer = document.querySelector("#marketResults");
  const searchButton = document.querySelector("#marketSearchButton");
  const searchStatus = document.querySelector("#marketSearchStatus");
  const selectedContainer = document.querySelector("#selectedMarketProduct");

  panel.hidden = marketState.status === "idle";
  summary.hidden = !marketState.selectedItem;
  searchButton.disabled = marketState.status === "loading";
  searchButton.textContent = marketState.status === "loading" ? "Buscando preços..." : "Pesquisar produto";
  selectedContainer.hidden = !marketState.selectedItem;
  selectedContainer.innerHTML = marketState.selectedItem
    ? `<p class="eyebrow">Referência selecionada</p><h3>${escapeHtml(marketState.selectedItem.title)}</h3><strong>${currency.format(marketState.selectedItem.price)}</strong><span>Fonte: ${escapeHtml(marketState.selectedItem.source)}</span><small>Tributação pendente; nenhuma alíquota ou NCM foi presumido.</small><button type="button" class="secondary-button" data-change-market-reference>Trocar produto</button>`
    : "";

  if (marketState.status === "loading") {
    searchStatus.textContent = "Buscando preços...";
    statsContainer.innerHTML = '<div class="market-loading"><span aria-hidden="true"></span><p>Consultando produtos no mercado...</p></div>';
    resultsContainer.innerHTML = "";
    return;
  }

  if (marketState.status === "error") {
    searchStatus.textContent = "Não foi possível concluir a pesquisa.";
    statsContainer.innerHTML = `
      <div class="market-error-alert" role="alert">
        <span class="market-error-icon" aria-hidden="true">!</span>
        <div><strong>Não foi possível consultar o mercado agora.</strong><p>${escapeHtml(marketState.error)}</p></div>
        <button type="button" class="secondary-button" data-market-retry>Tentar novamente</button>
      </div>`;
    resultsContainer.innerHTML = "";
    return;
  }

  if (marketState.status === "empty") {
    searchStatus.textContent = "Não encontramos produtos compatíveis.";
    statsContainer.innerHTML = '<p class="helper-text">Tente informar marca, modelo, capacidade, tamanho ou voltagem com mais precisão.</p>';
    resultsContainer.innerHTML = "";
    return;
  }

  if (!marketState.stats) {
    searchStatus.textContent = "A pesquisa é opcional. O valor manual só muda quando você escolher um produto.";
    statsContainer.innerHTML = "";
    resultsContainer.innerHTML = "";
    return;
  }

  const { stats } = marketState;
  searchStatus.textContent = `${stats.count} produto(s) encontrado(s). Escolha uma referência para atualizar o dashboard.`;
  summary.innerHTML = marketState.selectedItem
    ? `<span>Fonte: ${escapeHtml(marketState.selectedItem.source)}</span><strong>${currency.format(marketState.selectedItem.price)}</strong><small>${escapeHtml(marketState.selectedItem.title)}</small>`
    : "";
  statsContainer.innerHTML = "";
  resultsContainer.innerHTML = marketState.items
    .map((item) => `
        <article class="amazon-result${marketState.selectedItem?.id === item.id ? " selected" : ""}">
          ${item.image ? `<img src="${escapeHtml(item.image)}" alt="">` : '<div class="amazon-image-placeholder"></div>'}
          <div>
            <h4>${escapeHtml(item.title)}</h4>
            <p>${escapeHtml(item.category || "Categoria não informada")} · Fonte: ${escapeHtml(item.source)}</p>
            <strong>${currency.format(item.price)}</strong>
          </div>
          <div class="amazon-actions">
            <button type="button" data-market-select="${escapeHtml(item.id)}">${marketState.selectedItem?.id === item.id ? "Referência ativa" : "Usar como referência"}</button>
            <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Ver na ${escapeHtml(item.source)}</a>
          </div>
        </article>`)
    .join("");
}

function renderIncompleteDashboard(document, marketState, errors) {
  const invalidCount = Object.keys(errors).length;
  const selectedMarketProduct = marketState.selectedItem;
  const generalMessage = invalidCount === 1
    ? "Corrija o campo indicado para liberar o cálculo."
    : "Preencha ou corrija os campos indicados para liberar o cálculo.";

  document.querySelector("#baseCost").textContent = "-";
  document.querySelector("#marketPrice").textContent = selectedMarketProduct ? currency.format(selectedMarketProduct.price) : "-";
  document.querySelector("#marketTitle").textContent = selectedMarketProduct ? selectedMarketProduct.title : "Preço médio informado";
  document.querySelector("#marketReferenceDetails").textContent = selectedMarketProduct ? `Fonte: ${selectedMarketProduct.source}` : "Aguardando valor válido";
  document.querySelector("#marketPriceLabel").textContent = selectedMarketProduct ? "Produto selecionado" : "Referência manual";

  const primaryMarketValue = document.querySelector("#primaryMarketValue");
  const primaryTaxImpact = document.querySelector("#primaryTaxImpact");
  document.querySelector("#primaryPriceCard").classList.toggle("has-market-reference", Boolean(selectedMarketProduct));
  primaryMarketValue.hidden = !selectedMarketProduct;
  primaryTaxImpact.hidden = !selectedMarketProduct;
  document.querySelector("#primaryMarketPrice").textContent = selectedMarketProduct ? currency.format(selectedMarketProduct.price) : "-";
  document.querySelector("#primaryMarketSource").textContent = selectedMarketProduct ? `Fonte: ${selectedMarketProduct.source}` : "Fonte: mercado";
  document.querySelector("#primaryTaxAdjustedPrice").textContent = "Tributação pendente";
  document.querySelector("#primaryTaxStatus").textContent = "Complete a precificação antes de avaliar o impacto fiscal.";
  primaryTaxImpact.classList.add("is-pending");

  document.querySelector("#suggestedPrice").textContent = "-";
  document.querySelector("#profitPerSale").textContent = "-";
  document.querySelector("#estimatedMargin").textContent = "-";
  const priceStatus = document.querySelector("#priceStatus");
  priceStatus.textContent = "Aguardando dados válidos";
  priceStatus.classList.remove("risk-badge", "warning-badge");
  document.querySelector("#recommendationText").textContent = generalMessage;
  document.querySelector("#marketStatus").textContent = "O mercado será comparado somente depois que todos os dados necessários forem válidos.";
  const marketMeter = document.querySelector("#marketMeter");
  marketMeter.value = 0;
  marketMeter.setAttribute("aria-valuetext", "Cálculo ainda não realizado");
  marketMeter.classList.remove("over");

  document.querySelector("#alertCount").textContent = `${invalidCount} ${invalidCount === 1 ? "campo pendente" : "campos pendentes"}`;
  document.querySelector("#alertSummary").textContent = generalMessage;
  document.querySelector("#explanationList").innerHTML = `<li>${generalMessage}</li>`;
  document.querySelector("#costRows").innerHTML = '<tr><td colspan="4">Os custos serão detalhados após a validação do formulário.</td></tr>';
  renderAlerts(document, [["warning", generalMessage]]);
  document.querySelector("#fiscalSummary").innerHTML = "<p>O resumo fiscal será exibido depois que os dados financeiros obrigatórios forem validados.</p>";

  renderMarketPanel(document, null, marketState);
  renderPriceDetailsUnavailable(document, invalidCount);
}

function renderDashboard(document, inputs, result, marketState, marketSource, fiscalAssessment, memory) {
  const { costs } = result;
  const activeMarketStats = marketSource === "market-median" ? marketState.stats : null;
  const selectedMarketProduct = marketSource === "market-product" ? marketState.selectedItem : null;
  const alerts = dashboardAlerts(inputs, result, fiscalAssessment);

  document.querySelector("#baseCost").textContent = currency.format(costs.baseCost);
  document.querySelector("#marketPrice").textContent = currency.format(inputs.competitorAverage);
  document.querySelector("#marketTitle").textContent = selectedMarketProduct ? selectedMarketProduct.title : "Preço médio informado";
  document.querySelector("#marketReferenceDetails").textContent = selectedMarketProduct
    ? `Fonte: ${selectedMarketProduct.source}`
    : "Fonte: valor manual";
  document.querySelector("#marketPriceLabel").textContent = selectedMarketProduct
    ? "Produto selecionado"
    : "Referência manual";

  const primaryMarketValue = document.querySelector("#primaryMarketValue");
  const primaryTaxImpact = document.querySelector("#primaryTaxImpact");
  document.querySelector("#primaryPriceCard").classList.toggle("has-market-reference", Boolean(selectedMarketProduct));
  primaryMarketValue.hidden = !selectedMarketProduct;
  primaryTaxImpact.hidden = !selectedMarketProduct;
  document.querySelector("#primaryMarketPrice").textContent = currency.format(selectedMarketProduct?.price || 0);
  document.querySelector("#primaryMarketSource").textContent = selectedMarketProduct ? `Fonte: ${selectedMarketProduct.source}` : "Fonte: mercado";
  const hasRealTaxImpact = fiscalAssessment.automaticCalculation
    && fiscalAssessment.complete
    && Number.isFinite(fiscalAssessment.marketAdjustedPrice);
  document.querySelector("#primaryTaxAdjustedPrice").textContent = hasRealTaxImpact
    ? currency.format(fiscalAssessment.marketAdjustedPrice)
    : "Tributação pendente";
  document.querySelector("#primaryTaxStatus").textContent = hasRealTaxImpact
    ? "Valor calculado pelo provedor fiscal configurado."
    : "Nenhum TaxProvider de cálculo está configurado.";
  primaryTaxImpact.classList.toggle("is-pending", !hasRealTaxImpact);

  const suggestedPrice = document.querySelector("#suggestedPrice");
  const profitPerSale = document.querySelector("#profitPerSale");
  const estimatedMargin = document.querySelector("#estimatedMargin");
  const priceStatus = document.querySelector("#priceStatus");
  const recommendationText = document.querySelector("#recommendationText");
  const marketStatus = document.querySelector("#marketStatus");
  const marketMeter = document.querySelector("#marketMeter");
  let marketText;

  if (result.isValid) {
    suggestedPrice.textContent = currency.format(result.minimumPrice);
    profitPerSale.textContent = currency.format(result.profitPerSale);
    estimatedMargin.textContent = percent(result.actualMargin);
    priceStatus.textContent = "Estimativa fiscal pendente";
    priceStatus.classList.remove("risk-badge");
    priceStatus.classList.add("warning-badge");
    recommendationText.textContent = "Preço mínimo financeiro para cobrir custos, despesas de venda e margem. Valide a composição tributária com seu contador antes de usar como preço fiscal.";
    marketText = marketComparisonText(inputs, result, activeMarketStats, marketSource);
    marketStatus.textContent = marketText;
    marketMeter.value = clamp((result.minimumPrice / inputs.competitorAverage) * 100, 0, 100);
    marketMeter.setAttribute("aria-valuetext", `${percent(marketMeter.value / 100)} do preço médio de mercado`);
    marketMeter.classList.toggle("over", result.marketGap < 0);
  } else {
    suggestedPrice.textContent = "Revise percentuais";
    profitPerSale.textContent = "-";
    estimatedMargin.textContent = "-";
    priceStatus.textContent = "Cálculo inviável";
    priceStatus.classList.add("risk-badge");
    priceStatus.classList.remove("warning-badge");
    recommendationText.textContent = "Impostos, taxas, comissão e margem somam 100% ou mais do preço. Reduza algum percentual para calcular.";
    marketText = "Não é possível validar o mercado enquanto os percentuais consumirem todo o preço.";
    marketStatus.textContent = marketText;
    marketMeter.value = 100;
    marketMeter.setAttribute("aria-valuetext", "Cálculo inviável");
    marketMeter.classList.add("over");
  }

  document.querySelector("#alertCount").textContent = `${alerts.length} ${alerts.length === 1 ? "alerta importante" : "alertas importantes"}`;
  document.querySelector("#alertSummary").textContent = alerts[0][1];

  renderExplanation(document, inputs, result, fiscalAssessment);
  renderCostTable(document, memory);
  renderAlerts(document, alerts);
  renderFiscalSummary(document, fiscalAssessment);
  renderMarketPanel(document, result, marketState);
  renderPriceDetails(document, inputs, result, marketText, alerts.length);
}



function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function detail(label, value, extraClass = "") {
  return `<div class="${extraClass}"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function savedMarket(product) {
  const market = product.calculationData?.market;
  const price = Number(market?.selectedProduct?.price ?? market?.marketPrice ?? market?.stats?.median);
  if (!Number.isFinite(price) || price <= 0 || !["market-product", "amazon-product"].includes(market?.source)) return null;
  const relativeDifference = (product.suggestedPrice - price) / price;
  return {
    difference: `${Math.abs(relativeDifference * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% ${relativeDifference <= 0 ? "abaixo" : "acima"}`,
    price,
    productTitle: market.selectedProduct?.title || market.query || "Produto consultado",
    source: market.selectedProduct?.source || product.marketplace || "Marketplace",
  };
}

function renderProductsList(container, products) {
  if (products.length === 0) {
    container.innerHTML = '<div class="empty-history">Nenhum produto encontrado. Salve uma precificação no assistente para montar seu histórico.</div>';
    return;
  }

  container.innerHTML = products
    .map((product) => {
      const market = savedMarket(product);
      return `
        <article class="product-card">
          <div>
            <p class="eyebrow">${escapeHtml(product.category)}</p>
            <h3>${escapeHtml(product.name)}</h3>
            <div class="product-meta">
              <span>Custo: <strong>${currency.format(product.costPrice)}</strong></span>
              <span>Margem: <strong>${Number(product.profitMargin).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</strong></span>
              <span>Preço sugerido: <strong>${currency.format(product.suggestedPrice)}</strong></span>
              ${market ? `<span>Mercado na data: <strong>${currency.format(market.price)}</strong></span><span>Diferença: <strong>${escapeHtml(market.difference)}</strong></span><span>Fonte: <strong>${market.source}</strong></span>` : ""}
              <span>Criado em: <strong>${escapeHtml(formatDate(product.consultationDate))}</strong></span>
            </div>
          </div>
          <div class="product-actions">
            <button type="button" class="secondary-button" data-product-action="view" data-product-id="${escapeHtml(product.id)}">Ver detalhes</button>
            <button type="button" class="secondary-button" data-product-action="reuse" data-product-id="${escapeHtml(product.id)}">Reutilizar</button>
            <button type="button" class="secondary-button" data-product-action="edit" data-product-id="${escapeHtml(product.id)}">Editar</button>
            <button type="button" class="danger-button" data-product-action="delete" data-product-id="${escapeHtml(product.id)}">Excluir</button>
          </div>
        </article>`;
    })
    .join("");
}

function renderProductDetails(container, product) {
  const description = product.description || "Sem descrição informada.";
  const fiscal = product.calculationData?.fiscal;
  const market = savedMarket(product);
  const fiscalDetails = fiscal
    ? `
      ${detail("NCM", `${fiscal.ncm?.codigo || "Não informado"} (${fiscal.ncmSource || "origem desconhecida"})`)}
      ${detail("Status fiscal", fiscal.complete ? "Validado" : "Estimativa financeira pendente de validação fiscal")}
      ${detail("Tributos ainda dependentes de regra externa", (fiscal.unresolvedTaxes || []).join(", ") || "Não registrado")}`
    : detail("Status fiscal", "Consulta antiga: contexto fiscal não registrado");
  container.innerHTML = `
    <dl class="product-details">
      ${detail("Categoria", product.category)}
      ${detail("Plataforma", product.marketplace)}
      ${detail("Preço de custo", currency.format(product.costPrice))}
      ${detail("Custos adicionais", currency.format(product.additionalCosts))}
      ${detail("Margem desejada", `${Number(product.profitMargin).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`)}
      ${detail("Preço sugerido", currency.format(product.suggestedPrice))}
      ${market ? `${detail("Produto de mercado", market.productTitle)}${detail("Mercado na data", currency.format(market.price))}${detail("Diferença", market.difference)}${detail("Fonte de mercado", market.source)}` : ""}
      ${detail("Data da consulta", formatDate(product.consultationDate))}
      ${detail("Última atualização", formatDate(product.updatedAt))}
      ${fiscalDetails}
      ${detail("Descrição", description, "product-description")}
    </dl>
    <div class="dialog-detail-actions">
      <button type="button" class="secondary-button" data-dialog-product-action="reuse">Reutilizar consulta</button>
      <button type="button" class="secondary-button" data-dialog-product-action="edit">Editar</button>
      <button type="button" class="danger-button" data-dialog-product-action="delete">Excluir</button>
    </div>`;
}


const sectionFields = Object.freeze({
  product: ["productName"],
  fiscal: ["taxRegime", "originState", "destinationState", "customerType"],
  direct: ["materialsCost", "waste", "packagingCost", "deliveryCost", "insuranceCost", "discountAmount", "otherExpenses"],
  indirect: ["totalPayroll", "monthlyFixedCosts"],
  production: ["workerCount", "outputPerWorkerHour", "monthlyVolume"],
  sales: ["taxRate", "paymentFeeRate", "commissionRate"],
  market: ["margin", "competitorAverage"],
  terms: ["receiveDays", "payDays", "capitalRate"],
});

function fieldHasValidValue(field) {
  if (!field || String(field.value).trim() === "") return false;
  return typeof field.checkValidity !== "function" || field.checkValidity();
}

function createPricingTabs(root) {
  if (!root) throw new Error("O painel de precificação não foi encontrado.");

  const tabList = root.querySelector('[role="tablist"]');
  const tabs = Array.from(root.querySelectorAll("[data-pricing-tab]"));
  const panels = Array.from(root.querySelectorAll("[data-pricing-panel]"));
  const order = tabs.map((tab) => tab.dataset.pricingTab);
  let activeSection = order[0];
  const visitedSections = new Set();
  let pointerStartX = 0;
  let scrollStart = 0;
  let dragging = false;
  let moved = false;

  function updateCompletion() {
    for (const tab of tabs) {
      const section = tab.dataset.pricingTab;
      const valid = (sectionFields[section] || []).every((fieldId) => fieldHasValidValue(root.querySelector(`#${fieldId}`)));
      const complete = section !== activeSection && visitedSections.has(section) && valid;
      const active = section === activeSection;
      const label = tab.dataset.pricingLabel || tab.textContent.trim();
      const status = tab.querySelector(".pricing-tab-status");

      tab.classList.toggle("is-complete", complete);
      tab.classList.toggle("is-future", !active && !complete);
      tab.setAttribute("aria-label", `${label}, ${active ? "etapa atual" : complete ? "concluída" : "futura"}`);
      if (status) status.textContent = complete ? "✓" : active ? "●" : "○";
    }
  }

  function resetInternalScroll() {
    const view = root.ownerDocument.defaultView;
    const overflowY = view?.getComputedStyle(root).overflowY;
    if (overflowY !== "auto" && overflowY !== "scroll") return;

    if (typeof root.scrollTo === "function") root.scrollTo({ top: 0, behavior: "auto" });
    else root.scrollTop = 0;
  }

  function revealTab(tab) {
    if (!tabList || tabList.scrollWidth <= tabList.clientWidth) return;
    const left = Math.max(0, tab.offsetLeft - tabList.clientWidth / 2 + tab.clientWidth / 2);
    tabList.scrollTo({ left, behavior: "smooth" });
  }

  function activate(section, { focusTab = false, resetScroll = true } = {}) {
    if (!order.includes(section)) return;
    if (section !== activeSection) visitedSections.add(activeSection);
    activeSection = section;

    for (const tab of tabs) {
      const isActive = tab.dataset.pricingTab === section;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
      tab.tabIndex = isActive ? 0 : -1;
    }

    for (const panel of panels) {
      const isActive = panel.dataset.pricingPanel === section;
      panel.hidden = !isActive;
      panel.classList.toggle("is-active", isActive);
    }

    const activeTab = tabs.find((tab) => tab.dataset.pricingTab === section);
    if (activeTab) {
      revealTab(activeTab);
      if (focusTab) activeTab.focus({ preventScroll: true });
    }
    if (resetScroll) resetInternalScroll();
    updateCompletion();
  }

  function activateByOffset(currentTab, offset) {
    const currentIndex = tabs.indexOf(currentTab);
    const nextIndex = (currentIndex + offset + tabs.length) % tabs.length;
    activate(tabs[nextIndex].dataset.pricingTab, { focusTab: true });
  }

  for (const tab of tabs) {
    tab.addEventListener("click", (event) => {
      if (moved) {
        event.preventDefault();
        return;
      }
      activate(tab.dataset.pricingTab);
    });
    tab.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        activateByOffset(tab, 1);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        activateByOffset(tab, -1);
      } else if (event.key === "Home") {
        event.preventDefault();
        activate(order[0], { focusTab: true });
      } else if (event.key === "End") {
        event.preventDefault();
        activate(order.at(-1), { focusTab: true });
      }
    });
  }

  if (tabList && typeof tabList.addEventListener === "function") {
    tabList.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      pointerStartX = event.clientX;
      scrollStart = tabList.scrollLeft;
      dragging = true;
      moved = false;
    });
    tabList.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const distance = event.clientX - pointerStartX;
      if (Math.abs(distance) > 5) moved = true;
      if (!moved) return;
      if (event.pointerId !== undefined && typeof tabList.setPointerCapture === "function" && !tabList.hasPointerCapture?.(event.pointerId)) {
        tabList.setPointerCapture(event.pointerId);
      }
      tabList.scrollLeft = scrollStart - distance;
      tabList.classList.add("is-dragging");
      event.preventDefault();
    });
    const stopDrag = (event) => {
      if (!dragging) return;
      dragging = false;
      tabList.classList.remove("is-dragging");
      if (event.pointerId !== undefined && tabList.hasPointerCapture?.(event.pointerId)) tabList.releasePointerCapture(event.pointerId);
      globalThis.setTimeout(() => { moved = false; }, 0);
    };
    tabList.addEventListener("pointerup", stopDrag);
    tabList.addEventListener("pointercancel", stopDrag);
  }

  root.querySelectorAll("[data-pricing-go]").forEach((button) => {
    button.addEventListener("click", () => activate(button.dataset.pricingGo, { focusTab: true }));
  });

  root.addEventListener("input", updateCompletion);
  root.addEventListener("change", updateCompletion);
  activate(activeSection, { resetScroll: false });
  updateCompletion();

  return Object.freeze({
    activate,
    updateCompletion,
    getActiveSection: () => activeSection,
  });
}


const clampPanelSize = (value, min, max) => Math.min(max, Math.max(min, value));

function createPricingPanel(shell) {
  if (!shell) throw new Error("A área do simulador não foi encontrada.");
  const sidebar = shell.querySelector(".pricing-sidebar");
  const handle = shell.querySelector("[data-panel-resizer]");
  if (!sidebar || !handle) return Object.freeze({});

  let startPosition = 0;
  let startSize = 0;
  let dragging = false;
  const isMobile = () => window.matchMedia("(max-width: 900px)").matches;
  const currentSize = () => isMobile() ? sidebar.getBoundingClientRect().height : sidebar.getBoundingClientRect().width;
  const limits = () => isMobile()
    ? { min: 420, max: Math.max(480, window.innerHeight * 0.86) }
    : { min: 320, max: Math.min(620, window.innerWidth * 0.55) };

  function applySize(size) {
    const { min, max } = limits();
    const next = clampPanelSize(size, min, max);
    shell.dataset.panelSize = String(Math.round(((next - min) / (max - min)) * 10));
    handle.setAttribute("aria-valuemin", String(Math.round(min)));
    handle.setAttribute("aria-valuemax", String(Math.round(max)));
    handle.setAttribute("aria-valuenow", String(Math.round(next)));
  }

  function toggleExpanded() {
    const { min, max } = limits();
    applySize(currentSize() < min + (max - min) / 2 ? max : min);
  }

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    dragging = true;
    startPosition = isMobile() ? event.clientY : event.clientX;
    startSize = currentSize();
    handle.setPointerCapture(event.pointerId);
    shell.classList.add("is-resizing");
    event.preventDefault();
  });
  handle.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const position = isMobile() ? event.clientY : event.clientX;
    applySize(startSize + position - startPosition);
  });
  function stopDragging(event) {
    if (!dragging) return;
    dragging = false;
    shell.classList.remove("is-resizing");
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  }
  handle.addEventListener("pointerup", stopDragging);
  handle.addEventListener("pointercancel", stopDragging);
  handle.addEventListener("dblclick", toggleExpanded);
  handle.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleExpanded();
      return;
    }
    const decrease = event.key === "ArrowLeft" || event.key === "ArrowUp";
    const increase = event.key === "ArrowRight" || event.key === "ArrowDown";
    if (!decrease && !increase) return;
    event.preventDefault();
    applySize(currentSize() + (increase ? 32 : -32));
  });
  window.addEventListener("resize", () => {
    if (shell.dataset.panelSize) applySize(currentSize());
  });
  return Object.freeze({ toggleExpanded });
}



const $ = (selector) => document.querySelector(selector);
const themeStorageKey = "assistente-precificacao-theme";
const detailRouteHashes = Object.freeze({ price: "#preco-calculado" });
const market = new MarketService();
const taxRuleEngine = new ConfiguredTaxRuleEngine();
const formFieldIds = [
  "ncmCode",
  "taxRegime",
  "originState",
  "destinationState",
  "cfop",
  "taxSituation",
  "customerType",
  "operationPurpose",
  ...PRICING_FIELD_IDS,
];
const elements = Object.fromEntries(formFieldIds.map((id) => [id, $(`#${id}`)]));
const pricingTabs = createPricingTabs($(".pricing-sidebar"));
createPricingPanel($(".app-shell"));
const state = {
  user: null,
  products: [],
  selectedProduct: null,
};

let marketSource = "manual";
let focusState = {
  status: "idle",
  ncm: null,
  environment: "",
  error: "",
  unavailable: false,
};
let marketState = {
  status: "idle",
  query: "",
  items: [],
  stats: null,
  selectedItem: null,
  error: "",
};
let manualMarketValue = elements.competitorAverage.value;
let productSearchTimer;
let pendingDetailTarget = "";
let revealAllPricingErrors = false;
const touchedPricingFields = new Set();

function applyTheme(theme, persist = true) {
  const normalizedTheme = theme === "dark" ? "dark" : "light";
  const isDark = normalizedTheme === "dark";
  document.documentElement.dataset.theme = normalizedTheme;
  if (persist) {
    try {
      localStorage.setItem(themeStorageKey, normalizedTheme);
    } catch {
      // O tema continua funcionando mesmo que o armazenamento esteja indisponível.
    }
  }
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    const nextThemeLabel = isDark ? "Modo claro" : "Modo escuro";
    button.setAttribute("aria-label", `Ativar ${nextThemeLabel.toLowerCase()}`);
    button.setAttribute("aria-pressed", String(isDark));
    button.querySelector("[data-theme-label]").textContent = nextThemeLabel;
    button.querySelector(".theme-symbol").textContent = isDark ? "☼" : "☾";
  });
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

function messageFor(error) {
  return error instanceof ApiError ? error.message : "Não foi possível concluir a operação. Tente novamente.";
}

function setMessage(element, message = "", success = false) {
  element.hidden = !message;
  element.textContent = message;
  element.classList.toggle("success", success);
}

function setFieldError(fieldId, message = "") {
  const input = $(`#${fieldId}`);
  const field = input.closest(".auth-field");
  const messageElement = $(`#${fieldId}Error`);
  field?.classList.toggle("has-error", Boolean(message));
  input.setAttribute("aria-invalid", String(Boolean(message)));
  if (!messageElement) return;
  messageElement.hidden = !message;
  messageElement.textContent = message;
}

function clearAuthErrors(form) {
  form.querySelectorAll(".auth-field input").forEach((input) => setFieldError(input.id));
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function passwordChecks(value) {
  return {
    length: value.length >= 8,
    letter: /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(value),
    number: /\d/.test(value),
  };
}

function isStrongPassword(value) {
  return Object.values(passwordChecks(value)).every(Boolean);
}

function updatePasswordRequirements() {
  const checks = passwordChecks($("#registerPassword").value);
  document.querySelectorAll("[data-password-rule]").forEach((item) => item.classList.toggle("is-met", checks[item.dataset.passwordRule]));
}

function validateRegisterField(fieldId) {
  const value = $(`#${fieldId}`).value;
  const trimmedValue = value.trim();
  let error = "";

  if (fieldId === "registerName") {
    if (!trimmedValue) error = "Preencha todos os campos obrigatórios.";
    else if (trimmedValue.length < 2) error = "Informe seu nome completo.";
  }

  if (fieldId === "registerEmail") {
    if (!trimmedValue) error = "Preencha todos os campos obrigatórios.";
    else if (!isValidEmail(trimmedValue)) error = "Informe um e-mail válido.";
  }

  if (fieldId === "registerPassword") {
    if (!value) error = "Preencha todos os campos obrigatórios.";
    else if (!isStrongPassword(value)) error = "Use pelo menos 8 caracteres, incluindo letras e números.";
  }

  if (fieldId === "registerPasswordConfirmation") {
    const password = $("#registerPassword").value;
    if (!value) error = "Preencha todos os campos obrigatórios.";
    else if (value !== password) error = "As senhas não coincidem.";
  }

  setFieldError(fieldId, error);
  return !error;
}

function validateLoginField(fieldId) {
  const value = $(`#${fieldId}`).value.trim();
  const error = !value
    ? "Preencha todos os campos obrigatórios."
    : fieldId === "loginEmail" && !isValidEmail(value)
      ? "Informe um e-mail válido."
      : "";
  setFieldError(fieldId, error);
  return !error;
}

function setSubmitState(button, isLoading, label) {
  button.disabled = isLoading;
  button.setAttribute("aria-busy", String(isLoading));
  button.querySelector("span").textContent = label;
}

function currentPricingValidation() {
  const validation = validatePricingForm(elements);
  renderPricingErrors(elements, validation.errors, revealAllPricingErrors ? null : touchedPricingFields);
  return validation;
}

function render() {
  const validation = currentPricingValidation();
  if (validation.isValid) {
    const inputs = validation.inputs;
    const result = calculatePrice(inputs);
    const fiscalAssessment = taxRuleEngine.assess(inputs, focusState);
    const memory = buildCalculationMemory(inputs, result, fiscalAssessment);
    renderDashboard(document, inputs, result, marketState, marketSource, fiscalAssessment, memory);
  } else {
    renderIncompleteDashboard(document, marketState, validation.errors);
  }
  renderNcmState();
  $("#mobileSuggestedPrice").textContent = $("#suggestedPrice").textContent;
  pricingTabs.updateCompletion();
}

function renderNcmState() {
  const status = $("#ncmLookupStatus");
  const description = $("#ncmDescription");
  const button = $("#ncmLookupButton");
  button.disabled = focusState.status === "loading";
  button.textContent = focusState.status === "loading" ? "Consultando..." : "Validar NCM";

  if (focusState.status === "loading") status.textContent = "Consultando o NCM na Focus NFe…";
  else if (focusState.status === "success") status.textContent = `NCM confirmado pela Focus NFe em ${focusState.environment}. Isso não calcula a tributação.`;
  else if (focusState.status === "error") status.textContent = focusState.error;
  else status.textContent = "Consulte a classificação na Focus NFe. O NCM isolado não determina impostos.";

  description.hidden = !focusState.ncm?.descricao_completa;
  description.textContent = focusState.ncm?.descricao_completa || "";
}

async function lookupNcm() {
  const code = String(elements.ncmCode.value || "").replace(/\D/g, "");
  elements.ncmCode.value = code;
  if (!/^\d{8}$/.test(code)) {
    focusState = { status: "error", ncm: null, environment: "", error: "Informe um NCM com exatamente 8 dígitos.", unavailable: false };
    render();
    return;
  }

  focusState = { status: "loading", ncm: null, environment: "", error: "", unavailable: false };
  render();
  try {
    const response = await api.get(`/fiscal/ncms/${encodeURIComponent(code)}`, { handleUnauthorized: false });
    focusState = { status: "success", ncm: response.ncm, environment: response.environment, error: "", unavailable: false };
  } catch (error) {
    focusState = {
      status: "error",
      ncm: null,
      environment: "",
      error: `${messageFor(error)} O cálculo financeiro foi mantido, mas não está fiscalmente validado.`,
      unavailable: true,
    };
  }
  render();
}

function closeMobileMenus({ restoreFocus = false } = {}) {
  document.querySelectorAll("[data-mobile-menu-toggle]").forEach((button) => {
    const wasOpen = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "Abrir menu");
    const menu = button.closest(".mobile-app-header")?.querySelector("[data-mobile-menu]");
    if (menu) menu.hidden = true;
    if (restoreFocus && wasOpen) button.focus();
  });
}

function toggleMobileMenu(button) {
  const menu = button.closest(".mobile-app-header")?.querySelector("[data-mobile-menu]");
  if (!menu) return;
  const willOpen = button.getAttribute("aria-expanded") !== "true";
  closeMobileMenus();
  button.setAttribute("aria-expanded", String(willOpen));
  button.setAttribute("aria-label", willOpen ? "Fechar menu" : "Abrir menu");
  menu.hidden = !willOpen;
  if (willOpen) menu.querySelector("button")?.focus();
}

function showAuth(mode = "login", message = "") {
  closeMobileMenus();
  $("#bootScreen").hidden = true;
  $("#authView").hidden = false;
  $("#assistantView").hidden = true;
  $("#productsView").hidden = true;
  $("#aboutView").hidden = true;
  $("#loginForm").hidden = mode !== "login";
  $("#registerForm").hidden = mode !== "register";
  $("#showLoginButton").classList.toggle("active", mode === "login");
  $("#showRegisterButton").classList.toggle("active", mode === "register");
  $("#showLoginButton").setAttribute("aria-selected", String(mode === "login"));
  $("#showRegisterButton").setAttribute("aria-selected", String(mode === "register"));
  clearAuthErrors($("#loginForm"));
  clearAuthErrors($("#registerForm"));
  setMessage($("#authMessage"), message);
}

function showAssistant(view = "dashboard") {
  closeMobileMenus();
  $("#bootScreen").hidden = true;
  $("#authView").hidden = true;
  $("#assistantView").hidden = false;
  $("#productsView").hidden = true;
  $("#aboutView").hidden = true;
  const isPriceDetails = view === "price-details";
  $("#dashboardView").hidden = isPriceDetails;
  $("#priceDetailsView").hidden = !isPriceDetails;
  $("#mobilePriceSummary").hidden = isPriceDetails;

  if (isPriceDetails) {
    const target = pendingDetailTarget || "overview";
    pendingDetailTarget = "";
    window.requestAnimationFrame(() => {
      const detailSection = document.querySelector(`[data-detail-anchor="${target}"]`);
      detailSection?.scrollIntoView({ block: "start" });
      detailSection?.focus({ preventScroll: true });
    });
  } else {
    window.scrollTo({ top: 0, behavior: "auto" });
  }
}

async function showProducts() {
  closeMobileMenus();
  $("#bootScreen").hidden = true;
  $("#authView").hidden = true;
  $("#assistantView").hidden = true;
  $("#productsView").hidden = false;
  $("#aboutView").hidden = true;
  await loadProducts();
}

function showAbout() {
  closeMobileMenus();
  $("#bootScreen").hidden = true;
  $("#authView").hidden = true;
  $("#assistantView").hidden = true;
  $("#productsView").hidden = true;
  $("#aboutView").hidden = false;
  window.scrollTo({ top: 0, behavior: "auto" });
  $("#about-title")?.focus({ preventScroll: true });
}

async function syncRoute() {
  if (!state.user) return;
  if (window.location.hash === "#produtos") await showProducts();
  else if (window.location.hash === "#sobre") showAbout();
  else if (window.location.hash === detailRouteHashes.price) showAssistant("price-details");
  else showAssistant("dashboard");
}

function navigate(view, detailTarget = "") {
  closeMobileMenus();
  if (detailTarget) pendingDetailTarget = detailTarget;
  const hash = view === "products" ? "#produtos" : view === "about" ? "#sobre" : detailRouteHashes[view] || "#assistente";
  if (window.location.hash === hash) {
    void syncRoute();
  } else {
    window.location.hash = hash;
  }
}

function setAuthenticatedUser(user) {
  state.user = user;
  $("#currentUserName").textContent = user.name;
  void syncRoute();
}

function setMarketError(query, caughtError) {
  let error = "Não foi possível consultar o mercado agora.";
  if (caughtError instanceof ApiError && caughtError.status === 429) {
    error = "O provedor limitou temporariamente as consultas. Aguarde um pouco e tente novamente.";
  } else if (caughtError instanceof ApiError && caughtError.code === "NEXSCOPE_NOT_CONFIGURED") {
    error = "Consulta de mercado temporariamente indisponível.";
  } else if (caughtError instanceof ApiError && caughtError.code === "NEXSCOPE_AUTHENTICATION_FAILED") {
    error = "A credencial do provedor de mercado precisa ser revisada.";
  } else if (caughtError instanceof ApiError && caughtError.code === "NEXSCOPE_TIMEOUT") {
    error = "A consulta do mercado excedeu o tempo de resposta.";
  }

  marketState = {
    status: "error",
    query,
    items: [],
    stats: null,
    selectedItem: marketState.selectedItem,
    error: `${error} Você ainda pode informar o preço médio dos concorrentes manualmente.`,
  };
}

async function searchMarket() {
  if (marketState.status === "loading") return;
  const query = $("#marketQuery").value.trim();
  if (query.length < 3) {
    marketState = { ...marketState, status: "error", error: "Informe pelo menos 3 caracteres para pesquisar." };
    render();
    return;
  }

  marketState = { ...marketState, status: "loading", query, items: [], stats: null, error: "" };
  render();

  try {
    const data = await market.search(query);
    marketState = {
      ...marketState,
      status: data.stats ? "success" : "empty",
      ...data,
      error: "",
    };
  } catch (error) {
    setMarketError(query, error);
  }

  render();
}

function selectMarketProduct(id) {
  const selected = marketState.items.find((candidate) => candidate.id === id);
  const item = selected ? { ...selected, consultedAt: selected.consultedAt || new Date().toISOString() } : null;
  if (!item) return;
  if (marketSource !== "market-product") manualMarketValue = elements.competitorAverage.value;
  marketState = { ...marketState, selectedItem: item };
  elements.competitorAverage.value = item.price.toFixed(2);
  touchedPricingFields.add("competitorAverage");
  marketSource = "market-product";
  const parsedManualValue = parseBrazilianNumber(manualMarketValue);
  const storedManualValue = parsedManualValue.status === "valid" && parsedManualValue.value > 0 ? parsedManualValue.value : null;
  saveMarketReference(window.sessionStorage, { manualValue: storedManualValue, query: marketState.query, selectedItem: item });
  render();
}

function restoreManualMarket({ focusSearch = false } = {}) {
  elements.competitorAverage.value = manualMarketValue === null ? "" : String(manualMarketValue);
  touchedPricingFields.add("competitorAverage");
  marketSource = "manual";
  marketState = { ...marketState, selectedItem: null };
  clearMarketReference(window.sessionStorage);
  render();
  if (focusSearch) {
    pricingTabs.activate("market");
    $("#marketQuery").focus();
  }
}

function restoreMarketReferenceFromSession() {
  const saved = loadMarketReference(window.sessionStorage);
  if (!saved) return;
  manualMarketValue = saved.manualValue === null ? "" : String(saved.manualValue).replace(".", ",");
  marketState = { ...marketState, query: saved.query, selectedItem: saved.selectedItem };
  marketSource = "market-product";
  elements.competitorAverage.value = saved.selectedItem.price.toFixed(2);
  $("#marketQuery").value = saved.query;
}

function productPayloadFromCalculator() {
  const name = $("#productName").value.trim();
  const description = $("#productDescription").value.trim();
  revealAllPricingErrors = true;
  const validation = currentPricingValidation();
  if (!validation.isValid) {
    renderIncompleteDashboard(document, marketState, validation.errors);
    const firstInvalidField = elements[Object.keys(validation.errors)[0]];
    const panel = firstInvalidField?.closest?.("[data-pricing-panel]");
    if (panel) pricingTabs.activate(panel.dataset.pricingPanel, { focusTab: true });
    firstInvalidField?.focus();
    throw new ApiError("Corrija os campos indicados antes de salvar.", 400);
  }
  const inputs = validation.inputs;
  const result = calculatePrice(inputs);
  const fiscalAssessment = taxRuleEngine.assess(inputs, focusState);
  const memory = buildCalculationMemory(inputs, result, fiscalAssessment);

  if (!name) throw new ApiError("Informe o nome do produto antes de salvar.", 400);
  if (!result.isValid || result.minimumPrice === null) throw new ApiError("Revise os percentuais antes de salvar um cálculo inviável.", 400);

  return {
    name,
    description,
    category: "Não categorizado",
    costPrice: inputs.materialsCost,
    additionalCosts: Math.max(0, result.costs.baseCost - inputs.materialsCost),
    profitMargin: inputs.margin * 100,
    suggestedPrice: result.minimumPrice,
    marketplace: marketSource === "market-product" ? marketState.selectedItem?.source || "Marketplace" : "Manual",
    consultationDate: new Date().toISOString(),
    calculationData: {
      version: 5,
      inputs,
      emptyOptionalFields: validation.emptyOptionalFields,
      result,
      fiscal: fiscalDataForStorage(fiscalAssessment, memory),
      market: {
        source: marketSource,
        query: marketState.query,
        stats: marketState.stats,
        selectedProduct: marketState.selectedItem,
        manualValue: (() => {
          const parsed = parseBrazilianNumber(manualMarketValue);
          return parsed.status === "valid" && parsed.value > 0 ? parsed.value : null;
        })(),
        marketPrice: inputs.competitorAverage,
        taxAdjustedPrice: fiscalAssessment.automaticCalculation && fiscalAssessment.complete
          ? fiscalAssessment.marketAdjustedPrice || null
          : null,
      },
    },
  };
}

async function saveProduct() {
  const status = $("#saveProductStatus");
  const button = $("#saveProductButton");
  try {
    const payload = productPayloadFromCalculator();
    button.disabled = true;
    setMessage(status, "Salvando consulta…");
    await api.post("/products", payload);
    setMessage(status, "Produto salvo no seu histórico.", true);
  } catch (error) {
    setMessage(status, messageFor(error));
  } finally {
    button.disabled = false;
  }
}

async function loadProducts() {
  const list = $("#productsList");
  const search = $("#productSearch").value.trim();
  const sort = $("#productSort").value;
  setMessage($("#historyMessage"), "");
  list.innerHTML = '<div class="empty-history">Carregando produtos…</div>';

  try {
    const params = new URLSearchParams({ search, sort });
    const response = await api.get(`/products?${params.toString()}`);
    state.products = response.products;
    renderProductsList(list, state.products);
  } catch (error) {
    list.innerHTML = "";
    setMessage($("#historyMessage"), messageFor(error));
  }
}

function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

function showProductDetails(product) {
  state.selectedProduct = product;
  $("#productDialogTitle").textContent = product.name;
  $("#productDetails").hidden = false;
  $("#productEditorForm").hidden = true;
  renderProductDetails($("#productDetails"), product);
  openDialog($("#productDialog"));
}

function showProductEditor(product) {
  state.selectedProduct = product;
  $("#productDialogTitle").textContent = `Editar ${product.name}`;
  $("#productDetails").hidden = true;
  const form = $("#productEditorForm");
  form.hidden = false;
  $("#editProductName").value = product.name;
  $("#editProductDescription").value = product.description;
  $("#editProductCategory").value = product.category;
  $("#editCostPrice").value = product.costPrice;
  $("#editAdditionalCosts").value = product.additionalCosts;
  $("#editProfitMargin").value = product.profitMargin;
  $("#editSuggestedPrice").value = product.suggestedPrice;
  $("#editMarketplace").value = product.marketplace;
  openDialog($("#productDialog"));
}

async function getProduct(id) {
  const response = await api.get(`/products/${encodeURIComponent(id)}`);
  return response.product;
}

function reuseProduct(product) {
  const savedInputs = product.calculationData?.inputs;
  if (!applySavedInputs(savedInputs, elements, product.calculationData?.emptyOptionalFields)) {
    setMessage($("#historyMessage"), "Esta consulta não possui os dados necessários para ser reutilizada.");
    return;
  }

  $("#productName").value = product.name;
  $("#productDescription").value = product.description || "";
  const savedNcm = product.calculationData?.fiscal?.ncm;
  focusState = savedNcm?.codigo
    ? { status: "success", ncm: savedNcm, environment: "consulta salva", error: "", unavailable: false }
    : { status: "idle", ncm: null, environment: "", error: "", unavailable: false };
  const savedMarket = product.calculationData?.market;
  marketSource = ["market-product", "amazon-product"].includes(savedMarket?.source) ? "market-product" : "manual";
  const hasSavedManualValue = savedMarket && Object.prototype.hasOwnProperty.call(savedMarket, "manualValue");
  const savedManualValue = hasSavedManualValue ? savedMarket.manualValue : savedInputs?.competitorAverage;
  manualMarketValue = Number.isFinite(savedManualValue) && savedManualValue > 0
    ? String(savedManualValue).replace(".", ",")
    : "";
  marketState = {
    ...marketState,
    status: "idle",
    query: marketSource === "market-product" ? savedMarket?.query || "" : "",
    items: [],
    stats: marketSource === "market-product" ? savedMarket?.stats || null : null,
    selectedItem: marketSource === "market-product" ? savedMarket?.selectedProduct || null : null,
    error: "",
  };
  if (marketSource === "market-product" && marketState.selectedItem) {
    saveMarketReference(window.sessionStorage, {
      manualValue: manualMarketValue,
      query: marketState.query,
      selectedItem: marketState.selectedItem,
    });
  } else {
    clearMarketReference(window.sessionStorage);
  }
  $("#marketQuery").value = marketState.query;
  $("#productDialog").close();
  render();
  navigate("assistant");
  setMessage($("#saveProductStatus"), "Consulta anterior carregada. Ajuste o que quiser e salve uma nova versão.", true);
}

async function deleteProduct(id) {
  if (!window.confirm("Excluir este produto do seu histórico? Esta ação não pode ser desfeita.")) return;

  try {
    await api.delete(`/products/${encodeURIComponent(id)}`);
    if ($("#productDialog").open) $("#productDialog").close();
    setMessage($("#historyMessage"), "Produto excluído do seu histórico.", true);
    await loadProducts();
  } catch (error) {
    setMessage($("#historyMessage"), messageFor(error));
  }
}

async function editCurrentProduct(event) {
  event.preventDefault();
  const product = state.selectedProduct;
  const form = event.currentTarget;
  if (!product || !form.reportValidity()) return;

  const payload = {
    name: $("#editProductName").value.trim(),
    description: $("#editProductDescription").value.trim(),
    category: $("#editProductCategory").value.trim(),
    costPrice: Number($("#editCostPrice").value),
    additionalCosts: Number($("#editAdditionalCosts").value),
    profitMargin: Number($("#editProfitMargin").value),
    suggestedPrice: Number($("#editSuggestedPrice").value),
    marketplace: $("#editMarketplace").value.trim(),
    consultationDate: product.consultationDate,
    calculationData: product.calculationData || {},
  };

  try {
    const response = await api.patch(`/products/${encodeURIComponent(product.id)}`, payload);
    state.selectedProduct = response.product;
    $("#productDialog").close();
    setMessage($("#historyMessage"), "Produto atualizado com sucesso.", true);
    await loadProducts();
  } catch (error) {
    setMessage($("#historyMessage"), messageFor(error));
  }
}

function showProfile() {
  const details = $("#profileDetails");
  details.replaceChildren();
  [["Nome", state.user.name], ["E-mail", state.user.email]].forEach(([label, value]) => {
    const item = document.createElement("div");
    const term = document.createElement("dt");
    const definition = document.createElement("dd");
    term.textContent = label;
    definition.textContent = value;
    item.append(term, definition);
    details.append(item);
  });
  openDialog($("#profileDialog"));
}

async function logout() {
  try {
    await api.post("/auth/logout", undefined, { handleUnauthorized: false });
  } catch (error) {
    setMessage($("#saveProductStatus"), messageFor(error));
    return;
  }

  state.user = null;
  state.products = [];
  state.selectedProduct = null;
  clearMarketReference(window.sessionStorage);
  window.history.replaceState(null, "", window.location.pathname);
  showAuth("login", "Você saiu da sua conta.");
}

async function submitLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const isValid = ["loginEmail", "loginPassword"].every(validateLoginField);
  if (!isValid) return;
  const button = form.querySelector("button[type=submit]");

  try {
    setSubmitState(button, true, "Entrando...");
    setMessage($("#authMessage"), "");
    const response = await api.post("/auth/login", {
      email: $("#loginEmail").value.trim(),
      password: $("#loginPassword").value,
    }, { handleUnauthorized: false });
    form.reset();
    setAuthenticatedUser(response.user);
  } catch (error) {
    setMessage($("#authMessage"), messageFor(error));
  } finally {
    setSubmitState(button, false, "Entrar");
  }
}

async function submitRegistration(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const password = $("#registerPassword").value;
  const confirmation = $("#registerPasswordConfirmation").value;
  const isValid = ["registerName", "registerEmail", "registerPassword", "registerPasswordConfirmation"].every(validateRegisterField);
  if (!isValid) return;
  const button = form.querySelector("button[type=submit]");

  try {
    setSubmitState(button, true, "Criando conta...");
    setMessage($("#authMessage"), "");
    const response = await api.post("/auth/register", {
      name: $("#registerName").value.trim(),
      email: $("#registerEmail").value.trim(),
      password,
      passwordConfirmation: confirmation,
    }, { handleUnauthorized: false });
    form.reset();
    updatePasswordRequirements();
    setAuthenticatedUser(response.user);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      setFieldError("registerEmail", "Já existe uma conta cadastrada com este e-mail.");
      $("#registerEmail").focus();
    } else {
      setMessage($("#authMessage"), messageFor(error));
    }
  } finally {
    setSubmitState(button, false, "Criar conta");
  }
}

PRICING_FIELD_IDS
  .filter((fieldId) => fieldId !== "competitorAverage")
  .forEach((fieldId) => elements[fieldId].addEventListener("input", () => {
    touchedPricingFields.add(fieldId);
    render();
  }));

[
  elements.taxRegime,
  elements.originState,
  elements.destinationState,
  elements.cfop,
  elements.taxSituation,
  elements.customerType,
  elements.operationPurpose,
].forEach((field) => {
  field.addEventListener("input", render);
  field.addEventListener("change", render);
});

elements.ncmCode.addEventListener("input", () => {
  const currentCode = String(elements.ncmCode.value || "").replace(/\D/g, "");
  if (focusState.ncm?.codigo !== currentCode) focusState = { status: "idle", ncm: null, environment: "", error: "", unavailable: false };
  render();
});

$("#ncmLookupButton").addEventListener("click", lookupNcm);
elements.ncmCode.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  void lookupNcm();
});

elements.competitorAverage.addEventListener("input", () => {
  touchedPricingFields.add("competitorAverage");
  marketSource = "manual";
  marketState = { ...marketState, selectedItem: null };
  manualMarketValue = elements.competitorAverage.value;
  clearMarketReference(window.sessionStorage);
  render();
});

$("#marketSearchButton").addEventListener("click", searchMarket);
$("#marketQuery").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  void searchMarket();
});
$("#marketPanel").addEventListener("click", (event) => {
  const button = event.target.closest("[data-market-select]");
  if (button) selectMarketProduct(button.dataset.marketSelect);
  if (event.target.closest("[data-market-retry]")) void searchMarket();
});
$("#selectedMarketProduct").addEventListener("click", (event) => {
  if (event.target.closest("[data-change-market-reference]")) restoreManualMarket({ focusSearch: true });
});

$("#showLoginButton").addEventListener("click", () => showAuth("login"));
$("#showRegisterButton").addEventListener("click", () => showAuth("register"));
document.querySelectorAll("[data-theme-toggle]").forEach((button) => button.addEventListener("click", toggleTheme));
document.querySelectorAll("[data-auth-switch]").forEach((button) => {
  button.addEventListener("click", () => showAuth(button.dataset.authSwitch));
});
$("#loginForm").addEventListener("submit", submitLogin);
$("#registerForm").addEventListener("submit", submitRegistration);

["loginEmail", "loginPassword"].forEach((fieldId) => {
  const field = $(`#${fieldId}`);
  field.addEventListener("blur", () => validateLoginField(fieldId));
  field.addEventListener("input", () => {
    if (field.getAttribute("aria-invalid") === "true") validateLoginField(fieldId);
  });
});

["registerName", "registerEmail", "registerPassword", "registerPasswordConfirmation"].forEach((fieldId) => {
  const field = $(`#${fieldId}`);
  field.addEventListener("blur", () => {
    if (fieldId === "registerEmail") field.value = field.value.trim().toLowerCase();
    validateRegisterField(fieldId);
  });
  field.addEventListener("input", () => {
    if (fieldId === "registerPassword") {
      updatePasswordRequirements();
      if ($("#registerPasswordConfirmation").value) validateRegisterField("registerPasswordConfirmation");
    }
    if (field.getAttribute("aria-invalid") === "true" || fieldId === "registerPassword") validateRegisterField(fieldId);
  });
});

document.querySelectorAll("[data-password-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = $(`#${button.dataset.passwordToggle}`);
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    button.textContent = isPassword ? "Ocultar" : "Mostrar";
    button.setAttribute("aria-label", isPassword ? "Ocultar senha" : "Mostrar senha");
    button.setAttribute("aria-pressed", String(isPassword));
  });
});

document.querySelectorAll("[data-mobile-menu-toggle]").forEach((button) => {
  button.addEventListener("click", () => toggleMobileMenu(button));
});

document.querySelectorAll("[data-app-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.appAction;
    closeMobileMenus();
    if (action === "assistant") navigate("assistant");
    if (action === "products") navigate("products");
    if (action === "about") navigate("about");
    if (action === "profile") showProfile();
    if (action === "logout") void logout();
  });
});

document.querySelectorAll("[data-detail-view]").forEach((button) => {
  button.addEventListener("click", () => navigate(button.dataset.detailView, button.dataset.detailTarget || "overview"));
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".mobile-app-header")) closeMobileMenus();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMobileMenus({ restoreFocus: true });
});

$("#showMobileResultButton").addEventListener("click", () => {
  navigate("price", "overview");
});

$("#logoutButton").addEventListener("click", logout);
$("#showProfileButton").addEventListener("click", showProfile);
$("#showProductsButton").addEventListener("click", () => navigate("products"));
$("#showAboutButton").addEventListener("click", () => navigate("about"));
$("#backToDashboardButton").addEventListener("click", () => navigate("assistant"));
$("#backToAssistantButton").addEventListener("click", () => navigate("assistant"));
$("#aboutBackButton").addEventListener("click", () => navigate("assistant"));
$("#saveProductButton").addEventListener("click", saveProduct);
$("#productEditorForm").addEventListener("submit", editCurrentProduct);

$("#productSearch").addEventListener("input", () => {
  clearTimeout(productSearchTimer);
  productSearchTimer = setTimeout(() => void loadProducts(), 250);
});
$("#productSort").addEventListener("change", () => void loadProducts());
$("#productsList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-product-action]");
  if (!button) return;
  const { productAction: action, productId: id } = button.dataset;
  if (action === "delete") return deleteProduct(id);

  try {
    const product = await getProduct(id);
    if (action === "view") showProductDetails(product);
    if (action === "edit") showProductEditor(product);
    if (action === "reuse") reuseProduct(product);
  } catch (error) {
    setMessage($("#historyMessage"), messageFor(error));
  }
});
$("#productDetails").addEventListener("click", (event) => {
  const button = event.target.closest("[data-dialog-product-action]");
  if (!button || !state.selectedProduct) return;
  const action = button.dataset.dialogProductAction;
  if (action === "edit") showProductEditor(state.selectedProduct);
  if (action === "reuse") reuseProduct(state.selectedProduct);
  if (action === "delete") void deleteProduct(state.selectedProduct.id);
});
document.addEventListener("click", (event) => {
  const closeButton = event.target.closest("[data-close-dialog]");
  if (!closeButton) return;
  closeButton.closest("dialog")?.close();
});
window.addEventListener("hashchange", () => void syncRoute());
window.addEventListener("app:session-expired", () => {
  state.user = null;
  state.products = [];
  state.selectedProduct = null;
  clearMarketReference(window.sessionStorage);
  window.history.replaceState(null, "", window.location.pathname);
  showAuth("login", "Sua sessão expirou. Entre novamente para continuar.");
});

restoreMarketReferenceFromSession();
applyTheme(document.documentElement.dataset.theme, false);
render();

async function bootstrap(attempt = 0) {
  try {
    const response = await api.get("/auth/me", { handleUnauthorized: false });
    setAuthenticatedUser(response.user);
  } catch (error) {
    if (error instanceof ApiError && error.code === "STATIC_HOSTING") {
      showAuth("login", error.message);
      return;
    }
    const isInactiveSession = error instanceof ApiError && error.status === 401;
    if (!isInactiveSession && attempt < 2) {
      window.setTimeout(() => void bootstrap(attempt + 1), 800);
      return;
    }
    const message = error instanceof ApiError && error.status === 401
      ? ""
      : "Não foi possível conectar ao servidor.";
    showAuth("login", message);
  }
}

updatePasswordRequirements();
void bootstrap();
