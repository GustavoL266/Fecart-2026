/* Gerado por scripts/build.mjs. Edite os arquivos em js/ e execute npm run build. */

const PRODUCTIVE_HOURS_PER_WORKER_MONTH = 176;

const MARKET_RULES = {
  closeGap: 0.08,
  attentionGap: 0.18,
};


const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

// Presentation only: pick a CSS size from the complete, already formatted value.
function financialValueSize(text) {
  const length = String(text).length;
  if (length <= 8) return "short";
  if (length <= 10) return "medium";
  if (length <= 12) return "long";
  if (length <= 15) return "extra-long";
  if (length <= 20) return "extended";
  return "maximal";
}

function setFinancialValue(node, text) {
  node.textContent = text;
  node.setAttribute("data-financial-size", financialValueSize(text));
}

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
const PRICING_SCHEMA_VERSION = 7;
const FORMULA_VERSION = "transparent-pricing-v3";

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
  materialCost: { min: 0, label: "O custo dos insumos e da matéria-prima" },
  wasteRate: { min: 0, maxExclusive: 1, label: "A perda e o desperdício" },
  packagingCost: { min: 0, label: "O custo de embalagem" },
  averageOrderFreight: { min: 0, label: "O frete médio do pedido" },
  averageOrderUnits: { minExclusive: 0, label: "A quantidade média de unidades por pedido" },
  productionTimeMinutes: { min: 0, label: "O tempo médio para produzir uma unidade" },
  monthlyFixedCosts: { min: 0, label: "Os custos fixos mensais" },
  expectedMonthlyUnits: { minExclusive: 0, label: "A quantidade mensal esperada" },
  taxRate: { min: 0, maxExclusive: 1, label: "O percentual efetivo de impostos sobre a venda" },
  desiredNetMargin: { min: 0, maxExclusive: 1, label: "A margem de lucro desejada" },
  inventoryDays: { min: 0, label: "O prazo entre comprar ou produzir e vender" },
  receivingDays: { min: 0, label: "O prazo para receber do cliente" },
  paymentDays: { min: 0, label: "O prazo para pagar fornecedores" },
});

const optionalNumbers = Object.freeze({
  companyFreightShare: { defaultValue: null, min: 0, maxInclusive: 1, label: "O percentual do frete pago pela empresa" },
  otherVariableCost: { defaultValue: 0, min: 0, label: "Os outros custos variáveis de produção" },
  otherDirectExpenses: { defaultValue: 0, min: 0, label: "As outras despesas diretas" },
  monthlyLaborCost: { defaultValue: null, min: 0, label: "O custo mensal da mão de obra de produção" },
  monthlyProductiveHours: { defaultValue: null, minExclusive: 0, label: "As horas produtivas totais da equipe" },
  laborHourlyCost: { defaultValue: null, min: 0, label: "O custo da mão de obra por hora" },
  allocationLaborHours: { defaultValue: null, minExclusive: 0, label: "As horas totais de mão de obra para rateio" },
  machineTimeMinutes: { defaultValue: null, min: 0, label: "O tempo de máquina por unidade" },
  monthlyMachineHours: { defaultValue: null, minExclusive: 0, label: "As horas totais de máquina no mês" },
  monthlyBusinessRevenue: { defaultValue: null, minExclusive: 0, label: "O faturamento mensal total da empresa" },
  monthlyProductRevenue: { defaultValue: null, min: 0, label: "O faturamento mensal esperado deste produto" },
  equipmentValue: { defaultValue: 0, min: 0, label: "O valor total dos equipamentos" },
  equipmentUsefulLifeMonths: { defaultValue: null, minExclusive: 0, label: "A vida útil estimada dos equipamentos" },
  equipmentMaintenanceMonthly: { defaultValue: 0, min: 0, label: "A manutenção média mensal" },
  paymentFeeRate: { defaultValue: 0, min: 0, maxExclusive: 1, label: "A taxa de pagamento ou cartão" },
  commissionRate: { defaultValue: 0, min: 0, maxExclusive: 1, label: "A comissão" },
  marketplaceFeeRate: { defaultValue: 0, min: 0, maxExclusive: 1, label: "A taxa de marketplace ou plataforma" },
  fixedFeePerOrder: { defaultValue: 0, min: 0, label: "A taxa fixa por pedido" },
  postSaleLossRate: { defaultValue: 0, min: 0, maxExclusive: 1, label: "As perdas pós-venda" },
  minimumMargin: { defaultValue: null, min: 0, maxExclusive: 1, label: "A margem mínima" },
  monthlyCapitalRate: { defaultValue: null, min: 0, maxExclusive: 1, label: "O custo mensal do capital" },
  discountRate: { defaultValue: 0, min: 0, maxExclusive: 1, label: "O desconto planejado" },
  fixedDiscountAmount: { defaultValue: 0, min: 0, label: "O desconto planejado" },
  marketPrice: { defaultValue: null, minExclusive: 0, label: "A referência de mercado" },
});

const optionRules = Object.freeze({
  laborCostMode: ["automatic", "manual"],
  freightPayer: ["company", "customer", "shared"],
  allocationMethod: ["quantity", "labor-hours", "machine-hours", "revenue"],
  capitalRateSource: ["informed", "zero", "estimated"],
  discountType: ["none", "percentage", "fixed"],
});

function numericIssue(value, rule) {
  if (value === null || value === undefined) return "required";
  if (typeof value !== "number" || !Number.isFinite(value)) return "invalid";
  if (rule.min !== undefined && value < rule.min) return "min";
  if (rule.minExclusive !== undefined && value <= rule.minExclusive) return "minExclusive";
  if (rule.maxInclusive !== undefined && value > rule.maxInclusive) return "maxInclusive";
  if (rule.maxExclusive !== undefined && value >= rule.maxExclusive) return "maxExclusive";
  return null;
}

function numberMessage(rule, issue, optional = false) {
  if (issue === "required") return optional ? "" : `Informe ${rule.label.toLocaleLowerCase("pt-BR")}.`;
  if (issue === "invalid") return `${rule.label} deve ser um número finito.`;
  if (issue === "min") return `${rule.label} não pode ser negativo.`;
  if (issue === "minExclusive") return `${rule.label} deve ser maior que zero.`;
  if (issue === "maxInclusive") return `${rule.label} não pode ser maior que 100%.`;
  if (issue === "maxExclusive") return `${rule.label} deve ser menor que 100%.`;
  return "Dados inválidos.";
}

function optionalValue(value) {
  return value === null || value === undefined || value === "" ? null : value;
}

function isLegacyInput(input) {
  return !Object.hasOwn(input, "averageOrderFreight")
    && ["deliveryCost", "monthlyPayroll", "insuranceCost"].some((key) => Object.hasOwn(input, key));
}

// Registros v6 continuam reproduzindo o resultado histórico quando são abertos.
// O fluxo v7 nunca cria estes campos de compatibilidade.
function normalizedInputShape(input) {
  if (input._legacyV6 === true) return { ...input, _legacyV6: true };
  if (!isLegacyInput(input)) return { ...input, _legacyV6: false };
  return {
    ...input,
    _legacyV6: true,
    averageOrderFreight: input.deliveryCost,
    averageOrderUnits: 1,
    freightPayer: "company",
    companyFreightShare: 1,
    otherVariableCost: 0,
    laborCostMode: "manual",
    laborHourlyCost: 0,
    productionTimeMinutes: 0,
    allocationMethod: "quantity",
    marketplaceFeeRate: 0,
    fixedFeePerOrder: 0,
    postSaleLossRate: 0,
    minimumMargin: null,
    capitalRateSource: "informed",
    discountType: input.discountRate > 0 ? "percentage" : input.fixedDiscountAmount > 0 ? "fixed" : "none",
    legacyInsuranceCost: input.insuranceCost || 0,
    legacyMonthlyPayroll: input.monthlyPayroll || 0,
  };
}

function normalizedCapacity(input, errors) {
  const capacity = input.productionCapacity;
  if (!capacity || typeof capacity !== "object") return null;
  const keys = ["workerCount", "productiveHoursPerWorkerMonth", "unitsPerWorkerHour"];
  const supplied = keys.filter((key) => optionalValue(capacity[key]) !== null);
  if (supplied.length === 0) return null;
  if (supplied.length !== keys.length) {
    errors.productionCapacity = "Os dados históricos de capacidade estão incompletos.";
    return null;
  }
  const normalized = {};
  for (const key of keys) {
    const value = capacity[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      errors[`productionCapacity.${key}`] = "A capacidade histórica aceita apenas números não negativos.";
    } else normalized[key] = value;
  }
  return Object.keys(normalized).length === keys.length ? {
    ...normalized,
    monthlyCapacity: normalized.workerCount * normalized.productiveHoursPerWorkerMonth * normalized.unitsPerWorkerHour,
  } : null;
}

function requireConditionalNumber(normalized, errors, key, rule) {
  const issue = numericIssue(normalized[key], rule);
  if (issue) errors[key] = numberMessage(rule, issue);
}

/** Validate normalized, typed domain inputs. Rates are fractions, never percentages. */
function validatePricingInputs(rawInput = {}) {
  rawInput = rawInput && typeof rawInput === "object" ? rawInput : {};
  const input = normalizedInputShape(rawInput);
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
      normalized[key] = rule.defaultValue;
      continue;
    }
    const issue = numericIssue(value, rule);
    if (issue) errors[key] = numberMessage(rule, issue, true);
    else normalized[key] = value;
  }
  for (const [key, options] of Object.entries(optionRules)) {
    if (!options.includes(input[key])) errors[key] = "Selecione uma opção válida.";
    else normalized[key] = input[key];
  }

  normalized._legacyV6 = input._legacyV6;
  normalized.legacyInsuranceCost = input._legacyV6 ? input.legacyInsuranceCost : 0;
  normalized.legacyMonthlyPayroll = input._legacyV6 ? input.legacyMonthlyPayroll : 0;
  normalized.productionCapacity = normalizedCapacity(input, errors);
  normalized.fiscalContext = input.fiscalContext && typeof input.fiscalContext === "object" ? input.fiscalContext : {};

  if (normalized.freightPayer === "shared") {
    requireConditionalNumber(normalized, errors, "companyFreightShare", optionalNumbers.companyFreightShare);
  } else if (normalized.freightPayer === "company") normalized.companyFreightShare = 1;
  else if (normalized.freightPayer === "customer") normalized.companyFreightShare = 0;

  if (normalized.laborCostMode === "automatic") {
    requireConditionalNumber(normalized, errors, "monthlyLaborCost", optionalNumbers.monthlyLaborCost);
    requireConditionalNumber(normalized, errors, "monthlyProductiveHours", optionalNumbers.monthlyProductiveHours);
  } else if (normalized.laborCostMode === "manual") {
    requireConditionalNumber(normalized, errors, "laborHourlyCost", optionalNumbers.laborHourlyCost);
  }

  if (normalized.allocationMethod === "labor-hours") {
    if (normalized.laborCostMode !== "automatic") requireConditionalNumber(normalized, errors, "allocationLaborHours", optionalNumbers.allocationLaborHours);
    const available = normalized.laborCostMode === "automatic" ? normalized.monthlyProductiveHours : normalized.allocationLaborHours;
    const required = normalized.productionTimeMinutes * normalized.expectedMonthlyUnits / 60;
    if (typeof available === "number" && typeof required === "number" && required > available + 1e-12) {
      const field = normalized.laborCostMode === "automatic" ? "monthlyProductiveHours" : "allocationLaborHours";
      errors[field] = "As horas usadas por este produto no mês ultrapassam as horas totais informadas para o rateio.";
    }
  }
  if (normalized.allocationMethod === "machine-hours") {
    requireConditionalNumber(normalized, errors, "machineTimeMinutes", { ...optionalNumbers.machineTimeMinutes, minExclusive: 0 });
    requireConditionalNumber(normalized, errors, "monthlyMachineHours", optionalNumbers.monthlyMachineHours);
    const required = normalized.machineTimeMinutes * normalized.expectedMonthlyUnits / 60;
    if (typeof normalized.monthlyMachineHours === "number" && typeof required === "number" && required > normalized.monthlyMachineHours + 1e-12) {
      errors.monthlyMachineHours = "As horas de máquina usadas por este produto ultrapassam o total mensal informado.";
    }
  }
  if (normalized.allocationMethod === "revenue") {
    requireConditionalNumber(normalized, errors, "monthlyBusinessRevenue", optionalNumbers.monthlyBusinessRevenue);
    requireConditionalNumber(normalized, errors, "monthlyProductRevenue", { ...optionalNumbers.monthlyProductRevenue, minExclusive: 0 });
    if (typeof normalized.monthlyBusinessRevenue === "number" && typeof normalized.monthlyProductRevenue === "number"
      && normalized.monthlyProductRevenue > normalized.monthlyBusinessRevenue) {
      errors.monthlyProductRevenue = "O faturamento mensal deste produto não pode superar o faturamento mensal total da empresa.";
    }
  }
  if (normalized.equipmentValue > 0) requireConditionalNumber(normalized, errors, "equipmentUsefulLifeMonths", optionalNumbers.equipmentUsefulLifeMonths);

  if (normalized.capitalRateSource === "zero") normalized.monthlyCapitalRate = 0;
  else requireConditionalNumber(normalized, errors, "monthlyCapitalRate", optionalNumbers.monthlyCapitalRate);

  if (normalized.discountType === "none") {
    if (normalized.discountRate > 0 || normalized.fixedDiscountAmount > 0) errors.discountType = "Selecione o tipo de desconto correspondente ao valor informado.";
  } else if (normalized.discountType === "percentage") {
    requireConditionalNumber(normalized, errors, "discountRate", { ...optionalNumbers.discountRate, minExclusive: 0 });
    if (normalized.fixedDiscountAmount > 0) errors.fixedDiscountAmount = "Use apenas o desconto percentual selecionado.";
  } else if (normalized.discountType === "fixed") {
    requireConditionalNumber(normalized, errors, "fixedDiscountAmount", { ...optionalNumbers.fixedDiscountAmount, minExclusive: 0 });
    if (normalized.discountRate > 0) errors.discountRate = "Use apenas o desconto fixo selecionado.";
  }

  const saleRateKeys = ["taxRate", "paymentFeeRate", "commissionRate", "marketplaceFeeRate", "postSaleLossRate"];
  if (saleRateKeys.every((key) => typeof normalized[key] === "number")) {
    const saleRate = saleRateKeys.reduce((sum, key) => sum + normalized[key], 0);
    if (saleRate >= 1 - 1e-12) errors.taxRate = "A soma de impostos, taxas, comissão e perdas pós-venda deve ser menor que 100%.";
    if (typeof normalized.desiredNetMargin === "number" && saleRate + normalized.desiredNetMargin >= 1 - 1e-12) {
      errors.desiredNetMargin = "A soma de impostos, taxas, comissão, perdas pós-venda e margem desejada deve ser menor que 100%.";
    }
    if (typeof normalized.minimumMargin === "number" && saleRate + normalized.minimumMargin >= 1 - 1e-12) {
      errors.minimumMargin = "A soma de despesas percentuais e margem mínima deve ser menor que 100%.";
    }
  }
  if (typeof normalized.minimumMargin === "number" && typeof normalized.desiredNetMargin === "number"
    && normalized.minimumMargin > normalized.desiredNetMargin) {
    errors.minimumMargin = "A margem mínima não pode ser maior que a margem desejada.";
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

function calculateWorkingCapital(operatingCost, inventoryDays, receivingDays, paymentDays, monthlyCapitalRate) {
  const financedDays = Math.max(inventoryDays + receivingDays - paymentDays, 0);
  const periodCapitalRate = (1 + monthlyCapitalRate) ** (financedDays / 30) - 1;
  return { financedDays, financedBase: operatingCost, periodCapitalRate, financialCost: financedDays === 0 ? 0 : operatingCost * periodCapitalRate };
}

function calculateTechnicalPrice(totalUnitCost, saleExpenseRate, desiredNetMargin) {
  const priceDenominator = 1 - saleExpenseRate - desiredNetMargin;
  if (!(priceDenominator > 1e-12)) throw new PricingValidationError({ desiredNetMargin: "A soma das despesas sobre a venda e da margem deve ser menor que 100%." });
  const technicalPriceRaw = totalUnitCost / priceDenominator;
  return { priceDenominator, technicalPriceRaw, technicalPrice: Math.ceil(technicalPriceRaw * 100) / 100 };
}

function allocationFactor(inputs) {
  if (inputs.allocationMethod === "labor-hours") {
    const totalHours = inputs.laborCostMode === "automatic" ? inputs.monthlyProductiveHours : inputs.allocationLaborHours;
    return (inputs.productionTimeMinutes / 60) / totalHours;
  }
  if (inputs.allocationMethod === "machine-hours") return (inputs.machineTimeMinutes / 60) / inputs.monthlyMachineHours;
  if (inputs.allocationMethod === "revenue") return (inputs.monthlyProductRevenue / inputs.monthlyBusinessRevenue) / inputs.expectedMonthlyUnits;
  return 1 / inputs.expectedMonthlyUnits;
}

function calculateIndirectCost(monthlyPayroll, monthlyFixedCosts, expectedMonthlyUnits) {
  return (monthlyPayroll + monthlyFixedCosts) / expectedMonthlyUnits;
}

function calculateDiscountStrategy(technicalPrice, discountType = "none", discountRate = 0, fixedDiscountAmount = 0) {
  if (discountType === "percentage") {
    const advertisedPriceRaw = technicalPrice / (1 - discountRate);
    const advertisedPrice = Math.ceil(advertisedPriceRaw * 100) / 100;
    return { type: "percentage", rate: discountRate, fixedAmount: 0, advertisedPriceRaw, advertisedPrice, discountAmount: advertisedPrice - technicalPrice, postDiscountPrice: technicalPrice, preservesTechnicalPrice: true };
  }
  if (discountType === "fixed") {
    const advertisedPriceRaw = technicalPrice + fixedDiscountAmount;
    const advertisedPrice = Math.ceil(advertisedPriceRaw * 100) / 100;
    return { type: "fixed", rate: 0, fixedAmount: fixedDiscountAmount, advertisedPriceRaw, advertisedPrice, discountAmount: fixedDiscountAmount, postDiscountPrice: technicalPrice, preservesTechnicalPrice: true };
  }
  return { type: "none", rate: 0, fixedAmount: 0, advertisedPriceRaw: technicalPrice, advertisedPrice: technicalPrice, discountAmount: 0, postDiscountPrice: technicalPrice, preservesTechnicalPrice: true };
}

function calculateMarketComparison(marketReference, technicalPrice) {
  const price = marketReference?.price;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return { price: null, source: null, rule: null, difference: null, differenceRate: null, reference: null };
  return { price, source: marketReference.source || "manual", rule: marketReference.rule || "manual", difference: price - technicalPrice, differenceRate: (price - technicalPrice) / price, reference: marketReference };
}

function presentation(result) {
  const asMoney = (value) => Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  const keys = [
    "materialCost", "wasteCost", "adjustedMaterialCost", "packagingCost", "freightCostPerUnit", "directLaborCost",
    "otherVariableCost", "otherDirectExpenses", "directCost", "fixedCostPerUnit", "equipmentCostPerUnit", "indirectCost",
    "fixedSaleFeePerUnit", "operatingCost", "financedBase", "financialCost", "totalUnitCost", "breakEvenPrice",
    "minimumMarginPrice", "technicalPriceRaw", "technicalPrice", "taxAmount", "paymentFeeAmount", "commissionAmount",
    "marketplaceFeeAmount", "postSaleLossAmount", "profitAmount",
  ];
  return Object.fromEntries(keys.map((key) => [key, asMoney(result[key])]));
}

const allocationLabels = Object.freeze({
  quantity: "custos mensais ÷ quantidade mensal",
  "labor-hours": "custos mensais × horas de mão de obra da unidade ÷ horas totais",
  "machine-hours": "custos mensais × horas de máquina da unidade ÷ horas totais",
  revenue: "custos mensais × participação no faturamento ÷ quantidade mensal",
});

function canonicalBreakdown(result) {
  const items = [
    { group: "Custo do produto", key: "materialCost", label: "Insumos e matéria-prima", value: result.inputs.materialCost, basis: "Por unidade", source: "Usuário" },
    { group: "Custo do produto", key: "wasteCost", label: "Perdas e desperdício", value: result.wasteCost, basis: "insumos ÷ (1 − perda) − insumos", source: "Regra técnica" },
    { group: "Custo do produto", key: "packagingCost", label: "Embalagem e rotulagem", value: result.inputs.packagingCost, basis: "Por unidade", source: "Usuário" },
    { group: "Custo do produto", key: "freightCostPerUnit", label: "Frete pago pela empresa", value: result.freightCostPerUnit, basis: "frete do pedido × participação da empresa ÷ unidades do pedido", source: "Usuário" },
    { group: "Custo do produto", key: "directLaborCost", label: "Mão de obra direta", value: result.directLaborCost, basis: "custo por hora × tempo da unidade", source: "Usuário" },
    { group: "Custo do produto", key: "otherVariableCost", label: "Custos variáveis adicionais", value: result.inputs.otherVariableCost, basis: "Por unidade", source: "Usuário" },
    { group: "Custo do produto", key: "otherDirectExpenses", label: "Outras despesas diretas", value: result.inputs.otherDirectExpenses + result.inputs.legacyInsuranceCost, basis: "Por unidade", source: "Usuário" },
    { group: "Custos mensais", key: "fixedCostPerUnit", label: "Custos fixos rateados", value: result.fixedCostPerUnit, basis: allocationLabels[result.inputs.allocationMethod], source: "Usuário" },
    { group: "Custos mensais", key: "equipmentCostPerUnit", label: "Depreciação e manutenção rateadas", value: result.equipmentCostPerUnit, basis: allocationLabels[result.inputs.allocationMethod], source: "Usuário" },
    { group: "Taxas da venda", key: "fixedSaleFeePerUnit", label: "Taxa fixa por pedido", value: result.fixedSaleFeePerUnit, basis: "taxa fixa ÷ unidades do pedido", source: "Usuário" },
    { group: "Capital de giro", key: "financialCost", label: "Custo financeiro", value: result.financialCost, basis: "custo operacional × taxa do período", source: result.inputs.capitalRateSource === "estimated" ? "Estimativa informada" : "Regra técnica" },
    { group: "Venda", key: "taxAmount", label: "Impostos efetivos", value: result.taxAmount, basis: "preço recomendado × percentual informado", source: "Usuário" },
    { group: "Venda", key: "paymentFeeAmount", label: "Taxa de pagamento/cartão", value: result.paymentFeeAmount, basis: "preço recomendado × taxa", source: "Usuário" },
    { group: "Venda", key: "commissionAmount", label: "Comissão", value: result.commissionAmount, basis: "preço recomendado × comissão", source: "Usuário" },
    { group: "Venda", key: "marketplaceFeeAmount", label: "Marketplace/plataforma", value: result.marketplaceFeeAmount, basis: "preço recomendado × taxa", source: "Usuário" },
    { group: "Venda", key: "postSaleLossAmount", label: "Perdas pós-venda", value: result.postSaleLossAmount, basis: "preço recomendado × percentual", source: "Usuário" },
    { group: "Resultado", key: "profitAmount", label: "Lucro", value: result.profitAmount, basis: "preço recomendado − custos − despesas", source: "Regra técnica" },
    { group: "Resultado", key: "breakEvenPrice", label: "Preço de equilíbrio", value: result.breakEvenPrice, basis: "custo completo ÷ (1 − despesas percentuais)", source: "Regra técnica" },
  ];
  if (result.minimumMarginPrice !== null) items.push({ group: "Resultado", key: "minimumMarginPrice", label: "Preço com margem mínima", value: result.minimumMarginPrice, basis: "custo completo ÷ (1 − despesas − margem mínima)", source: "Regra técnica" });
  items.push({ group: "Resultado", key: "technicalPrice", label: "Preço com margem desejada", value: result.technicalPrice, basis: "custo completo ÷ (1 − despesas − margem desejada)", source: "Regra técnica" });
  if (result.discount.type !== "none") {
    items.push(
      { group: "Estratégia comercial", key: "advertisedPrice", label: "Preço anunciado para permitir desconto", value: result.discount.advertisedPrice, basis: result.discount.type === "percentage" ? "preço necessário ÷ (1 − desconto)" : "preço necessário + desconto fixo", source: "Regra técnica" },
      { group: "Estratégia comercial", key: "postDiscountPrice", label: "Preço após desconto", value: result.discount.postDiscountPrice, basis: "Preserva o preço com margem desejada", source: "Regra técnica" },
    );
  }
  return items;
}

function canonicalExplanation(result) {
  const laborBasis = result.inputs.laborCostMode === "automatic"
    ? `R$ ${result.inputs.monthlyLaborCost.toFixed(2)} ÷ ${result.inputs.monthlyProductiveHours} h/mês`
    : "custo/hora informado manualmente";
  return [
    { key: "material", value: result.wasteCost, detail: "As perdas foram incorporadas pelo rendimento: insumos ÷ (1 − percentual de perda)." },
    { key: "freight", value: result.freightCostPerUnit, detail: "O frete considera somente a parcela paga pela empresa e foi dividido pelas unidades médias do pedido." },
    { key: "labor", value: result.directLaborCost, detail: `A mão de obra usa ${laborBasis} × ${result.inputs.productionTimeMinutes} minuto(s) por unidade.` },
    { key: "indirect", value: result.indirectCost, detail: `Custos fixos e equipamentos foram rateados por ${allocationLabels[result.inputs.allocationMethod]}. A mão de obra direta não foi somada novamente.` },
    { key: "workingCapital", value: result.financialCost, detail: "O ciclo financeiro aplica juros compostos somente ao custo operacional durante os dias efetivamente financiados." },
    { key: "price", value: result.technicalPrice, detail: "Margem é percentual do preço de venda, não markup: custo completo ÷ (1 − impostos − taxas − comissão − perdas pós-venda − margem)." },
    { key: "discount", value: result.discount.advertisedPrice, detail: result.discount.type === "none" ? "Nenhum desconto planejado foi aplicado." : "O preço anunciado foi elevado para que o preço após o desconto preserve a margem desejada." },
  ];
}

function calculatePricing(input, marketReference = null) {
  const inputs = assertPricingInputs(input);
  const adjustedMaterialCost = calculateAdjustedMaterialCost(inputs.materialCost, inputs.wasteRate);
  const wasteCost = adjustedMaterialCost - inputs.materialCost;
  const freightCostPerUnit = (inputs.averageOrderFreight * inputs.companyFreightShare) / inputs.averageOrderUnits;
  const effectiveLaborHourlyCost = inputs.laborCostMode === "automatic" ? inputs.monthlyLaborCost / inputs.monthlyProductiveHours : inputs.laborHourlyCost;
  const directLaborCost = effectiveLaborHourlyCost * inputs.productionTimeMinutes / 60;
  const directCost = adjustedMaterialCost + inputs.packagingCost + freightCostPerUnit + directLaborCost
    + inputs.otherVariableCost + inputs.otherDirectExpenses + inputs.legacyInsuranceCost;

  const equipmentDepreciationMonthly = inputs.equipmentValue > 0 ? inputs.equipmentValue / inputs.equipmentUsefulLifeMonths : 0;
  const equipmentMonthlyCost = equipmentDepreciationMonthly + inputs.equipmentMaintenanceMonthly;
  const factor = allocationFactor(inputs);
  const fixedCostPerUnit = inputs.monthlyFixedCosts * factor + inputs.legacyMonthlyPayroll / inputs.expectedMonthlyUnits;
  const equipmentCostPerUnit = equipmentMonthlyCost * factor;
  const indirectCost = fixedCostPerUnit + equipmentCostPerUnit;
  const operatingCost = directCost + indirectCost;
  const workingCapital = calculateWorkingCapital(operatingCost, inputs.inventoryDays, inputs.receivingDays, inputs.paymentDays, inputs.monthlyCapitalRate);
  const fixedSaleFeePerUnit = inputs.fixedFeePerOrder / inputs.averageOrderUnits;
  const totalUnitCost = operatingCost + workingCapital.financialCost + fixedSaleFeePerUnit;
  const saleExpenseRate = inputs.taxRate + inputs.paymentFeeRate + inputs.commissionRate + inputs.marketplaceFeeRate + inputs.postSaleLossRate;
  const breakEven = calculateTechnicalPrice(totalUnitCost, saleExpenseRate, 0);
  const minimum = inputs.minimumMargin === null ? null : calculateTechnicalPrice(totalUnitCost, saleExpenseRate, inputs.minimumMargin);
  const technical = calculateTechnicalPrice(totalUnitCost, saleExpenseRate, inputs.desiredNetMargin);

  const taxAmountRaw = technical.technicalPriceRaw * inputs.taxRate;
  const paymentFeeAmountRaw = technical.technicalPriceRaw * inputs.paymentFeeRate;
  const commissionAmountRaw = technical.technicalPriceRaw * inputs.commissionRate;
  const marketplaceFeeAmountRaw = technical.technicalPriceRaw * inputs.marketplaceFeeRate;
  const postSaleLossAmountRaw = technical.technicalPriceRaw * inputs.postSaleLossRate;
  const taxAmount = technical.technicalPrice * inputs.taxRate;
  const paymentFeeAmount = technical.technicalPrice * inputs.paymentFeeRate;
  const commissionAmount = technical.technicalPrice * inputs.commissionRate;
  const marketplaceFeeAmount = technical.technicalPrice * inputs.marketplaceFeeRate;
  const postSaleLossAmount = technical.technicalPrice * inputs.postSaleLossRate;
  const profitAmountRaw = technical.technicalPriceRaw - totalUnitCost - taxAmountRaw - paymentFeeAmountRaw - commissionAmountRaw - marketplaceFeeAmountRaw - postSaleLossAmountRaw;
  const profitAmount = technical.technicalPrice - totalUnitCost - taxAmount - paymentFeeAmount - commissionAmount - marketplaceFeeAmount - postSaleLossAmount;
  const actualNetMargin = technical.technicalPrice === 0 ? 0 : profitAmount / technical.technicalPrice;
  const result = {
    pricingSchemaVersion: PRICING_SCHEMA_VERSION, formulaVersion: FORMULA_VERSION, inputs,
    materialCost: inputs.materialCost, adjustedMaterialCost, wasteCost, packagingCost: inputs.packagingCost,
    freightCostPerUnit, effectiveLaborHourlyCost, directLaborCost, otherVariableCost: inputs.otherVariableCost,
    otherDirectExpenses: inputs.otherDirectExpenses + inputs.legacyInsuranceCost, directCost, allocationFactor: factor,
    equipmentDepreciationMonthly, equipmentMonthlyCost, fixedCostPerUnit, equipmentCostPerUnit, indirectCost, operatingCost,
    ...workingCapital, fixedSaleFeePerUnit, totalUnitCost, saleExpenseRate,
    breakEvenPriceRaw: breakEven.technicalPriceRaw, breakEvenPrice: breakEven.technicalPrice,
    minimumMarginPriceRaw: minimum?.technicalPriceRaw ?? null, minimumMarginPrice: minimum?.technicalPrice ?? null,
    ...technical, taxAmountRaw, paymentFeeAmountRaw, commissionAmountRaw, marketplaceFeeAmountRaw, postSaleLossAmountRaw,
    profitAmountRaw, taxAmount, paymentFeeAmount, commissionAmount, marketplaceFeeAmount, postSaleLossAmount, profitAmount,
    desiredNetMargin: inputs.desiredNetMargin, minimumMargin: inputs.minimumMargin, actualNetMargin,
    discount: calculateDiscountStrategy(technical.technicalPrice, inputs.discountType, inputs.discountRate, inputs.fixedDiscountAmount),
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
      productNameForNcmSearch: ncmVerified ? String(focusState.productNameForNcmSearch || "") : "",
      ncmValidation: ncmVerified ? {
        status: "success", source: "Focus NFe", environment: focusState.environment || "não informado", checkedAt: focusState.checkedAt || new Date().toISOString(), code,
      } : { status: "unverified", source: code ? "Usuário" : null, environment: null, checkedAt: null, code: code || null },
      taxes: [{ key: "aggregate", label: "Percentual efetivo de impostos sobre a venda", rate: inputs.taxRate, source: "Usuário" }],
      unresolvedTaxes: TAXES_REQUIRING_EXTERNAL_RULES,
      warnings: [
        "A Focus NFe confirma somente a classificação NCM; ela não calcula os tributos desta venda.",
        "O NCM isolado não determina a tributação aplicável.",
        "O percentual efetivo informado deve ser validado por contador ou especialista fiscal.",
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
    productNameForNcmSearch: assessment.productNameForNcmSearch || null,
    ncmDescription: assessment.ncm?.descricao_completa || null,
    ncmConfirmedAt: assessment.ncmValidation?.status === "success" ? assessment.ncmValidation.checkedAt : null,
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


const HTML_ENTITIES = Object.freeze({ amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' });

function decodeHtmlEntities(value) {
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (entity, decimal, hexadecimal, named) => {
    if (named) return HTML_ENTITIES[named.toLowerCase()] ?? entity;
    const codePoint = Number.parseInt(decimal || hexadecimal, decimal ? 10 : 16);
    return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : entity;
  });
}

function normalizeNcmDescription(value) {
  const decoded = decodeHtmlEntities(String(value || ""));
  return decoded
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fiscalText(value) {
  return normalizeNcmDescription(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

// Regras de vocabulário, nunca códigos NCM. A seleção final continua com o usuário.
const fiscalCategories = [
  { category: "acessório para telefone", match: /\b(capa|capinha|pelicula|carregador|fone|fones)\b.*\b(iphone|galaxy|celular|smartphone)\b/, terms: ["acessório para telefone"] },
  { category: "relógio inteligente", match: /\b(smartwatch|galaxy watch|apple watch)\b/, terms: ["relógio"] },
  { category: "tablet", match: /\b(tablet|ipad|galaxy tab)\b/, terms: ["máquinas automáticas para processamento de dados"] },
  { category: "telefone celular", match: /\b(iphone|galaxy|smartphones?|celular|celulares|telefone celular)\b/, normalized: "telefone celular smartphone", terms: ["smartphone", "telefones para redes celulares"], relevant: /\bsmartphones?\b|\btelefones?\b.*\b(celulares?|redes sem fio)\b/ },
  { category: "computador portátil", match: /\b(notebook|macbook|laptop|computador portatil)\b/, normalized: "computador portátil notebook", terms: ["processamento de dados", "computadores portáteis"], relevant: /\b(computadores?|maquinas|processamento de dados)\b.*\bportateis\b|\b(notebooks?|laptops?)\b/ },
  { category: "aparelho de televisão", match: /\b(tv|televisor|televisao)\b/, normalized: "aparelho de televisão", terms: ["aparelhos receptores de televisão"], relevant: /\b(televisao|televisores?)\b/ },
  { category: "console de videogame", match: /\b(playstation|xbox|videogame|nintendo switch)\b/, normalized: "console de videogame", terms: ["consoles", "jogos de vídeo"], relevant: /\bconsoles?\b|\bjogos de video\b|\bvideogames?\b/ },
  { category: "bolo / confeitaria", match: /\b(bolos?|tortas?)\b/, normalized: "bolo produto de confeitaria", terms: ["bolos", "produtos de padaria", "pastelaria"], relevant: /\b(bolos?|tortas?|padaria|pastelaria|confeitaria)\b/, preserve: true },
  { category: "refrigerante", match: /\b(refrigerantes?|coca cola|pepsi)\b/, normalized: "refrigerante", terms: ["refrigerantes", "águas gaseificadas"], relevant: /\brefrigerantes?\b|\b(aguas|bebidas)\b.*\b(gaseificadas|aromatizadas|adicionadas de acucar)\b/, preserve: true },
  { category: "calçado / tênis", match: /\b(nike air max|tenis|calcados?)\b/, normalized: "calçado tênis", terms: ["calçados"], relevant: /\bcalcados?\b/, preserve: true },
];

function fiscalCategoryFor(value) {
  const text = fiscalText(value);
  return fiscalCategories.find((rule) => rule.match.test(text));
}

function fiscalCharacteristics(value) {
  const text = fiscalText(value);
  return [
    [/\bchocolate\b/, "chocolate"], [/\bsem gluten\b/, "sem glúten"],
    [/\b(sem acucar|zero acucar|diet|zero)\b/, "sem açúcar"],
    [/\bsem lactose\b/, "sem lactose"], [/\b(couro|cabedal de couro)\b/, "couro"],
    [/\b(torta|frango|carne|recheado|salgado|congelado|cru)\b/g, null],
    [/\b(borracha|plastico|textil|tecido|sintetico)\b/g, null],
  ].flatMap(([pattern, label]) => label ? (pattern.test(text) ? [label] : []) : [...text.matchAll(pattern)].map((match) => match[0]));
}

function normalizeProductForFiscalSearch(value) {
  const originalQuery = String(value || "").trim().replace(/\s+/g, " ");
  const rule = fiscalCategoryFor(originalQuery);
  if (rule?.normalized) {
    const characteristics = rule.preserve ? fiscalCharacteristics(originalQuery) : [];
    return { originalQuery, normalizedQuery: [rule.normalized, ...characteristics].join(" "), category: rule.category };
  }
  // Sem categoria reconhecida, preservar material/função e pedir uma descrição
  // editável. Não eliminar palavras desconhecidas que podem ser essenciais.
  const normalizedQuery = originalQuery
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:gb|tb|ml|kg|cm|mm|litros?|l)\b/gi, "")
    .replace(/\b(?:cor|tamanho)\s+\S+/gi, "")
    .replace(/\s+/g, " ").trim();
  return { originalQuery, normalizedQuery, category: rule?.category || normalizedQuery };
}

function fiscalNcmSearchTerms(normalizedQuery) {
  const rule = fiscalCategoryFor(normalizedQuery);
  // A Focus pesquisa trechos da descrição; sinônimos concatenados não são um
  // operador OR. Consultar os poucos termos da categoria separadamente.
  if (rule?.normalized) return rule.terms;
  const words = fiscalText(normalizedQuery).split(" ").filter((word) => word.length >= 3 && !["para", "com", "sem", "produto", "produtos"].includes(word));
  return [...new Set([normalizedQuery, words[0]])].filter((term) => term?.length >= 3).slice(0, 2);
}

function isRelevantFiscalNcm(normalizedQuery, ncm) {
  const code = ncm?.codigo ?? ncm?.code;
  const description = normalizeNcmDescription(ncm?.descricao_completa ?? ncm?.description);
  if (typeof code !== "string" || !/^\d{8}$/.test(code) || typeof description !== "string" || !description.trim()) return false;
  const text = fiscalText(description);
  const rule = fiscalCategoryFor(normalizedQuery);
  // Examinar a especialização, sem confundir uma menção genérica a "partes"
  // no título ancestral com a classificação específica de um smartphone.
  const detail = fiscalText(description.split(/[.;>]/).filter((part) => part.trim()).at(-1));
  const accessory = /^(partes|acessorios|capas|carregadores|fones)\b/;
  if (rule?.normalized && ["telefone celular", "computador portátil", "aparelho de televisão", "console de videogame"].includes(rule.category)
    && (accessory.test(text) || accessory.test(detail) || /\bpartes(?: outras?)?$/.test(text))) return false;
  if (rule?.relevant) return rule.relevant.test(text);
  const stopWords = new Set(["para", "com", "sem", "dos", "das", "uma", "produto", "produtos", "outros", "outras", "diversos"]);
  const words = [...new Set(fiscalText(normalizedQuery).split(" ").filter((word) => word.length >= 3 && !stopWords.has(word)))];
  const descriptionWords = new Set(text.split(" ").map((word) => word.replace(/s$/, "")));
  const matches = words.filter((word) => descriptionWords.has(word.replace(/s$/, "")));
  // Exigir o substantivo principal, além de sobreposição mínima para fallback.
  return words.length > 0 && descriptionWords.has(words[0].replace(/s$/, "")) && matches.length >= Math.min(2, words.length);
}


const FISCAL_BRAZIL_STATES = Object.freeze([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]);

function normalizeFiscalState(value) {
  return typeof value === "string" ? value.replace(/\s+/g, "").toUpperCase() : "";
}

function isValidFiscalState(value) {
  return FISCAL_BRAZIL_STATES.includes(normalizeFiscalState(value));
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
    title: String(item.title),
    price,
    source: String(item.source || "Marketplace"),
    seller: String(item.seller || item.source || "Marketplace"),
    currency: "BRL",
    category: String(item.category || ""),
    image: String(item.image || ""),
    url: String(item.url),
    consultedAt: String(item.consultedAt || ""),
    ...(Number.isFinite(Number(item.rating)) ? { rating: Number(item.rating) } : {}),
    ...(Number.isInteger(Number(item.reviews)) && Number(item.reviews) >= 0 ? { reviews: Number(item.reviews) } : {}),
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
      provider: response?.provider || "SearchAPI / Google Shopping",
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
  const { method = "GET", body, handleUnauthorized = true, signal } = options;
  if (isGitHubPages() && (path.startsWith("/auth") || path.startsWith("/products") || path.startsWith("/market") || path.startsWith("/tax") || path.startsWith("/fiscal") || path.startsWith("/ai"))) {
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
      // API and interface share the Render domain. "include" also keeps the
      // cookie explicit if this client is ever embedded by a same-site origin.
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    console.error(`[api] Falha de rede em ${method} ${path}:`, error);
    throw new ApiError("Não foi possível conectar ao servidor.", 0);
  }

  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (response.ok) return payload;

  const error = new ApiError(payload?.error || "Não foi possível concluir a operação.", response.status, payload?.code || "", payload || {});
  // A provider can legitimately return HTTP 401 (for example Focus NFe or
  // externos). Only our explicit session code may reset the local account.
  if (handleUnauthorized && error.code === "SESSION_REQUIRED") window.dispatchEvent(new CustomEvent("app:session-expired"));
  throw error;
}

const api = {
  get: (path, options) => request(path, options),
  post: (path, body, options) => request(path, { ...options, method: "POST", body }),
  patch: (path, body, options) => request(path, { ...options, method: "PATCH", body }),
  delete: (path, options) => request(path, { ...options, method: "DELETE" }),
};



const taxMessages = Object.freeze({
  NCM_REQUIRED: ["NCM necessário", "Confirme um NCM relacionado à categoria atual para estimar os tributos."],
  FOCUS_NFE_NCM_CONFIRMATION_REQUIRED: ["NCM necessário", "Confirme o NCM relacionado à categoria atual para estimar os tributos."],
  NCM_CLASSIFICATION_REQUIRED: ["NCM necessário", "Pesquise a categoria e confirme uma sugestão atual."],
  NCM_IRRELEVANT: ["Classificação fiscal inválida", "A descrição do NCM não corresponde à categoria atual."],
  PRODUCT_ORIGIN_REQUIRED: ["Origem do produto necessária", "Selecione se o produto é nacional ou importado (fora do país)."],
  COUNTRY_OF_ORIGIN_REQUIRED: ["País de origem necessário", "Selecione ou informe o país de origem do produto importado."],
  IBPT_NCM_NOT_FOUND: ["NCM não encontrado na tabela IBPT", "O NCM confirmado não existe na versão local da tabela IBPT."],
  IBPT_NOT_CONFIGURED: ["Tabela IBPT não configurada", "O arquivo da tabela IBPT não foi encontrado no servidor."],
  IBPT_INVALID_FILE: ["Não foi possível carregar a tabela tributária", "O arquivo IBPT está ausente ou possui formato inválido."],
  INVALID_TAX_CONTEXT: ["Revise os dados da estimativa", "Revise o NCM, a origem do produto e o maior preço."],
  TAX_RATE_LIMITED: ["Muitas estimativas tributárias", "Aguarde um minuto e tente novamente."],
  SESSION_REQUIRED: ["Sessão expirada", "Sua sessão expirou. Entre novamente."],
});

function marketTaxError(error) {
  const code = error?.code || "";
  const [shortMessage, message] = taxMessages[code] || ["Não foi possível estimar", "Tente novamente em instantes."];
  return { code, shortMessage, message: error?.message || message };
}

function marketTaxPrerequisiteError(context, unitValue, availability) {
  if (!context.ncmConfirmed || !/^\d{8}$/.test(context.ncm || "")) return marketTaxError({ code: "NCM_REQUIRED" });
  if (!["nacional", "importado"].includes(context.productOrigin)) return marketTaxError({ code: "PRODUCT_ORIGIN_REQUIRED" });
  if (context.productOrigin === "importado" && !String(context.countryOfOrigin || "").trim()) return marketTaxError({ code: "COUNTRY_OF_ORIGIN_REQUIRED" });
  if (availability?.configured === false) return marketTaxError({ code: availability.errorCode || "IBPT_NOT_CONFIGURED" });
  if (!Number.isFinite(unitValue) || unitValue <= 0) return marketTaxError({ code: "INVALID_TAX_CONTEXT", message: "Informe um maior preço válido e positivo." });
  return null;
}

class TaxService {
  #api;

  constructor({ apiClient = api } = {}) {
    this.#api = apiClient;
  }

  calculateForPrice({ ncm, productOrigin, unitValue, classificationId, originalQuery, normalizedQuery }) {
    return this.#api.post("/tax/estimate", {
      ncm,
      productOrigin,
      unitValue,
      classificationId,
      originalQuery,
      normalizedQuery,
    });
  }
}


const MARKET_REFERENCE_KEY = "assistente-precificacao-market-reference-v1";

function safeMarketItem(value) {
  const price = Number(value?.price);
  if (!value?.id || !value?.title || !Number.isFinite(price) || price <= 0) return null;
  return {
    id: String(value.id),
    title: String(value.title),
    price,
    source: String(value.source || "Marketplace"),
    seller: String(value.seller || value.source || "Marketplace"),
    currency: String(value.currency || "BRL"),
    category: String(value.category || ""),
    image: String(value.image || ""),
    url: String(value.url || ""),
    consultedAt: String(value.consultedAt || ""),
    ...(Number.isFinite(Number(value.rating)) ? { rating: Number(value.rating) } : {}),
    ...(Number.isInteger(Number(value.reviews)) && Number(value.reviews) >= 0 ? { reviews: Number(value.reviews) } : {}),
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
  "wasteRate", "companyFreightShare", "taxRate", "paymentFeeRate", "commissionRate", "marketplaceFeeRate",
  "postSaleLossRate", "minimumMargin", "desiredNetMargin", "monthlyCapitalRate", "discountRate",
]);
const ASSISTANT_COMBINED_RATE_FIELDS = Object.freeze([
  "taxRate", "paymentFeeRate", "commissionRate", "marketplaceFeeRate", "postSaleLossRate", "desiredNetMargin",
]);

const FIELD_RULES = Object.freeze({
  materialCost: { required: "Informe o custo dos insumos e da matéria-prima." },
  wasteRate: { required: "Informe a perda ou use 0%." },
  packagingCost: { required: "Informe o custo de embalagem ou use R$ 0." },
  averageOrderFreight: { required: "Informe o frete médio do pedido ou use R$ 0." },
  companyFreightShare: { optional: true, nullWhenEmpty: true },
  averageOrderUnits: { required: "Informe a quantidade média de unidades por pedido." },
  otherVariableCost: { optional: true },
  otherDirectExpenses: { optional: true },
  monthlyLaborCost: { optional: true, nullWhenEmpty: true },
  monthlyProductiveHours: { optional: true, nullWhenEmpty: true },
  laborHourlyCost: { optional: true, nullWhenEmpty: true },
  productionTimeMinutes: { required: "Informe o tempo médio para produzir uma unidade." },
  monthlyFixedCosts: { required: "Informe os custos fixos mensais ou use R$ 0." },
  expectedMonthlyUnits: { required: "Informe a quantidade que espera produzir ou vender por mês." },
  allocationLaborHours: { optional: true, nullWhenEmpty: true },
  machineTimeMinutes: { optional: true, nullWhenEmpty: true },
  monthlyMachineHours: { optional: true, nullWhenEmpty: true },
  monthlyBusinessRevenue: { optional: true, nullWhenEmpty: true },
  monthlyProductRevenue: { optional: true, nullWhenEmpty: true },
  equipmentValue: { optional: true },
  equipmentUsefulLifeMonths: { optional: true, nullWhenEmpty: true },
  equipmentMaintenanceMonthly: { optional: true },
  taxRate: { required: "Informe o percentual efetivo de impostos ou use 0%." },
  paymentFeeRate: { optional: true },
  commissionRate: { optional: true },
  marketplaceFeeRate: { optional: true },
  fixedFeePerOrder: { optional: true },
  postSaleLossRate: { optional: true },
  minimumMargin: { optional: true, nullWhenEmpty: true },
  desiredNetMargin: { required: "Informe a margem de lucro desejada." },
  inventoryDays: { required: "Informe os dias entre comprar ou produzir e vender." },
  receivingDays: { required: "Informe o prazo para receber do cliente." },
  paymentDays: { required: "Informe o prazo para pagar fornecedores." },
  monthlyCapitalRate: { optional: true, nullWhenEmpty: true },
  discountRate: { optional: true },
  fixedDiscountAmount: { optional: true },
  marketPrice: { optional: true, nullWhenEmpty: true },
});

const PRICING_FIELD_IDS = Object.freeze(Object.keys(FIELD_RULES));
const REQUIRED_PRICING_FIELD_IDS = Object.freeze(Object.entries(FIELD_RULES)
  .filter(([, rule]) => !rule.optional)
  .map(([fieldId]) => fieldId));
const FORM_OPTION_FIELD_IDS = Object.freeze(["laborCostMode", "freightPayer", "allocationMethod", "capitalRateSource", "discountType"]);

const OPTION_DEFAULTS = Object.freeze({
  laborCostMode: "automatic",
  freightPayer: "company",
  allocationMethod: "quantity",
  capitalRateSource: "informed",
  discountType: "none",
});

const ASSISTANT_TEXT_FIELDS = Object.freeze({
  productName: 160, productDescription: 2000, marketQuery: 160,
  taxRegime: 30, customerType: 30, operationPurpose: 30, cfop: 4, taxSituation: 4,
  productOrigin: 20, originState: 2, destinationState: 2, countryOfOrigin: 80,
  ...Object.fromEntries(FORM_OPTION_FIELD_IDS.map((fieldId) => [fieldId, 30])),
});
const ASSISTANT_NUMERIC_FIELDS = new Set(PRICING_FIELD_IDS);
const ASSISTANT_DAY_FIELDS = new Set(["inventoryDays", "receivingDays", "paymentDays"]);
const ASSISTANT_OPTIONS = Object.freeze({
  taxRegime: ["simples-nacional", "lucro-presumido", "lucro-real", "mei", "outro"],
  customerType: ["contribuinte", "nao-contribuinte", "consumidor-final"],
  operationPurpose: ["venda", "revenda", "industrializacao", "consumo", "ativo", "outra"],
  productOrigin: ["nacional", "importado"],
  laborCostMode: ["automatic", "manual"],
  freightPayer: ["company", "customer", "shared"],
  allocationMethod: ["quantity", "labor-hours", "machine-hours", "revenue"],
  capitalRateSource: ["informed", "zero", "estimated"],
  discountType: ["none", "percentage", "fixed"],
});
const ASSISTANT_STATES = new Set(["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"]);
const assistantNumberFormatter = new Intl.NumberFormat("pt-BR", { useGrouping: false, maximumSignificantDigits: 21 });

/** The assistant supplies display percentages (25), not calculator fractions (0.25). */
function validateAssistantFields(fields) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error("AI_INVALID_RESPONSE");
  const patch = {};
  for (const [fieldId, value] of Object.entries(fields)) {
    const numeric = ASSISTANT_NUMERIC_FIELDS.has(fieldId);
    if (!numeric && !Object.hasOwn(ASSISTANT_TEXT_FIELDS, fieldId)) throw new Error("AI_INVALID_RESPONSE");
    if (value === null || value === undefined) continue;
    if (numeric) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000_000) throw new Error("AI_INVALID_RESPONSE");
      if (PERCENTAGE_FIELDS.has(fieldId) && value >= 100 && fieldId !== "companyFreightShare") throw new Error("AI_INVALID_RESPONSE");
      if (fieldId === "companyFreightShare" && value > 100) throw new Error("AI_INVALID_RESPONSE");
      if (ASSISTANT_DAY_FIELDS.has(fieldId) && value > 3650) throw new Error("AI_INVALID_RESPONSE");
      if (["marketPrice", "expectedMonthlyUnits", "averageOrderUnits", "monthlyProductiveHours", "allocationLaborHours",
        "monthlyMachineHours", "monthlyBusinessRevenue", "monthlyProductRevenue", "equipmentUsefulLifeMonths"].includes(fieldId)
        && value === 0) throw new Error("AI_INVALID_RESPONSE");
    } else if (typeof value !== "string" || !value.trim() || value.length > ASSISTANT_TEXT_FIELDS[fieldId]
      || /[\u0000-\u001f<>]/u.test(value)) throw new Error("AI_INVALID_RESPONSE");
    if (ASSISTANT_OPTIONS[fieldId] && !ASSISTANT_OPTIONS[fieldId].includes(value)) throw new Error("AI_INVALID_RESPONSE");
    if (["originState", "destinationState"].includes(fieldId) && !ASSISTANT_STATES.has(value)) throw new Error("AI_INVALID_RESPONSE");
    if (fieldId === "cfop" && !/^[1-7]\d{3}$/.test(value)) throw new Error("AI_INVALID_RESPONSE");
    if (fieldId === "taxSituation" && !/^\d{2,4}$/.test(value)) throw new Error("AI_INVALID_RESPONSE");
    patch[fieldId] = value;
  }
  if ((patch.discountRate || 0) > 0 && (patch.fixedDiscountAmount || 0) > 0) throw new Error("AI_INVALID_RESPONSE");
  const rates = ["taxRate", "paymentFeeRate", "commissionRate", "marketplaceFeeRate", "postSaleLossRate", "desiredNetMargin"];
  if (rates.reduce((sum, fieldId) => sum + (patch[fieldId] || 0), 0) >= 100) throw new Error("AI_INVALID_RESPONSE");
  return patch;
}

function applyAssistantFields(fields, elements) {
  const patch = validateAssistantFields(fields);
  for (const [fieldId, value] of Object.entries(patch)) {
    const control = elements[fieldId];
    if (!control || (control.options && !Array.from(control.options).some((option) => option.value === value))) throw new Error("AI_INVALID_RESPONSE");
  }
  for (const [fieldId, value] of Object.entries(patch)) elements[fieldId].value = typeof value === "number" ? assistantNumberFormatter.format(value) : value;
  return Object.keys(patch);
}

function parseBrazilianNumber(rawValue) {
  const value = String(rawValue ?? "").trim().replace(/\s/g, "");
  if (value === "") return { status: "empty", value: null };
  const commaCount = (value.match(/,/g) || []).length;
  const normalized = commaCount === 1 ? value.replace(/\./g, "").replace(",", ".") : value;
  if (commaCount > 1 || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return { status: "invalid", value: null };
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? { status: "valid", value: numeric } : { status: "invalid", value: null };
}

function readAssistantRateContext(elements) {
  return Object.fromEntries(ASSISTANT_COMBINED_RATE_FIELDS.flatMap((fieldId) => {
    const parsed = parseBrazilianNumber(elements[fieldId]?.value);
    return parsed.status === "valid" && parsed.value >= 0 && parsed.value < 100 ? [[fieldId, parsed.value]] : [];
  }));
}

/** Safe current values used only by the backend to preserve manual inputs over AI estimates. */
function readAssistantFieldContext(elements) {
  const context = {};
  for (const fieldId of PRICING_FIELD_IDS) {
    if (fieldId === "marketPrice") continue;
    const parsed = parseBrazilianNumber(elements[fieldId]?.value);
    if (parsed.status !== "valid") continue;
    try { Object.assign(context, validateAssistantFields({ [fieldId]: parsed.value })); } catch { /* permanece local */ }
  }
  for (const fieldId of ["productName", "productDescription"]) {
    const value = String(elements[fieldId]?.value || "").trim();
    if (!value) continue;
    try { Object.assign(context, validateAssistantFields({ [fieldId]: value })); } catch { /* validação normal assume */ }
  }
  for (const fieldId of FORM_OPTION_FIELD_IDS) {
    const value = String(elements[fieldId]?.value || "");
    if (!value) continue;
    try { Object.assign(context, validateAssistantFields({ [fieldId]: value })); } catch { /* permanece local */ }
  }
  return context;
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

function validatePricingForm(elements) {
  const errors = {};
  const rawInputs = {};
  const emptyOptionalFields = [];
  for (const [fieldId, rule] of Object.entries(FIELD_RULES)) {
    const parsed = parseBrazilianNumber(elements[fieldId]?.value);
    if (parsed.status === "empty") {
      if (rule.optional) {
        rawInputs[fieldId] = rule.nullWhenEmpty ? null : 0;
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
  for (const fieldId of FORM_OPTION_FIELD_IDS) rawInputs[fieldId] = String(elements[fieldId]?.value || "");
  if (rawInputs.freightPayer !== "shared") rawInputs.companyFreightShare = null;
  if (rawInputs.laborCostMode === "automatic") rawInputs.laborHourlyCost = null;
  if (rawInputs.laborCostMode === "manual") {
    rawInputs.monthlyLaborCost = null;
    rawInputs.monthlyProductiveHours = null;
  }
  if (rawInputs.allocationMethod !== "labor-hours") rawInputs.allocationLaborHours = null;
  if (rawInputs.allocationMethod !== "machine-hours") {
    rawInputs.machineTimeMinutes = null;
    rawInputs.monthlyMachineHours = null;
  }
  if (rawInputs.allocationMethod !== "revenue") {
    rawInputs.monthlyBusinessRevenue = null;
    rawInputs.monthlyProductRevenue = null;
  }
  if (rawInputs.capitalRateSource === "zero") rawInputs.monthlyCapitalRate = null;
  if (rawInputs.discountType !== "percentage") rawInputs.discountRate = 0;
  if (rawInputs.discountType !== "fixed") rawInputs.fixedDiscountAmount = 0;
  rawInputs.productionCapacity = null;
  rawInputs.fiscalContext = readFiscalContext(elements);
  if (Object.keys(errors).length > 0) return { isValid: false, errors, inputs: null, emptyOptionalFields };

  const domainValidation = validatePricingInputs(rawInputs);
  return { isValid: domainValidation.isValid, errors: domainValidation.errors, inputs: domainValidation.isValid ? domainValidation.value : null, emptyOptionalFields };
}

function renderPricingErrors(elements, errors, visibleFieldIds = null) {
  for (const fieldId of [...PRICING_FIELD_IDS, ...FORM_OPTION_FIELD_IDS]) {
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
    if (errorElement) { errorElement.textContent = visible ? error : ""; errorElement.hidden = !visible; }
  }
}

function displayNumber(value, percentage = false) {
  const display = percentage ? value * 100 : value;
  return String(Number(display.toFixed(8))).replace(".", ",");
}

function clearPricingInputs(elements) {
  for (const fieldId of PRICING_FIELD_IDS) if (elements[fieldId]) elements[fieldId].value = "";
  for (const [fieldId, value] of Object.entries(OPTION_DEFAULTS)) if (elements[fieldId]) elements[fieldId].value = value;
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
  for (const fieldId of FORM_OPTION_FIELD_IDS) {
    const value = savedInputs[fieldId];
    if (elements[fieldId] && typeof value === "string") elements[fieldId].value = value;
  }
  Object.entries(savedInputs.fiscalContext || {}).forEach(([fieldId, value]) => {
    if (elements[fieldId] && typeof value === "string") elements[fieldId].value = value;
  });
  return true;
}

/** Somente equivalências seguras são migradas; mão de obra precisa ser confirmada no novo fluxo. */
function migrateLegacyV6Inputs(legacy = {}) {
  return {
    materialCost: legacy.materialCost,
    wasteRate: legacy.wasteRate,
    packagingCost: legacy.packagingCost,
    averageOrderFreight: legacy.deliveryCost,
    freightPayer: "company",
    companyFreightShare: 1,
    averageOrderUnits: 1,
    otherVariableCost: 0,
    otherDirectExpenses: (legacy.otherDirectExpenses || 0) + (legacy.insuranceCost || 0),
    laborCostMode: "automatic",
    monthlyFixedCosts: legacy.monthlyFixedCosts,
    expectedMonthlyUnits: legacy.expectedMonthlyUnits,
    allocationMethod: "quantity",
    taxRate: legacy.taxRate,
    paymentFeeRate: legacy.paymentFeeRate,
    commissionRate: legacy.commissionRate,
    marketplaceFeeRate: 0,
    fixedFeePerOrder: 0,
    postSaleLossRate: 0,
    minimumMargin: null,
    desiredNetMargin: legacy.desiredNetMargin,
    inventoryDays: legacy.inventoryDays,
    receivingDays: legacy.receivingDays,
    paymentDays: legacy.paymentDays,
    capitalRateSource: "informed",
    monthlyCapitalRate: legacy.monthlyCapitalRate,
    discountType: legacy.discountRate > 0 ? "percentage" : legacy.fixedDiscountAmount > 0 ? "fixed" : "none",
    discountRate: legacy.discountRate || 0,
    fixedDiscountAmount: legacy.fixedDiscountAmount || 0,
    marketPrice: legacy.marketPrice,
    fiscalContext: legacy.fiscalContext || {},
  };
}

/** Maps only semantically equivalent v5 values. Missing production/labor data deliberately stay empty. */
function migrateLegacyV5Inputs(legacy = {}) {
  return migrateLegacyV6Inputs({
    materialCost: legacy.materialsCost,
    wasteRate: legacy.waste,
    packagingCost: legacy.packagingCost,
    deliveryCost: legacy.deliveryCost,
    insuranceCost: legacy.insuranceCost,
    otherDirectExpenses: legacy.otherExpenses,
    monthlyFixedCosts: legacy.monthlyFixedCosts,
    expectedMonthlyUnits: legacy.monthlyVolume,
    taxRate: legacy.taxRate,
    paymentFeeRate: legacy.paymentFeeRate,
    commissionRate: legacy.commissionRate,
    desiredNetMargin: legacy.margin,
    receivingDays: legacy.receiveDays,
    paymentDays: legacy.payDays,
    monthlyCapitalRate: legacy.capitalRate,
    fiscalContext: legacy.fiscalContext || {},
  });
}



const AI_ASSISTANT_MESSAGES = Object.freeze({
  insufficient: "Não consegui identificar informações suficientes. Tente informar custos, margem ou dados do produto.",
  unavailable: "O assistente está temporariamente indisponível. Você ainda pode preencher os dados manualmente.",
  invalid: "Não foi possível validar a resposta do assistente. Nenhum campo foi alterado. Tente novamente.",
});

const AI_PENDING_CODES = new Set([
  "AI_COST_BASIS_UNKNOWN", "AI_BATCH_UNITS_REQUIRED", "AI_BATCH_UNITS_INVALID",
  "AI_NEGATIVE_VALUE", "AI_VALUE_OUT_OF_RANGE", "AI_AMBIGUOUS_VALUE",
  "AI_CONFIRM_FIELD", "AI_MEANING_UNCERTAIN", "AI_RATE_SUM_INVALID", "AI_REQUIRED_FIELD_MISSING",
  "AI_USER_VALUE_REQUIRED",
]);
const AI_VALUE_SOURCES = new Set(["user_provided", "inferred", "estimated"]);
const REQUIRED_FIELDS = new Set(REQUIRED_PRICING_FIELD_IDS);
const CLARIFICATION_IN_FLIGHT = Symbol.for("fecart.ai.clarificationInFlight");

function validateAssistantResponse(response) {
  const fields = validateAssistantFields(response?.fields);
  const fieldIds = Object.keys(fields);
  if (!response?.sources || typeof response.sources !== "object" || Array.isArray(response.sources)) throw new Error("AI_INVALID_RESPONSE");
  const sourceIds = Object.keys(response.sources);
  if (sourceIds.length !== fieldIds.length || sourceIds.some((field) => !Object.hasOwn(fields, field)
    || !AI_VALUE_SOURCES.has(response.sources[field]))) throw new Error("AI_INVALID_RESPONSE");
  const sources = Object.fromEntries(fieldIds.map((field) => [field, response.sources[field]]));
  const skippedInput = response?.skipped ?? {};
  if (!skippedInput || typeof skippedInput !== "object" || Array.isArray(skippedInput)) throw new Error("AI_INVALID_RESPONSE");
  const skipped = {};
  for (const [field, decision] of Object.entries(skippedInput)) {
    validateAssistantFields({ [field]: null });
    if (!decision || typeof decision !== "object" || Array.isArray(decision)
      || Object.keys(decision).length !== 2 || decision.value !== null || decision.source !== "skipped"
      || Object.hasOwn(fields, field)) throw new Error("AI_INVALID_RESPONSE");
    skipped[field] = { value: null, source: "skipped" };
  }
  const skippedIds = Object.keys(skipped);
  if (!Array.isArray(response.summary) || response.summary.length !== fieldIds.length + skippedIds.length) throw new Error("AI_INVALID_RESPONSE");
  const seen = new Set();
  const summary = response.summary.map((item) => {
    const skippedField = Object.hasOwn(skipped, item?.field);
    if (!item || (!Object.hasOwn(fields, item.field) && !Object.hasOwn(skipped, item.field)) || seen.has(item.field)
      || typeof item.label !== "string" || !item.label || item.label.length > 120
      || typeof item.value !== "string" || !item.value || item.value.length > 2300
      || (skippedField ? item.source !== "skipped" : item.source !== sources[item.field])) throw new Error("AI_INVALID_RESPONSE");
    seen.add(item.field);
    return { field: item.field, label: item.label, value: item.value, source: item.source };
  });
  if (!Array.isArray(response.pending)) throw new Error("AI_INVALID_RESPONSE");
  const pendingSeen = new Set();
  const pending = response.pending.map((item) => {
    if (!item || !AI_PENDING_CODES.has(item.code)
      || typeof item.field !== "string" || !item.field
      || typeof item.message !== "string" || !item.message || item.message.length > 300
      || (item.label !== undefined && (typeof item.label !== "string" || !item.label || item.label.length > 120))
      || (item.required !== undefined && typeof item.required !== "boolean")) throw new Error("AI_INVALID_RESPONSE");
    // Reuse the form allowlist without treating a pending value as an update.
    validateAssistantFields({ [item.field]: null });
    const key = `${item.code}:${item.field}`;
    if (pendingSeen.has(key)) throw new Error("AI_INVALID_RESPONSE");
    pendingSeen.add(key);
    if (Object.hasOwn(skipped, item.field) || Object.hasOwn(fields, item.field)) throw new Error("AI_INVALID_RESPONSE");
    return { code: item.code, field: item.field, message: item.message, label: item.label || item.field, required: item.required ?? REQUIRED_FIELDS.has(item.field) };
  });
  const needsClarification = pending.length > 0;
  if (response.needsClarification !== needsClarification) throw new Error("AI_INVALID_RESPONSE");
  if (!fieldIds.length && !pending.length && !skippedIds.length) {
    throw Object.assign(new Error(AI_ASSISTANT_MESSAGES.insufficient), { code: "AI_INSUFFICIENT_INFORMATION" });
  }
  if (Object.hasOwn(response, "calculationReady") && typeof response.calculationReady !== "boolean") throw new Error("AI_INVALID_RESPONSE");
  const calculationReady = typeof response.calculationReady === "boolean" ? response.calculationReady : null;
  return { fields, sources, skipped, summary, pending, needsClarification, calculationReady };
}

function assistantErrorMessage(error) {
  const code = error?.code || error?.message;
  if (code === "AI_INSUFFICIENT_INFORMATION") return AI_ASSISTANT_MESSAGES.insufficient;
  if (code === "AI_INVALID_RESPONSE" || code === "GEMINI_INVALID_RESPONSE") return AI_ASSISTANT_MESSAGES.invalid;
  if (code === "AI_CLARIFICATION_MERGE_FAILED") return "Não foi possível combinar o esclarecimento com a análise anterior. A prévia anterior foi preservada.";
  if (code === "AI_VALIDATION_FAILED") return "O esclarecimento não passou pela validação final. A prévia anterior foi preservada.";
  if (code === "GEMINI_UNAVAILABLE") return "A Gemini está temporariamente indisponível. Você ainda pode preencher os dados manualmente.";
  if (code === "GEMINI_NOT_CONFIGURED") return "O assistente ainda não está configurado neste ambiente. Você pode preencher os dados manualmente.";
  if (code === "GEMINI_UNAUTHORIZED") return "Não foi possível autenticar o assistente no provedor de IA. Avise o responsável pelo site.";
  if (code === "GEMINI_FORBIDDEN") return "O provedor de IA não autorizou esta operação. Avise o responsável pelo site.";
  if (code === "GEMINI_MODEL_UNAVAILABLE") return "O modelo de IA configurado não está disponível para esta integração. Avise o responsável pelo site.";
  if (code === "GEMINI_BAD_REQUEST") return "O provedor recusou o formato da análise. Avise o responsável pelo site.";
  if (code === "GEMINI_QUOTA_EXCEEDED") return "O limite de uso ou de créditos da integração de IA foi atingido. Avise o responsável pelo site.";
  if (code === "GEMINI_RATE_LIMITED") return "O provedor de IA está limitando as análises. Aguarde um pouco e tente novamente.";
  if (code === "GEMINI_TIMEOUT") return "A análise demorou mais que o esperado. Tente novamente em alguns instantes.";
  if (code === "GEMINI_CONNECTION_ERROR") return "Não foi possível conectar ao provedor de IA. Tente novamente em alguns instantes.";
  if (code === "AI_INTERNAL_ERROR") return "Não foi possível concluir a análise devido a uma falha interna. Você pode preencher os dados manualmente.";
  if (code === "AI_RATE_LIMITED") return "Você fez várias análises em pouco tempo. Aguarde um minuto e tente novamente.";
  if (code === "AI_REQUEST_IN_PROGRESS") return "Uma análise ainda está em andamento. Aguarde alguns instantes para tentar novamente.";
  if (code === "INVALID_AI_REQUEST") return "Descreva seu produto em uma mensagem de até 4.000 caracteres.";
  if (code === "SESSION_REQUIRED") return "Sua sessão expirou. Entre novamente para usar o assistente.";
  return AI_ASSISTANT_MESSAGES.unavailable;
}

/** Manages a single ephemeral analysis. Only onApply is allowed to mutate pricing. */
function createAiAssistant({ dialog, openButtons, parse, onApply, onSearchMarket, hasSession = () => true }) {
  const select = (selector) => dialog.querySelector(selector);
  const form = select("[data-ai-form]");
  const textarea = select("[data-ai-message]");
  const analyzeButton = select("[data-ai-analyze]");
  const preview = select("[data-ai-preview]");
  const fieldsList = select("[data-ai-fields]");
  const estimateWarning = select("[data-ai-estimate-warning]");
  const pendingSection = select("[data-ai-pending]");
  const pendingList = select("[data-ai-pending-list]");
  const clarificationForm = select("[data-ai-clarification-form]");
  const clarificationLabel = select("[data-ai-clarification-label]");
  const clarification = select("[data-ai-clarification]");
  const clarifyButton = select("[data-ai-clarify]");
  const status = select("[data-ai-status]");
  const applyButton = select("[data-ai-apply]");
  const adjustButton = select("[data-ai-adjust]");
  const searchButton = select("[data-ai-search]");
  const cancelButton = select("[data-ai-cancel]");
  let result = null;
  let phase = "idle";
  let revision = 0;
  let abortController = null;
  let analysisContext = "";
  let loadingAction = "analysis";
  let activeField = null;
  const acceptedEstimates = new Set();

  function update() {
    const loading = phase === "loading";
    form.setAttribute("aria-busy", String(loading));
    textarea.readOnly = loading;
    analyzeButton.disabled = loading || !textarea.value.trim();
    analyzeButton.setAttribute("aria-busy", String(loading));
    analyzeButton.textContent = loading && loadingAction === "analysis" ? "Analisando informações..." : "Analisar informações";
    const showingResult = Boolean(result) && (["preview", "partial-applied"].includes(phase) || loading);
    const hasFields = Boolean(result && Object.keys(result.fields).length);
    const hasSkipped = Boolean(result && Object.keys(result.skipped).length);
    const hasPending = Boolean(result?.pending.length);
    const unresolvedEstimates = result?.summary.filter((item) => item.source === "estimated" && !acceptedEstimates.has(item.field)) || [];
    const hasChoices = hasPending || unresolvedEstimates.length > 0;
    preview.hidden = !showingResult;
    fieldsList.hidden = !hasFields && !hasSkipped;
    estimateWarning.hidden = !showingResult || !result?.summary.some((item) => item.source === "estimated");
    pendingSection.hidden = !showingResult || !hasChoices;
    clarificationForm.hidden = !showingResult || !activeField;
    clarification.readOnly = loading;
    clarifyButton.disabled = loading || !clarification.value.trim();
    clarifyButton.setAttribute("aria-busy", String(loading && loadingAction === "clarification"));
    clarifyButton.textContent = loading && loadingAction === "clarification" ? "Confirmando..." : "Confirmar";
    const unresolvedChoices = hasPending || unresolvedEstimates.length > 0;
    applyButton.hidden = phase !== "preview" || (!hasFields && !hasSkipped) || unresolvedChoices;
    applyButton.disabled = phase !== "preview" || (!hasFields && !hasSkipped) || unresolvedChoices;
    adjustButton.hidden = !showingResult || loading;
    searchButton.hidden = phase !== "applied" || !result?.fields.marketQuery;
    cancelButton.textContent = ["applied", "partial-applied"].includes(phase) ? "Fechar" : "Cancelar";
  }

  function clearAnalysis({ clearText = false, clearContext = true } = {}) {
    revision += 1;
    abortController?.abort();
    abortController = null;
    result = null;
    phase = "idle";
    status.textContent = "";
    status.hidden = true;
    status.classList.remove("is-error", "is-success");
    fieldsList.replaceChildren();
    pendingList.replaceChildren();
    clarification.value = "";
    activeField = null;
    acceptedEstimates.clear();
    if (clearContext) analysisContext = "";
    if (clearText) textarea.value = "";
    update();
  }

  function close() {
    clearAnalysis({ clearText: true });
    if (dialog.open) dialog.close();
  }

  function open() {
    if (!hasSession()) return;
    clearAnalysis({ clearText: true });
    if (!dialog.open) dialog.showModal();
    textarea.focus();
  }

  function showStatus(message, kind = "") {
    status.textContent = message;
    status.hidden = false;
    status.classList.toggle("is-error", kind === "error");
    status.classList.toggle("is-success", kind === "success");
  }

  function summaryLabel(field) {
    return result.summary.find((item) => item.field === field)?.label
      || result.pending.find((item) => item.field === field)?.label
      || field;
  }

  function requiredWarning(document) {
    const warning = document.createElement("p");
    warning.className = "ai-assistant-required-warning";
    warning.textContent = "Sem esse valor, o simulador pode não conseguir calcular o preço final.";
    return warning;
  }

  function chooseManualValue(field) {
    if (phase === "loading") return;
    activeField = { field, label: summaryLabel(field) };
    clarification.value = "";
    clarificationLabel.textContent = `${activeField.label}:`;
    clarification.setAttribute("placeholder", "Digite o valor");
    update();
    clarification.focus();
  }

  function skipField(field) {
    if (phase === "loading") return;
    const label = summaryLabel(field);
    delete result.fields[field];
    delete result.sources[field];
    result.pending = result.pending.filter((item) => item.field !== field);
    result.skipped[field] = { value: null, source: "skipped" };
    result.summary = result.summary.filter((item) => item.field !== field);
    result.summary.push({ field, label, value: "Não informado", source: "skipped" });
    result.needsClarification = result.pending.length > 0;
    if (REQUIRED_FIELDS.has(field)) result.calculationReady = false;
    acceptedEstimates.delete(field);
    if (activeField?.field === field) {
      activeField = null;
      clarification.value = "";
    }
    renderResult();
    update();
  }

  function choiceButton(label, action, className = "secondary-button") {
    const button = dialog.ownerDocument.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }

  function renderChoice({ field, message, estimate }) {
    const row = dialog.ownerDocument.createElement("li");
    row.className = "ai-assistant-choice";
    const copy = dialog.ownerDocument.createElement("div");
    const title = dialog.ownerDocument.createElement("strong");
    title.textContent = summaryLabel(field);
    const detail = dialog.ownerDocument.createElement("p");
    detail.textContent = estimate ? `Estimativa sugerida: ${estimate}` : message;
    const question = dialog.ownerDocument.createElement("p");
    question.textContent = "Você deseja informar esse valor ou deixar em branco?";
    copy.append(title, detail, question);
    if (REQUIRED_FIELDS.has(field)) copy.append(requiredWarning(dialog.ownerDocument));
    const actions = dialog.ownerDocument.createElement("div");
    actions.className = "ai-assistant-choice-actions";
    if (estimate) {
      actions.append(choiceButton("Usar estimativa", () => {
        acceptedEstimates.add(field);
        renderResult();
        update();
      }, ""));
    }
    actions.append(
      choiceButton(estimate ? "Informar outro valor" : "Informar valor", () => chooseManualValue(field)),
      choiceButton("Deixar em branco", () => skipField(field), "secondary-button"),
    );
    row.append(copy, actions);
    pendingList.append(row);
  }

  function renderResult() {
    fieldsList.replaceChildren();
    pendingList.replaceChildren();
    const groups = [
      ["user_provided", "Informado pelo usuário"],
      ["inferred", "Inferido com segurança"],
      ["estimated", "Estimado pela IA"],
      ["skipped", "Deixado em branco"],
    ];
    for (const [source, title] of groups) {
      const items = result.summary.filter((item) => item.source === source);
      if (!items.length) continue;
      const section = dialog.ownerDocument.createElement("section");
      section.className = "ai-assistant-source-group";
      const heading = dialog.ownerDocument.createElement("h4");
      heading.textContent = title;
      const list = dialog.ownerDocument.createElement("dl");
      list.className = "ai-assistant-source-fields";
      for (const item of items) {
        const row = dialog.ownerDocument.createElement("div");
        const label = dialog.ownerDocument.createElement("dt");
        const value = dialog.ownerDocument.createElement("dd");
        label.textContent = item.label;
        value.textContent = item.value;
        row.append(label, value);
        if (source === "skipped" && REQUIRED_FIELDS.has(item.field)) row.append(requiredWarning(dialog.ownerDocument));
        list.append(row);
      }
      section.append(heading, list);
      fieldsList.append(section);
    }
    const pendingByField = new Map();
    for (const item of result.pending) {
      const existing = pendingByField.get(item.field);
      if (!existing) pendingByField.set(item.field, { ...item });
      else if (!existing.message.includes(item.message)) existing.message = `${existing.message} ${item.message}`;
    }
    for (const item of pendingByField.values()) renderChoice(item);
    for (const item of result.summary) {
      if (item.source === "estimated" && !acceptedEstimates.has(item.field)) {
        renderChoice({ field: item.field, estimate: item.value });
      }
    }
  }

  async function runAnalysis(message, { clarificationContext = null, preserveResult = false, retainedPending = [] } = {}) {
    if (phase === "loading" || !dialog.open || !hasSession()) return;
    const preserved = preserveResult ? { result, phase } : null;
    if (preserveResult) {
      revision += 1;
      abortController?.abort();
      abortController = null;
    } else {
      clearAnalysis({ clearContext: false });
    }
    if (!message || message.length > 4000) {
      showStatus(message ? "Use até 4.000 caracteres na descrição." : AI_ASSISTANT_MESSAGES.insufficient, "error");
      return false;
    }
    phase = "loading";
    loadingAction = clarificationContext ? "clarification" : "analysis";
    const requestRevision = revision;
    abortController = new AbortController();
    showStatus(loadingAction === "clarification" ? "Analisando esclarecimento..." : "Analisando informações...");
    update();
    try {
      const response = await parse(message, {
        signal: abortController.signal,
        ...(clarificationContext ? { clarification: clarificationContext } : {}),
      });
      if (revision !== requestRevision || !dialog.open || !hasSession()) return;
      result = validateAssistantResponse(response);
      if (retainedPending.length) {
        const resolved = new Set([...Object.keys(result.fields), ...Object.keys(result.skipped)]);
        const pendingKeys = new Set(result.pending.map((item) => `${item.code}:${item.field}`));
        for (const item of retainedPending) {
          const key = `${item.code}:${item.field}`;
          if (!resolved.has(item.field) && !pendingKeys.has(key)) {
            result.pending.push(item);
            pendingKeys.add(key);
          }
        }
        result.needsClarification = result.pending.length > 0;
      }
      activeField = null;
      clarification.value = "";
      renderResult();
      phase = "preview";
      status.hidden = true;
      update();
      (Object.keys(result.fields).length || Object.keys(result.skipped).length ? applyButton : pendingList).focus?.();
      return true;
    } catch (error) {
      if (revision !== requestRevision || !dialog.open) return;
      if (preserved) {
        result = preserved.result;
        phase = preserved.phase;
        renderResult();
      } else {
        phase = "error";
      }
      showStatus(assistantErrorMessage(error), "error");
      update();
      return false;
    } finally {
      if (revision === requestRevision) abortController = null;
    }
  }

  async function analyze(event) {
    event?.preventDefault();
    analysisContext = textarea.value.trim();
    await runAnalysis(analysisContext);
  }

  async function clarify(event) {
    event?.preventDefault();
    event?.stopPropagation?.();
    if (clarificationForm[CLARIFICATION_IN_FLIGHT]) return false;
    if (!["preview", "partial-applied"].includes(phase) || !result || !activeField) return;
    const answer = clarification.value.trim();
    if (!answer) return;
    const previousContext = analysisContext;
    const combined = `${previousContext}\n\nEsclarecimento do usuário: ${answer}`;
    if (combined.length > 4000) {
      showStatus("A descrição e os esclarecimentos juntos devem ter até 4.000 caracteres.", "error");
      return;
    }
    const targetField = activeField.field;
    const retainedPending = result.pending.filter((item) => item.field !== targetField);
    const previousFields = { ...result.fields };
    const previousSources = { ...result.sources };
    delete previousFields[targetField];
    delete previousSources[targetField];
    const previousAnalysis = {
      fields: previousFields,
      sources: previousSources,
      skipped: { ...result.skipped },
      pending: [{ code: "AI_USER_VALUE_REQUIRED", field: targetField }],
      needsClarification: true,
    };
    clarificationForm[CLARIFICATION_IN_FLIGHT] = true;
    try {
      const succeeded = await runAnalysis(answer, {
        clarificationContext: { context: previousContext, previousAnalysis },
        preserveResult: true,
        retainedPending,
      });
      if (succeeded) {
        analysisContext = combined;
      }
      return succeeded;
    } finally {
      clarificationForm[CLARIFICATION_IN_FLIGHT] = false;
      update();
    }
  }

  function apply() {
    if (phase !== "preview" || !result || !dialog.open || !hasSession()) return;
    try {
      const message = onApply(result.fields);
      phase = result.pending.length ? "partial-applied" : "applied";
      const suffix = result.pending.length ? " Responda às pendências para analisar os demais dados." : "";
      showStatus(`${message || "Informações aplicadas. O simulador foi atualizado."}${suffix}`, "success");
      update();
      (result.fields.marketQuery ? searchButton : cancelButton).focus();
    } catch (error) {
      result = null;
      phase = "error";
      showStatus(assistantErrorMessage(error), "error");
      update();
    }
  }

  openButtons.forEach((button) => button.addEventListener("click", open));
  form.addEventListener("submit", analyze);
  textarea.addEventListener("input", () => clearAnalysis());
  clarificationForm.addEventListener("submit", clarify);
  clarification.addEventListener("input", update);
  applyButton.addEventListener("click", apply);
  adjustButton.addEventListener("click", () => {
    clearAnalysis({ clearText: false });
    textarea.focus();
  });
  cancelButton.addEventListener("click", close);
  select("[data-ai-close]").addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.addEventListener("close", () => clearAnalysis({ clearText: true }));
  searchButton.addEventListener("click", () => {
    if (phase !== "applied" || !result?.fields.marketQuery || !hasSession()) return;
    close();
    onSearchMarket();
  });
  update();
  return { open, close, invalidate: close };
}



function money(value) { return value === null || value === undefined ? "—" : currency.format(value); }

function priceCompositionFrom(result) {
  return [
    { label: "Custo direto", value: result.directCost },
    { label: "Custo indireto", value: result.indirectCost },
    { label: "Custo financeiro", value: result.financialCost },
    { label: "Taxa fixa por pedido", value: result.fixedSaleFeePerUnit },
    { label: "Impostos, taxas, comissão e perdas", value: result.taxAmount + result.paymentFeeAmount + result.commissionAmount + result.marketplaceFeeAmount + result.postSaleLossAmount },
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
  document.querySelector("#priceCompositionLegend").innerHTML = components.map((item, index) => `<li><span class="chart-legend-color chart-legend-color-${index + 1}"></span><span>${escapeHtml(item.label)}</span><strong class="financial-value" data-financial-size="${financialValueSize(money(item.value))}">${money(item.value)}</strong><small>${percent(total ? item.value / total : 0)}</small></li>`).join("");
}

function renderPriceDetails(document, result, alertCount) {
  setFinancialValue(document.querySelector("#detailSuggestedPrice"), money(result.technicalPrice));
  setFinancialValue(document.querySelector("#detailBreakEvenPrice"), money(result.breakEvenPrice));
  setFinancialValue(document.querySelector("#detailDesiredMarginPrice"), money(result.technicalPrice));
  const minimumCard = document.querySelector("#detailMinimumMarginCard");
  minimumCard.hidden = result.minimumMarginPrice === null;
  setFinancialValue(document.querySelector("#detailMinimumMarginPrice"), money(result.minimumMarginPrice));
  const hasDiscount = result.discount.type !== "none";
  document.querySelector("#detailAdvertisedPriceCard").hidden = !hasDiscount;
  document.querySelector("#detailPostDiscountPriceCard").hidden = !hasDiscount;
  setFinancialValue(document.querySelector("#detailAdvertisedPrice"), money(result.discount.advertisedPrice));
  setFinancialValue(document.querySelector("#detailPostDiscountPrice"), money(result.discount.postDiscountPrice));
  setFinancialValue(document.querySelector("#detailDonutPrice"), money(result.technicalPrice));
  setFinancialValue(document.querySelector("#detailBaseCost"), money(result.totalUnitCost));
  document.querySelector("#detailSalesRate").textContent = percent(result.saleExpenseRate);
  setFinancialValue(document.querySelector("#detailProfit"), money(result.profitAmount));
  document.querySelector("#detailMargin").textContent = percent(result.actualNetMargin);
  setFinancialValue(document.querySelector("#detailMarketPrice"), money(result.market.price));
  setFinancialValue(document.querySelector("#detailMarketCostLimit"), money(result.market.difference));
  document.querySelector("#detailAlertCount").textContent = `${alertCount} ${alertCount === 1 ? "ponto de atenção" : "pontos de atenção"}`;
  document.querySelector("#detailMarketNarrative").textContent = result.market.price
    ? `Referência ${result.market.rule}: ${money(result.market.price)}. Diferença para o preço recomendado: ${money(result.market.difference)} (${percent(result.market.differenceRate)}).`
    : "Não há referência de mercado. Isso não bloqueia o cálculo do preço recomendado.";
  document.querySelector("#priceComparisonBars").innerHTML = [
    ["Custo total", result.totalUnitCost], ["Preço com margem desejada", result.technicalPrice], ["Mercado", result.market.price],
  ].filter(([, value]) => value !== null).map(([label, value]) => `<li><div><span>${label}</span><strong class="financial-value" data-financial-size="${financialValueSize(money(value))}">${money(value)}</strong></div></li>`).join("");
  renderComposition(document, result);
}

function renderPriceDetailsUnavailable(document, invalidCount) {
  ["detailSuggestedPrice", "detailBreakEvenPrice", "detailMinimumMarginPrice", "detailDesiredMarginPrice", "detailAdvertisedPrice", "detailPostDiscountPrice", "detailDonutPrice", "detailBaseCost", "detailSalesRate", "detailProfit", "detailMargin", "detailMarketPrice", "detailMarketCostLimit"].forEach((id) => { document.querySelector(`#${id}`).textContent = "—"; });
  ["detailMinimumMarginCard", "detailAdvertisedPriceCard", "detailPostDiscountPriceCard"].forEach((id) => { document.querySelector(`#${id}`).hidden = true; });
  document.querySelector("#detailAlertCount").textContent = `${invalidCount} ${invalidCount === 1 ? "campo pendente" : "campos pendentes"}`;
  document.querySelector("#priceDonutSegments").innerHTML = "";
  document.querySelector("#priceCompositionLegend").innerHTML = "<li>Preencha os campos obrigatórios.</li>";
  document.querySelector("#priceComparisonBars").innerHTML = "";
  document.querySelector("#detailMarketNarrative").textContent = "A comparação é opcional e será mostrada quando houver uma referência válida.";
}



function dashboardMoney(value) { return value === null || value === undefined ? "—" : currency.format(value); }
function taxPercent(value) { return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`; }

function marketLabel(market) {
  if (!market?.price) return "Sem referência de mercado";
  if (market.rule === "selected-product") return "Produto individual selecionado";
  if (market.rule === "market-average") return "Média da pesquisa Google Shopping";
  if (market.rule === "market-median") return "Mediana da pesquisa Google Shopping";
  return "Média informada manualmente";
}

function renderExplanation(document, result) {
  const explanations = [
    `Insumos: ${dashboardMoney(result.inputs.materialCost)}; perdas e desperdício: ${dashboardMoney(result.wasteCost)} (${percent(result.inputs.wasteRate)}).`,
    `Frete da empresa por unidade: ${dashboardMoney(result.freightCostPerUnit)}; mão de obra direta: ${dashboardMoney(result.directLaborCost)}; taxa fixa por unidade: ${dashboardMoney(result.fixedSaleFeePerUnit)}.`,
    `Custo direto: ${dashboardMoney(result.directCost)}; custos mensais rateados: ${dashboardMoney(result.indirectCost)} pelo método ${result.inputs.allocationMethod}.`,
    `Ciclo financeiro: ${result.financedDays.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} dia(s); base financiada: ${dashboardMoney(result.financedBase)}; taxa do período: ${percent(result.periodCapitalRate)}; custo financeiro: ${dashboardMoney(result.financialCost)}.`,
    `Preço de equilíbrio: ${dashboardMoney(result.breakEvenPrice)}. Despesas percentuais: ${percent(result.saleExpenseRate)}; margem desejada: ${percent(result.desiredNetMargin)}; preço recomendado: ${dashboardMoney(result.technicalPrice)}. Fórmula: custo completo ÷ (1 − despesas − margem).`,
  ];
  if (result.minimumMarginPrice !== null) explanations.push(`Margem mínima: ${percent(result.minimumMargin)}; preço mínimo comercial: ${dashboardMoney(result.minimumMarginPrice)}. Este valor não é o preço de equilíbrio.`);
  if (result.market.price) explanations.push(`${marketLabel(result.market)}: ${dashboardMoney(result.market.price)}; diferença para o preço recomendado: ${dashboardMoney(result.market.difference)} (${percent(result.market.differenceRate)}). Essa referência não alterou o cálculo.`);
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
  if (result.inputs.capitalRateSource === "estimated") alerts.push(["warning", "O custo mensal do capital foi informado como estimativa. Revise-o quando tiver um valor validado."]);
  if (result.inputs.capitalRateSource === "zero") alerts.push(["warning", "O custo mensal do capital está em 0% porque você informou que não sabe o percentual."]);
  if (result.market.price && result.market.difference < 0) alerts.push(["risk", `O preço recomendado está ${dashboardMoney(Math.abs(result.market.difference))} acima da referência de mercado. A referência não altera o cálculo.`]);
  if (assessment.focusUnavailable) alerts.push(["warning", "A Focus NFe está indisponível; a carga tributária continua manual e não foi alterada."]);
  alerts.push(["warning", "O percentual efetivo de impostos foi informado manualmente. A Focus NFe valida NCM, mas não calcula essa alíquota."]);
  document.querySelector("#alerts").innerHTML = alerts.map(([type, text]) => `<div class="${type}">${escapeHtml(text)}</div>`).join("");
  document.querySelector("#alertCount").textContent = `${alerts.length} ${alerts.length === 1 ? "ponto de atenção" : "pontos de atenção"}`;
  document.querySelector("#alertSummary").textContent = alerts[0][1];
  return alerts.length;
}

function renderFiscalSummary(document, assessment) {
  const ncm = assessment.ncm?.codigo || "não informado";
  const status = assessment.ncmValidation.status === "success" ? `validado pela Focus NFe em ${assessment.ncmValidation.environment}` : "não validado nesta simulação";
  document.querySelector("#fiscalSummary").innerHTML = `<p><strong>NCM:</strong> ${escapeHtml(ncm)} (${escapeHtml(status)})</p><p><strong>Percentual efetivo usado:</strong> informado manualmente, sem alteração silenciosa. A Focus NFe não calculou qualquer alíquota.</p><p><strong>Tributos ainda dependentes de regra externa:</strong> ${escapeHtml(assessment.unresolvedTaxes.join(", "))}.</p>`;
}

function maximumMarketItemForDisplay(marketState) {
  return marketState.items.reduce((current, item) => {
    if (!Number.isFinite(item.price)) return current;
    return !current || item.price > current.price ? item : current;
  }, null);
}

function minimumMarketItemForDisplay(marketState) {
  return marketState.items.reduce((current, item) => {
    if (!Number.isFinite(item.price)) return current;
    return !current || item.price < current.price ? item : current;
  }, null);
}

function marketTaxDisplayMode(marketState) {
  return marketState.selectedItem ? "selected" : "extremes";
}

function marketTaxBasePrice(marketState) {
  return marketState.selectedItem?.price ?? maximumMarketItemForDisplay(marketState)?.price ?? marketState.stats?.max;
}

function marketTaxModeHeading(mode) {
  const selected = mode === "selected";
  return `<div class="market-tax-mode-heading"><div><span>Estimativa tributária</span><strong>${selected ? "Baseado no produto selecionado" : "Baseado nos extremos da pesquisa"}</strong></div><span class="market-tax-mode-badge">${selected ? "Produto selecionado" : "Menor e maior valor"}</span></div>`;
}

function taxMoneyMetric(label, value, total = false) {
  const formatted = dashboardMoney(value);
  return `<div class="market-tax-summary-metric${total ? " is-total" : ""}"><span>${label}</span><strong class="financial-value" data-financial-size="${financialValueSize(formatted)}">${formatted}</strong></div>`;
}

function selectedTaxSummary(marketState, calculation) {
  return `<p class="market-tax-selected-title"><span>Produto selecionado</span><strong>${escapeHtml(marketState.selectedItem?.title || "Produto atual")}</strong></p><div class="market-tax-summary-grid">${taxMoneyMetric("Preço base", calculation.marketPrice)}<div class="market-tax-summary-metric"><span>Carga tributária</span><strong>${taxPercent(calculation.rates.total)}</strong></div>${taxMoneyMetric("Tributos estimados", calculation.estimatedTaxes)}${taxMoneyMetric("Total com tributos", calculation.total, true)}</div>`;
}

function extremeTaxScenario(label, item, calculation) {
  const base = dashboardMoney(calculation.marketPrice);
  const taxes = dashboardMoney(calculation.estimatedTaxes);
  const total = dashboardMoney(calculation.total);
  return `<article class="market-tax-scenario-card"><div><span>${label}</span><strong>${escapeHtml(item?.title || "Referência da pesquisa")}</strong></div><dl><div><dt>Preço base</dt><dd class="financial-value" data-financial-size="${financialValueSize(base)}">${base}</dd></div><div><dt>Tributos estimados</dt><dd class="financial-value" data-financial-size="${financialValueSize(taxes)}">${taxes}</dd></div><div class="is-total"><dt>Total com tributos</dt><dd class="financial-value" data-financial-size="${financialValueSize(total)}">${total}</dd></div></dl></article>`;
}

function taxAction(label, attribute, secondary = false) {
  return `<button type="button" class="market-tax-action${secondary ? " secondary" : ""}" ${attribute}>${label}</button>`;
}

function renderMarketTaxStat(marketState) {
  const mode = marketTaxDisplayMode(marketState);
  const minimumItem = minimumMarketItemForDisplay(marketState);
  const maximumItem = maximumMarketItemForDisplay(marketState);
  const basePrice = marketTaxBasePrice(marketState);
  const tax = marketState.tax || { status: "idle" };
  const context = marketState.taxContext || {};
  const taxAvailability = marketState.taxAvailability;
  const marketDetails = mode === "selected"
    ? [`Produto selecionado: ${marketState.selectedItem?.title || "não informado"}`, `Preço base: ${dashboardMoney(basePrice)}`]
    : [`Menor preço: ${dashboardMoney(minimumItem?.price ?? marketState.stats?.min)}`, `Maior preço: ${dashboardMoney(maximumItem?.price ?? marketState.stats?.max)}`];
  const heading = marketTaxModeHeading(mode);

  const prerequisiteError = marketTaxPrerequisiteError(context, basePrice, taxAvailability);
  if (prerequisiteError) {
    const needsNcm = prerequisiteError.code === "NCM_REQUIRED";
    return `<div class="market-tax-stat is-error" title="${escapeHtml(`${marketDetails.join(" · ")} · ${prerequisiteError.message}`)}">${heading}<p class="market-tax-state-message"><strong>Estimativa indisponível</strong><small>${escapeHtml(prerequisiteError.shortMessage)}</small></p>${needsNcm ? taxAction("Classificar produto", "data-confirm-market-ncm", true) : ""}</div>`;
  }
  if (tax.status === "loading") {
    return `<div class="market-tax-stat is-loading">${heading}<p class="market-tax-state-message"><strong>Calculando estimativa...</strong><small>${mode === "selected" ? "Aplicando as alíquotas ao produto selecionado." : "Calculando os cenários de menor e maior valor."}</small></p></div>`;
  }
  if (tax.status === "success") {
    const calculations = tax.calculations || {};
    const primary = calculations.selected || calculations.maximum || calculations.minimum || tax.result;
    const content = mode === "selected" && calculations.selected
      ? selectedTaxSummary(marketState, calculations.selected)
      : calculations.minimum && calculations.maximum
        ? `<div class="market-tax-extremes-summary"><div class="market-tax-shared-rate"><span>Carga tributária aplicada aos dois cenários</span><strong>${taxPercent(calculations.maximum.rates.total)}</strong></div><div class="market-tax-scenarios">${extremeTaxScenario("Menor preço + tributos", minimumItem, calculations.minimum)}${extremeTaxScenario("Maior preço + tributos", maximumItem, calculations.maximum)}</div></div>`
        : primary ? selectedTaxSummary(marketState, primary) : "";
    return `<div class="market-tax-stat is-success">${heading}${content}<small class="market-tax-source">Fonte: ${escapeHtml(primary.source)} · Versão: ${escapeHtml(primary.version)}</small>${taxAction(tax.expanded ? "Ocultar detalhes" : "Ver detalhes", "data-toggle-market-taxes")}</div>`;
  }
  if (tax.status === "error") {
    const tableUnavailable = ["IBPT_NOT_CONFIGURED", "IBPT_INVALID_FILE"].includes(tax.code);
    return `<div class="market-tax-stat is-error">${heading}<p class="market-tax-state-message"><strong>Não foi possível estimar</strong><small>${escapeHtml(tax.shortMessage || "Tente novamente em instantes.")}</small></p>${tableUnavailable ? "" : taxAction("Tentar novamente", "data-calculate-market-taxes", true)}</div>`;
  }
  return `<div class="market-tax-stat">${heading}<p class="market-tax-state-message"><strong>Estimativa pronta para calcular</strong><small>${mode === "selected" ? "O produto selecionado será usado como preço base." : "O menor e o maior preço serão comparados."}</small></p>${taxAction("Calcular estimativa", "data-calculate-market-taxes")}</div>`;
}

function taxOriginDetails(context, result) {
  const isNational = result.productOrigin === "nacional";
  const origin = isNational ? "Nacional" : "Importado (Fora do País)";
  const originLabel = isNational ? "UF de origem" : "País de origem";
  const originValue = isNational ? context.originState : context.countryOfOrigin;
  const destinationState = context.destinationState || "Não informada";
  const originSummary = isNational ? `UF origem: ${context.originState || "Não informada"}` : `País: ${context.countryOfOrigin || "Não informado"}`;
  return {
    markup: `<div class="market-tax-origin-section"><h4>Origem da mercadoria</h4><dl class="market-tax-origin-details"><div><dt>Origem do produto</dt><dd>${escapeHtml(origin)}</dd></div><div><dt>${originLabel}</dt><dd>${escapeHtml(originValue || "Não informada")}</dd></div><div><dt>UF de destino</dt><dd>${escapeHtml(destinationState)}</dd></div><div><dt>Fonte</dt><dd>${escapeHtml(result.source)}</dd></div></dl></div>`,
    summary: `NCM ${escapeHtml(result.ncm)} · Origem: ${escapeHtml(origin)} · ${escapeHtml(originSummary)} · UF destino: ${escapeHtml(destinationState)} · Versão: ${escapeHtml(result.version)} · Vigência: ${escapeHtml(result.validFrom)} a ${escapeHtml(result.validTo)}`,
  };
}

function taxRateDetails(result) {
  return `<dl class="market-tax-rate-details"><div><dt>Alíquota federal</dt><dd>${taxPercent(result.rates.federal)}</dd></div><div><dt>Alíquota estadual</dt><dd>${taxPercent(result.rates.state)}</dd></div><div><dt>Alíquota municipal</dt><dd>${taxPercent(result.rates.municipal)}</dd></div><div><dt>Carga tributária estimada</dt><dd>${taxPercent(result.rates.total)}</dd></div></dl>`;
}

function renderTaxDetails(marketState) {
  const context = marketState.taxContext || {};
  const prerequisiteError = marketTaxPrerequisiteError(context, marketTaxBasePrice(marketState), marketState.taxAvailability);
  if (prerequisiteError) return `<div class="market-tax-notice is-error" role="alert"><strong>${escapeHtml(prerequisiteError.message)}</strong></div>`;
  const tax = marketState.tax || { status: "idle" };
  if (tax.status === "ncm-error" || tax.status === "error") {
    return `<div class="market-tax-notice is-error" role="alert"><strong>${escapeHtml(tax.message || "Não foi possível concluir a estimativa tributária.")}</strong></div>`;
  }
  if (tax.status !== "success" || !tax.expanded) return "";
  const calculations = tax.calculations || {};
  const mode = marketTaxDisplayMode(marketState);
  const primary = calculations.selected || calculations.maximum || calculations.minimum || tax.result;
  const origin = taxOriginDetails(context, primary);
  if (mode === "selected" && calculations.selected) {
    const result = calculations.selected;
    const selectedTitle = escapeHtml(marketState.selectedItem?.title || "Produto atual");
    return `<section class="market-tax-breakdown" aria-labelledby="market-tax-breakdown-title"><div><p class="eyebrow">Baseado no produto selecionado</p><h3 id="market-tax-breakdown-title">${selectedTitle}</h3></div><div class="market-tax-detail-selected">${taxMoneyMetric("Preço base", result.marketPrice)}${taxMoneyMetric("Tributos estimados", result.estimatedTaxes)}${taxMoneyMetric("Total com tributos", result.total, true)}</div>${taxRateDetails(result)}${origin.markup}<p>${origin.summary}</p></section>`;
  }
  const minimum = calculations.minimum;
  const maximum = calculations.maximum;
  return `<section class="market-tax-breakdown" aria-labelledby="market-tax-breakdown-title"><div><p class="eyebrow">Baseado nos extremos da pesquisa</p><h3 id="market-tax-breakdown-title">Comparação tributária: menor e maior valor</h3></div>${taxRateDetails(primary)}<div class="market-tax-detail-scenarios">${extremeTaxScenario("Menor preço + tributos", minimumMarketItemForDisplay(marketState), minimum)}${extremeTaxScenario("Maior preço + tributos", maximumMarketItemForDisplay(marketState), maximum)}</div>${origin.markup}<p>${origin.summary}</p></section>`;
}

function renderMarketPanel(document, marketState) {
  const panel = document.querySelector("#marketPanel");
  const stats = document.querySelector("#marketStats");
  const results = document.querySelector("#marketResults");
  const sidebarStatus = document.querySelector("#marketSearchStatus");
  const dashboardStatus = document.querySelector("#marketDashboardStatus");
  const taxDetails = document.querySelector("#marketTaxDetails");
  const selected = document.querySelector("#selectedMarketProduct");
  const searchButton = document.querySelector("#marketSearchButton");
  panel.hidden = marketState.status === "idle";
  searchButton.disabled = marketState.status === "loading";
  searchButton.textContent = marketState.status === "loading" ? "Buscando produtos..." : "Pesquisar produto";
  selected.hidden = !marketState.selectedItem;
  const selectedItem = marketState.selectedItem;
  const selectedRating = Number.isFinite(selectedItem?.rating)
    ? ` · Nota ${selectedItem.rating.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${Number.isInteger(selectedItem.reviews) ? ` (${selectedItem.reviews.toLocaleString("pt-BR")} avaliações)` : ""}`
    : "";
  selected.innerHTML = selectedItem ? `<p class="eyebrow">Produto individual selecionado</p><h3>${escapeHtml(selectedItem.title)}</h3><strong class="financial-value" data-financial-size="${financialValueSize(dashboardMoney(selectedItem.price))}">${dashboardMoney(selectedItem.price)}</strong><small>Loja: ${escapeHtml(selectedItem.seller || selectedItem.source)}${escapeHtml(selectedRating)}</small><small>Google Shopping · consulta de ${escapeHtml(selectedItem.consultedAt ? new Date(selectedItem.consultedAt).toLocaleString("pt-BR") : "agora")}</small><button type="button" class="secondary-button" data-change-market-reference>Remover seleção</button>` : "";
  taxDetails.innerHTML = "";
  if (marketState.status === "loading") {
    sidebarStatus.textContent = "Buscando produtos no mercado…";
    dashboardStatus.textContent = "Buscando produtos no mercado…";
    stats.innerHTML = "";
    results.innerHTML = '<div class="market-loading market-state-wide"><span aria-hidden="true"></span><p>Buscando produtos no mercado...</p></div>';
    return;
  }
  if (marketState.status === "error") {
    sidebarStatus.textContent = "Não foi possível consultar o mercado. A alternativa manual continua disponível.";
    dashboardStatus.textContent = "";
    stats.innerHTML = "";
    results.innerHTML = `<div class="market-error-alert market-state-wide" role="alert"><span class="market-error-icon" aria-hidden="true">!</span><div><strong>Não foi possível consultar o mercado agora.</strong><p>${escapeHtml(marketState.error)}</p></div><button type="button" class="secondary-button" data-market-retry>Tentar novamente</button></div>`;
    return;
  }
  if (marketState.status === "empty") {
    sidebarStatus.textContent = "Nenhum produto compatível foi encontrado.";
    dashboardStatus.textContent = "";
    stats.innerHTML = "";
    results.innerHTML = '<div class="market-empty-state market-state-wide"><strong>Nenhum produto compatível foi encontrado.</strong><p>Experimente pesquisar usando nome, marca e modelo.</p></div>';
    return;
  }
  if (!marketState.stats) {
    sidebarStatus.textContent = "A pesquisa de mercado é opcional.";
    dashboardStatus.textContent = "";
    stats.innerHTML = "";
    results.innerHTML = "";
    return;
  }
  const resultCount = marketState.items.length;
  sidebarStatus.textContent = `${resultCount} ${resultCount === 1 ? "produto encontrado" : "produtos encontrados"}.`;
  dashboardStatus.textContent = `${resultCount} ${resultCount === 1 ? "referência encontrada" : "referências encontradas"} para “${marketState.query}”.`;
  const standardStats = [
    ["Média", marketState.stats.average],
    ["Mediana", marketState.stats.median],
    ["Menor", marketState.stats.min],
    ["Maior", marketState.stats.max],
  ].map(([label, value]) => `<div><span>${label}</span><strong class="financial-value" data-financial-size="${financialValueSize(dashboardMoney(value))}">${dashboardMoney(value)}</strong></div>`).join("");
  stats.innerHTML = `${standardStats}${renderMarketTaxStat(marketState)}`;
  taxDetails.innerHTML = renderTaxDetails(marketState);
  results.innerHTML = marketState.items.map((item) => {
    const isSelected = marketState.selectedItem?.id === item.id;
    const rating = Number.isFinite(item.rating)
      ? `<span class="market-rating" aria-label="Nota ${escapeHtml(item.rating)} de 5">★ ${escapeHtml(item.rating.toLocaleString("pt-BR", { maximumFractionDigits: 1 }))}${Number.isInteger(item.reviews) ? ` <small>(${escapeHtml(item.reviews.toLocaleString("pt-BR"))})</small>` : ""}</span>`
      : "";
    const image = item.image
      ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
      : '<div class="market-image-placeholder" aria-hidden="true">Sem imagem</div>';
    const selection = isSelected
      ? '<span class="market-selected-badge">✓ Referência selecionada</span>'
      : "";
    const action = isSelected
      ? '<button type="button" disabled aria-current="true">Referência selecionada</button>'
      : `<button type="button" data-market-select="${escapeHtml(item.id)}">Usar como referência</button>`;
    return `<article class="market-result${isSelected ? " selected" : ""}">${image}${selection}<div class="market-result-content"><h4>${escapeHtml(item.title)}</h4><div class="market-result-price"><strong class="financial-value" data-financial-size="${financialValueSize(dashboardMoney(item.price))}">${dashboardMoney(item.price)}</strong>${rating}</div><p>Loja: ${escapeHtml(item.seller || item.source)}</p></div><div class="market-actions">${action}<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Ver no Google Shopping</a></div></article>`;
  }).join("");
}

function renderIncompleteDashboard(document, marketState, errors) {
  const count = Object.keys(errors).length;
  ["baseCost", "marketReferencePrice", "suggestedPrice", "profitPerSale", "estimatedMargin", "breakEvenPrice", "minimumMarginPrice", "desiredMarginPrice", "advertisedPrice", "postDiscountPrice", "detailSuggestedPrice", "detailBreakEvenPrice", "detailMinimumMarginPrice", "detailDesiredMarginPrice", "detailAdvertisedPrice", "detailPostDiscountPrice", "detailBaseCost", "detailSalesRate", "detailProfit", "detailMargin"].forEach((id) => { const node = document.querySelector(`#${id}`); if (node) node.textContent = "—"; });
  ["minimumMarginPriceRow", "advertisedPriceRow", "postDiscountPriceRow", "detailMinimumMarginCard", "detailAdvertisedPriceCard", "detailPostDiscountPriceCard"].forEach((id) => { const node = document.querySelector(`#${id}`); if (node) node.hidden = true; });
  document.querySelector("#priceStatus").textContent = "Aguardando dados válidos";
  document.querySelector("#recommendationText").textContent = "Corrija os campos indicados para calcular e salvar.";
  document.querySelector("#marketStatus").textContent = "Mercado é opcional e será comparado quando houver referência válida.";
  document.querySelector("#alertCount").textContent = `${count} ${count === 1 ? "campo pendente" : "campos pendentes"}`;
  document.querySelector("#alertSummary").textContent = "O cálculo e o salvamento estão bloqueados.";
  document.querySelector("#explanationList").innerHTML = "<li>Preencha os campos obrigatórios sem corrigir valores silenciosamente.</li>";
  document.querySelector("#costRows").innerHTML = '<tr><td colspan="4">O detalhamento usa o resultado canônico após a validação.</td></tr>';
  document.querySelector("#alerts").innerHTML = "<div class=\"warning\">Corrija os campos indicados.</div>";
  document.querySelector("#fiscalSummary").innerHTML = "<p>O contexto fiscal será preservado sem inventar alíquotas.</p>";
  document.querySelector("#primaryMarketValue").hidden = true;
  document.querySelector("#primaryPriceCard").classList.toggle("has-market-reference", false);
  renderMarketPanel(document, marketState);
  renderPriceDetailsUnavailable(document, count);
}

function renderDashboard(document, result, marketState, fiscalAssessment) {
  const market = result.market;
  setFinancialValue(document.querySelector("#baseCost"), dashboardMoney(result.totalUnitCost));
  setFinancialValue(document.querySelector("#marketReferencePrice"), dashboardMoney(market.price));
  document.querySelector("#marketTitle").textContent = marketLabel(market);
  const selectedReference = market.reference?.selectedProduct;
  document.querySelector("#marketReferenceDetails").textContent = market.price
    ? selectedReference
      ? `${selectedReference.title} · Loja: ${selectedReference.seller || selectedReference.source} · Fonte: Google Shopping · ${selectedReference.consultedAt ? new Date(selectedReference.consultedAt).toLocaleDateString("pt-BR") : "consulta atual"}`
      : `Fonte: ${market.source || "não informada"}`
    : "Referência opcional não informada";
  document.querySelector("#marketPriceLabel").textContent = marketLabel(market);
  setFinancialValue(document.querySelector("#suggestedPrice"), dashboardMoney(result.technicalPrice));
  setFinancialValue(document.querySelector("#breakEvenPrice"), dashboardMoney(result.breakEvenPrice));
  setFinancialValue(document.querySelector("#desiredMarginPrice"), dashboardMoney(result.technicalPrice));
  const minimumRow = document.querySelector("#minimumMarginPriceRow");
  minimumRow.hidden = result.minimumMarginPrice === null;
  setFinancialValue(document.querySelector("#minimumMarginPrice"), dashboardMoney(result.minimumMarginPrice));
  const hasDiscount = result.discount.type !== "none";
  document.querySelector("#advertisedPriceRow").hidden = !hasDiscount;
  document.querySelector("#postDiscountPriceRow").hidden = !hasDiscount;
  setFinancialValue(document.querySelector("#advertisedPrice"), dashboardMoney(result.discount.advertisedPrice));
  setFinancialValue(document.querySelector("#postDiscountPrice"), dashboardMoney(result.discount.postDiscountPrice));
  setFinancialValue(document.querySelector("#profitPerSale"), dashboardMoney(result.profitAmount));
  document.querySelector("#estimatedMargin").textContent = percent(result.actualNetMargin);
  const primaryMarketValue = document.querySelector("#primaryMarketValue");
  primaryMarketValue.hidden = !market.price;
  document.querySelector("#primaryPriceCard").classList.toggle("has-market-reference", Boolean(market.price));
  setFinancialValue(document.querySelector("#primaryMarketPrice"), dashboardMoney(market.price));
  document.querySelector("#primaryMarketSource").textContent = market.price
    ? selectedReference
      ? `${selectedReference.title} · Loja: ${selectedReference.seller || selectedReference.source} · Google Shopping`
      : `${marketLabel(market)} · ${market.source || "Google Shopping"}`
    : "Sem referência de mercado";
  document.querySelector("#priceStatus").textContent = "Preço recomendado";
  document.querySelector("#recommendationText").textContent = "Margem tratada como percentual do preço de venda. Mercado e desconto não entram como custo.";
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
  if (!Number.isFinite(price) || price <= 0 || market?.source !== "market-product") return null;
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
      ${detail(canonical ? "Preço recomendado" : "Preço sugerido", currency.format(product.suggestedPrice))}
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


function profileInitials(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1
    ? words[0].slice(0, 2)
    : `${words[0][0]}${words[1][0]}`;
  return letters.toLocaleUpperCase("pt-BR");
}

function validateProfileDraft({ name, email }) {
  const normalized = {
    name: String(name || "").trim(),
    email: String(email || "").trim().toLowerCase(),
  };
  const errors = { name: "", email: "" };

  if (!normalized.name) errors.name = "O nome não pode ficar vazio.";
  else if (normalized.name.length < 2) errors.name = "Informe um nome com pelo menos 2 caracteres.";
  else if (normalized.name.length > 120) errors.name = "O nome deve ter no máximo 120 caracteres.";

  if (!normalized.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) {
    errors.email = "Informe um e-mail válido.";
  } else if (normalized.email.length > 320) {
    errors.email = "O e-mail deve ter no máximo 320 caracteres.";
  }

  return { normalized, errors, isValid: !errors.name && !errors.email };
}

function validateProfilePasswordDraft({ currentPassword, newPassword, newPasswordConfirmation }) {
  const values = {
    currentPassword: String(currentPassword || ""),
    newPassword: String(newPassword || ""),
    newPasswordConfirmation: String(newPasswordConfirmation || ""),
  };
  const errors = { currentPassword: "", newPassword: "", newPasswordConfirmation: "" };

  if (!values.currentPassword) errors.currentPassword = "Informe sua senha atual.";
  else if (values.currentPassword.length > 72) errors.currentPassword = "Senha atual inválida.";

  if (!values.newPassword) errors.newPassword = "Informe a nova senha.";
  else if (values.newPassword.length > 72 || values.newPassword.length < 8 || !/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(values.newPassword) || !/\d/.test(values.newPassword)) {
    errors.newPassword = "Use pelo menos 8 caracteres, incluindo letras e números.";
  }

  if (!values.newPasswordConfirmation) errors.newPasswordConfirmation = "Confirme a nova senha.";
  else if (values.newPasswordConfirmation !== values.newPassword) errors.newPasswordConfirmation = "As senhas não coincidem.";

  return { values, errors, isValid: !errors.currentPassword && !errors.newPassword && !errors.newPasswordConfirmation };
}

function setProfileFieldError(input, messageElement, message = "") {
  input.setAttribute("aria-invalid", String(Boolean(message)));
  messageElement.hidden = !message;
  messageElement.textContent = message;
}

function setProfileStatus(element, message = "", success = false) {
  element.hidden = !message;
  element.textContent = message;
  element.classList.toggle("success", success);
}

function setProfileButtonBusy(button, busy, idleLabel, busyLabel) {
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
  button.textContent = busy ? busyLabel : idleLabel;
}

function createProfileSettings({
  dialog,
  elements,
  api,
  getUser,
  onUserUpdated,
  onOpenProducts,
  schedule = (callback) => window.requestAnimationFrame(callback),
}) {
  const {
    avatar, displayName, displayEmail, productCount, profileForm, nameInput, nameError,
    emailInput, emailError, status, saveButton, cancelButton, productsButton,
    changePasswordButton, passwordPanel, passwordForm, currentPasswordInput,
    currentPasswordError, newPasswordInput, newPasswordError,
    newPasswordConfirmationInput, newPasswordConfirmationError, passwordSaveButton,
    passwordToggleButtons,
  } = elements;
  let original = { name: "", email: "" };
  let savingProfile = false;
  let savingPassword = false;
  let openRevision = 0;
  let returnFocus = null;
  let rejectedEmail = "";
  let currentPasswordRejected = false;

  function renderProductCount(user) {
    const parsed = Number(user?.savedProductsCount);
    const count = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
    productCount.textContent = `${count} ${count === 1 ? "produto" : "produtos"}`;
  }

  function updateIdentityPreview() {
    const name = nameInput.value.trim() || original.name;
    const email = emailInput.value.trim() || original.email;
    avatar.textContent = profileInitials(name);
    displayName.textContent = name;
    displayEmail.textContent = email;
  }

  function currentProfileValidation() {
    const validation = validateProfileDraft({ name: nameInput.value, email: emailInput.value });
    if (rejectedEmail && validation.normalized.email === rejectedEmail) {
      validation.errors.email = "Este e-mail já está sendo utilizado.";
      validation.isValid = false;
    } else if (rejectedEmail) {
      rejectedEmail = "";
    }
    return validation;
  }

  function isProfileDirty(validation = currentProfileValidation()) {
    return validation.normalized.name !== original.name || validation.normalized.email !== original.email;
  }

  function updateSaveState({ showErrors = false } = {}) {
    const validation = currentProfileValidation();
    if (showErrors || nameInput.getAttribute("aria-invalid") === "true") setProfileFieldError(nameInput, nameError, validation.errors.name);
    if (showErrors || emailInput.getAttribute("aria-invalid") === "true") setProfileFieldError(emailInput, emailError, validation.errors.email);
    saveButton.disabled = savingProfile || !validation.isValid || !isProfileDirty(validation);
    return validation;
  }

  function setUser(user, { replaceDraft = true } = {}) {
    if (replaceDraft) {
      rejectedEmail = "";
      original = { name: String(user.name || ""), email: String(user.email || "").toLowerCase() };
      nameInput.value = original.name;
      emailInput.value = original.email;
      setProfileFieldError(nameInput, nameError);
      setProfileFieldError(emailInput, emailError);
    }
    renderProductCount(user);
    updateIdentityPreview();
    updateSaveState();
  }

  function resetPasswordVisibility() {
    [currentPasswordInput, newPasswordInput, newPasswordConfirmationInput].forEach((input) => { input.type = "password"; });
    passwordToggleButtons.forEach((button) => {
      button.setAttribute("aria-label", "Mostrar senha");
      button.setAttribute("aria-pressed", "false");
      const label = button.querySelector("[data-password-toggle-label]");
      if (label) label.textContent = "Mostrar senha";
    });
  }

  function resetPasswordForm({ collapse = true } = {}) {
    currentPasswordRejected = false;
    passwordForm.reset();
    setProfileFieldError(currentPasswordInput, currentPasswordError);
    setProfileFieldError(newPasswordInput, newPasswordError);
    setProfileFieldError(newPasswordConfirmationInput, newPasswordConfirmationError);
    resetPasswordVisibility();
    passwordSaveButton.disabled = true;
    if (collapse) {
      passwordPanel.hidden = true;
      changePasswordButton.setAttribute("aria-expanded", "false");
    }
  }

  function resetProfileDraft() {
    nameInput.value = original.name;
    emailInput.value = original.email;
    setProfileFieldError(nameInput, nameError);
    setProfileFieldError(emailInput, emailError);
    updateIdentityPreview();
    updateSaveState();
    resetPasswordForm();
    setProfileStatus(status);
  }

  function currentPasswordValidation() {
    const validation = validateProfilePasswordDraft({
      currentPassword: currentPasswordInput.value,
      newPassword: newPasswordInput.value,
      newPasswordConfirmation: newPasswordConfirmationInput.value,
    });
    if (currentPasswordRejected) {
      validation.errors.currentPassword = "A senha atual está incorreta.";
      validation.isValid = false;
    }
    return validation;
  }

  function validatePassword({ showErrors = false } = {}) {
    const validation = currentPasswordValidation();
    if (showErrors || currentPasswordInput.getAttribute("aria-invalid") === "true") setProfileFieldError(currentPasswordInput, currentPasswordError, validation.errors.currentPassword);
    if (showErrors || newPasswordInput.getAttribute("aria-invalid") === "true") setProfileFieldError(newPasswordInput, newPasswordError, validation.errors.newPassword);
    if (showErrors || newPasswordConfirmationInput.getAttribute("aria-invalid") === "true") setProfileFieldError(newPasswordConfirmationInput, newPasswordConfirmationError, validation.errors.newPasswordConfirmation);
    passwordSaveButton.disabled = savingPassword || !validation.isValid;
    return validation;
  }

  async function open(trigger) {
    const cachedUser = getUser();
    if (!cachedUser) return;
    const revision = ++openRevision;
    returnFocus = trigger || document.activeElement;
    setUser(cachedUser);
    resetPasswordForm();
    setProfileStatus(status);
    if (!dialog.open) dialog.showModal();
    schedule(() => nameInput.focus());

    try {
      const response = await api.get("/auth/me");
      if (revision !== openRevision || !dialog.open) return;
      const draftWasChanged = isProfileDirty();
      onUserUpdated(response.user);
      setUser(response.user, { replaceDraft: !draftWasChanged });
    } catch (error) {
      if (revision === openRevision && dialog.open && error?.code !== "SESSION_REQUIRED") {
        setProfileStatus(status, error?.message || "Não foi possível atualizar os dados da conta.");
      }
    }
  }

  async function submitProfile(event) {
    event.preventDefault();
    const validation = updateSaveState({ showErrors: true });
    if (!validation.isValid || !isProfileDirty(validation)) return;

    try {
      savingProfile = true;
      setProfileButtonBusy(saveButton, true, "Salvar alterações", "Salvando...");
      setProfileStatus(status);
      const response = await api.patch("/auth/me", validation.normalized);
      onUserUpdated(response.user);
      setUser(response.user);
      setProfileStatus(status, "Perfil atualizado com sucesso.", true);
    } catch (error) {
      if (error?.code === "PROFILE_EMAIL_IN_USE") {
        rejectedEmail = validation.normalized.email;
        setProfileFieldError(emailInput, emailError, "Este e-mail já está sendo utilizado.");
        emailInput.focus();
      } else if (error?.code !== "SESSION_REQUIRED") {
        setProfileStatus(status, error?.message || "Não foi possível atualizar o perfil.");
      }
    } finally {
      savingProfile = false;
      setProfileButtonBusy(saveButton, false, "Salvar alterações", "Salvando...");
      const finalValidation = currentProfileValidation();
      saveButton.disabled = !finalValidation.isValid || !isProfileDirty(finalValidation);
    }
  }

  async function submitPassword(event) {
    event.preventDefault();
    const validation = validatePassword({ showErrors: true });
    if (!validation.isValid) return;

    try {
      savingPassword = true;
      setProfileButtonBusy(passwordSaveButton, true, "Atualizar senha", "Atualizando...");
      setProfileStatus(status);
      await api.post("/auth/change-password", validation.values);
      resetPasswordForm();
      setProfileStatus(status, "Senha atualizada com sucesso.", true);
      changePasswordButton.focus();
    } catch (error) {
      if (error?.code === "CURRENT_PASSWORD_INCORRECT") {
        currentPasswordRejected = true;
        setProfileFieldError(currentPasswordInput, currentPasswordError, "A senha atual está incorreta.");
        currentPasswordInput.focus();
      } else if (error?.code !== "SESSION_REQUIRED") {
        setProfileStatus(status, error?.message || "Não foi possível atualizar a senha.");
      }
    } finally {
      savingPassword = false;
      setProfileButtonBusy(passwordSaveButton, false, "Atualizar senha", "Atualizando...");
      const finalValidation = currentPasswordValidation();
      passwordSaveButton.disabled = !finalValidation.isValid;
    }
  }

  nameInput.addEventListener("input", () => { updateIdentityPreview(); updateSaveState(); });
  emailInput.addEventListener("input", () => { updateIdentityPreview(); updateSaveState(); });
  nameInput.addEventListener("blur", () => {
    nameInput.value = nameInput.value.trim();
    updateIdentityPreview();
    updateSaveState({ showErrors: true });
  });
  emailInput.addEventListener("blur", () => {
    emailInput.value = emailInput.value.trim().toLowerCase();
    updateIdentityPreview();
    updateSaveState({ showErrors: true });
  });
  profileForm.addEventListener("submit", submitProfile);
  cancelButton.addEventListener("click", () => dialog.close());
  productsButton.addEventListener("click", () => {
    returnFocus = null;
    dialog.close();
    onOpenProducts();
  });
  changePasswordButton.addEventListener("click", () => {
    const willOpen = passwordPanel.hidden;
    passwordPanel.hidden = !willOpen;
    changePasswordButton.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) schedule(() => currentPasswordInput.focus());
    else resetPasswordForm();
  });
  [currentPasswordInput, newPasswordInput, newPasswordConfirmationInput].forEach((input) => {
    input.addEventListener("input", () => {
      if (input === currentPasswordInput) currentPasswordRejected = false;
      validatePassword();
    });
    input.addEventListener("blur", () => validatePassword({ showErrors: true }));
  });
  passwordForm.addEventListener("submit", submitPassword);
  dialog.addEventListener("close", () => {
    openRevision += 1;
    resetProfileDraft();
    const target = returnFocus;
    returnFocus = null;
    if (target?.focus) schedule(() => target.focus());
  });

  return {
    open,
    closeForSession() {
      openRevision += 1;
      returnFocus = null;
      if (dialog.open) dialog.close();
      else resetProfileDraft();
    },
  };
}


const sectionFields = Object.freeze({
  product: ["productName"],
  fiscal: ["taxRegime", "originState", "destinationState", "customerType"],
  direct: ["materialCost", "wasteRate", "packagingCost", "averageOrderFreight", "averageOrderUnits"],
  indirect: ["monthlyFixedCosts"],
  production: ["expectedMonthlyUnits", "productionTimeMinutes", "laborCostMode"],
  sales: ["taxRate", "desiredNetMargin"],
  market: [],
  terms: ["inventoryDays", "receivingDays", "paymentDays", "capitalRateSource"],
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
  const mobileStep = root.querySelector("[data-mobile-pricing-step]");
  const mobileTitle = root.querySelector("[data-mobile-pricing-title]");
  const mobileProgress = root.querySelector("[data-mobile-pricing-progress]");
  const mobileStepsToggle = root.querySelector("[data-mobile-steps-toggle]");
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

  function setMobileStepsOpen(open, { restoreFocus = false } = {}) {
    root.classList?.toggle("is-step-picker-open", open);
    if (!mobileStepsToggle) return;
    mobileStepsToggle.setAttribute("aria-expanded", String(open));
    mobileStepsToggle.textContent = open ? "Fechar" : "Etapas";
    if (restoreFocus) mobileStepsToggle.focus();
  }

  function updateMobileProgress(section) {
    const index = order.indexOf(section);
    const tab = tabs[index];
    const label = tab?.dataset.pricingLabel || tab?.textContent.trim() || "Etapa";
    const step = index + 1;
    const progressLabel = `Etapa ${step} de ${order.length}: ${label}`;

    if (mobileStep) mobileStep.textContent = `Etapa ${step} de ${order.length}`;
    if (mobileTitle) mobileTitle.textContent = label;
    if (mobileProgress) {
      mobileProgress.max = order.length;
      mobileProgress.value = step;
      mobileProgress.setAttribute("aria-label", progressLabel);
    }
    if (mobileStepsToggle) mobileStepsToggle.setAttribute("aria-label", `${progressLabel}. Mudar etapa`);
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
    setMobileStepsOpen(false);
    updateMobileProgress(section);
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

  mobileStepsToggle?.addEventListener("click", () => {
    const isOpen = mobileStepsToggle.getAttribute("aria-expanded") !== "true";
    setMobileStepsOpen(isOpen);
    if (isOpen) tabs.find((tab) => tab.dataset.pricingTab === activeSection)?.focus();
  });

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
const taxService = new TaxService();
const taxRuleEngine = new ConfiguredTaxRuleEngine();
const formFieldIds = [
  "ncmCode",
  "productOrigin",
  "countryOfOrigin",
  "taxRegime",
  "originState",
  "destinationState",
  "cfop",
  "taxSituation",
  "customerType",
  "operationPurpose",
  "marketReferenceRule",
  ...PRICING_FIELD_IDS,
  ...FORM_OPTION_FIELD_IDS,
];
const elements = Object.fromEntries(formFieldIds.map((id) => [id, $(`#${id}`)]));
const pricingTabs = createPricingTabs($(".pricing-sidebar"));
createPricingPanel($(".app-shell"));
const state = {
  user: null,
  products: [],
  selectedProduct: null,
  taxAvailability: null,
  countryOfOrigin: "",
};

let focusState = emptyFocusState();
let marketState = emptyMarketState();
let manualMarketValue = elements.marketPrice.value;
let productSearchTimer;
let authenticationRevision = 0;
let pendingDetailTarget = "";
let revealAllPricingErrors = false;
const touchedPricingFields = new Set();
let marketSearchRevision = 0;
let ncmLookupRevision = 0;
let ncmSearchRevision = 0;
let ncmSearchState = emptyNcmSearchState();
const aiAssistant = createAiAssistant({
  dialog: $("#aiAssistantDialog"),
  openButtons: document.querySelectorAll("[data-ai-open]"),
  parse: (message, { signal, clarification } = {}) => api.post("/ai/parse-pricing", {
    message,
    currentRates: readAssistantRateContext(elements),
    currentFields: readAssistantFieldContext({
      ...elements,
      productName: $("#productName"),
      productDescription: $("#productDescription"),
    }),
    ...(clarification ? { clarification } : {}),
  }, { signal }),
  hasSession: () => Boolean(state.user),
  onApply: applyAiPricingFields,
  onSearchMarket: () => {
    pricingTabs.activate("market");
    void searchMarket();
  },
});

function applyAiPricingFields(fields) {
  const previousOrigin = elements.productOrigin.value;
  const changedFields = applyAssistantFields(fields, {
    ...elements,
    productName: $("#productName"),
    productDescription: $("#productDescription"),
    marketQuery: $("#marketQuery"),
  });
  changedFields.forEach((fieldId) => touchedPricingFields.add(fieldId));
  // Preserve the same dependent state transitions as a manual form edit.
  if (changedFields.includes("productOrigin") && elements.productOrigin.value !== previousOrigin) {
    if (!changedFields.includes("originState")) elements.originState.value = "";
    if (!changedFields.includes("countryOfOrigin")) elements.countryOfOrigin.value = "";
    marketState = { ...marketState, tax: emptyMarketTaxState() };
  }
  state.countryOfOrigin = normalizeCountryOfOrigin(elements.countryOfOrigin.value);
  if (changedFields.includes("marketPrice")) updateManualMarketValue();
  if (changedFields.includes("cfop") || changedFields.includes("taxSituation")) {
    document.querySelector(".fiscal-advanced-fields")?.setAttribute("open", "");
  }
  render();
  const marketOnly = changedFields.length === 1 && changedFields[0] === "marketQuery";
  const message = marketOnly
    ? "Busca preparada. Clique em Pesquisar no mercado para consultar os preços reais."
    : validatePricingForm(elements).isValid
      ? "Informações aplicadas. O simulador recalculou os resultados com suas fórmulas atuais."
      : "Informações aplicadas. Complete os demais campos obrigatórios para o simulador calcular o resultado.";
  setMessage($("#saveProductStatus"), message, true);
  return fields.marketQuery && !marketOnly ? `${message} A busca de mercado também está pronta para pesquisar.` : message;
}

function updateManualMarketValue() {
  touchedPricingFields.add("marketPrice");
  marketState = { ...marketState, selectedItem: null };
  manualMarketValue = elements.marketPrice.value;
  elements.marketReferenceRule.value = "manual";
  clearMarketReference(window.sessionStorage);
}

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

const apiMessages = Object.freeze({
  SESSION_REQUIRED: "Sua sessão expirou. Entre novamente.",
  FOCUS_NFE_UNAUTHORIZED: "Não foi possível autenticar na Focus NFe.",
  FOCUS_NFE_NCM_CONFIRMATION_REQUIRED: "Confirme o NCM para estimar os tributos.",
  IBPT_NCM_NOT_FOUND: "O NCM confirmado não existe na tabela IBPT.",
  IBPT_NOT_CONFIGURED: "A tabela IBPT não foi encontrada no servidor.",
  IBPT_INVALID_FILE: "Não foi possível carregar a tabela tributária.",
});

function messageFor(error) {
  if (error instanceof ApiError) return apiMessages[error.code] || error.message;
  return "Não foi possível concluir a operação. Tente novamente.";
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

function renderPricingConditionalFields() {
  const laborAutomatic = elements.laborCostMode.value === "automatic";
  const allocationMethod = elements.allocationMethod.value;
  const discountType = elements.discountType.value;
  const capitalSource = elements.capitalRateSource.value;
  $("#companyFreightShareField").hidden = elements.freightPayer.value !== "shared";
  $("#automaticLaborFields").hidden = !laborAutomatic;
  $("#manualLaborFields").hidden = laborAutomatic;
  $("#allocationLaborHoursField").hidden = allocationMethod !== "labor-hours" || laborAutomatic;
  $("#machineAllocationFields").hidden = allocationMethod !== "machine-hours";
  $("#revenueAllocationFields").hidden = allocationMethod !== "revenue";
  $("#monthlyCapitalRateField").hidden = capitalSource === "zero";
  $("#capitalRateEstimateNotice").hidden = capitalSource !== "estimated";
  $("#percentageDiscountField").hidden = discountType !== "percentage";
  $("#fixedDiscountField").hidden = discountType !== "fixed";
}

function emptyMarketTaxState(overrides = {}) {
  return { status: "idle", mode: "", expanded: false, result: null, calculations: null, suggestions: [], code: "", message: "", shortMessage: "", ...overrides };
}

function emptyFocusState() {
  return { status: "idle", ncm: null, source: "", environment: "", checkedAt: "", productNameForNcmSearch: "", error: "", unavailable: false };
}

function emptyNcmSearchState(overrides = {}) {
  return { status: "idle", query: "", originalQuery: "", normalizedQuery: "", category: "", classificationId: "", editing: true, results: [], error: "", ...overrides };
}

function emptyMarketState() {
  return {
    status: "idle",
    query: "",
    items: [],
    stats: null,
    selectedItem: null,
    error: "",
    tax: emptyMarketTaxState(),
  };
}

function currentFiscalClassification() {
  const query = $("#ncmProductQuery").value || "";
  return { ...normalizeProductForFiscalSearch(query), originalQuery: ncmSearchState.originalQuery || marketState.query || query.trim() };
}

function fiscalCategoryLabel(classification) {
  const labels = {
    "telefone celular": "Telefone celular / smartphone",
    "computador portátil": "Notebook / computador portátil",
    "aparelho de televisão": "Televisão / smart TV",
    "bolo / confeitaria": "Bolo / confeitaria",
  };
  const category = String(classification.category || classification.normalizedQuery || "").trim();
  return labels[category] || (category ? `${category[0].toLocaleUpperCase("pt-BR")}${category.slice(1)}` : "Categoria não informada");
}

function normalizeCountryOfOrigin(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function clearProductOriginGeography() {
  elements.originState.value = "";
  elements.countryOfOrigin.value = "";
  state.countryOfOrigin = "";
}

function renderProductOriginFields() {
  const isNational = elements.productOrigin.value === "nacional";
  const isImported = elements.productOrigin.value === "importado";
  $("#originStateField").hidden = !isNational;
  $("#countryOfOriginField").hidden = !isImported;
  elements.originState.disabled = !isNational;
  elements.countryOfOrigin.disabled = !isImported;
  elements.countryOfOrigin.value = state.countryOfOrigin;
}

function prepareFiscalClassification(originalQuery) {
  const classification = normalizeProductForFiscalSearch(originalQuery);
  ncmLookupRevision += 1;
  ncmSearchRevision += 1;
  elements.ncmCode.value = "";
  elements.productOrigin.value = "";
  clearProductOriginGeography();
  focusState = emptyFocusState();
  ncmSearchState = emptyNcmSearchState({ ...classification, query: classification.normalizedQuery, editing: false });
  $("#ncmProductQuery").value = classification.normalizedQuery;
  marketState = { ...marketState, tax: emptyMarketTaxState() };
  return ncmSearchRevision;
}

function currentMarketTaxContext() {
  const ncm = String(elements.ncmCode.value || "");
  const classification = currentFiscalClassification();
  return {
    ncm,
    ncmConfirmed: /^\d{8}$/.test(ncm) && focusState.status === "success" && focusState.ncm?.codigo === ncm
      && Boolean(focusState.classificationId) && focusState.normalizedQuery === classification.normalizedQuery
      && focusState.originalQuery === classification.originalQuery && isRelevantFiscalNcm(classification.normalizedQuery, focusState.ncm),
    classificationId: focusState.classificationId || "",
    originalQuery: classification.originalQuery,
    normalizedQuery: classification.normalizedQuery,
    productOrigin: elements.productOrigin.value,
    countryOfOrigin: elements.productOrigin.value === "importado" ? state.countryOfOrigin : "",
    originState: elements.productOrigin.value === "nacional" ? elements.originState.value : "",
    destinationState: elements.destinationState.value,
  };
}

function marketTaxSignature() {
  const targets = marketTaxTargets();
  const context = currentMarketTaxContext();
  return JSON.stringify([
    targets.mode,
    targets.entries.map(({ key, item }) => [key, item.id, item.price]),
    context.ncm,
    context.ncmConfirmed,
    context.productOrigin,
    context.countryOfOrigin,
    context.classificationId,
    context.originalQuery,
    context.normalizedQuery,
  ]);
}

function marketStateForRender() {
  if (marketState.tax?.signature && marketState.tax.signature !== marketTaxSignature()) {
    marketState = { ...marketState, tax: emptyMarketTaxState() };
  }
  return {
    ...marketState,
    tax: marketState.tax || emptyMarketTaxState(),
    taxContext: currentMarketTaxContext(),
    taxAvailability: state.taxAvailability,
  };
}

function renderMarketTaxContextStatus() {
  const context = currentMarketTaxContext();
  const targets = marketTaxTargets();
  const status = $("#marketTaxContextStatus");
  const prerequisiteError = marketTaxPrerequisiteError(context, targets.entries[0]?.item.price, state.taxAvailability);
  if (!context.ncmConfirmed) status.textContent = "Classifique o produto para estimar os tributos.";
  else if (prerequisiteError) status.textContent = prerequisiteError.message;
  else {
    const origin = context.productOrigin === "nacional" ? "Nacional" : "Importado (Fora do País)";
    const geography = context.productOrigin === "nacional" ? `UF de origem ${context.originState || "não informada"}` : `país ${context.countryOfOrigin}`;
    const basis = targets.mode === "selected"
      ? `produto selecionado (${targets.entries[0].item.title})`
      : "extremos da pesquisa (menor e maior valor)";
    status.textContent = `Pronto para estimar com base no ${basis}: NCM ${context.ncm} · Origem: ${origin} · ${geography} · UF de destino ${context.destinationState || "não informada"}.`;
  }
}

function marketReferenceFromState(inputs) {
  const rule = elements.marketReferenceRule.value || "manual";
  if (rule === "manual") return inputs.marketPrice ? { price: inputs.marketPrice, source: "manual", rule } : null;
  if (rule === "selected-product" && marketState.selectedItem) {
    return { price: marketState.selectedItem.price, source: marketState.selectedItem.source, rule, query: marketState.query, marketplace: marketState.marketplace, provider: marketState.provider, selectedProduct: marketState.selectedItem, stats: marketState.stats };
  }
  if (rule === "market-average" && marketState.stats) return { price: marketState.stats.average, source: marketState.marketplace || "Google Shopping", rule, query: marketState.query, marketplace: marketState.marketplace, provider: marketState.provider, stats: marketState.stats };
  if (rule === "market-median" && marketState.stats) return { price: marketState.stats.median, source: marketState.marketplace || "Google Shopping", rule, query: marketState.query, marketplace: marketState.marketplace, provider: marketState.provider, stats: marketState.stats };
  return null;
}

function render() {
  renderProductOriginFields();
  renderPricingConditionalFields();
  const validation = currentPricingValidation();
  const viewMarketState = marketStateForRender();
  if (validation.isValid) {
    const inputs = validation.inputs;
    const result = calculatePricing(inputs, marketReferenceFromState(inputs));
    const fiscalAssessment = taxRuleEngine.assess(inputs, focusState);
    renderDashboard(document, result, viewMarketState, fiscalAssessment);
  } else {
    renderIncompleteDashboard(document, viewMarketState, validation.errors);
  }
  renderNcmState();
  renderMarketTaxContextStatus();
  $("#mobileSuggestedPrice").textContent = $("#suggestedPrice").textContent;
  $("#mobileSuggestedPrice").setAttribute("data-financial-size", financialValueSize($("#mobileSuggestedPrice").textContent));
  pricingTabs.updateCompletion();
}

function renderNcmState() {
  const status = $("#ncmLookupStatus");
  const editor = $("#ncmEditor");
  const confirmedSummary = $("#ncmConfirmedSummary");
  const actions = $("#ncmActions");
  const queryInput = $("#ncmProductQuery");
  const searchButton = $("#ncmSearchButton");
  const changeButton = $("#ncmChangeButton");
  const suggestionsHeading = $("#ncmSuggestionsHeading");
  const suggestions = $("#ncmSuggestions");
  const isConfirming = focusState.status === "loading";
  const isSearching = ncmSearchState.status === "loading";
  const isConfirmed = currentMarketTaxContext().ncmConfirmed;
  const classification = currentFiscalClassification();
  $("#fiscalOriginalProduct").textContent = classification.originalQuery || "Nenhum produto pesquisado";

  editor.hidden = isConfirmed;
  confirmedSummary.hidden = !isConfirmed;
  actions.hidden = !isConfirmed;
  $("#ncmConfirmedCategory").textContent = isConfirmed ? fiscalCategoryLabel(classification) : "";
  $("#ncmConfirmedCode").textContent = isConfirmed ? focusState.ncm.codigo : "";

  queryInput.readOnly = isConfirmed || (!ncmSearchState.editing && Boolean(classification.normalizedQuery));
  queryInput.setAttribute("aria-readonly", String(queryInput.readOnly));
  searchButton.disabled = isSearching || isConfirming || isConfirmed;
  searchButton.textContent = isSearching ? "Buscando..." : "Buscar NCM";
  changeButton.hidden = !isConfirmed;

  if (isConfirming) status.textContent = "Confirmando a classificação na Focus NFe…";
  else if (isConfirmed) status.textContent = `✓ NCM confirmado · ${focusState.ncm.codigo} · Focus NFe (${focusState.environment}).`;
  else if (ncmSearchState.status === "loading") status.textContent = "Buscando classificações na Focus NFe…";
  else if (ncmSearchState.status === "empty") status.textContent = "Nenhuma classificação NCM foi encontrada com relação suficiente à categoria. Altere a categoria e informe o tipo, a função ou a composição do produto.";
  else if (ncmSearchState.status === "error") status.textContent = ncmSearchState.error;
  else if (focusState.status === "error") status.textContent = focusState.error;
  else status.textContent = "Revise a categoria e escolha uma sugestão relacionada da Focus NFe. A categoria não determina o NCM.";

  suggestions.replaceChildren();
  suggestions.hidden = ncmSearchState.status !== "success" || ncmSearchState.results.length === 0 || isConfirmed;
  suggestionsHeading.hidden = suggestions.hidden;
  if (!suggestions.hidden) {
    for (const result of ncmSearchState.results.filter((candidate) => isRelevantFiscalNcm(classification.normalizedQuery, candidate))) {
      const item = document.createElement("li");
      const content = document.createElement("div");
      const code = document.createElement("strong");
      const descriptionText = document.createElement("span");
      const useButton = document.createElement("button");
      code.textContent = result.code;
      descriptionText.textContent = normalizeNcmDescription(result.description);
      useButton.type = "button";
      useButton.className = "secondary-button";
      useButton.dataset.ncmSelect = result.code;
      useButton.disabled = isConfirming;
      useButton.textContent = "Usar este NCM";
      content.append(code, descriptionText);
      item.append(content, useButton);
      suggestions.append(item);
    }
  }
}

function ncmSearchErrorMessage(error) {
  if (error instanceof ApiError && ["FOCUS_NFE_UNAVAILABLE", "FOCUS_NFE_TIMEOUT", "FOCUS_NFE_NOT_CONFIGURED"].includes(error.code)) {
    return "Não foi possível consultar a classificação fiscal agora.";
  }
  return messageFor(error);
}

async function searchNcmSuggestions() {
  if (ncmSearchState.status === "loading") return;
  const classification = currentFiscalClassification();
  const query = classification.normalizedQuery;
  const searchRevision = ++ncmSearchRevision;
  ncmLookupRevision += 1;
  elements.ncmCode.value = "";
  focusState = emptyFocusState();
  marketState = { ...marketState, tax: emptyMarketTaxState() };
  $("#ncmProductQuery").value = query;
  if (query.length < 3) {
    ncmSearchState = emptyNcmSearchState({ status: "error", query, error: "Informe pelo menos 3 caracteres para buscar a classificação fiscal." });
    render();
    return;
  }

  ncmSearchState = emptyNcmSearchState({ ...classification, status: "loading", query, editing: false });
  render();
  try {
    const response = await api.get(`/fiscal/ncms/search?q=${encodeURIComponent(query)}&originalQuery=${encodeURIComponent(classification.originalQuery)}`);
    if (searchRevision !== ncmSearchRevision) return;
    if (response.normalizedQuery !== query || response.originalQuery !== classification.originalQuery || !response.classificationId) throw new ApiError("A busca fiscal retornou uma categoria inesperada. Pesquise novamente.", 502, "NCM_CLASSIFICATION_REQUIRED");
    const results = Array.isArray(response.results) ? response.results.filter((candidate) => isRelevantFiscalNcm(query, candidate)) : [];
    ncmSearchState = emptyNcmSearchState({ ...classification, classificationId: response.classificationId, status: results.length ? "success" : "empty", query, results, editing: false });
  } catch (error) {
    if (searchRevision !== ncmSearchRevision) return;
    ncmSearchState = emptyNcmSearchState({ ...classification, status: "error", query, error: ncmSearchErrorMessage(error) });
  }
  render();
}

async function lookupNcm(code) {
  const lookupRevision = ++ncmLookupRevision;
  const normalizedCode = String(code || "");
  const classification = currentFiscalClassification();
  const classificationId = ncmSearchState.classificationId;
  const candidate = ncmSearchState.results.find((result) => result.code === normalizedCode);
  if (!classificationId || !isRelevantFiscalNcm(classification.normalizedQuery, candidate)) {
    focusState = { ...emptyFocusState(), status: "error", error: "Escolha um NCM relacionado à categoria entre as sugestões atuais." };
    elements.ncmCode.value = "";
    render();
    return;
  }

  focusState = { ...emptyFocusState(), status: "loading" };
  render();
  try {
    const response = await api.get(`/fiscal/ncms/${encodeURIComponent(normalizedCode)}?classificationId=${encodeURIComponent(classificationId)}`);
    if (lookupRevision !== ncmLookupRevision) return;
    if (response.classificationId !== classificationId || response.ncm?.codigo !== normalizedCode
      || response.normalizedQuery !== classification.normalizedQuery || response.originalQuery !== classification.originalQuery
      || !isRelevantFiscalNcm(classification.normalizedQuery, response.ncm)) throw new ApiError("A descrição do NCM não corresponde à categoria atual.", 422, "NCM_IRRELEVANT");
    elements.ncmCode.value = response.ncm.codigo;
    focusState = {
      status: "success",
      ncm: response.ncm,
      source: "Focus NFe",
      environment: response.environment,
      checkedAt: new Date().toISOString(),
      productNameForNcmSearch: classification.originalQuery,
      classificationId,
      normalizedQuery: classification.normalizedQuery,
      originalQuery: classification.originalQuery,
      error: "",
      unavailable: false,
    };
  } catch (error) {
    if (lookupRevision !== ncmLookupRevision) return;
    focusState = {
      ...emptyFocusState(),
      status: "error",
      error: `${messageFor(error)} O cálculo financeiro foi mantido, mas não está fiscalmente validado.`,
      unavailable: true,
    };
  }
  render();
  void maybeCalculateMarketTaxes();
}

function resetNcmClassification({ focusInput = false } = {}) {
  const classification = currentFiscalClassification();
  ncmLookupRevision += 1;
  ncmSearchRevision += 1;
  elements.ncmCode.value = "";
  focusState = emptyFocusState();
  ncmSearchState = emptyNcmSearchState({ ...classification, query: classification.normalizedQuery, editing: true });
  marketState = { ...marketState, tax: emptyMarketTaxState() };
  render();
  if (focusInput) $("#ncmProductQuery").focus();
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

function setAuthenticatedUser(user, taxAvailability = null) {
  authenticationRevision += 1;
  updateCurrentUser(user);
  state.taxAvailability = taxAvailability;
  void syncRoute();
}

function updateCurrentUser(user) {
  state.user = user;
  $("#currentUserName").textContent = user.name;
}

function clearAuthenticatedState() {
  aiAssistant.invalidate();
  authenticationRevision += 1;
  state.user = null;
  state.products = [];
  state.selectedProduct = null;
  state.taxAvailability = null;
  $("#currentUserName").textContent = "Conta";
  profileSettings.closeForSession();
  clearMarketReference(window.sessionStorage);
  window.history.replaceState(null, "", window.location.pathname);
}

function endSession(message = "Sua sessão expirou. Entre novamente.") {
  clearAuthenticatedState();
  showAuth("login", message);
}

function setMarketError(query, caughtError) {
  let error = "Não foi possível consultar o mercado agora.";
  if (caughtError instanceof ApiError && caughtError.status === 429) {
    error = "O provedor limitou temporariamente as consultas. Aguarde um pouco e tente novamente.";
  } else if (caughtError instanceof ApiError && caughtError.code === "SEARCHAPI_NOT_CONFIGURED") {
    error = "Consulta de mercado temporariamente indisponível.";
  } else if (caughtError instanceof ApiError && caughtError.code === "SEARCHAPI_UNAUTHORIZED") {
    error = "Não foi possível autenticar a consulta de mercado.";
  } else if (caughtError instanceof ApiError && caughtError.code === "SEARCHAPI_FORBIDDEN") {
    error = "A conta do provedor não possui acesso à pesquisa no Google Shopping.";
  } else if (caughtError instanceof ApiError && caughtError.code === "SEARCHAPI_TIMEOUT") {
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

function maximumMarketItem() {
  return marketState.items.reduce((current, item) => {
    if (!Number.isFinite(item.price)) return current;
    return !current || item.price > current.price ? item : current;
  }, null);
}

function minimumMarketItem() {
  return marketState.items.reduce((current, item) => {
    if (!Number.isFinite(item.price)) return current;
    return !current || item.price < current.price ? item : current;
  }, null);
}

function marketTaxTargets() {
  if (marketState.selectedItem) {
    return { mode: "selected", entries: [{ key: "selected", item: marketState.selectedItem }] };
  }
  const minimum = minimumMarketItem();
  const maximum = maximumMarketItem();
  return {
    mode: "extremes",
    entries: [
      ...(minimum ? [{ key: "minimum", item: minimum }] : []),
      ...(maximum ? [{ key: "maximum", item: maximum }] : []),
    ],
  };
}

function setMarketTaxError(error) {
  marketState = { ...marketState, tax: emptyMarketTaxState({ status: "error", ...marketTaxError(error), signature: marketTaxSignature() }) };
}

async function maybeCalculateMarketTaxes() {
  marketStateForRender();
  if (marketState.tax?.status !== "idle") return;
  const context = currentMarketTaxContext();
  const targets = marketTaxTargets();
  if (!marketTaxPrerequisiteError(context, targets.entries[0]?.item.price, state.taxAvailability)) await calculateMarketTaxes();
}

async function calculateMarketTaxes() {
  marketStateForRender();
  if (marketState.tax?.status === "loading") return;
  const targets = marketTaxTargets();
  const context = currentMarketTaxContext();
  const prerequisiteError = marketTaxPrerequisiteError(context, targets.entries[0]?.item.price, state.taxAvailability);
  if (prerequisiteError) {
    setMarketTaxError(prerequisiteError);
    render();
    if (prerequisiteError.code === "NCM_REQUIRED") $("#ncmProductQuery").focus();
    return;
  }
  const signature = marketTaxSignature();
  const pendingTax = emptyMarketTaxState({ status: "loading", signature });
  const requestIsCurrent = () => marketState.tax === pendingTax && marketTaxSignature() === signature;
  marketState = { ...marketState, tax: pendingTax };
  render();
  try {
    const responses = await Promise.all(targets.entries.map(async ({ key, item }) => {
      const response = await taxService.calculateForPrice({
        ncm: context.ncm,
        productOrigin: context.productOrigin,
        unitValue: item.price,
        classificationId: context.classificationId,
        originalQuery: context.originalQuery,
        normalizedQuery: context.normalizedQuery,
      });
      return [key, response.calculation];
    }));
    if (!requestIsCurrent()) return;
    const calculations = Object.fromEntries(responses);
    marketState = {
      ...marketState,
      tax: emptyMarketTaxState({
        status: "success",
        mode: targets.mode,
        expanded: false,
        calculations,
        result: calculations.selected || calculations.maximum || calculations.minimum,
        signature,
      }),
    };
  } catch (error) {
    if (!requestIsCurrent()) return;
    setMarketTaxError(error);
  }
  render();
}

async function searchMarket() {
  if (marketState.status === "loading") return;
  const searchRevision = ++marketSearchRevision;
  const query = $("#marketQuery").value.trim();
  if (query.length < 3) {
    marketState = { ...marketState, status: "error", error: "Informe pelo menos 3 caracteres para pesquisar." };
    render();
    return;
  }

  if (elements.marketReferenceRule.value === "selected-product") {
    elements.marketPrice.value = manualMarketValue === null ? "" : String(manualMarketValue);
    elements.marketReferenceRule.value = "manual";
  }
  clearMarketReference(window.sessionStorage);
  const fiscalRevision = prepareFiscalClassification(query);
  marketState = { ...marketState, status: "loading", query, items: [], stats: null, selectedItem: null, error: "", tax: emptyMarketTaxState() };
  render();

  try {
    const data = await market.search(query);
    if (searchRevision !== marketSearchRevision) return;
    marketState = {
      ...marketState,
      status: data.stats ? "success" : "empty",
      ...data,
      error: "",
    };
  } catch (error) {
    if (searchRevision !== marketSearchRevision) return;
    setMarketError(query, error);
  }

  render();
  if (marketState.status === "success" && fiscalRevision === ncmSearchRevision) void searchNcmSuggestions();
}

function selectMarketProduct(id) {
  const selected = marketState.items.find((candidate) => candidate.id === id);
  const item = selected ? { ...selected, consultedAt: selected.consultedAt || new Date().toISOString() } : null;
  if (!item) return;
  if (elements.marketReferenceRule.value !== "selected-product") manualMarketValue = elements.marketPrice.value;
  marketState = { ...marketState, selectedItem: item, tax: emptyMarketTaxState() };
  elements.marketReferenceRule.value = "selected-product";
  saveMarketReference(window.sessionStorage, { manualValue: manualMarketValue || null, query: marketState.query, selectedItem: item });
  render();
  void maybeCalculateMarketTaxes();
}

function restoreManualMarket({ focusSearch = false } = {}) {
  elements.marketPrice.value = manualMarketValue === null ? "" : String(manualMarketValue);
  touchedPricingFields.add("marketPrice");
  elements.marketReferenceRule.value = "manual";
  marketState = { ...marketState, selectedItem: null, tax: emptyMarketTaxState() };
  clearMarketReference(window.sessionStorage);
  render();
  void maybeCalculateMarketTaxes();
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

function resetCurrentProductForm() {
  aiAssistant.invalidate();
  // Invalida somente respostas locais pendentes; não inicia chamadas externas.
  marketSearchRevision += 1;
  ncmLookupRevision += 1;
  ncmSearchRevision += 1;
  clearPricingInputs(elements);
  elements.productOrigin.value = "";
  clearProductOriginGeography();
  $("#productName").value = "";
  $("#productDescription").value = "";
  $("#marketQuery").value = "";
  $("#ncmProductQuery").value = "";
  elements.marketReferenceRule.value = "manual";
  document.querySelector(".fiscal-advanced-fields")?.removeAttribute("open");
  document.querySelectorAll(".advanced-pricing-options").forEach((details) => details.removeAttribute("open"));
  focusState = emptyFocusState();
  ncmSearchState = emptyNcmSearchState();
  marketState = emptyMarketState();
  manualMarketValue = "";
  revealAllPricingErrors = false;
  touchedPricingFields.clear();
  clearMarketReference(window.sessionStorage);
  pricingTabs.activate("product", { resetScroll: true });
  render();
  $("#productName").focus({ preventScroll: true });
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
        marketplace: marketState.marketplace || "Google Shopping",
        provider: marketState.provider || "SearchAPI / Google Shopping",
      },
      fiscalValidation: focusState.status === "success" && focusState.ncm?.codigo === inputs.fiscalContext.ncmCode
        ? {
          status: "success",
          source: "Focus NFe",
          code: focusState.ncm.codigo,
          ncm: focusState.ncm,
          environment: focusState.environment,
          checkedAt: focusState.checkedAt,
          productNameForNcmSearch: focusState.productNameForNcmSearch,
        }
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
    resetCurrentProductForm();
    setMessage(status, "Produto salvo com sucesso. Você já pode cadastrar outro item.", true);
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
  aiAssistant.invalidate();
  // Nunca deixa valores da simulação anterior sobreviverem a campos ausentes.
  clearPricingInputs(elements);
  elements.productOrigin.value = "";
  clearProductOriginGeography();
  $("#productName").value = "";
  $("#productDescription").value = "";
  const data = product.calculationData || {};
  const isLegacyV5 = data.version === 5 || data.pricingSchemaVersion === 5;
  const isLegacyV6 = data.pricingSchemaVersion === 6;
  const isLegacy = isLegacyV5 || isLegacyV6;
  const savedInputs = isLegacyV5 ? migrateLegacyV5Inputs(data.inputs) : isLegacyV6 ? migrateLegacyV6Inputs(data.inputs) : data.inputs;
  if (!applySavedInputs(savedInputs, elements, product.calculationData?.emptyOptionalFields)) {
    setMessage($("#historyMessage"), "Esta consulta não possui os dados necessários para ser reutilizada.");
    return;
  }

  $("#productName").value = product.name;
  $("#productDescription").value = product.description || "";
  // Um v5 não possuía prova de validação; ele nunca é promovido para Focus validado.
  const savedValidation = !isLegacy ? data.fiscal?.ncmValidation : null;
  const savedNcm = data.fiscal?.ncm;
  const savedNcmQuery = !isLegacy ? String(data.fiscal?.productNameForNcmSearch || "") : "";
  focusState = savedValidation?.status === "success" && savedValidation.code === savedInputs?.fiscalContext?.ncmCode
    ? { status: "success", ncm: savedNcm, source: "Focus NFe", environment: savedValidation.environment, checkedAt: savedValidation.checkedAt, productNameForNcmSearch: savedNcmQuery, error: "", unavailable: false }
    : emptyFocusState();
  ncmSearchState = emptyNcmSearchState({ query: savedNcmQuery });
  $("#ncmProductQuery").value = savedNcmQuery;
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
    marketplace: reference?.marketplace || "Google Shopping",
    provider: reference?.provider || "SearchAPI / Google Shopping",
    error: "",
  };
  elements.marketReferenceRule.value = reference?.rule || "manual";
  if (marketState.selectedItem) saveMarketReference(window.sessionStorage, { manualValue: manualMarketValue || null, query: marketState.query, selectedItem: marketState.selectedItem });
  else clearMarketReference(window.sessionStorage);
  $("#marketQuery").value = marketState.query;
  $("#productDialog").close();
  render();
  navigate("assistant");
  setMessage($("#saveProductStatus"), isLegacy ? "Cálculo legado carregado: o frete e o seguro foram migrados com segurança; informe a nova mão de obra e revise os campos antes de salvar." : "Consulta carregada. Ajuste os inputs e salve uma nova versão.", true);
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

const profileSettings = createProfileSettings({
  dialog: $("#profileDialog"),
  elements: {
    avatar: $("#profileAvatar"),
    displayName: $("#profileDisplayName"),
    displayEmail: $("#profileDisplayEmail"),
    productCount: $("#profileProductCount"),
    profileForm: $("#profileForm"),
    nameInput: $("#profileName"),
    nameError: $("#profileNameError"),
    emailInput: $("#profileEmail"),
    emailError: $("#profileEmailError"),
    status: $("#profileStatus"),
    saveButton: $("#profileSaveButton"),
    cancelButton: $("#profileCancelButton"),
    productsButton: $("#profileProductsButton"),
    changePasswordButton: $("#profileChangePasswordButton"),
    passwordPanel: $("#profilePasswordPanel"),
    passwordForm: $("#profilePasswordForm"),
    currentPasswordInput: $("#profileCurrentPassword"),
    currentPasswordError: $("#profileCurrentPasswordError"),
    newPasswordInput: $("#profileNewPassword"),
    newPasswordError: $("#profileNewPasswordError"),
    newPasswordConfirmationInput: $("#profileNewPasswordConfirmation"),
    newPasswordConfirmationError: $("#profileNewPasswordConfirmationError"),
    passwordSaveButton: $("#profilePasswordSaveButton"),
    passwordToggleButtons: document.querySelectorAll("#profileDialog [data-password-toggle]"),
  },
  api,
  getUser: () => state.user,
  onUserUpdated: updateCurrentUser,
  onOpenProducts: () => navigate("products"),
});

async function logout() {
  try {
    await api.post("/auth/logout", undefined, { handleUnauthorized: false });
  } catch (error) {
    setMessage($("#saveProductStatus"), messageFor(error));
    return;
  }

  clearAuthenticatedState();
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
    setAuthenticatedUser(response.user, response.taxEstimate);
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
    setAuthenticatedUser(response.user, response.taxEstimate);
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

 [...PRICING_FIELD_IDS]
  .filter((fieldId) => fieldId !== "marketPrice")
  .forEach((fieldId) => elements[fieldId].addEventListener("input", () => {
    touchedPricingFields.add(fieldId);
    render();
  }));

FORM_OPTION_FIELD_IDS.forEach((fieldId) => {
  elements[fieldId].addEventListener("change", () => {
    touchedPricingFields.add(fieldId);
    render();
  });
});

[
  elements.taxRegime,
  elements.originState,
  elements.destinationState,
  elements.cfop,
  elements.taxSituation,
  elements.customerType,
  elements.operationPurpose,
].forEach((field) => {
  const updateField = () => {
    if (field === elements.originState || field === elements.destinationState) {
      field.value = normalizeFiscalState(field.value);
      marketStateForRender();
    }
    render();
  };
  field.addEventListener("input", updateField);
  field.addEventListener("change", updateField);
});

elements.productOrigin.addEventListener("change", () => {
  clearProductOriginGeography();
  marketState = { ...marketState, tax: emptyMarketTaxState() };
  render();
  void maybeCalculateMarketTaxes();
});

elements.countryOfOrigin.addEventListener("input", () => {
  state.countryOfOrigin = String(elements.countryOfOrigin.value || "").slice(0, 80);
  marketStateForRender();
  render();
});

elements.countryOfOrigin.addEventListener("change", () => {
  state.countryOfOrigin = normalizeCountryOfOrigin(elements.countryOfOrigin.value);
  elements.countryOfOrigin.value = state.countryOfOrigin;
  marketStateForRender();
  render();
  void maybeCalculateMarketTaxes();
});

$("#ncmSearchButton").addEventListener("click", () => void searchNcmSuggestions());
$("#ncmProductQuery").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  void searchNcmSuggestions();
});
$("#ncmProductQuery").addEventListener("input", () => {
  resetNcmClassification();
});
$("#ncmSuggestions").addEventListener("click", (event) => {
  const button = event.target.closest("[data-ncm-select]");
  if (button) void lookupNcm(button.dataset.ncmSelect);
});
$("#ncmChangeButton").addEventListener("click", () => resetNcmClassification({ focusInput: true }));

elements.marketPrice.addEventListener("input", () => {
  updateManualMarketValue();
  render();
  void maybeCalculateMarketTaxes();
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
  if (event.target.closest("[data-calculate-market-taxes]")) void calculateMarketTaxes();
  if (event.target.closest("[data-confirm-market-ncm]")) {
    pricingTabs.activate("market");
    $("#ncmProductQuery").focus();
  }
  if (event.target.closest("[data-toggle-market-taxes]")) {
    marketState = { ...marketState, tax: { ...marketState.tax, expanded: !marketState.tax.expanded } };
    render();
  }
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
    const label = button.querySelector("[data-password-toggle-label]");
    if (label) label.textContent = isPassword ? "Ocultar senha" : "Mostrar senha";
    else button.textContent = isPassword ? "Ocultar" : "Mostrar";
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
    if (action === "profile") void profileSettings.open(button);
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
$("#showProfileButton").addEventListener("click", (event) => void profileSettings.open(event.currentTarget));
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
  endSession();
});

restoreMarketReferenceFromSession();
applyTheme(document.documentElement.dataset.theme, false);
render();

async function bootstrap(attempt = 0, revision = authenticationRevision) {
  if (revision !== authenticationRevision) return;
  try {
    const response = await api.get("/auth/me", { handleUnauthorized: false });
    if (revision !== authenticationRevision) return;
    setAuthenticatedUser(response.user, response.taxEstimate);
  } catch (error) {
    if (revision !== authenticationRevision) return;
    if (error instanceof ApiError && error.code === "STATIC_HOSTING") {
      showAuth("login", error.message);
      return;
    }
    const isInactiveSession = error instanceof ApiError && error.code === "SESSION_REQUIRED";
    if (!isInactiveSession && attempt < 2) {
      window.setTimeout(() => void bootstrap(attempt + 1, revision), 800);
      return;
    }
    if (isInactiveSession) {
      endSession();
      return;
    }
    showAuth("login", "Não foi possível conectar ao servidor.");
  }
}

updatePasswordRequirements();
void bootstrap();
