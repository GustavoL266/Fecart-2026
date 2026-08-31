export const REQUIRED_FISCAL_FIELDS = Object.freeze([
  ["taxRegime", "regime tributário"],
  ["originState", "UF de origem"],
  ["destinationState", "UF de destino"],
  ["cfop", "CFOP"],
  ["taxSituation", "CST/CSOSN"],
  ["customerType", "tipo de cliente"],
  ["operationPurpose", "finalidade da operação"],
]);

export const TAXES_REQUIRING_EXTERNAL_RULES = Object.freeze([
  "ICMS",
  "ICMS-ST",
  "DIFAL",
  "FCP",
  "IPI",
  "PIS/COFINS",
  "IBS/CBS/IS e demais regras da reforma tributária",
]);

export class TaxRuleEngine {
  assess() {
    throw new Error("O motor tributário deve implementar assess().");
  }
}

export class ConfiguredTaxRuleEngine extends TaxRuleEngine {
  assess(inputs, focusState = {}) {
    const fiscalContext = inputs.fiscalContext || {};
    const missingFields = REQUIRED_FISCAL_FIELDS
      .filter(([key]) => !String(fiscalContext[key] || "").trim())
      .map(([, label]) => label);
    const ncmVerified = focusState.status === "success" && focusState.ncm?.codigo === fiscalContext.ncmCode;
    const focusUnavailable = focusState.unavailable === true;

    return {
      automaticCalculation: false,
      complete: false,
      focusUnavailable,
      fiscalContext,
      missingFields,
      ncm: focusState.ncm || (fiscalContext.ncmCode ? { codigo: fiscalContext.ncmCode } : null),
      ncmSource: ncmVerified ? "Focus NFe" : fiscalContext.ncmCode ? "Usuário (não validado)" : "Não informado",
      taxes: [
        {
          key: "aggregate",
          label: "Carga tributária agregada estimada",
          rate: inputs.taxRate,
          source: "Usuário/regra configurada",
        },
      ],
      unresolvedTaxes: TAXES_REQUIRING_EXTERNAL_RULES,
      warnings: [
        "A Focus NFe confirma apenas a classificação NCM; ela não calcula os tributos desta venda.",
        "O NCM isolado não determina a tributação aplicável.",
        "A carga tributária agregada deve ser validada por contador ou especialista fiscal antes do uso operacional.",
      ],
    };
  }
}

export function buildCalculationMemory(inputs, result, assessment) {
  const priceCents = result.minimumPriceCents || 0;
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const rateDescription = (rate) => `Base ${money.format(priceCents / 100)} | alíquota ${(rate * 100).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;

  return [
    { group: "Custo", label: "Custo do produto com perdas", valueCents: result.costs.materialsWithWasteCents, basis: "Custo informado + perda", source: "Usuário" },
    { group: "Custo", label: "Embalagem", valueCents: result.costs.packagingCostCents, basis: "Valor por venda", source: "Usuário" },
    { group: "Custo", label: "Frete/entrega", valueCents: result.costs.deliveryCostCents, basis: "Valor por venda", source: "Usuário" },
    { group: "Custo", label: "Seguro", valueCents: result.costs.insuranceCostCents, basis: "Valor por venda", source: "Usuário" },
    { group: "Custo", label: "Desconto", valueCents: -result.costs.discountAmountCents, basis: "Redução do custo", source: "Usuário" },
    { group: "Custo", label: "Despesas adicionais", valueCents: result.costs.otherExpensesCents, basis: "Valor por venda", source: "Usuário" },
    { group: "Custo", label: "Mão de obra direta", valueCents: result.costs.directLaborCents, basis: "176 h produtivas/mês", source: "Regra configurada" },
    { group: "Custo", label: "Capital de giro", valueCents: result.costs.workingCapitalCostCents, basis: "Prazos informados", source: "Usuário + regra configurada" },
    { group: "Custo", label: "Rateio de custos fixos", valueCents: result.costs.fixedCostAllocationCents, basis: "Volume mensal informado", source: "Usuário + regra configurada" },
    { group: "Tributo", label: assessment.taxes[0].label, valueCents: result.taxExpensesCents, basis: rateDescription(inputs.taxRate), baseCents: priceCents, rate: inputs.taxRate, source: assessment.taxes[0].source },
    { group: "Venda", label: "Taxa de pagamento", valueCents: result.paymentFeeCents, basis: rateDescription(inputs.paymentFeeRate), baseCents: priceCents, rate: inputs.paymentFeeRate, source: "Usuário" },
    { group: "Venda", label: "Comissão", valueCents: result.commissionCents, basis: rateDescription(inputs.commissionRate), baseCents: priceCents, rate: inputs.commissionRate, source: "Usuário" },
    { group: "Margem", label: "Margem líquida", valueCents: result.profitPerSaleCents, basis: rateDescription(inputs.margin), baseCents: priceCents, rate: inputs.margin, source: "Usuário" },
    { group: "Resultado", label: "Preço sugerido", valueCents: priceCents, basis: "Custo-base ÷ percentual disponível", source: "Regra configurada" },
  ];
}

export function fiscalDataForStorage(assessment, memory) {
  return {
    automaticCalculation: assessment.automaticCalculation,
    complete: assessment.complete,
    context: assessment.fiscalContext,
    missingFields: assessment.missingFields,
    ncm: assessment.ncm,
    ncmSource: assessment.ncmSource,
    unresolvedTaxes: assessment.unresolvedTaxes,
    memory: memory.map((item) => ({ ...item, value: item.valueCents / 100, base: item.baseCents === undefined ? undefined : item.baseCents / 100 })),
  };
}
