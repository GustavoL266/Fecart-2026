import { FiscalHubError } from "./fiscalhub-client.js";
import { FISCAL_BRAZIL_STATES, normalizeFiscalState } from "../js/domain/fiscal-context.js";

const NCM_CODE = /^\d{8}$/;
const BRAZIL_STATES = new Set(FISCAL_BRAZIL_STATES);
const TAX_FIELDS = Object.freeze([
  ["valorIcms", "ICMS"],
  ["valorIpi", "IPI"],
  ["valorPis", "PIS"],
  ["valorCofins", "COFINS"],
  ["valorDifal", "DIFAL"],
  ["valorIcmsSt", "ICMS-ST"],
  ["valorFcp", "FCP"],
  ["valorIbs", "IBS"],
  ["valorIbsUf", "IBS-UF"],
  ["valorIbsMun", "IBS-Mun"],
  ["valorCbs", "CBS"],
]);

function finiteNumber(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value))) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function ownNumber(object, keys) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) continue;
    const value = finiteNumber(object[key]);
    if (value !== null) return value;
  }
  return null;
}

function normalizeState(value, fieldName) {
  const state = normalizeFiscalState(value);
  if (!BRAZIL_STATES.has(state)) {
    throw new FiscalHubError(`Informe uma ${fieldName} válida.`, {
      code: "INVALID_TAX_CONTEXT",
      status: 400,
    });
  }
  return state;
}

export function normalizeFiscalHubTaxResponse(payload, marketPrice) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new FiscalHubError("A FiscalHub retornou dados tributários em formato inesperado.", {
      code: "FISCALHUB_INVALID_RESPONSE",
      status: 502,
    });
  }

  const totals = payload.totais && typeof payload.totais === "object" && !Array.isArray(payload.totais)
    ? payload.totais
    : payload;
  const taxes = TAX_FIELDS.flatMap(([key, label]) => {
    if (!Object.prototype.hasOwnProperty.call(totals, key)) return [];
    const value = finiteNumber(totals[key]);
    return value === null ? [] : [{ key, label, value }];
  });
  const explicitFinalTotal = ownNumber(payload, ["valorTotalNota", "totalComTributos", "valorFinal"])
    ?? ownNumber(totals, ["valorTotalNota", "totalComTributos", "valorFinal"]);
  const explicitTaxTotal = ownNumber(payload, ["valorTotalTributos", "totalTributos", "valorTributos"])
    ?? ownNumber(totals, ["valorTotalTributos", "totalTributos", "valorTributos"]);
  // Um total de tributos pode incluir impostos por dentro. A documentação não
  // define esse agregado como acréscimo ao preço; só aceitamos o total final.
  const total = explicitFinalTotal;

  if (total === null || total < 0) {
    throw new FiscalHubError(
      "A FiscalHub retornou os tributos, mas não informou um total final que possa ser usado sem duplicar impostos.",
      { code: "FISCALHUB_TOTAL_NOT_PROVIDED", status: 502 },
    );
  }

  return {
    marketPrice,
    taxTotal: explicitTaxTotal ?? Math.max(0, total - marketPrice),
    taxes,
    total,
  };
}

export class FiscalHubTaxProvider {
  #cache;
  #cacheMaxEntries;
  #cacheTtlMs;
  #client;
  #companyId;
  #logger;

  constructor({ client, companyId, logger = console, cacheTtlMs = 5 * 60 * 1_000, cacheMaxEntries = 100 } = {}) {
    if (!client?.request) throw new TypeError("Um cliente FiscalHub é obrigatório.");
    this.#cache = new Map();
    this.#cacheMaxEntries = cacheMaxEntries;
    this.#cacheTtlMs = cacheTtlMs;
    this.#client = client;
    this.#companyId = String(companyId || "").trim();
    this.#logger = logger;
  }

  async calculate({ ncm, quantity = 1, unitValue, originState, destinationState } = {}) {
    if (!this.#companyId) {
      throw new FiscalHubError("Configure a empresa utilizada para o cálculo tributário.", {
        code: "FISCALHUB_EMPRESA_NOT_CONFIGURED",
        status: 503,
      });
    }
    const normalizedNcm = typeof ncm === "string" ? ncm : "";
    if (!NCM_CODE.test(normalizedNcm)) {
      throw new FiscalHubError("Informe e confirme um NCM com exatamente 8 dígitos.", {
        code: "NCM_REQUIRED",
        status: 400,
      });
    }
    const normalizedOrigin = normalizeState(originState, "UF de origem");
    const normalizedDestination = normalizeState(destinationState, "UF de destino");
    if (quantity !== 1) {
      throw new FiscalHubError("A Consulta de Mercado calcula uma unidade do produto de maior valor.", {
        code: "INVALID_TAX_CONTEXT",
        status: 400,
      });
    }
    const normalizedUnitValue = typeof unitValue === "number" ? finiteNumber(unitValue) : null;
    if (normalizedUnitValue === null || normalizedUnitValue <= 0) {
      throw new FiscalHubError("O preço do produto de maior valor é inválido.", {
        code: "INVALID_TAX_CONTEXT",
        status: 400,
      });
    }

    const cacheKey = [this.#companyId, normalizedNcm, normalizedUnitValue, normalizedOrigin, normalizedDestination].join("|");
    const cached = this.#cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.#logger.info?.("[FiscalHub] Cache hit", { ncm: normalizedNcm });
      return { ...cached.value, cached: true };
    }
    if (cached) this.#cache.delete(cacheKey);

    this.#logger.info?.("[FiscalHub] Calculating taxes");
    this.#logger.info?.(`[FiscalHub] NCM: ${normalizedNcm}`);
    this.#logger.info?.(`[FiscalHub] Origin: ${normalizedOrigin}`);
    this.#logger.info?.(`[FiscalHub] Destination: ${normalizedDestination}`);
    const payload = await this.#client.request("/api/v1/tributario/calcular", {
      method: "POST",
      body: {
        empresaId: this.#companyId,
        ufOrigem: normalizedOrigin,
        ufDestino: normalizedDestination,
        itens: [{ ncm: normalizedNcm, quantidade: 1, valorUnitario: normalizedUnitValue }],
      },
    });
    const normalized = {
      ...normalizeFiscalHubTaxResponse(payload, normalizedUnitValue),
      cached: false,
      destinationState: normalizedDestination,
      ncm: normalizedNcm,
      originState: normalizedOrigin,
      provider: "FiscalHub",
      quantity: 1,
    };

    if (this.#cache.size >= this.#cacheMaxEntries) {
      const oldestKey = this.#cache.keys().next().value;
      if (oldestKey) this.#cache.delete(oldestKey);
    }
    this.#cache.set(cacheKey, { expiresAt: Date.now() + this.#cacheTtlMs, value: normalized });
    return normalized;
  }
}

export function createFiscalHubTaxProvider(config, client, dependencies = {}) {
  return new FiscalHubTaxProvider({ client, companyId: config.companyId, ...dependencies });
}
