import { CATEGORY_PRESETS, PERCENTAGE_FIELDS } from "../config/pricing.js";
import { clamp } from "../utils/formatters.js";

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

export function readInputs(elements) {
  return {
    productType: elements.productType.selectedOptions[0].textContent,
    materialsCost: numberValue(elements.materialsCost),
    waste: clamp(numberValue(elements.waste), 0, 100) / 100,
    packagingCost: numberValue(elements.packagingCost),
    deliveryCost: numberValue(elements.deliveryCost),
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
  };
}

export function applyCategoryPreset(category, elements) {
  const preset = category === "outros" ? averagePreset() : CATEGORY_PRESETS[category];

  Object.entries(preset).forEach(([field, value]) => {
    elements[field].value = PERCENTAGE_FIELDS.has(field) ? String(value).replace(".", ",") : value;
  });
}

export function applySavedInputs(savedInputs, elements) {
  if (!savedInputs || typeof savedInputs !== "object") return false;

  const categoryOption = [...elements.productType.options].find((option) => option.textContent === savedInputs.productType);
  if (categoryOption) elements.productType.value = categoryOption.value;

  Object.entries(savedInputs).forEach(([field, value]) => {
    if (!elements[field] || !Number.isFinite(value)) return;
    const displayValue = PERCENTAGE_FIELDS.has(field) ? value * 100 : value;
    elements[field].value = String(Number(displayValue.toFixed(4))).replace(".", ",");
  });

  return true;
}

export function isAboveCompetitorLimit(elements) {
  return numberValue(elements.competitorAverage) > 1000000;
}
