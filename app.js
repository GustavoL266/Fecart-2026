/* Gerado por scripts/build.mjs. Edite os arquivos em js/ e execute npm run build. */

const PRODUCTIVE_HOURS_PER_WORKER_MONTH = 176;

const AMAZON_MARKET_CONFIG = {
  minComparableResults: 3,
};

const MARKET_RULES = {
  closeGap: 0.08,
  attentionGap: 0.18,
};


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


// Esta regra é deliberadamente independente do DOM e do banco. O navegador e
// o servidor importam este mesmo módulo: não existe uma segunda fórmula no API.
const PRICING_SCHEMA_VERSION = 6;
const FORMULA_VERSION = "technical-pricing-v2";

class PricingValidationError extends Error {
  constructor(errors) {
    super(Object.values(errors)[0] || "Dados de precificação inválidos.");
    this.name = "PricingValidationError";
    this.code = "INVALID_PRICING_INPUTS";
    this.status = 400;
    this.errors = errors;
  }
}

const requiredNumbers = Object.freeze({
  materialCost: { min: 0, label: "O custo da matéria-prima" },
  wasteRate: { min: 0, maxExclusive: 1, label: "O desperdício" },
  packagingCost: { min: 0, label: "O custo de embalagem" },
  deliveryCost: { min: 0, label: "O frete ou entrega" },
  monthlyPayroll: { min: 0, label: "A folha salarial mensal" },
  monthlyFixedCosts: { min: 0, label: "Os custos fixos mensais" },
  expectedMonthlyUnits: { minExclusive: 0, label: "A quantidade mensal prevista" },
  taxRate: { min: 0, maxExclusive: 1, label: "A carga tributária estimada manualmente" },
  paymentFeeRate: { min: 0, maxExclusive: 1, label: "A taxa de pagamento" },
  commissionRate: { min: 0, maxExclusive: 1, label: "A comissão" },
  desiredNetMargin: { min: 0, maxExclusive: 1, label: "A margem líquida desejada" },
  inventoryDays: { min: 0, label: "O prazo de estoque/produção" },
  receivingDays: { min: 0, label: "O prazo de recebimento" },
  paymentDays: { min: 0, label: "O prazo de pagamento" },
  monthlyCapitalRate: { min: 0, label: "O custo mensal do capital" },
});

const optionalNumbers = Object.freeze({
  insuranceCost: { min: 0, label: "O seguro" },
  otherDirectExpenses: { min: 0, label: "As outras despesas diretas" },
  discountRate: { min: 0, maxExclusive: 1, label: "O desconto percentual" },
  fixedDiscountAmount: { min: 0, label: "O desconto fixo" },
  marketPrice: { minExclusive: 0, label: "A referência de mercado" },
});

function numericIssue(value, rule) {
  if (value === null || value === undefined) return "required";
  if (typeof value !== "number" || !Number.isFinite(value)) return "invalid";
  if (rule.min !== undefined && value < rule.min) return "min";
  if (rule.minExclusive !== undefined && value <= rule.minExclusive) return "minExclusive";
  if (rule.maxExclusive !== undefined && value >= rule.maxExclusive) return "maxExclusive";
  return null;
}

function numberMessage(rule, issue, optional = false) {
  if (issue === "required") return optional ? "" : `Informe ${rule.label.toLocaleLowerCase("pt-BR")}.`;
  if (issue === "invalid") return `${rule.label} deve ser um número finito.`;
  if (issue === "min") return `${rule.label} não pode ser negativo.`;
  if (issue === "minExclusive") return `${rule.label} deve ser maior que zero.`;
  if (issue === "maxExclusive") return `${rule.label} deve ser menor que 100%.`;
  return "Dados inválidos.";
}

function optionalValue(value) {
  return value === null || value === undefined || value === "" ? null : value;
}

function normalizedCapacity(input, errors) {
  const capacity = input.productionCapacity;
  if (!capacity || typeof capacity !== "object") return null;
  const keys = ["workerCount", "productiveHoursPerWorkerMonth", "unitsPerWorkerHour"];
  const supplied = keys.filter((key) => optionalValue(capacity[key]) !== null);
  if (supplied.length === 0) return null;
  if (supplied.length !== keys.length) {
    errors.productionCapacity = "Preencha todos os campos da capacidade produtiva ou deixe-os vazios.";
    return null;
  }
  const normalized = {};
  for (const key of keys) {
    const value = capacity[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      errors[`productionCapacity.${key}`] = "A capacidade produtiva aceita apenas números não negativos.";
    } else {
      normalized[key] = value;
    }
  }
  return Object.keys(normalized).length === keys.length ? {
    ...normalized,
    monthlyCapacity: normalized.workerCount * normalized.productiveHoursPerWorkerMonth * normalized.unitsPerWorkerHour,
  } : null;
}

/** Validate normalized, typed domain inputs. Rates are fractions, never percentages. */
function validatePricingInputs(input = {}) {
  input = input && typeof input === "object" ? input : {};
  const errors = {};
  const normalized = {};

  for (const [key, rule] of Object.entries(requiredNumbers)) {
    const issue = numericIssue(input[key], rule);
    if (issue) errors[key] = numberMessage(rule, issue);
    else normalized[key] = input[key];
  }

  for (const [key, rule] of Object.entries(optionalNumbers)) {
    const value = optionalValue(input[key]);
    if (value === null) {
      normalized[key] = key === "marketPrice" ? null : 0;
      continue;
    }
    const issue = numericIssue(value, rule);
    if (issue) errors[key] = numberMessage(rule, issue, true);
    else normalized[key] = value;
  }

  normalized.productionCapacity = normalizedCapacity(input, errors);
  normalized.fiscalContext = input.fiscalContext && typeof input.fiscalContext === "object" ? input.fiscalContext : {};

  const rateKeys = ["taxRate", "paymentFeeRate", "commissionRate", "desiredNetMargin"];
  if (rateKeys.every((key) => typeof normalized[key] === "number")) {
    const denominator = 1 - normalized.taxRate - normalized.paymentFeeRate - normalized.commissionRate - normalized.desiredNetMargin;
    if (!(denominator > 1e-12)) errors.desiredNetMargin = "A soma de tributos, taxas, comissão e margem deve ser menor que 100%.";
  }
  if (normalized.discountRate > 0 && normalized.fixedDiscountAmount > 0) {
    errors.discountRate = "Escolha desconto percentual ou valor fixo, não os dois.";
    errors.fixedDiscountAmount = "Escolha desconto percentual ou valor fixo, não os dois.";
  }

  return { isValid: Object.keys(errors).length === 0, errors, value: Object.keys(errors).length === 0 ? normalized : null };
}

function assertPricingInputs(input) {
  const validation = validatePricingInputs(input);
  if (!validation.isValid) throw new PricingValidationError(validation.errors);
  return validation.value;
}

function calculateAdjustedMaterialCost(materialCost, wasteRate) {
  return materialCost / (1 - wasteRate);
}

function calculateDirectCost(inputs) {
  return inputs.adjustedMaterialCost + inputs.packagingCost + inputs.deliveryCost + inputs.insuranceCost + inputs.otherDirectExpenses;
}

function calculateIndirectCost(monthlyPayroll, monthlyFixedCosts, expectedMonthlyUnits) {
  return (monthlyPayroll + monthlyFixedCosts) / expectedMonthlyUnits;
}

function calculateWorkingCapital(operatingCost, inventoryDays, receivingDays, paymentDays, monthlyCapitalRate) {
  const financedDays = Math.max(inventoryDays + receivingDays - paymentDays, 0);
  const periodCapitalRate = (1 + monthlyCapitalRate) ** (financedDays / 30) - 1;
  return {
    financedDays,
    financedBase: operatingCost,
    periodCapitalRate,
    financialCost: financedDays === 0 ? 0 : operatingCost * periodCapitalRate,
  };
}

function calculateTechnicalPrice(totalUnitCost, saleExpenseRate, desiredNetMargin) {
  const priceDenominator = 1 - saleExpenseRate - desiredNetMargin;
  if (!(priceDenominator > 1e-12)) throw new PricingValidationError({ desiredNetMargin: "A soma de tributos, taxas, comissão e margem deve ser menor que 100%." });
  const technicalPriceRaw = totalUnitCost / priceDenominator;
  return { priceDenominator, technicalPriceRaw, technicalPrice: Math.ceil(technicalPriceRaw * 100) / 100 };
}

function calculateDiscountStrategy(technicalPrice, discountRate = 0, fixedDiscountAmount = 0) {
  if (discountRate > 0) {
    const advertisedPriceRaw = technicalPrice / (1 - discountRate);
    return { type: "percentage", rate: discountRate, fixedAmount: 0, advertisedPriceRaw, advertisedPrice: Math.ceil(advertisedPriceRaw * 100) / 100, discountAmount: advertisedPriceRaw - technicalPrice, postDiscountPrice: technicalPrice, preservesTechnicalPrice: true };
  }
  if (fixedDiscountAmount > 0) {
    const advertisedPriceRaw = technicalPrice + fixedDiscountAmount;
    return { type: "fixed", rate: 0, fixedAmount: fixedDiscountAmount, advertisedPriceRaw, advertisedPrice: Math.ceil(advertisedPriceRaw * 100) / 100, discountAmount: fixedDiscountAmount, postDiscountPrice: technicalPrice, preservesTechnicalPrice: true };
  }
  return { type: "none", rate: 0, fixedAmount: 0, advertisedPriceRaw: technicalPrice, advertisedPrice: technicalPrice, discountAmount: 0, postDiscountPrice: technicalPrice, preservesTechnicalPrice: true };
}

function calculateMarketComparison(marketReference, technicalPrice) {
  const price = marketReference?.price;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    return { price: null, source: null, rule: null, difference: null, differenceRate: null, reference: null };
  }
  return { price, source: marketReference.source || "manual", rule: marketReference.rule || "manual", difference: price - technicalPrice, differenceRate: (price - technicalPrice) / price, reference: marketReference };
}

function presentation(result) {
  const asMoney = (value) => Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  return Object.fromEntries(["adjustedMaterialCost", "directCost", "indirectCost", "operatingCost", "financedBase", "financialCost", "totalUnitCost", "technicalPriceRaw", "technicalPrice", "taxAmount", "paymentFeeAmount", "commissionAmount", "profitAmount"].map((key) => [key, asMoney(result[key])]));
}

function canonicalBreakdown(result) {
  const items = [
    { group: "Custo direto", key: "adjustedMaterialCost", label: "Matéria-prima ajustada por desperdício", value: result.adjustedMaterialCost, basis: "matéria-prima ÷ (1 − desperdício)", source: "Usuário" },
    { group: "Custo direto", key: "packagingCost", label: "Embalagem e rotulagem", value: result.inputs.packagingCost, basis: "Por unidade/venda", source: "Usuário" },
    { group: "Custo direto", key: "deliveryCost", label: "Frete e entrega", value: result.inputs.deliveryCost, basis: "Por unidade/venda", source: "Usuário" },
    { group: "Custo direto", key: "insuranceCost", label: "Seguro", value: result.inputs.insuranceCost, basis: "Por unidade/venda", source: "Usuário" },
    { group: "Custo direto", key: "otherDirectExpenses", label: "Outras despesas diretas", value: result.inputs.otherDirectExpenses, basis: "Por unidade/venda", source: "Usuário" },
    { group: "Custo indireto", key: "indirectCost", label: "Rateio da folha e custos fixos", value: result.indirectCost, basis: "(folha + custos fixos) ÷ quantidade mensal", source: "Usuário" },
    { group: "Capital de giro", key: "financialCost", label: "Custo financeiro", value: result.financialCost, basis: "custo operacional × taxa do período", source: "Regra técnica" },
    { group: "Venda", key: "taxAmount", label: "Carga tributária estimada manualmente", value: result.taxAmount, basis: "preço técnico × carga manual", source: "Usuário" },
    { group: "Venda", key: "paymentFeeAmount", label: "Taxa de pagamento", value: result.paymentFeeAmount, basis: "preço técnico × taxa", source: "Usuário" },
    { group: "Venda", key: "commissionAmount", label: "Comissão", value: result.commissionAmount, basis: "preço técnico × comissão", source: "Usuário" },
    { group: "Resultado", key: "profitAmount", label: "Lucro líquido", value: result.profitAmount, basis: "preço técnico − custos − despesas", source: "Regra técnica" },
    { group: "Resultado", key: "technicalPrice", label: "Preço técnico recomendado", value: result.technicalPrice, basis: "custo total ÷ denominador, arredondado para cima ao centavo", source: "Regra técnica" },
  ];
  if (result.discount.type !== "none") {
    items.push(
      { group: "Estratégia comercial", key: "advertisedPrice", label: "Preço anunciado", value: result.discount.advertisedPrice, basis: "Preço técnico acrescido do desconto planejado", source: "Usuário" },
      { group: "Estratégia comercial", key: "postDiscountPrice", label: "Preço após desconto", value: result.discount.postDiscountPrice, basis: "Mantém o preço técnico mínimo", source: "Regra técnica" },
    );
  }
  return items;
}

function canonicalExplanation(result) {
  return [
    { key: "material", value: result.adjustedMaterialCost, detail: "A matéria-prima foi ajustada pelo rendimento usando desperdício." },
    { key: "direct", value: result.directCost, detail: "O custo direto soma matéria-prima ajustada, embalagem, entrega, seguro e outras despesas diretas." },
    { key: "indirect", value: result.indirectCost, detail: "A folha e os custos fixos foram rateados somente pela quantidade mensal prevista." },
    { key: "workingCapital", value: result.financialCost, detail: "O ciclo financeiro aplica juros compostos somente sobre o custo operacional." },
    { key: "price", value: result.technicalPrice, detail: "O preço técnico cobre custo total, despesas percentuais e margem desejada; somente ele é arredondado para cima ao centavo." },
  ];
}

function calculatePricing(input, marketReference = null) {
  const inputs = assertPricingInputs(input);
  const adjustedMaterialCost = calculateAdjustedMaterialCost(inputs.materialCost, inputs.wasteRate);
  const directCost = calculateDirectCost({ ...inputs, adjustedMaterialCost });
  const indirectCost = calculateIndirectCost(inputs.monthlyPayroll, inputs.monthlyFixedCosts, inputs.expectedMonthlyUnits);
  const operatingCost = directCost + indirectCost;
  const workingCapital = calculateWorkingCapital(operatingCost, inputs.inventoryDays, inputs.receivingDays, inputs.paymentDays, inputs.monthlyCapitalRate);
  const totalUnitCost = operatingCost + workingCapital.financialCost;
  const saleExpenseRate = inputs.taxRate + inputs.paymentFeeRate + inputs.commissionRate;
  const technical = calculateTechnicalPrice(totalUnitCost, saleExpenseRate, inputs.desiredNetMargin);
  const taxAmountRaw = technical.technicalPriceRaw * inputs.taxRate;
  const paymentFeeAmountRaw = technical.technicalPriceRaw * inputs.paymentFeeRate;
  const commissionAmountRaw = technical.technicalPriceRaw * inputs.commissionRate;
  const taxAmount = technical.technicalPrice * inputs.taxRate;
  const paymentFeeAmount = technical.technicalPrice * inputs.paymentFeeRate;
  const commissionAmount = technical.technicalPrice * inputs.commissionRate;
  const profitAmountRaw = technical.technicalPriceRaw - totalUnitCost - taxAmountRaw - paymentFeeAmountRaw - commissionAmountRaw;
  const profitAmount = technical.technicalPrice - totalUnitCost - taxAmount - paymentFeeAmount - commissionAmount;
  const actualNetMargin = profitAmount / technical.technicalPrice;
  const result = {
    pricingSchemaVersion: PRICING_SCHEMA_VERSION,
    formulaVersion: FORMULA_VERSION,
    inputs,
    adjustedMaterialCost,
    directCost,
    indirectCost,
    operatingCost,
    ...workingCapital,
    totalUnitCost,
    saleExpenseRate,
    ...technical,
    taxAmountRaw,
    paymentFeeAmountRaw,
    commissionAmountRaw,
    profitAmountRaw,
    taxAmount,
    paymentFeeAmount,
    commissionAmount,
    profitAmount,
    desiredNetMargin: inputs.desiredNetMargin,
    actualNetMargin,
    discount: calculateDiscountStrategy(technical.technicalPrice, inputs.discountRate, inputs.fixedDiscountAmount),
    market: calculateMarketComparison(marketReference || (inputs.marketPrice ? { price: inputs.marketPrice, source: "manual", rule: "manual" } : null), technical.technicalPrice),
  };
  result.presentation = presentation(result);
  result.breakdown = canonicalBreakdown(result);
  result.explanation = canonicalExplanation(result);
  return result;
}

const calculatePrice = calculatePricing;


const REQUIRED_FISCAL_FIELDS = Object.freeze([
  ["taxRegime", "regime tributário"], ["originState", "UF de origem"], ["destinationState", "UF de destino"],
  ["cfop", "CFOP"], ["taxSituation", "CST/CSOSN"], ["customerType", "tipo de cliente"], ["operationPurpose", "finalidade da operação"],
]);

const TAXES_REQUIRING_EXTERNAL_RULES = Object.freeze([
  "ICMS", "ICMS-ST", "DIFAL", "FCP", "IPI", "PIS/COFINS", "IBS/CBS/IS e demais regras da reforma tributária",
]);

class TaxRuleEngine {
  assess() { throw new Error("O motor tributário deve implementar assess()."); }
}

class ConfiguredTaxRuleEngine extends TaxRuleEngine {
  assess(inputs, focusState = {}) {
    const fiscalContext = inputs.fiscalContext || {};
    const missingFields = REQUIRED_FISCAL_FIELDS.filter(([key]) => !String(fiscalContext[key] || "").trim()).map(([, label]) => label);
    const code = String(fiscalContext.ncmCode || "");
    const ncmVerified = focusState.status === "success" && focusState.source === "Focus NFe" && focusState.ncm?.codigo === code;
    const ncm = ncmVerified ? focusState.ncm : code ? { codigo: code } : null;
    return {
      automaticCalculation: false,
      complete: false,
      focusUnavailable: focusState.unavailable === true,
      fiscalContext,
      missingFields,
      ncm,
      ncmSource: ncmVerified ? "Focus NFe" : code ? "Usuário (não validado nesta simulação)" : "Não informado",
      ncmValidation: ncmVerified ? {
        status: "success", source: "Focus NFe", environment: focusState.environment || "não informado", checkedAt: focusState.checkedAt || new Date().toISOString(), code,
      } : { status: "unverified", source: code ? "Usuário" : null, environment: null, checkedAt: null, code: code || null },
      taxes: [{ key: "aggregate", label: "Carga tributária estimada manualmente", rate: inputs.taxRate, source: "Usuário" }],
      unresolvedTaxes: TAXES_REQUIRING_EXTERNAL_RULES,
      warnings: [
        "A Focus NFe confirma somente a classificação NCM; ela não calcula os tributos desta venda.",
        "O NCM isolado não determina a tributação aplicável.",
        "A carga tributária estimada manualmente deve ser validada por contador ou especialista fiscal.",
      ],
    };
  }
}

// Memória, tabela e gráficos recebem exatamente os valores que o cálculo produziu.
function buildCalculationMemory(result, assessment) {
  return result.breakdown.map((item) => ({ ...item, fiscalSource: item.key === "taxAmount" ? assessment.taxes[0].source : item.source }));
}

function fiscalDataForStorage(assessment, memory) {
  return {
    automaticCalculation: false,
    complete: false,
    context: assessment.fiscalContext,
    ncm: assessment.ncm,
    ncmSource: assessment.ncmSource,
    ncmValidation: assessment.ncmValidation,
    unresolvedTaxes: assessment.unresolvedTaxes,
    memory,
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



const PERCENTAGE_FIELDS = new Set([
  "wasteRate", "taxRate", "paymentFeeRate", "commissionRate", "desiredNetMargin", "monthlyCapitalRate", "discountRate",
]);

const FIELD_RULES = Object.freeze({
  materialCost: { required: "Informe o custo da matéria-prima." },
  wasteRate: { required: "Informe o desperdício." },
  packagingCost: { required: "Informe o custo de embalagem." },
  deliveryCost: { required: "Informe o frete ou entrega." },
  insuranceCost: { optional: true },
  otherDirectExpenses: { optional: true },
  monthlyPayroll: { required: "Informe a folha salarial mensal." },
  monthlyFixedCosts: { required: "Informe os custos fixos mensais." },
  expectedMonthlyUnits: { required: "Informe a quantidade prevista por mês." },
  taxRate: { required: "Informe a carga tributária estimada manualmente." },
  paymentFeeRate: { required: "Informe a taxa de pagamento." },
  commissionRate: { required: "Informe a comissão." },
  desiredNetMargin: { required: "Informe a margem líquida desejada." },
  inventoryDays: { required: "Informe o prazo de estoque/produção." },
  receivingDays: { required: "Informe o prazo de recebimento." },
  paymentDays: { required: "Informe o prazo de pagamento." },
  monthlyCapitalRate: { required: "Informe o custo do capital ao mês." },
  discountRate: { optional: true },
  fixedDiscountAmount: { optional: true },
  marketPrice: { optional: true },
});

const PRICING_FIELD_IDS = Object.freeze(Object.keys(FIELD_RULES));
const CAPACITY_FIELD_IDS = Object.freeze(["workerCount", "productiveHoursPerWorkerMonth", "unitsPerWorkerHour"]);

function parseBrazilianNumber(rawValue) {
  const value = String(rawValue ?? "").trim().replace(/\s/g, "");
  if (value === "") return { status: "empty", value: null };
  const commaCount = (value.match(/,/g) || []).length;
  const normalized = commaCount === 1 ? value.replace(/\./g, "").replace(",", ".") : value;
  if (commaCount > 1 || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return { status: "invalid", value: null };
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? { status: "valid", value: numeric } : { status: "invalid", value: null };
}

function readFiscalContext(elements) {
  return {
    ncmCode: String(elements.ncmCode?.value || "").replace(/\D/g, ""),
    taxRegime: String(elements.taxRegime?.value || ""),
    originState: String(elements.originState?.value || "").trim().toUpperCase(),
    destinationState: String(elements.destinationState?.value || "").trim().toUpperCase(),
    cfop: String(elements.cfop?.value || "").replace(/\D/g, ""),
    taxSituation: String(elements.taxSituation?.value || "").trim().toUpperCase(),
    customerType: String(elements.customerType?.value || ""),
    operationPurpose: String(elements.operationPurpose?.value || ""),
  };
}

function readCapacity(elements, errors) {
  const capacity = {};
  let provided = 0;
  for (const fieldId of CAPACITY_FIELD_IDS) {
    const parsed = parseBrazilianNumber(elements[fieldId]?.value);
    if (parsed.status === "invalid") errors[fieldId] = "Informe um número válido.";
    if (parsed.status === "valid") {
      capacity[fieldId] = parsed.value;
      provided += 1;
    }
  }
  if (provided > 0 && provided < CAPACITY_FIELD_IDS.length) {
    for (const fieldId of CAPACITY_FIELD_IDS) {
      if (!(fieldId in capacity) && !errors[fieldId]) errors[fieldId] = "Complete a capacidade produtiva ou deixe a seção vazia.";
    }
  }
  return provided === CAPACITY_FIELD_IDS.length ? capacity : null;
}

function validatePricingForm(elements) {
  const errors = {};
  const rawInputs = {};
  const emptyOptionalFields = [];
  for (const [fieldId, rule] of Object.entries(FIELD_RULES)) {
    const parsed = parseBrazilianNumber(elements[fieldId]?.value);
    if (parsed.status === "empty") {
      if (rule.optional) {
        rawInputs[fieldId] = fieldId === "marketPrice" ? null : 0;
        emptyOptionalFields.push(fieldId);
      } else errors[fieldId] = rule.required;
      continue;
    }
    if (parsed.status === "invalid") {
      errors[fieldId] = "Informe um número válido, sem notação científica.";
      continue;
    }
    rawInputs[fieldId] = PERCENTAGE_FIELDS.has(fieldId) ? parsed.value / 100 : parsed.value;
  }
  rawInputs.productionCapacity = readCapacity(elements, errors);
  rawInputs.fiscalContext = readFiscalContext(elements);
  if (Object.keys(errors).length > 0) return { isValid: false, errors, inputs: null, emptyOptionalFields };

  const domainValidation = validatePricingInputs(rawInputs);
  return {
    isValid: domainValidation.isValid,
    errors: domainValidation.errors,
    inputs: domainValidation.isValid ? domainValidation.value : null,
    emptyOptionalFields,
  };
}

function renderPricingErrors(elements, errors, visibleFieldIds = null) {
  for (const fieldId of [...PRICING_FIELD_IDS, ...CAPACITY_FIELD_IDS]) {
    const field = elements[fieldId];
    if (!field) continue;
    const error = errors[fieldId] || "";
    const visible = Boolean(error) && (visibleFieldIds === null || visibleFieldIds.has(fieldId));
    field.setCustomValidity?.(error);
    field.setAttribute("aria-invalid", String(visible));
    const container = field.closest?.(".sidebar-field");
    if (!container) continue;
    container.classList.toggle("has-error", visible);
    const errorId = `${fieldId}Error`;
    let errorElement = field.ownerDocument?.getElementById?.(errorId);
    if (!errorElement && field.ownerDocument?.createElement) {
      errorElement = field.ownerDocument.createElement("p");
      errorElement.id = errorId;
      errorElement.className = "pricing-field-error";
      errorElement.setAttribute("role", "alert");
      container.append(errorElement);
      const describedBy = new Set(String(field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
      describedBy.add(errorId);
      field.setAttribute("aria-describedby", [...describedBy].join(" "));
    }
    if (errorElement) {
      errorElement.textContent = visible ? error : "";
      errorElement.hidden = !visible;
    }
  }
}

function displayNumber(value, percentage = false) {
  const display = percentage ? value * 100 : value;
  return String(Number(display.toFixed(8))).replace(".", ",");
}

function clearPricingInputs(elements) {
  for (const fieldId of [...PRICING_FIELD_IDS, ...CAPACITY_FIELD_IDS]) {
    if (elements[fieldId]) elements[fieldId].value = "";
  }
  ["ncmCode", "taxRegime", "originState", "destinationState", "cfop", "taxSituation", "customerType", "operationPurpose"].forEach((fieldId) => {
    if (elements[fieldId]) elements[fieldId].value = "";
  });
}

function applySavedInputs(savedInputs, elements, emptyOptionalFields = []) {
  if (!savedInputs || typeof savedInputs !== "object") return false;
  const empty = new Set(emptyOptionalFields);
  for (const fieldId of PRICING_FIELD_IDS) {
    if (!elements[fieldId] || empty.has(fieldId)) continue;
    const value = savedInputs[fieldId];
    if (typeof value === "number" && Number.isFinite(value)) elements[fieldId].value = displayNumber(value, PERCENTAGE_FIELDS.has(fieldId));
  }
  for (const fieldId of CAPACITY_FIELD_IDS) {
    const value = savedInputs.productionCapacity?.[fieldId];
    if (elements[fieldId] && typeof value === "number" && Number.isFinite(value)) elements[fieldId].value = displayNumber(value);
  }
  Object.entries(savedInputs.fiscalContext || {}).forEach(([fieldId, value]) => {
    if (elements[fieldId] && typeof value === "string") elements[fieldId].value = value;
  });
  return true;
}

/** Maps only semantically equivalent v5 values. Missing inventory days deliberately stay empty. */
function migrateLegacyV5Inputs(legacy = {}) {
  const rate = (value) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
  return {
    materialCost: legacy.materialsCost,
    wasteRate: rate(legacy.waste),
    packagingCost: legacy.packagingCost,
    deliveryCost: legacy.deliveryCost,
    insuranceCost: legacy.insuranceCost,
    otherDirectExpenses: legacy.otherExpenses,
    monthlyPayroll: legacy.totalPayroll,
    monthlyFixedCosts: legacy.monthlyFixedCosts,
    expectedMonthlyUnits: legacy.monthlyVolume,
    taxRate: rate(legacy.taxRate),
    paymentFeeRate: rate(legacy.paymentFeeRate),
    commissionRate: rate(legacy.commissionRate),
    desiredNetMargin: rate(legacy.margin),
    receivingDays: legacy.receiveDays,
    paymentDays: legacy.payDays,
    monthlyCapitalRate: rate(legacy.capitalRate),
    // inventoryDays and discount strategy have no safe v5 equivalent.
    productionCapacity: legacy.workerCount !== undefined || legacy.outputPerWorkerHour !== undefined
      ? { workerCount: legacy.workerCount, productiveHoursPerWorkerMonth: 176, unitsPerWorkerHour: legacy.outputPerWorkerHour }
      : null,
    fiscalContext: legacy.fiscalContext || {},
  };
}



function money(value) { return value === null || value === undefined ? "—" : currency.format(value); }

function priceCompositionFrom(result) {
  return [
    { label: "Custo direto", value: result.directCost },
    { label: "Custo indireto", value: result.indirectCost },
    { label: "Custo financeiro", value: result.financialCost },
    { label: "Tributos, taxa e comissão", value: result.taxAmount + result.paymentFeeAmount + result.commissionAmount },
    { label: "Lucro líquido", value: result.profitAmount },
  ].filter((item) => item.value > 0);
}

function renderComposition(document, result) {
  const components = priceCompositionFrom(result);
  const total = components.reduce((sum, item) => sum + item.value, 0);
  document.querySelector("#priceDonutSegments").innerHTML = components.reduce(({ markup, cursor }, item, index) => {
    const share = total ? item.value / total : 0;
    const size = share * 100;
    return { cursor: cursor + size, markup: `${markup}<circle class="donut-segment donut-segment-${index + 1}" cx="60" cy="60" r="48" pathLength="100" stroke-dasharray="${size.toFixed(4)} ${(100 - size).toFixed(4)}" stroke-dashoffset="${(-cursor).toFixed(4)}"></circle>` };
  }, { markup: "", cursor: 0 }).markup;
  document.querySelector("#priceCompositionLegend").innerHTML = components.map((item, index) => `<li><span class="chart-legend-color chart-legend-color-${index + 1}"></span><span>${escapeHtml(item.label)}</span><strong>${money(item.value)}</strong><small>${percent(total ? item.value / total : 0)}</small></li>`).join("");
}

function renderPriceDetails(document, result, alertCount) {
  document.querySelector("#detailSuggestedPrice").textContent = money(result.technicalPrice);
  document.querySelector("#detailDonutPrice").textContent = money(result.technicalPrice);
  document.querySelector("#detailBaseCost").textContent = money(result.totalUnitCost);
  document.querySelector("#detailSalesRate").textContent = percent(result.saleExpenseRate);
  document.querySelector("#detailProfit").textContent = money(result.profitAmount);
  document.querySelector("#detailMargin").textContent = percent(result.actualNetMargin);
  document.querySelector("#detailMarketPrice").textContent = money(result.market.price);
  document.querySelector("#detailMarketCostLimit").textContent = result.market.difference === null ? "—" : money(result.market.difference);
  document.querySelector("#detailAlertCount").textContent = `${alertCount} ${alertCount === 1 ? "ponto de atenção" : "pontos de atenção"}`;
  document.querySelector("#detailMarketNarrative").textContent = result.market.price
    ? `Referência ${result.market.rule}: ${money(result.market.price)}. Diferença para o preço técnico: ${money(result.market.difference)} (${percent(result.market.differenceRate)}).`
    : "Não há referência de mercado. Isso não bloqueia o preço técnico.";
  document.querySelector("#priceComparisonBars").innerHTML = [
    ["Custo total", result.totalUnitCost], ["Preço técnico", result.technicalPrice], ["Mercado", result.market.price],
  ].filter(([, value]) => value !== null).map(([label, value]) => `<li><div><span>${label}</span><strong>${money(value)}</strong></div></li>`).join("");
  renderComposition(document, result);
}

function renderPriceDetailsUnavailable(document, invalidCount) {
  ["detailSuggestedPrice", "detailDonutPrice", "detailBaseCost", "detailSalesRate", "detailProfit", "detailMargin", "detailMarketPrice", "detailMarketCostLimit"].forEach((id) => { document.querySelector(`#${id}`).textContent = "—"; });
  document.querySelector("#detailAlertCount").textContent = `${invalidCount} ${invalidCount === 1 ? "campo pendente" : "campos pendentes"}`;
  document.querySelector("#priceDonutSegments").innerHTML = "";
  document.querySelector("#priceCompositionLegend").innerHTML = "<li>Preencha os campos obrigatórios.</li>";
  document.querySelector("#priceComparisonBars").innerHTML = "";
  document.querySelector("#detailMarketNarrative").textContent = "A comparação é opcional e será mostrada quando houver uma referência válida.";
}



function dashboardMoney(value) { return value === null || value === undefined ? "—" : currency.format(value); }

function marketLabel(market) {
  if (!market?.price) return "Sem referência de mercado";
  if (market.rule === "selected-product") return "Produto individual selecionado";
  if (market.rule === "amazon-average") return "Média da pesquisa Amazon";
  if (market.rule === "amazon-median") return "Mediana da pesquisa Amazon";
  return "Média informada manualmente";
}

function renderExplanation(document, result) {
  const explanations = [
    `Matéria-prima ajustada: ${dashboardMoney(result.adjustedMaterialCost)} (${percent(result.inputs.wasteRate)} de desperdício).`,
    `Custo direto: ${dashboardMoney(result.directCost)}; custo indireto: ${dashboardMoney(result.indirectCost)}, rateado por ${result.inputs.expectedMonthlyUnits.toLocaleString("pt-BR")} unidade(s)/mês.`,
    `Ciclo financeiro: ${result.financedDays.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} dia(s); base financiada: ${dashboardMoney(result.financedBase)}; taxa do período: ${percent(result.periodCapitalRate)}; custo financeiro: ${dashboardMoney(result.financialCost)}.`,
    `Despesas percentuais: ${percent(result.saleExpenseRate)}; margem desejada: ${percent(result.desiredNetMargin)}; preço bruto: ${dashboardMoney(result.technicalPriceRaw)}; preço técnico arredondado para cima: ${dashboardMoney(result.technicalPrice)}.`,
  ];
  if (result.market.price) explanations.push(`${marketLabel(result.market)}: ${dashboardMoney(result.market.price)}; diferença para o preço técnico: ${dashboardMoney(result.market.difference)} (${percent(result.market.differenceRate)}).`);
  if (result.discount.type !== "none") explanations.push(`Estratégia de desconto ${result.discount.type === "percentage" ? "percentual" : "fixo"}: preço anunciado ${dashboardMoney(result.discount.advertisedPrice)}, desconto ${dashboardMoney(result.discount.discountAmount)} e preço após desconto ${dashboardMoney(result.discount.postDiscountPrice)}.`);
  document.querySelector("#explanationList").innerHTML = explanations.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderCostTable(document, result) {
  document.querySelector("#costRows").innerHTML = result.breakdown.map((item) => `
    <tr><td><small>${escapeHtml(item.group)}</small><br>${escapeHtml(item.label)}</td><td>${dashboardMoney(item.value)}</td><td>${escapeHtml(item.basis)}</td><td>${escapeHtml(item.fiscalSource || item.source)}</td></tr>`).join("");
}

function renderAlerts(document, result, assessment) {
  const alerts = [];
  if (result.financedDays > 0) alerts.push(["warning", `O ciclo financeiro acrescenta ${dashboardMoney(result.financialCost)} por unidade.`]);
  if (result.inputs.productionCapacity && result.inputs.productionCapacity.monthlyCapacity < result.inputs.expectedMonthlyUnits) alerts.push(["warning", "A capacidade produtiva informada é menor que a quantidade mensal usada no rateio. O preço não foi alterado por isso."]);
  if (result.market.price && result.market.difference < 0) alerts.push(["risk", `O preço técnico está ${dashboardMoney(Math.abs(result.market.difference))} acima da referência de mercado. A referência não altera o preço técnico.`]);
  if (assessment.focusUnavailable) alerts.push(["warning", "A Focus NFe está indisponível; a carga tributária continua manual e não foi alterada."]);
  alerts.push(["warning", "A carga tributária é estimada manualmente. A Focus NFe valida NCM, mas não calcula alíquotas."]);
  document.querySelector("#alerts").innerHTML = alerts.map(([type, text]) => `<div class="${type}">${escapeHtml(text)}</div>`).join("");
  document.querySelector("#alertCount").textContent = `${alerts.length} ${alerts.length === 1 ? "ponto de atenção" : "pontos de atenção"}`;
  document.querySelector("#alertSummary").textContent = alerts[0][1];
  return alerts.length;
}

function renderFiscalSummary(document, assessment) {
  const ncm = assessment.ncm?.codigo || "não informado";
  const status = assessment.ncmValidation.status === "success" ? `validado pela Focus NFe em ${assessment.ncmValidation.environment}` : "não validado nesta simulação";
  document.querySelector("#fiscalSummary").innerHTML = `<p><strong>NCM:</strong> ${escapeHtml(ncm)} (${escapeHtml(status)})</p><p><strong>Carga usada:</strong> estimada manualmente; a Focus NFe não calculou qualquer alíquota.</p><p><strong>Tributos ainda dependentes de regra externa:</strong> ${escapeHtml(assessment.unresolvedTaxes.join(", "))}.</p>`;
}

function renderMarketPanel(document, marketState) {
  const panel = document.querySelector("#marketPanel");
  const stats = document.querySelector("#marketStats");
  const results = document.querySelector("#marketResults");
  const status = document.querySelector("#marketSearchStatus");
  const selected = document.querySelector("#selectedMarketProduct");
  const searchButton = document.querySelector("#marketSearchButton");
  panel.hidden = marketState.status === "idle";
  searchButton.disabled = marketState.status === "loading";
  searchButton.textContent = marketState.status === "loading" ? "Buscando produtos..." : "Pesquisar produto";
  selected.hidden = !marketState.selectedItem;
  selected.innerHTML = marketState.selectedItem ? `<p class="eyebrow">Produto individual selecionado</p><h3>${escapeHtml(marketState.selectedItem.title)}</h3><strong>${dashboardMoney(marketState.selectedItem.price)}</strong><small>Marketplace: ${escapeHtml(marketState.marketplace || "Amazon")} · Provedor técnico: ${escapeHtml(marketState.provider || "Nexscope")}</small><button type="button" class="secondary-button" data-change-market-reference>Remover seleção</button>` : "";
  if (marketState.status === "loading") { status.textContent = "Consultando produtos…"; stats.innerHTML = ""; results.innerHTML = ""; return; }
  if (marketState.status === "error") { status.textContent = marketState.error; stats.innerHTML = '<div class="market-error-alert" role="alert">Pesquisa indisponível. O cálculo técnico continua disponível.</div>'; results.innerHTML = ""; return; }
  if (marketState.status === "empty") { status.textContent = "Nenhum produto compatível foi encontrado."; stats.innerHTML = ""; results.innerHTML = ""; return; }
  if (!marketState.stats) { status.textContent = "A pesquisa de mercado é opcional."; stats.innerHTML = ""; results.innerHTML = ""; return; }
  status.textContent = `${marketState.stats.count} referência(s) encontrada(s).`;
  stats.innerHTML = `<p>Média: <strong>${dashboardMoney(marketState.stats.average)}</strong> · Mediana: <strong>${dashboardMoney(marketState.stats.median)}</strong> · Mín.: ${dashboardMoney(marketState.stats.min)} · Máx.: ${dashboardMoney(marketState.stats.max)}</p>`;
  results.innerHTML = marketState.items.map((item) => `<article class="amazon-result${marketState.selectedItem?.id === item.id ? " selected" : ""}"><div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.category || "Categoria não informada")} · ${escapeHtml(item.source)}</p><strong>${dashboardMoney(item.price)}</strong></div><div class="amazon-actions"><button type="button" data-market-select="${escapeHtml(item.id)}">Usar produto</button><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Ver referência</a></div></article>`).join("");
}

function renderIncompleteDashboard(document, marketState, errors) {
  const count = Object.keys(errors).length;
  ["baseCost", "marketReferencePrice", "suggestedPrice", "profitPerSale", "estimatedMargin", "detailSuggestedPrice", "detailBaseCost", "detailSalesRate", "detailProfit", "detailMargin"].forEach((id) => { const node = document.querySelector(`#${id}`); if (node) node.textContent = "—"; });
  document.querySelector("#priceStatus").textContent = "Aguardando dados válidos";
  document.querySelector("#recommendationText").textContent = "Corrija os campos indicados para calcular e salvar.";
  document.querySelector("#marketStatus").textContent = "Mercado é opcional e será comparado quando houver referência válida.";
  document.querySelector("#alertCount").textContent = `${count} ${count === 1 ? "campo pendente" : "campos pendentes"}`;
  document.querySelector("#alertSummary").textContent = "O cálculo e o salvamento estão bloqueados.";
  document.querySelector("#explanationList").innerHTML = "<li>Preencha os campos obrigatórios sem corrigir valores silenciosamente.</li>";
  document.querySelector("#costRows").innerHTML = '<tr><td colspan="4">O detalhamento usa o resultado canônico após a validação.</td></tr>';
  document.querySelector("#alerts").innerHTML = "<div class=\"warning\">Corrija os campos indicados.</div>";
  document.querySelector("#fiscalSummary").innerHTML = "<p>O contexto fiscal será preservado sem inventar alíquotas.</p>";
  renderMarketPanel(document, marketState);
  renderPriceDetailsUnavailable(document, count);
}

function renderDashboard(document, result, marketState, fiscalAssessment) {
  const market = result.market;
  document.querySelector("#baseCost").textContent = dashboardMoney(result.totalUnitCost);
  document.querySelector("#marketReferencePrice").textContent = dashboardMoney(market.price);
  document.querySelector("#marketTitle").textContent = marketLabel(market);
  document.querySelector("#marketReferenceDetails").textContent = market.price ? `Fonte: ${market.source || "não informada"}` : "Referência opcional não informada";
  document.querySelector("#marketPriceLabel").textContent = marketLabel(market);
  document.querySelector("#suggestedPrice").textContent = dashboardMoney(result.technicalPrice);
  document.querySelector("#profitPerSale").textContent = dashboardMoney(result.profitAmount);
  document.querySelector("#estimatedMargin").textContent = percent(result.actualNetMargin);
  document.querySelector("#priceStatus").textContent = "Preço técnico";
  document.querySelector("#recommendationText").textContent = "Preço mínimo sustentável, calculado sem usar mercado ou desconto como custo.";
  document.querySelector("#marketStatus").textContent = market.price ? `Diferença: ${dashboardMoney(market.difference)} (${percent(market.differenceRate)}).` : "Sem referência de mercado; o cálculo técnico não é bloqueado.";
  const meter = document.querySelector("#marketMeter");
  meter.value = market.price ? Math.min((result.technicalPrice / market.price) * 100, 100) : 0;
  const count = renderAlerts(document, result, fiscalAssessment);
  renderExplanation(document, result);
  renderCostTable(document, result);
  renderFiscalSummary(document, fiscalAssessment);
  renderMarketPanel(document, marketState);
  renderPriceDetails(document, result, count);
}



function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function detail(label, value, extraClass = "") {
  return `<div class="${extraClass}"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function savedMarket(product) {
  const canonical = product.calculationData?.pricingResult?.market;
  if (canonical?.price) {
    return {
      difference: `${Math.abs(canonical.differenceRate * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% ${canonical.difference <= 0 ? "abaixo" : "acima"}`,
      price: canonical.price,
      productTitle: canonical.reference?.selectedProduct?.title || canonical.reference?.query || canonical.rule,
      source: canonical.source || "não informada",
    };
  }
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
  const canonical = product.calculationData?.pricingResult;
  const isLegacy = product.calculationData?.version === 5 || product.calculationData?.pricingSchemaVersion === 5;
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
      ${detail(canonical ? "Custo direto unitário" : "Preço de custo", currency.format(canonical?.directCost ?? product.costPrice))}
      ${detail(canonical ? "Custo indireto + financeiro" : "Custos adicionais", currency.format(canonical ? canonical.indirectCost + canonical.financialCost : product.additionalCosts))}
      ${detail("Margem desejada", `${Number(product.profitMargin).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`)}
      ${detail(canonical ? "Preço técnico recomendado" : "Preço sugerido", currency.format(product.suggestedPrice))}
      ${canonical ? `${detail("Custo total unitário", currency.format(canonical.totalUnitCost))}${detail("Margem efetiva", `${(canonical.actualNetMargin * 100).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`)}` : ""}
      ${isLegacy ? detail("Memória", "Cálculo legado v5 preservado; não foi recalculado.") : ""}
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
  direct: ["materialCost", "wasteRate", "packagingCost", "deliveryCost"],
  indirect: ["monthlyPayroll", "monthlyFixedCosts"],
  production: ["expectedMonthlyUnits"],
  sales: ["taxRate", "paymentFeeRate", "commissionRate"],
  market: ["desiredNetMargin"],
  terms: ["inventoryDays", "receivingDays", "paymentDays", "monthlyCapitalRate"],
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
  "marketReferenceRule",
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

let focusState = {
  status: "idle",
  ncm: null,
  source: "",
  environment: "",
  checkedAt: "",
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
let manualMarketValue = elements.marketPrice.value;
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

function marketReferenceFromState(inputs) {
  const rule = elements.marketReferenceRule.value || "manual";
  if (rule === "manual") return inputs.marketPrice ? { price: inputs.marketPrice, source: "manual", rule } : null;
  if (rule === "selected-product" && marketState.selectedItem) {
    return { price: marketState.selectedItem.price, source: marketState.selectedItem.source, rule, query: marketState.query, marketplace: marketState.marketplace, provider: marketState.provider, selectedProduct: marketState.selectedItem, stats: marketState.stats };
  }
  if (rule === "amazon-average" && marketState.stats) return { price: marketState.stats.average, source: marketState.marketplace || "Amazon", rule, query: marketState.query, marketplace: marketState.marketplace, provider: marketState.provider, stats: marketState.stats };
  if (rule === "amazon-median" && marketState.stats) return { price: marketState.stats.median, source: marketState.marketplace || "Amazon", rule, query: marketState.query, marketplace: marketState.marketplace, provider: marketState.provider, stats: marketState.stats };
  return null;
}

function render() {
  const validation = currentPricingValidation();
  if (validation.isValid) {
    const inputs = validation.inputs;
    const result = calculatePricing(inputs, marketReferenceFromState(inputs));
    const fiscalAssessment = taxRuleEngine.assess(inputs, focusState);
    renderDashboard(document, result, marketState, fiscalAssessment);
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
    focusState = { status: "error", ncm: null, source: "", environment: "", checkedAt: "", error: "Informe um NCM com exatamente 8 dígitos.", unavailable: false };
    render();
    return;
  }

  focusState = { status: "loading", ncm: null, source: "", environment: "", checkedAt: "", error: "", unavailable: false };
  render();
  try {
    const response = await api.get(`/fiscal/ncms/${encodeURIComponent(code)}`, { handleUnauthorized: false });
    focusState = { status: "success", ncm: response.ncm, source: "Focus NFe", environment: response.environment, checkedAt: new Date().toISOString(), error: "", unavailable: false };
  } catch (error) {
    focusState = {
      status: "error",
      ncm: null,
      source: "", environment: "", checkedAt: "",
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
  } else if (caughtError instanceof ApiError && caughtError.code === "NEXSCOPE_UNAUTHORIZED") {
    error = "Não foi possível autenticar a consulta de mercado.";
  } else if (caughtError instanceof ApiError && caughtError.code === "NEXSCOPE_FORBIDDEN") {
    error = "A conta do provedor não possui acesso à pesquisa Amazon.";
  } else if (caughtError instanceof ApiError && caughtError.code === "NEXSCOPE_INSUFFICIENT_CREDITS") {
    error = "A conta do provedor está sem créditos suficientes para esta consulta.";
  } else if (caughtError instanceof ApiError && caughtError.code === "NEXSCOPE_TIMEOUT") {
    error = "A consulta demorou mais que o esperado. Tente novamente.";
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
  if (elements.marketReferenceRule.value !== "selected-product") manualMarketValue = elements.marketPrice.value;
  marketState = { ...marketState, selectedItem: item };
  elements.marketReferenceRule.value = "selected-product";
  saveMarketReference(window.sessionStorage, { manualValue: manualMarketValue || null, query: marketState.query, selectedItem: item });
  render();
}

function restoreManualMarket({ focusSearch = false } = {}) {
  elements.marketPrice.value = manualMarketValue === null ? "" : String(manualMarketValue);
  touchedPricingFields.add("marketPrice");
  elements.marketReferenceRule.value = "manual";
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
  elements.marketReferenceRule.value = "selected-product";
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

  if (!name) throw new ApiError("Informe o nome do produto antes de salvar.", 400);

  return {
    name,
    description,
    category: "Não categorizado",
    pricing: {
      inputs,
      emptyOptionalFields: validation.emptyOptionalFields,
      market: {
        rule: elements.marketReferenceRule.value,
        query: marketState.query,
        stats: marketState.stats,
        selectedProduct: marketState.selectedItem,
        marketplace: marketState.marketplace || "Amazon",
        provider: marketState.provider || "Nexscope",
      },
      fiscalValidation: focusState.status === "success" && focusState.ncm?.codigo === inputs.fiscalContext.ncmCode
        ? { status: "success", source: "Focus NFe", code: focusState.ncm.codigo, ncm: focusState.ncm, environment: focusState.environment, checkedAt: focusState.checkedAt }
        : null,
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
    const response = await api.post("/products", payload);
    // O servidor recalcula e devolve o snapshot que passa a ser a versão salva.
    state.selectedProduct = response.product;
    setMessage(status, `Produto salvo no histórico com o preço técnico de ${response.product.suggestedPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`, true);
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
  ["editCostPrice", "editAdditionalCosts", "editProfitMargin", "editSuggestedPrice", "editMarketplace"].forEach((id) => {
    const field = $(`#${id}`);
    if (field) field.readOnly = true;
  });
  openDialog($("#productDialog"));
}

async function getProduct(id) {
  const response = await api.get(`/products/${encodeURIComponent(id)}`);
  return response.product;
}

function reuseProduct(product) {
  // Nunca deixa valores da simulação anterior sobreviverem a campos ausentes.
  clearPricingInputs(elements);
  $("#productName").value = "";
  $("#productDescription").value = "";
  const data = product.calculationData || {};
  const isLegacy = data.version === 5 || data.pricingSchemaVersion === 5;
  const savedInputs = isLegacy ? migrateLegacyV5Inputs(data.inputs) : data.inputs;
  if (!applySavedInputs(savedInputs, elements, product.calculationData?.emptyOptionalFields)) {
    setMessage($("#historyMessage"), "Esta consulta não possui os dados necessários para ser reutilizada.");
    return;
  }

  $("#productName").value = product.name;
  $("#productDescription").value = product.description || "";
  // Um v5 não possuía prova de validação; ele nunca é promovido para Focus validado.
  const savedValidation = !isLegacy ? data.fiscal?.ncmValidation : null;
  const savedNcm = data.fiscal?.ncm;
  focusState = savedValidation?.status === "success" && savedValidation.code === savedInputs?.fiscalContext?.ncmCode
    ? { status: "success", ncm: savedNcm, source: "Focus NFe", environment: savedValidation.environment, checkedAt: savedValidation.checkedAt, error: "", unavailable: false }
    : { status: "idle", ncm: null, source: "", environment: "", checkedAt: "", error: "", unavailable: false };
  const savedMarket = data.market;
  const reference = data.pricingResult?.market?.reference || savedMarket;
  const savedManualValue = savedInputs?.marketPrice;
  manualMarketValue = Number.isFinite(savedManualValue) && savedManualValue > 0 ? String(savedManualValue).replace(".", ",") : "";
  marketState = {
    ...marketState,
    status: "idle",
    query: reference?.query || "",
    items: [],
    stats: reference?.stats || null,
    selectedItem: reference?.selectedProduct || null,
    marketplace: reference?.marketplace || "Amazon",
    provider: reference?.provider || "Nexscope",
    error: "",
  };
  elements.marketReferenceRule.value = reference?.rule || "manual";
  if (marketState.selectedItem) saveMarketReference(window.sessionStorage, { manualValue: manualMarketValue || null, query: marketState.query, selectedItem: marketState.selectedItem });
  else clearMarketReference(window.sessionStorage);
  $("#marketQuery").value = marketState.query;
  $("#productDialog").close();
  render();
  navigate("assistant");
  setMessage($("#saveProductStatus"), isLegacy ? "Cálculo legado carregado: confirme estoque/produção e revise os campos antes de salvar uma nova versão." : "Consulta carregada. Ajuste os inputs e salve uma nova versão.", true);
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

 [...PRICING_FIELD_IDS, ...CAPACITY_FIELD_IDS]
  .filter((fieldId) => fieldId !== "marketPrice")
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
  if (focusState.ncm?.codigo !== currentCode) focusState = { status: "idle", ncm: null, source: "", environment: "", checkedAt: "", error: "", unavailable: false };
  render();
});

$("#ncmLookupButton").addEventListener("click", lookupNcm);
elements.ncmCode.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  void lookupNcm();
});

elements.marketPrice.addEventListener("input", () => {
  touchedPricingFields.add("marketPrice");
  marketState = { ...marketState, selectedItem: null };
  manualMarketValue = elements.marketPrice.value;
  elements.marketReferenceRule.value = "manual";
  clearMarketReference(window.sessionStorage);
  render();
});

elements.marketReferenceRule.addEventListener("change", render);

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
