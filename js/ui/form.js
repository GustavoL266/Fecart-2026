import { PERCENTAGE_FIELDS } from "../config/pricing.js";

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

export const PRICING_FIELD_IDS = Object.freeze(Object.keys(PRICING_FIELD_RULES));

export function parseBrazilianNumber(rawValue) {
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

export function validatePricingForm(elements) {
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

export function renderPricingErrors(elements, errors, visibleFieldIds = null) {
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

export function applySavedInputs(savedInputs, elements, emptyOptionalFields = []) {
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
