import { PRODUCTIVE_HOURS_PER_WORKER_MONTH } from "../config/pricing.js";

const RATE_SCALE = 1_000_000;

export function toCents(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

export function fromCents(value) {
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

export function calculateCosts(inputs) {
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

export function calculatePrice(inputs) {
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
