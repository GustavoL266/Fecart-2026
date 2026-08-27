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
  const product = {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    costPrice: Number(row.cost_price),
    additionalCosts: Number(row.additional_costs),
    profitMargin: Number(row.profit_margin),
    suggestedPrice: Number(row.suggested_price),
    marketplace: row.marketplace,
    consultationDate: row.consultation_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (includeCalculation) product.calculationData = row.calculation_data || {};
  return product;
}
