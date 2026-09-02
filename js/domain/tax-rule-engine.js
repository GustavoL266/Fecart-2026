export const REQUIRED_FISCAL_FIELDS = Object.freeze([
  ["taxRegime", "regime tributário"], ["originState", "UF de origem"], ["destinationState", "UF de destino"],
  ["cfop", "CFOP"], ["taxSituation", "CST/CSOSN"], ["customerType", "tipo de cliente"], ["operationPurpose", "finalidade da operação"],
]);

export const TAXES_REQUIRING_EXTERNAL_RULES = Object.freeze([
  "ICMS", "ICMS-ST", "DIFAL", "FCP", "IPI", "PIS/COFINS", "IBS/CBS/IS e demais regras da reforma tributária",
]);

export class TaxRuleEngine {
  assess() { throw new Error("O motor tributário deve implementar assess()."); }
}

export class ConfiguredTaxRuleEngine extends TaxRuleEngine {
  assess(inputs, focusState = {}) {
    const fiscalContext = inputs.fiscalContext || {};
    const missingFields = REQUIRED_FISCAL_FIELDS.filter(([key]) => !String(fiscalContext[key] || "").trim()).map(([, label]) => label);
    const code = String(fiscalContext.ncmCode || "");
    const ncmVerified = focusState.status === "success" && focusState.source === "Focus NFe" && focusState.ncm?.codigo === code;
    const ncm = ncmVerified ? focusState.ncm : code ? { codigo: code } : null;
    return {
      automaticCalculation: false,
      complete: false,
      focusUnavailable: focusState.unavailable === true,
      fiscalContext,
      missingFields,
      ncm,
      ncmSource: ncmVerified ? "Focus NFe" : code ? "Usuário (não validado nesta simulação)" : "Não informado",
      ncmValidation: ncmVerified ? {
        status: "success", source: "Focus NFe", environment: focusState.environment || "não informado", checkedAt: focusState.checkedAt || new Date().toISOString(), code,
      } : { status: "unverified", source: code ? "Usuário" : null, environment: null, checkedAt: null, code: code || null },
      taxes: [{ key: "aggregate", label: "Carga tributária estimada manualmente", rate: inputs.taxRate, source: "Usuário" }],
      unresolvedTaxes: TAXES_REQUIRING_EXTERNAL_RULES,
      warnings: [
        "A Focus NFe confirma somente a classificação NCM; ela não calcula os tributos desta venda.",
        "O NCM isolado não determina a tributação aplicável.",
        "A carga tributária estimada manualmente deve ser validada por contador ou especialista fiscal.",
      ],
    };
  }
}

// Memória, tabela e gráficos recebem exatamente os valores que o cálculo produziu.
export function buildCalculationMemory(result, assessment) {
  return result.breakdown.map((item) => ({ ...item, fiscalSource: item.key === "taxAmount" ? assessment.taxes[0].source : item.source }));
}

export function fiscalDataForStorage(assessment, memory) {
  return {
    automaticCalculation: false,
    complete: false,
    context: assessment.fiscalContext,
    ncm: assessment.ncm,
    ncmSource: assessment.ncmSource,
    ncmValidation: assessment.ncmValidation,
    unresolvedTaxes: assessment.unresolvedTaxes,
    memory,
  };
}
