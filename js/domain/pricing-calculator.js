// Esta regra é deliberadamente independente do DOM e do banco. O navegador e
// o servidor importam este mesmo módulo: não existe uma segunda fórmula no API.
export const PRICING_SCHEMA_VERSION = 6;
export const FORMULA_VERSION = "technical-pricing-v2";

export class PricingValidationError extends Error {
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
export function validatePricingInputs(input = {}) {
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

export function assertPricingInputs(input) {
  const validation = validatePricingInputs(input);
  if (!validation.isValid) throw new PricingValidationError(validation.errors);
  return validation.value;
}

export function calculateAdjustedMaterialCost(materialCost, wasteRate) {
  return materialCost / (1 - wasteRate);
}

export function calculateDirectCost(inputs) {
  return inputs.adjustedMaterialCost + inputs.packagingCost + inputs.deliveryCost + inputs.insuranceCost + inputs.otherDirectExpenses;
}

export function calculateIndirectCost(monthlyPayroll, monthlyFixedCosts, expectedMonthlyUnits) {
  return (monthlyPayroll + monthlyFixedCosts) / expectedMonthlyUnits;
}

export function calculateWorkingCapital(operatingCost, inventoryDays, receivingDays, paymentDays, monthlyCapitalRate) {
  const financedDays = Math.max(inventoryDays + receivingDays - paymentDays, 0);
  const periodCapitalRate = (1 + monthlyCapitalRate) ** (financedDays / 30) - 1;
  return {
    financedDays,
    financedBase: operatingCost,
    periodCapitalRate,
    financialCost: financedDays === 0 ? 0 : operatingCost * periodCapitalRate,
  };
}

export function calculateTechnicalPrice(totalUnitCost, saleExpenseRate, desiredNetMargin) {
  const priceDenominator = 1 - saleExpenseRate - desiredNetMargin;
  if (!(priceDenominator > 1e-12)) throw new PricingValidationError({ desiredNetMargin: "A soma de tributos, taxas, comissão e margem deve ser menor que 100%." });
  const technicalPriceRaw = totalUnitCost / priceDenominator;
  return { priceDenominator, technicalPriceRaw, technicalPrice: Math.ceil(technicalPriceRaw * 100) / 100 };
}

export function calculateDiscountStrategy(technicalPrice, discountRate = 0, fixedDiscountAmount = 0) {
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

export function calculateMarketComparison(marketReference, technicalPrice) {
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

export function calculatePricing(input, marketReference = null) {
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

export const calculatePrice = calculatePricing;
