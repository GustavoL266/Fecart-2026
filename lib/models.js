export function userForClient(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function productForClient(row, includeCalculation = true) {
  const marketplace = ["Amazon", "Manual"].includes(row.marketplace)
    ? row.marketplace
    : "Manual (registro anterior)";
  const product = {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    costPrice: Number(row.cost_price),
    additionalCosts: Number(row.additional_costs),
    profitMargin: Number(row.profit_margin),
    suggestedPrice: Number(row.suggested_price),
    marketplace,
    consultationDate: row.consultation_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (includeCalculation) {
    const calculationData = row.calculation_data || {};
    const market = calculationData.market;
    product.calculationData = market && !["manual", "amazon-median"].includes(market.source)
      ? { ...calculationData, market: { source: "manual" } }
      : calculationData;
  }
  return product;
}
