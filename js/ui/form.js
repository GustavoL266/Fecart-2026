import { validatePricingInputs } from "../domain/pricing-calculator.js";

export const PERCENTAGE_FIELDS = new Set([
  "wasteRate", "companyFreightShare", "taxRate", "paymentFeeRate", "commissionRate", "marketplaceFeeRate",
  "postSaleLossRate", "minimumMargin", "desiredNetMargin", "monthlyCapitalRate", "discountRate",
]);
export const ASSISTANT_COMBINED_RATE_FIELDS = Object.freeze([
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

export const PRICING_FIELD_IDS = Object.freeze(Object.keys(FIELD_RULES));
export const REQUIRED_PRICING_FIELD_IDS = Object.freeze(Object.entries(FIELD_RULES)
  .filter(([, rule]) => !rule.optional)
  .map(([fieldId]) => fieldId));
export const FORM_OPTION_FIELD_IDS = Object.freeze(["laborCostMode", "freightPayer", "allocationMethod", "capitalRateSource", "discountType"]);

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
export function validateAssistantFields(fields) {
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

export function applyAssistantFields(fields, elements) {
  const patch = validateAssistantFields(fields);
  for (const [fieldId, value] of Object.entries(patch)) {
    const control = elements[fieldId];
    if (!control || (control.options && !Array.from(control.options).some((option) => option.value === value))) throw new Error("AI_INVALID_RESPONSE");
  }
  for (const [fieldId, value] of Object.entries(patch)) elements[fieldId].value = typeof value === "number" ? assistantNumberFormatter.format(value) : value;
  return Object.keys(patch);
}

export function parseBrazilianNumber(rawValue) {
  const value = String(rawValue ?? "").trim().replace(/\s/g, "");
  if (value === "") return { status: "empty", value: null };
  const commaCount = (value.match(/,/g) || []).length;
  const normalized = commaCount === 1 ? value.replace(/\./g, "").replace(",", ".") : value;
  if (commaCount > 1 || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return { status: "invalid", value: null };
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? { status: "valid", value: numeric } : { status: "invalid", value: null };
}

export function readAssistantRateContext(elements) {
  return Object.fromEntries(ASSISTANT_COMBINED_RATE_FIELDS.flatMap((fieldId) => {
    const parsed = parseBrazilianNumber(elements[fieldId]?.value);
    return parsed.status === "valid" && parsed.value >= 0 && parsed.value < 100 ? [[fieldId, parsed.value]] : [];
  }));
}

/** Safe current values used only by the backend to preserve manual inputs over AI estimates. */
export function readAssistantFieldContext(elements) {
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

export function validatePricingForm(elements) {
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

export function renderPricingErrors(elements, errors, visibleFieldIds = null) {
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

export function clearPricingInputs(elements) {
  for (const fieldId of PRICING_FIELD_IDS) if (elements[fieldId]) elements[fieldId].value = "";
  for (const [fieldId, value] of Object.entries(OPTION_DEFAULTS)) if (elements[fieldId]) elements[fieldId].value = value;
  ["ncmCode", "taxRegime", "originState", "destinationState", "cfop", "taxSituation", "customerType", "operationPurpose"].forEach((fieldId) => {
    if (elements[fieldId]) elements[fieldId].value = "";
  });
}

export function applySavedInputs(savedInputs, elements, emptyOptionalFields = []) {
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
export function migrateLegacyV6Inputs(legacy = {}) {
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
export function migrateLegacyV5Inputs(legacy = {}) {
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
