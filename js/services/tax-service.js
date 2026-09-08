import { api } from "./api-client.js";

const taxMessages = Object.freeze({
  NCM_REQUIRED: ["NCM necessário", "Confirme um NCM com 8 dígitos, sem espaços ou outros caracteres."],
  FOCUS_NFE_NCM_CONFIRMATION_REQUIRED: ["NCM necessário", "Confirme o NCM para calcular os tributos."],
  FISCALHUB_NOT_CONFIGURED: ["Chave FiscalHub não configurada", "A chave de acesso da FiscalHub precisa ser configurada no servidor."],
  FISCALHUB_EMPRESA_NOT_CONFIGURED: ["Empresa FiscalHub não configurada", "A empresa para cálculo tributário precisa ser configurada no servidor."],
  FISCALHUB_UNAUTHORIZED: ["Erro de autenticação FiscalHub", "A FiscalHub recusou a chave de acesso."],
  FISCALHUB_FORBIDDEN: ["Sem permissão na FiscalHub", "A empresa ou o recurso não está autorizado na FiscalHub."],
  FISCALHUB_NOT_FOUND: ["Empresa/recurso não encontrado", "A empresa ou o recurso não foi encontrado na FiscalHub."],
  INVALID_TAX_CONTEXT: ["Revise os dados fiscais", "Revise o NCM, as UFs e o maior preço."],
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
  const validState = /^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/;
  const fields = [];
  if (!validState.test(context.originState || "")) fields.push("Informe uma UF de origem brasileira válida.");
  if (!validState.test(context.destinationState || "")) fields.push("Informe uma UF de destino brasileira válida.");
  if (!Number.isFinite(unitValue) || unitValue <= 0) fields.push("Informe um maior preço válido e positivo.");
  if (fields.length) issues.push(marketTaxError({ code: "INVALID_TAX_CONTEXT", message: fields.join(" ") }));
  return issues.length ? { ...issues[0], message: issues.map((issue) => issue.message).join(" ") } : null;
}

export class TaxService {
  #api;

  constructor({ apiClient = api } = {}) {
    this.#api = apiClient;
  }

  calculateMaximum({ ncm, originState, destinationState, unitValue }) {
    return this.#api.post("/tax/calculate", {
      ncm,
      originState,
      destinationState,
      quantity: 1,
      unitValue,
    });
  }
}
