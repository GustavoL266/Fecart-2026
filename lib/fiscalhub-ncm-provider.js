import { FiscalHubError } from "./fiscalhub-client.js";

function resultList(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["resultados", "itens", "items", "data"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return null;
}

function normalizeNcm(item) {
  const code = String(item?.codigo || item?.ncm || "").replace(/\D/g, "");
  const description = String(item?.descricao || item?.descricao_completa || "").trim();
  if (!/^\d{8}$/.test(code) || !description) return null;
  return {
    code,
    description,
    cest: item.cest ?? null,
    ipiRate: Number.isFinite(Number(item.aliquotaIpi)) ? Number(item.aliquotaIpi) : null,
    unit: item.unidadeMedida || null,
  };
}

export class FiscalHubNcmProvider {
  #cache;
  #cacheTtlMs;
  #client;

  constructor({ client, cacheTtlMs = 24 * 60 * 60 * 1_000 } = {}) {
    if (!client?.request) throw new TypeError("Um cliente FiscalHub é obrigatório.");
    this.#cache = new Map();
    this.#cacheTtlMs = cacheTtlMs;
    this.#client = client;
  }

  async search(description) {
    const query = String(description || "").trim().replace(/\s+/g, " ").slice(0, 120);
    if (query.length < 3) {
      throw new FiscalHubError("Informe uma descrição com pelo menos 3 caracteres para pesquisar NCM.", {
        code: "INVALID_NCM_QUERY",
        status: 400,
      });
    }
    const cacheKey = query.toLocaleLowerCase("pt-BR");
    const cached = this.#cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (cached) this.#cache.delete(cacheKey);

    const payload = await this.#client.request(`/api/v1/ncm/buscar?q=${encodeURIComponent(query)}`);
    const list = resultList(payload);
    if (!list) {
      throw new FiscalHubError("A FiscalHub retornou sugestões de NCM em formato inesperado.", {
        code: "FISCALHUB_INVALID_RESPONSE",
        status: 502,
      });
    }
    const results = list.map(normalizeNcm).filter(Boolean).slice(0, 10);
    const value = { query, results, source: "FiscalHub" };
    this.#cache.set(cacheKey, { expiresAt: Date.now() + this.#cacheTtlMs, value });
    return value;
  }
}

export function createFiscalHubNcmProvider(client, dependencies = {}) {
  return new FiscalHubNcmProvider({ client, ...dependencies });
}
