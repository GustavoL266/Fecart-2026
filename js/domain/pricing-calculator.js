// Esta regra é deliberadamente independente do DOM e do banco. O navegador e
// o servidor importam este mesmo módulo: não existe uma segunda fórmula no API.
export const PRICING_SCHEMA_VERSION = 7;
export const FORMULA_VERSION = "transparent-pricing-v3";

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
export function validatePricingInputs(rawInput = {}) {
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

export function assertPricingInputs(input) {
  const validation = validatePricingInputs(input);
  if (!validation.isValid) throw new PricingValidationError(validation.errors);
  return validation.value;
}

export function calculateAdjustedMaterialCost(materialCost, wasteRate) {
  return materialCost / (1 - wasteRate);
}

export function calculateWorkingCapital(operatingCost, inventoryDays, receivingDays, paymentDays, monthlyCapitalRate) {
  const financedDays = Math.max(inventoryDays + receivingDays - paymentDays, 0);
  const periodCapitalRate = (1 + monthlyCapitalRate) ** (financedDays / 30) - 1;
  return { financedDays, financedBase: operatingCost, periodCapitalRate, financialCost: financedDays === 0 ? 0 : operatingCost * periodCapitalRate };
}

export function calculateTechnicalPrice(totalUnitCost, saleExpenseRate, desiredNetMargin) {
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

export function calculateIndirectCost(monthlyPayroll, monthlyFixedCosts, expectedMonthlyUnits) {
  return (monthlyPayroll + monthlyFixedCosts) / expectedMonthlyUnits;
}

export function calculateDiscountStrategy(technicalPrice, discountType = "none", discountRate = 0, fixedDiscountAmount = 0) {
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

export function calculateMarketComparison(marketReference, technicalPrice) {
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

export function calculatePricing(input, marketReference = null) {
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

export const calculatePrice = calculatePricing;
