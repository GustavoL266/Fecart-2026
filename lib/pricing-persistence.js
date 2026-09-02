import { calculatePricing, FORMULA_VERSION, PRICING_SCHEMA_VERSION, PricingValidationError } from "../js/domain/pricing-calculator.js";
import { buildCalculationMemory, ConfiguredTaxRuleEngine, fiscalDataForStorage } from "../js/domain/tax-rule-engine.js";

function finitePositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function sanitizedProduct(value) {
  if (!value || typeof value !== "object") return null;
  const price = finitePositive(value.price);
  if (!price || !String(value.id || "").trim() || !String(value.title || "").trim()) return null;
  return {
    id: String(value.id), title: String(value.title), price,
    source: String(value.source || "Marketplace"), seller: String(value.seller || value.source || "Marketplace"),
    currency: String(value.currency || "BRL"), category: String(value.category || ""),
    image: String(value.image || ""), url: String(value.url || ""), consultedAt: String(value.consultedAt || ""),
    ...(Number.isFinite(Number(value.rating)) ? { rating: Number(value.rating) } : {}),
    ...(Number.isInteger(Number(value.reviews)) && Number(value.reviews) >= 0 ? { reviews: Number(value.reviews) } : {}),
  };
}

function sanitizedStats(value) {
  if (!value || typeof value !== "object") return null;
  const stats = Object.fromEntries(["min", "max", "average", "median"].map((key) => [key, finitePositive(value[key])]));
  if (Object.values(stats).some((number) => number === null)) return null;
  return { ...stats, count: Number.isInteger(value.count) && value.count > 0 ? value.count : null };
}

export function marketReferenceFromRequest(market, inputs) {
  const rule = market?.rule || "manual";
  const base = { rule, query: String(market?.query || ""), marketplace: String(market?.marketplace || ""), provider: String(market?.provider || "") };
  if (rule === "manual") return inputs.marketPrice ? { ...base, price: inputs.marketPrice, source: "manual" } : null;
  const selectedProduct = sanitizedProduct(market?.selectedProduct);
  const stats = sanitizedStats(market?.stats);
  if (rule === "selected-product" && selectedProduct) return { ...base, price: selectedProduct.price, source: selectedProduct.source, selectedProduct, stats };
  if (rule === "market-average" && stats) return { ...base, price: stats.average, source: market?.marketplace || "Google Shopping", stats };
  if (rule === "market-median" && stats) return { ...base, price: stats.median, source: market?.marketplace || "Google Shopping", stats };
  // Sem uma referência verificável, mercado permanece ausente; ele nunca invalida o cálculo técnico.
  return null;
}

function sanitizedFocusState(fiscalValidation, fiscalContext) {
  const code = String(fiscalContext?.ncmCode || "");
  if (!fiscalValidation || typeof fiscalValidation !== "object" || fiscalValidation.status !== "success" || fiscalValidation.source !== "Focus NFe" || fiscalValidation.code !== code) {
    return { status: "idle", ncm: null, source: "", environment: "", checkedAt: "", unavailable: false };
  }
  const ncm = fiscalValidation.ncm;
  if (!ncm || String(ncm.codigo || "") !== code) return { status: "idle", ncm: null, source: "", environment: "", checkedAt: "", unavailable: false };
  return { status: "success", ncm, source: "Focus NFe", environment: String(fiscalValidation.environment || ""), checkedAt: String(fiscalValidation.checkedAt || ""), unavailable: false };
}

export function authoritativeProductSnapshot(payload) {
  let result;
  try {
    // O request nunca fornece result/suggestedPrice/margem: eles são todos gerados aqui.
    result = calculatePricing(payload.pricing.inputs, null);
  } catch (error) {
    if (error instanceof PricingValidationError) throw error;
    throw error;
  }
  const marketReference = marketReferenceFromRequest(payload.pricing.market, result.inputs);
  result = calculatePricing(result.inputs, marketReference);
  const assessment = new ConfiguredTaxRuleEngine().assess(result.inputs, sanitizedFocusState(payload.pricing.fiscalValidation, result.inputs.fiscalContext));
  const memory = buildCalculationMemory(result, assessment);
  const calculationData = {
    pricingSchemaVersion: PRICING_SCHEMA_VERSION,
    formulaVersion: FORMULA_VERSION,
    inputs: result.inputs,
    emptyOptionalFields: payload.pricing.emptyOptionalFields || [],
    pricingResult: result,
    fiscal: fiscalDataForStorage(assessment, memory),
    market: result.market.reference ? { ...result.market.reference, priceUsed: result.market.price, consultedAt: result.market.reference.selectedProduct?.consultedAt || new Date().toISOString() } : { rule: "none", priceUsed: null },
    summarySemantics: {
      costPrice: "directCost", additionalCosts: "indirectCost + financialCost", suggestedPrice: "technicalPrice", profitMargin: "desiredNetMargin",
    },
  };
  return {
    name: payload.name,
    description: payload.description,
    category: payload.category,
    // Colunas legadas continuam apenas como resumo compatível; a memória oficial está no JSONB v6.
    costPrice: result.directCost,
    additionalCosts: result.indirectCost + result.financialCost,
    profitMargin: result.desiredNetMargin * 100,
    suggestedPrice: result.technicalPrice,
    marketplace: result.market.source || "Sem referência de mercado",
    calculationData,
  };
}
