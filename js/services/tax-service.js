import { api } from "./api-client.js";

const taxMessages = Object.freeze({
  NCM_REQUIRED: ["NCM necessário", "Confirme um NCM relacionado à categoria atual para estimar os tributos."],
  FOCUS_NFE_NCM_CONFIRMATION_REQUIRED: ["NCM necessário", "Confirme o NCM relacionado à categoria atual para estimar os tributos."],
  NCM_CLASSIFICATION_REQUIRED: ["NCM necessário", "Pesquise a categoria e confirme uma sugestão atual."],
  NCM_IRRELEVANT: ["Classificação fiscal inválida", "A descrição do NCM não corresponde à categoria atual."],
  PRODUCT_ORIGIN_REQUIRED: ["Origem do produto necessária", "Selecione se o produto é nacional ou importado."],
  IBPT_NCM_NOT_FOUND: ["NCM não encontrado na tabela IBPT", "O NCM confirmado não existe na versão local da tabela IBPT."],
  IBPT_NOT_CONFIGURED: ["Tabela IBPT não configurada", "O arquivo da tabela IBPT não foi encontrado no servidor."],
  IBPT_INVALID_FILE: ["Não foi possível carregar a tabela tributária", "O arquivo IBPT está ausente ou possui formato inválido."],
  INVALID_TAX_CONTEXT: ["Revise os dados da estimativa", "Revise o NCM, a origem do produto e o maior preço."],
  TAX_RATE_LIMITED: ["Muitas estimativas tributárias", "Aguarde um minuto e tente novamente."],
  SESSION_REQUIRED: ["Sessão expirada", "Sua sessão expirou. Entre novamente."],
});

export function marketTaxError(error) {
  const code = error?.code || "";
  const [shortMessage, message] = taxMessages[code] || ["Não foi possível estimar", "Tente novamente em instantes."];
  return { code, shortMessage, message: error?.message || message };
}

export function marketTaxPrerequisiteError(context, unitValue, availability) {
  if (!context.ncmConfirmed || !/^\d{8}$/.test(context.ncm || "")) return marketTaxError({ code: "NCM_REQUIRED" });
  if (!["nacional", "importado"].includes(context.productOrigin)) return marketTaxError({ code: "PRODUCT_ORIGIN_REQUIRED" });
  if (availability?.configured === false) return marketTaxError({ code: availability.errorCode || "IBPT_NOT_CONFIGURED" });
  if (!Number.isFinite(unitValue) || unitValue <= 0) return marketTaxError({ code: "INVALID_TAX_CONTEXT", message: "Informe um maior preço válido e positivo." });
  return null;
}

export class TaxService {
  #api;

  constructor({ apiClient = api } = {}) {
    this.#api = apiClient;
  }

  calculateMaximum({ ncm, productOrigin, unitValue, classificationId, originalQuery, normalizedQuery }) {
    return this.#api.post("/tax/estimate", {
      ncm,
      productOrigin,
      unitValue,
      classificationId,
      originalQuery,
      normalizedQuery,
    });
  }
}
