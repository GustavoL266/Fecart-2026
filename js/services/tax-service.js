import { api } from "./api-client.js";
import { normalizeFiscalState, isValidFiscalState } from "../domain/fiscal-context.js";

const taxMessages = Object.freeze({
  NCM_REQUIRED: ["Classificação fiscal necessária", "Confirme um NCM relacionado à categoria atual para calcular os tributos."],
  FOCUS_NFE_NCM_CONFIRMATION_REQUIRED: ["Classificação fiscal necessária", "Confirme o NCM relacionado à categoria atual para calcular os tributos."],
  NCM_CLASSIFICATION_REQUIRED: ["Classificação fiscal necessária", "Pesquise a categoria e confirme uma sugestão atual."],
  NCM_IRRELEVANT: ["Classificação fiscal inválida", "A descrição do NCM não corresponde à categoria atual."],
  FISCALHUB_NOT_CONFIGURED: ["Chave FiscalHub não configurada", "A chave de acesso da FiscalHub precisa ser configurada no servidor."],
  FISCALHUB_EMPRESA_NOT_CONFIGURED: ["Empresa FiscalHub não configurada", "Configure a empresa da FiscalHub para calcular os tributos."],
  FISCALHUB_UNAUTHORIZED: ["Erro de autenticação FiscalHub", "A FiscalHub recusou a chave de acesso."],
  FISCALHUB_FORBIDDEN: ["Sem permissão na FiscalHub", "A empresa ou o recurso não está autorizado na FiscalHub."],
  FISCALHUB_NOT_FOUND: ["Empresa/recurso não encontrado", "A empresa ou o recurso não foi encontrado na FiscalHub."],
  INVALID_TAX_CONTEXT: ["Revise os dados fiscais", "Revise o NCM, as UFs e o maior preço."],
  INVALID_TAX_UF: ["Informe UF de origem e destino", "Selecione UF de origem e UF de destino válidas."],
  FISCALHUB_INVALID_OPERATION: ["Revise os dados fiscais", "A FiscalHub rejeitou os dados da operação."],
  FISCALHUB_REJECTED: ["Revise os dados fiscais", "A FiscalHub informou dados fiscais insuficientes ou inválidos."],
  FISCALHUB_ERROR: ["Erro na FiscalHub", "A FiscalHub não conseguiu concluir o cálculo."],
  FISCALHUB_TOTAL_NOT_PROVIDED: ["Total final não informado", "A FiscalHub não informou um total final seguro; a resposta não permite somar os impostos ao preço."],
  FISCALHUB_INVALID_RESPONSE: ["Resposta inválida da FiscalHub", "A FiscalHub retornou dados em formato inesperado."],
  FISCALHUB_BAD_GATEWAY: ["Resposta inesperada da FiscalHub", "A FiscalHub retornou um status inesperado."],
  FISCALHUB_TIMEOUT: ["FiscalHub demorou a responder", "Tente calcular novamente em instantes."],
  FISCALHUB_UNAVAILABLE: ["Falha de conexão com a FiscalHub", "Não foi possível conectar à FiscalHub."],
  FISCALHUB_RATE_LIMITED: ["Limite de consultas FiscalHub", "Aguarde antes de tentar novamente."],
  SESSION_REQUIRED: ["Sessão expirada", "Sua sessão expirou. Entre novamente."],
});

export function marketTaxError(error) {
  const code = error?.code || "";
  const [shortMessage, message] = taxMessages[code] || ["Não foi possível calcular", "Tente novamente em instantes."];
  return { code, shortMessage, message: error?.message || message };
}

export function marketTaxPrerequisiteError(context, unitValue, availability) {
  if (!context.ncmConfirmed || !/^\d{8}$/.test(context.ncm || "")) return marketTaxError({ code: "NCM_REQUIRED" });
  const issues = [];
  if (availability?.companyConfigured === false) issues.push(marketTaxError({ code: "FISCALHUB_EMPRESA_NOT_CONFIGURED" }));
  if (availability?.configured === false) issues.push(marketTaxError({ code: "FISCALHUB_NOT_CONFIGURED" }));
  const fields = [];
  if (!isValidFiscalState(context.originState)) fields.push("Selecione uma UF de origem brasileira válida.");
  if (!isValidFiscalState(context.destinationState)) fields.push("Selecione uma UF de destino brasileira válida.");
  if (fields.length) issues.push(marketTaxError({ code: "INVALID_TAX_UF", message: fields.join(" ") }));
  if (!Number.isFinite(unitValue) || unitValue <= 0) issues.push(marketTaxError({ code: "INVALID_TAX_CONTEXT", message: "Informe um maior preço válido e positivo." }));
  return issues.length ? { ...issues[0], message: issues.map((issue) => issue.message).join(" ") } : null;
}

export class TaxService {
  #api;

  constructor({ apiClient = api } = {}) {
    this.#api = apiClient;
  }

  calculateMaximum({ ncm, originState, destinationState, unitValue, classificationId, originalQuery, normalizedQuery }) {
    return this.#api.post("/tax/calculate", {
      ncm,
      originState: normalizeFiscalState(originState),
      destinationState: normalizeFiscalState(destinationState),
      quantity: 1,
      unitValue,
      classificationId,
      originalQuery,
      normalizedQuery,
    });
  }
}
