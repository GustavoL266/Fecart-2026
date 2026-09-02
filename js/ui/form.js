import { validatePricingInputs } from "../domain/pricing-calculator.js";

export const PERCENTAGE_FIELDS = new Set([
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

export const PRICING_FIELD_IDS = Object.freeze(Object.keys(FIELD_RULES));
export const CAPACITY_FIELD_IDS = Object.freeze(["workerCount", "productiveHoursPerWorkerMonth", "unitsPerWorkerHour"]);

export function parseBrazilianNumber(rawValue) {
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

export function validatePricingForm(elements) {
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

export function renderPricingErrors(elements, errors, visibleFieldIds = null) {
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

export function clearPricingInputs(elements) {
  for (const fieldId of [...PRICING_FIELD_IDS, ...CAPACITY_FIELD_IDS]) {
    if (elements[fieldId]) elements[fieldId].value = "";
  }
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
export function migrateLegacyV5Inputs(legacy = {}) {
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
