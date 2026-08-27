import { PRODUCTIVE_HOURS_PER_WORKER_MONTH } from "../config/pricing.js";

export function calculateCosts(inputs) {
  const materialsWithWaste = inputs.materialsCost * (1 + inputs.waste);
  const laborHourlyCost = inputs.totalPayroll / (inputs.workerCount * PRODUCTIVE_HOURS_PER_WORKER_MONTH);
  const monthlyProductionCapacity = inputs.workerCount * inputs.outputPerWorkerHour * PRODUCTIVE_HOURS_PER_WORKER_MONTH;
  const directLabor = inputs.totalPayroll / monthlyProductionCapacity;
  const directCashCost = materialsWithWaste + inputs.packagingCost + inputs.deliveryCost + directLabor;
  const cashGapDays = Math.max(inputs.receiveDays - inputs.payDays, 0);
  const workingCapitalCost = directCashCost * inputs.capitalRate * (cashGapDays / 30);
  const fixedCostAllocation = inputs.monthlyFixedCosts / inputs.monthlyVolume;
  const baseCost = directCashCost + workingCapitalCost + fixedCostAllocation;
  const salesRate = inputs.taxRate + inputs.paymentFeeRate + inputs.commissionRate;

  return {
    materialsWithWaste,
    laborHourlyCost,
    directLabor,
    monthlyProductionCapacity,
    directCashCost,
    cashGapDays,
    workingCapitalCost,
    fixedCostAllocation,
    baseCost,
    salesRate,
  };
}

export function calculatePrice(inputs) {
  const costs = calculateCosts(inputs);
  const availableRate = 1 - costs.salesRate - inputs.margin;
  const isValid = availableRate > Number.EPSILON;
  const minimumPrice = isValid ? Math.ceil((costs.baseCost / availableRate) * 100) / 100 : null;
  const salesExpenses = isValid ? minimumPrice * costs.salesRate : 0;
  const profitPerSale = isValid ? minimumPrice - costs.baseCost - salesExpenses : 0;
  const actualMargin = isValid ? profitPerSale / minimumPrice : 0;
  const marketGap = isValid ? (inputs.competitorAverage - minimumPrice) / inputs.competitorAverage : 0;
  const marketCostLimit = Math.max(0, inputs.competitorAverage * availableRate);
  const requiredCostReduction = Math.max(0, costs.baseCost - marketCostLimit);

  return {
    costs,
    availableRate,
    isValid,
    minimumPrice,
    salesExpenses,
    profitPerSale,
    actualMargin,
    marketGap,
    marketCostLimit,
    requiredCostReduction,
  };
}
