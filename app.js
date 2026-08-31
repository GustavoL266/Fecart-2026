/* Gerado por scripts/build.mjs. Edite os arquivos em js/ e execute npm run build. */

const PRODUCTIVE_HOURS_PER_WORKER_MONTH = 176;

const MELI_CONFIG = {
  siteId: "MLB",
  searchLimit: 30,
  minComparableResults: 3,
  cacheTtlMs: 5 * 60 * 1000,
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

const CATEGORY_PRESETS = {
  comestiveis: {
    materialsCost: 12,
    waste: 8,
    packagingCost: 2,
    deliveryCost: 1.5,
    totalPayroll: 12600,
    workerCount: 6,
    outputPerWorkerHour: 12,
    monthlyFixedCosts: 16000,
    monthlyVolume: 4000,
    taxRate: 6,
    paymentFeeRate: 2.8,
    commissionRate: 0,
    margin: 18,
    competitorAverage: 32,
    receiveDays: 7,
    payDays: 14,
    capitalRate: 2.5,
  },
  domesticos: {
    materialsCost: 30,
    waste: 2,
    packagingCost: 3,
    deliveryCost: 5,
    totalPayroll: 10800,
    workerCount: 4,
    outputPerWorkerHour: 6,
    monthlyFixedCosts: 18000,
    monthlyVolume: 750,
    taxRate: 6,
    paymentFeeRate: 3.2,
    commissionRate: 0,
    margin: 22,
    competitorAverage: 105,
    receiveDays: 15,
    payDays: 20,
    capitalRate: 2.5,
  },
  eletrodomesticos: {
    materialsCost: 320,
    waste: 0.5,
    packagingCost: 10,
    deliveryCost: 35,
    totalPayroll: 10000,
    workerCount: 3,
    outputPerWorkerHour: 1.5,
    monthlyFixedCosts: 22000,
    monthlyVolume: 250,
    taxRate: 6,
    paymentFeeRate: 4,
    commissionRate: 1,
    margin: 14,
    competitorAverage: 650,
    receiveDays: 30,
    payDays: 30,
    capitalRate: 2.5,
  },
  vestuario: {
    materialsCost: 35,
    waste: 2.5,
    packagingCost: 3,
    deliveryCost: 7,
    totalPayroll: 12500,
    workerCount: 5,
    outputPerWorkerHour: 4,
    monthlyFixedCosts: 20000,
    monthlyVolume: 800,
    taxRate: 6,
    paymentFeeRate: 3.5,
    commissionRate: 2,
    margin: 28,
    competitorAverage: 135,
    receiveDays: 20,
    payDays: 25,
    capitalRate: 2.5,
  },
  cosmeticos: {
    materialsCost: 20,
    waste: 1.5,
    packagingCost: 6,
    deliveryCost: 4,
    totalPayroll: 11000,
    workerCount: 4,
    outputPerWorkerHour: 5,
    monthlyFixedCosts: 16000,
    monthlyVolume: 600,
    taxRate: 6,
    paymentFeeRate: 3.5,
    commissionRate: 4,
    margin: 30,
    competitorAverage: 125,
    receiveDays: 30,
    payDays: 15,
    capitalRate: 2.5,
  },
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



function normalizeText(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function extractTokens(value) {
  return (
    normalizeText(value)
      .match(/[a-z0-9]+/g)
      ?.filter((token) => token.length >= 3 || /^\d+$/.test(token)) || []
  );
}

function normalizeItem(item) {
  const image = item.thumbnail ? item.thumbnail.replace(/^http:/, "https:") : "";
  const category = item.domain_id || item.category_id || item.attributes?.find((attribute) => attribute.id === "BRAND")?.value_name || "";

  return {
    id: item.id,
    title: item.title,
    price: Number(item.price),
    image,
    link: item.permalink,
    category,
    condition: item.condition,
    attributes: Array.isArray(item.attributes) ? item.attributes : [],
  };
}

function isComparable(listing, queryTokens) {
  const title = normalizeText(listing.title);
  const compactTitle = title.replace(/\s+/g, "");
  const titleTokens = extractTokens(listing.title);

  return queryTokens.every((token) => (/^\d+$/.test(token) ? titleTokens.includes(token) : titleTokens.includes(token) || compactTitle.includes(token)));
}

function filterComparableListings(listings, query) {
  const queryTokens = extractTokens(query);
  const seenIds = new Set();

  return listings.filter((listing) => {
    const isValid = Number.isFinite(listing.price) && listing.price > 0 && listing.title && listing.link;
    if (!isValid || seenIds.has(listing.id)) return false;

    seenIds.add(listing.id);
    return queryTokens.length === 0 || isComparable(listing, queryTokens);
  });
}

function calculateMedian(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function calculateStats(listings) {
  const prices = listings.map((listing) => listing.price).filter((price) => Number.isFinite(price) && price > 0);
  if (prices.length === 0) return null;

  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
    average: prices.reduce((sum, price) => sum + price, 0) / prices.length,
    median: calculateMedian(prices),
    count: prices.length,
  };
}

function buildSearchUrl(query) {
  return `https://lista.mercadolivre.com.br/${encodeURIComponent(query.trim().replace(/\s+/g, "-"))}`;
}

class MercadoLivreService {
  #cache = new Map();

  async search(query) {
    const cacheKey = normalizeText(query);
    const cached = this.#cache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < MELI_CONFIG.cacheTtlMs) return cached.data;

    const params = new URLSearchParams({ q: query, limit: String(MELI_CONFIG.searchLimit) });
    const response = await fetch(`https://api.mercadolibre.com/sites/${MELI_CONFIG.siteId}/search?${params.toString()}`);

    if (!response.ok) {
      const error = new Error("api-error");
      error.status = response.status;
      throw error;
    }

    const payload = await response.json();
    const listings = Array.isArray(payload.results) ? payload.results.map(normalizeItem) : [];
    const comparableListings = filterComparableListings(listings, query);
    const data = {
      query,
      searchUrl: buildSearchUrl(query),
      listings,
      comparableListings,
      stats: calculateStats(comparableListings),
    };

    this.#cache.set(cacheKey, { createdAt: Date.now(), data });
    return data;
  }
}


class ApiError extends Error {
  constructor(message, status = 0, code = "") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function isGitHubPages() {
  return window.location.hostname.endsWith(".github.io");
}

async function request(path, options = {}) {
  const { method = "GET", body, handleUnauthorized = true } = options;
  if (isGitHubPages() && (path.startsWith("/auth") || path.startsWith("/products"))) {
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

  const error = new ApiError(payload?.error || "Não foi possível concluir a operação.", response.status, payload?.code || "");
  if (handleUnauthorized && response.status === 401) window.dispatchEvent(new CustomEvent("app:session-expired"));
  throw error;
}

const api = {
  get: (path, options) => request(path, options),
  post: (path, body, options) => request(path, { ...options, method: "POST", body }),
  patch: (path, body, options) => request(path, { ...options, method: "PATCH", body }),
  delete: (path, options) => request(path, { ...options, method: "DELETE" }),
};



function numberValue(element, fallback = 0) {
  const rawValue = String(element.value).trim();
  const normalizedValue = rawValue.includes(",") ? rawValue.replace(/\./g, "").replace(",", ".") : rawValue;
  const value = Number(normalizedValue);
  return Number.isFinite(value) ? value : fallback;
}

function averagePreset() {
  const presets = Object.values(CATEGORY_PRESETS);
  const fields = Object.keys(CATEGORY_PRESETS.comestiveis);

  return Object.fromEntries(
    fields.map((field) => {
      const average = presets.reduce((sum, preset) => sum + preset[field], 0) / presets.length;
      return [field, field === "workerCount" ? Math.max(1, Math.round(average)) : Number(average.toFixed(2))];
    }),
  );
}

function readInputs(elements) {
  return {
    productType: elements.productType.selectedOptions[0].textContent,
    materialsCost: numberValue(elements.materialsCost),
    waste: clamp(numberValue(elements.waste), 0, 100) / 100,
    packagingCost: numberValue(elements.packagingCost),
    deliveryCost: numberValue(elements.deliveryCost),
    insuranceCost: numberValue(elements.insuranceCost),
    discountAmount: numberValue(elements.discountAmount),
    otherExpenses: numberValue(elements.otherExpenses),
    totalPayroll: numberValue(elements.totalPayroll),
    workerCount: Math.max(numberValue(elements.workerCount, 1), 1),
    outputPerWorkerHour: Math.max(numberValue(elements.outputPerWorkerHour, 0.01), 0.01),
    monthlyFixedCosts: numberValue(elements.monthlyFixedCosts),
    monthlyVolume: Math.max(numberValue(elements.monthlyVolume, 1), 1),
    taxRate: clamp(numberValue(elements.taxRate), 0, 60) / 100,
    paymentFeeRate: clamp(numberValue(elements.paymentFeeRate), 0, 30) / 100,
    commissionRate: clamp(numberValue(elements.commissionRate), 0, 50) / 100,
    margin: clamp(numberValue(elements.margin), 0.1, 60) / 100,
    competitorAverage: clamp(numberValue(elements.competitorAverage, 0.01), 0.01, 1000000),
    receiveDays: numberValue(elements.receiveDays),
    payDays: numberValue(elements.payDays),
    capitalRate: clamp(numberValue(elements.capitalRate), 0, 8) / 100,
    fiscalContext: {
      ncmCode: String(elements.ncmCode.value || "").replace(/\D/g, ""),
      taxRegime: elements.taxRegime.value,
      originState: elements.originState.value.trim().toUpperCase(),
      destinationState: elements.destinationState.value.trim().toUpperCase(),
      cfop: String(elements.cfop.value || "").replace(/\D/g, ""),
      taxSituation: elements.taxSituation.value.trim().toUpperCase(),
      customerType: elements.customerType.value,
      operationPurpose: elements.operationPurpose.value,
    },
  };
}

function applyCategoryPreset(category, elements) {
  const preset = category === "outros" ? averagePreset() : CATEGORY_PRESETS[category];

  Object.entries(preset).forEach(([field, value]) => {
    elements[field].value = PERCENTAGE_FIELDS.has(field) ? String(value).replace(".", ",") : value;
  });
}

function applySavedInputs(savedInputs, elements) {
  if (!savedInputs || typeof savedInputs !== "object") return false;

  const categoryOption = [...elements.productType.options].find((option) => option.textContent === savedInputs.productType);
  if (categoryOption) elements.productType.value = categoryOption.value;

  Object.entries(savedInputs).forEach(([field, value]) => {
    if (!elements[field] || !Number.isFinite(value)) return;
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

function isAboveCompetitorLimit(elements) {
  return numberValue(elements.competitorAverage) > 1000000;
}



const chartColors = [
  "var(--chart-green)",
  "var(--chart-teal)",
  "var(--chart-blue)",
  "var(--chart-amber)",
  "var(--chart-violet)",
];

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
  return components.map((item, index) => ({
    ...item,
    color: chartColors[index % chartColors.length],
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
  const legend = document.querySelector("#priceCompositionLegend");
  const components = priceCompositionFrom(result);

  if (components.length === 0) {
    donut.style.setProperty("--donut-gradient", "conic-gradient(var(--meter-track) 0 100%)");
    donut.setAttribute("aria-label", "Composição indisponível enquanto o cálculo estiver inválido.");
    legend.innerHTML = '<li class="chart-empty">Revise os percentuais para visualizar a composição.</li>';
    return;
  }

  let cursor = 0;
  const stops = components.map((item) => {
    const start = cursor;
    cursor += item.share * 100;
    return `${item.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  });

  donut.style.setProperty("--donut-gradient", `conic-gradient(${stops.join(", ")})`);
  donut.setAttribute(
    "aria-label",
    components.map((item) => `${item.label}: ${percent(item.share)}`).join(". "),
  );
  legend.innerHTML = components
    .map(
      (item) => `
        <li>
          <span class="chart-legend-color" style="--legend-color: ${item.color}" aria-hidden="true"></span>
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
          <span class="comparison-track" aria-hidden="true"><span class="comparison-fill comparison-fill-${index + 1}" style="width: ${item.width.toFixed(2)}%"></span></span>
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



function marketComparisonText(inputs, result, marketStats, marketSource) {
  const difference = Math.abs(inputs.competitorAverage - result.minimumPrice);
  const source =
    marketSource === "meli-median"
      ? "mediana dos anúncios comparáveis do Mercado Livre"
      : marketSource === "meli-listing"
        ? "anúncio selecionado no Mercado Livre"
        : "média informada";
  const relativeGap = Math.abs(result.marketGap);
  const confidenceNote = marketStats && marketStats.count < MELI_CONFIG.minComparableResults ? " A amostra é pequena, então use como sinal preliminar." : "";

  if (relativeGap <= 0.08) return `O preço calculado está próximo da ${source}, com diferença de ${percent(relativeGap)}.${confidenceNote}`;
  if (result.marketGap >= 0) return `O preço calculado fica ${currency.format(difference)} (${percent(relativeGap)}) abaixo da ${source}.${confidenceNote}`;

  return `O preço calculado fica ${currency.format(difference)} (${percent(relativeGap)}) acima da ${source}.${confidenceNote}`;
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

function renderMeliPanel(document, result, meliState) {
  const panel = document.querySelector("#meliPanel");
  const summary = document.querySelector("#meliSummary");
  const statsContainer = document.querySelector("#meliStats");
  const resultsContainer = document.querySelector("#meliResults");
  const applyButton = document.querySelector("#applyMeliMarket");
  const searchStatus = document.querySelector("#meliSearchStatus");

  panel.hidden = meliState.status === "idle";
  summary.hidden = !meliState.stats;
  applyButton.disabled = !meliState.stats;

  if (meliState.status === "loading") {
    searchStatus.textContent = "Consultando anúncios reais no Mercado Livre...";
    statsContainer.innerHTML = '<p class="helper-text">Buscando produtos ativos no Mercado Livre.</p>';
    resultsContainer.innerHTML = "";
    return;
  }

  if (meliState.status === "error") {
    searchStatus.textContent = meliState.error;
    statsContainer.innerHTML = `
      <div class="meli-fallback">
        <p class="error-text">${escapeHtml(meliState.error)}</p>
        <p class="helper-text">Você ainda pode abrir a busca, comparar alguns anúncios e preencher a média manualmente no campo de concorrentes.</p>
        ${meliState.searchUrl ? `<a class="secondary-link" href="${escapeHtml(meliState.searchUrl)}" target="_blank" rel="noopener">Abrir busca no Mercado Livre</a>` : ""}
      </div>`;
    resultsContainer.innerHTML = "";
    return;
  }

  if (meliState.status === "empty") {
    searchStatus.textContent = "Nenhum anúncio comparável foi encontrado para essa busca.";
    statsContainer.innerHTML = '<p class="helper-text">Tente informar marca, modelo, capacidade, tamanho ou voltagem com mais precisão.</p>';
    resultsContainer.innerHTML = "";
    return;
  }

  if (!meliState.stats) {
    searchStatus.textContent = "Use a consulta para substituir a média manual por dados reais quando desejar.";
    statsContainer.innerHTML = "";
    resultsContainer.innerHTML = "";
    return;
  }

  const { stats } = meliState;
  const reliabilityText = stats.count < MELI_CONFIG.minComparableResults ? "Amostra pequena: referência preliminar." : "Amostra suficiente para referência inicial.";
  const marketGap = result.isValid ? (stats.median - result.minimumPrice) / stats.median : 0;
  const [badgeType, badgeText] = result.isValid ? marketBadgeForGap(marketGap) : ["risk", "Revise percentuais"];

  searchStatus.textContent = `${stats.count} anúncio(s) comparável(is) analisado(s).`;
  summary.innerHTML = `<span>Referência Mercado Livre</span><strong>${currency.format(stats.median)}</strong><small>Mediana de ${stats.count} anúncio(s)</small>`;
  statsContainer.innerHTML = `
    <div><span>Menor preço</span><strong>${currency.format(stats.min)}</strong></div>
    <div><span>Preço médio</span><strong>${currency.format(stats.average)}</strong></div>
    <div><span>Preço mediano</span><strong>${currency.format(stats.median)}</strong></div>
    <div><span>Maior preço</span><strong>${currency.format(stats.max)}</strong></div>
    <div><span>Análise</span><strong class="${badgeType}">${badgeText}</strong></div>
    <div><span>Confiança</span><strong>${reliabilityText}</strong></div>`;
  resultsContainer.innerHTML = meliState.comparableListings
    .map((listing) => {
      const isSelected = listing.id === meliState.selectedId;
      const attributes = listing.attributes
        .filter((attribute) => ["BRAND", "MODEL", "LINE", "VOLTAGE", "CAPACITY"].includes(attribute.id) && attribute.value_name)
        .slice(0, 3)
        .map((attribute) => attribute.value_name)
        .join(" | ");

      return `
        <article class="meli-result ${isSelected ? "selected" : ""}">
          ${listing.image ? `<img src="${escapeHtml(listing.image)}" alt="">` : '<div class="meli-image-placeholder"></div>'}
          <div>
            <h4>${escapeHtml(listing.title)}</h4>
            <p>${[listing.condition, listing.category, attributes].filter(Boolean).map(escapeHtml).join(" | ")}</p>
            <strong>${currency.format(listing.price)}</strong>
          </div>
          <div class="meli-actions">
            <button type="button" data-meli-select="${escapeHtml(listing.id)}">${isSelected ? "Selecionado" : "Selecionar"}</button>
            <a href="${escapeHtml(listing.link)}" target="_blank" rel="noopener">Abrir anúncio</a>
          </div>
        </article>`;
    })
    .join("");
}

function renderDashboard(document, inputs, result, meliState, marketSource, fiscalAssessment, memory) {
  const { costs } = result;
  const activeMarketStats = marketSource === "meli-median" ? meliState.stats : null;
  const alerts = dashboardAlerts(inputs, result, fiscalAssessment);

  document.querySelector("#baseCost").textContent = currency.format(costs.baseCost);
  document.querySelector("#marketPrice").textContent = currency.format(inputs.competitorAverage);
  document.querySelector("#marketTitle").textContent = inputs.productType;

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
    marketMeter.style.width = `${clamp((result.minimumPrice / inputs.competitorAverage) * 100, 0, 100)}%`;
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
    marketMeter.style.width = "100%";
    marketMeter.classList.add("over");
  }

  document.querySelector("#alertCount").textContent = `${alerts.length} ${alerts.length === 1 ? "alerta importante" : "alertas importantes"}`;
  document.querySelector("#alertSummary").textContent = alerts[0][1];

  renderExplanation(document, inputs, result, fiscalAssessment);
  renderCostTable(document, memory);
  renderAlerts(document, alerts);
  renderFiscalSummary(document, fiscalAssessment);
  renderMeliPanel(document, result, meliState);
  renderPriceDetails(document, inputs, result, marketText, alerts.length);
}



function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function detail(label, value, extraClass = "") {
  return `<div class="${extraClass}"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function renderProductsList(container, products) {
  if (products.length === 0) {
    container.innerHTML = '<div class="empty-history">Nenhum produto encontrado. Salve uma precificação no assistente para montar seu histórico.</div>';
    return;
  }

  container.innerHTML = products
    .map(
      (product) => `
        <article class="product-card">
          <div>
            <p class="eyebrow">${escapeHtml(product.category)}</p>
            <h3>${escapeHtml(product.name)}</h3>
            <div class="product-meta">
              <span>Custo: <strong>${currency.format(product.costPrice)}</strong></span>
              <span>Margem: <strong>${Number(product.profitMargin).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</strong></span>
              <span>Preço sugerido: <strong>${currency.format(product.suggestedPrice)}</strong></span>
              <span>Criado em: <strong>${escapeHtml(formatDate(product.consultationDate))}</strong></span>
            </div>
          </div>
          <div class="product-actions">
            <button type="button" class="secondary-button" data-product-action="view" data-product-id="${escapeHtml(product.id)}">Ver detalhes</button>
            <button type="button" class="secondary-button" data-product-action="reuse" data-product-id="${escapeHtml(product.id)}">Reutilizar</button>
            <button type="button" class="secondary-button" data-product-action="edit" data-product-id="${escapeHtml(product.id)}">Editar</button>
            <button type="button" class="danger-button" data-product-action="delete" data-product-id="${escapeHtml(product.id)}">Excluir</button>
          </div>
        </article>`,
    )
    .join("");
}

function renderProductDetails(container, product) {
  const description = product.description || "Sem descrição informada.";
  const fiscal = product.calculationData?.fiscal;
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
  product: ["productType", "productName"],
  fiscal: ["ncmCode", "taxRegime", "originState", "destinationState", "cfop", "taxSituation", "customerType", "operationPurpose"],
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

  function updateCompletion() {
    for (const tab of tabs) {
      const section = tab.dataset.pricingTab;
      const complete = (sectionFields[section] || []).every((fieldId) => fieldHasValidValue(root.querySelector(`#${fieldId}`)));
      const label = tab.dataset.pricingLabel || tab.textContent.trim();
      const status = tab.querySelector(".pricing-tab-status");

      tab.classList.toggle("is-complete", complete);
      tab.setAttribute("aria-label", `${label}, ${complete ? "preenchida" : "incompleta"}`);
      if (status) status.textContent = complete ? "✓" : "○";
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
  }

  function activateByOffset(currentTab, offset) {
    const currentIndex = tabs.indexOf(currentTab);
    const nextIndex = (currentIndex + offset + tabs.length) % tabs.length;
    activate(tabs[nextIndex].dataset.pricingTab, { focusTab: true });
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => activate(tab.dataset.pricingTab));
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



const $ = (selector) => document.querySelector(selector);
const themeStorageKey = "assistente-precificacao-theme";
const detailRouteHashes = Object.freeze({ price: "#preco-calculado" });
const mercadoLivre = new MercadoLivreService();
const taxRuleEngine = new ConfiguredTaxRuleEngine();
const formFieldIds = [
  "productType",
  "ncmCode",
  "taxRegime",
  "originState",
  "destinationState",
  "cfop",
  "taxSituation",
  "customerType",
  "operationPurpose",
  "materialsCost",
  "waste",
  "packagingCost",
  "deliveryCost",
  "insuranceCost",
  "discountAmount",
  "otherExpenses",
  "totalPayroll",
  "workerCount",
  "outputPerWorkerHour",
  "monthlyFixedCosts",
  "monthlyVolume",
  "taxRate",
  "paymentFeeRate",
  "commissionRate",
  "margin",
  "competitorAverage",
  "receiveDays",
  "payDays",
  "capitalRate",
];
const elements = Object.fromEntries(formFieldIds.map((id) => [id, $(`#${id}`)]));
const pricingTabs = createPricingTabs($(".pricing-sidebar"));
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
let meliState = {
  status: "idle",
  query: "",
  searchUrl: "",
  listings: [],
  comparableListings: [],
  stats: null,
  selectedId: null,
  error: "",
};
let productSearchTimer;
let pendingDetailTarget = "";

function applyTheme(theme, persist = true) {
  const normalizedTheme = theme === "dark" ? "dark" : "light";
  const isDark = normalizedTheme === "dark";
  document.documentElement.dataset.theme = normalizedTheme;
  document.documentElement.style.colorScheme = normalizedTheme;
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

function render() {
  const inputs = readInputs(elements);
  const result = calculatePrice(inputs);
  const fiscalAssessment = taxRuleEngine.assess(inputs, focusState);
  const memory = buildCalculationMemory(inputs, result, fiscalAssessment);
  renderDashboard(document, inputs, result, meliState, marketSource, fiscalAssessment, memory);
  renderNcmState();
  $("#mobileSuggestedPrice").textContent = $("#suggestedPrice").textContent;
  pricingTabs.updateCompletion();
}

function renderNcmState() {
  const status = $("#ncmLookupStatus");
  const description = $("#ncmDescription");
  const button = $("#ncmLookupButton");
  button.disabled = focusState.status === "loading";
  button.textContent = focusState.status === "loading" ? "Consultando..." : "Consultar";

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
  await loadProducts();
}

async function syncRoute() {
  if (!state.user) return;
  if (window.location.hash === "#produtos") await showProducts();
  else if (window.location.hash === detailRouteHashes.price) showAssistant("price-details");
  else showAssistant("dashboard");
}

function navigate(view, detailTarget = "") {
  closeMobileMenus();
  if (detailTarget) pendingDetailTarget = detailTarget;
  const hash = view === "products" ? "#produtos" : detailRouteHashes[view] || "#assistente";
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

function setMeliError(query, status) {
  const error =
    status === 429
      ? "O Mercado Livre limitou as consultas no momento. Aguarde um pouco e tente novamente."
      : status === 403
        ? "O Mercado Livre bloqueou a consulta automática de anúncios para este acesso."
        : "Não foi possível consultar o Mercado Livre agora. Verifique sua conexão ou tente novamente mais tarde.";

  meliState = { ...meliState, status: "error", query, searchUrl: buildSearchUrl(query), listings: [], comparableListings: [], stats: null, selectedId: null, error };
}

async function searchMercadoLivre() {
  const query = $("#meliQuery").value.trim();
  if (query.length < 3) {
    meliState = { ...meliState, status: "error", error: "Informe pelo menos 3 caracteres para pesquisar." };
    render();
    return;
  }

  meliState = { status: "loading", query, searchUrl: buildSearchUrl(query), listings: [], comparableListings: [], stats: null, selectedId: null, error: "" };
  render();

  try {
    const data = await mercadoLivre.search(query);
    meliState = {
      status: data.stats ? "success" : "empty",
      ...data,
      selectedId: data.comparableListings[0]?.id || null,
      error: "",
    };
  } catch (error) {
    setMeliError(query, error.status);
  }

  render();
}

function productPayloadFromCalculator() {
  const name = $("#productName").value.trim();
  const description = $("#productDescription").value.trim();
  const inputs = readInputs(elements);
  const result = calculatePrice(inputs);
  const fiscalAssessment = taxRuleEngine.assess(inputs, focusState);
  const memory = buildCalculationMemory(inputs, result, fiscalAssessment);

  if (!name) throw new ApiError("Informe o nome do produto antes de salvar.", 400);
  if (!result.isValid || result.minimumPrice === null) throw new ApiError("Revise os percentuais antes de salvar um cálculo inviável.", 400);

  const selectedListing = meliState.comparableListings.find((listing) => listing.id === meliState.selectedId);
  return {
    name,
    description,
    category: inputs.productType,
    costPrice: inputs.materialsCost,
    additionalCosts: Math.max(0, result.costs.baseCost - inputs.materialsCost),
    profitMargin: inputs.margin * 100,
    suggestedPrice: result.minimumPrice,
    marketplace: marketSource.startsWith("meli") ? "Mercado Livre" : "Manual",
    consultationDate: new Date().toISOString(),
    calculationData: {
      version: 2,
      inputs,
      result,
      fiscal: fiscalDataForStorage(fiscalAssessment, memory),
      market: {
        source: marketSource,
        query: meliState.query,
        stats: meliState.stats,
        selectedListing: selectedListing
          ? { id: selectedListing.id, title: selectedListing.title, price: selectedListing.price, link: selectedListing.link }
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
  if (!applySavedInputs(savedInputs, elements)) {
    setMessage($("#historyMessage"), "Esta consulta não possui os dados necessários para ser reutilizada.");
    return;
  }

  $("#productName").value = product.name;
  $("#productDescription").value = product.description || "";
  const savedNcm = product.calculationData?.fiscal?.ncm;
  focusState = savedNcm?.codigo
    ? { status: "success", ncm: savedNcm, environment: "consulta salva", error: "", unavailable: false }
    : { status: "idle", ncm: null, environment: "", error: "", unavailable: false };
  marketSource = product.calculationData?.market?.source || "manual";
  meliState = { ...meliState, status: "idle", query: product.calculationData?.market?.query || "", stats: product.calculationData?.market?.stats || null };
  $("#meliQuery").value = meliState.query;
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

[
  elements.materialsCost,
  elements.waste,
  elements.packagingCost,
  elements.deliveryCost,
  elements.insuranceCost,
  elements.discountAmount,
  elements.otherExpenses,
  elements.totalPayroll,
  elements.workerCount,
  elements.outputPerWorkerHour,
  elements.monthlyFixedCosts,
  elements.monthlyVolume,
  elements.taxRate,
  elements.paymentFeeRate,
  elements.commissionRate,
  elements.margin,
  elements.receiveDays,
  elements.payDays,
  elements.capitalRate,
].forEach((field) => field.addEventListener("input", render));

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

elements.productType.addEventListener("change", () => {
  applyCategoryPreset(elements.productType.value, elements);
  marketSource = "manual";
  render();
});

elements.competitorAverage.addEventListener("input", () => {
  marketSource = "manual";
  if (isAboveCompetitorLimit(elements)) elements.competitorAverage.value = "1000000";
  render();
});

$("#meliSearchButton").addEventListener("click", searchMercadoLivre);
$("#meliQuery").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  searchMercadoLivre();
});
$("#applyMeliMarket").addEventListener("click", () => {
  if (!meliState.stats) return;
  elements.competitorAverage.value = meliState.stats.median.toFixed(2);
  marketSource = "meli-median";
  render();
});
$("#meliResults").addEventListener("click", (event) => {
  const button = event.target.closest("[data-meli-select]");
  if (!button) return;
  const selectedListing = meliState.comparableListings.find((listing) => listing.id === button.dataset.meliSelect);
  meliState = { ...meliState, selectedId: button.dataset.meliSelect };
  if (selectedListing) {
    elements.competitorAverage.value = selectedListing.price.toFixed(2);
    marketSource = "meli-listing";
  }
  render();
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
$("#backToDashboardButton").addEventListener("click", () => navigate("assistant"));
$("#backToAssistantButton").addEventListener("click", () => navigate("assistant"));
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
  window.history.replaceState(null, "", window.location.pathname);
  showAuth("login", "Sua sessão expirou. Entre novamente para continuar.");
});

applyCategoryPreset(elements.productType.value, elements);
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
