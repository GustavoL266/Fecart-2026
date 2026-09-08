export const FISCAL_BRAZIL_STATES = Object.freeze([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]);

export function normalizeFiscalState(value) {
  return typeof value === "string" ? value.replace(/\s+/g, "").toUpperCase() : "";
}

export function isValidFiscalState(value) {
  return FISCAL_BRAZIL_STATES.includes(normalizeFiscalState(value));
}
