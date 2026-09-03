import assert from "node:assert/strict";
import test from "node:test";
import { FISCALHUB_BASE_URL, getFiscalHubConfig, taxHealth } from "../lib/config.js";
import { fiscalHubErrorForClient, FiscalHubClient, FiscalHubError, redactFiscalHubSensitiveData } from "../lib/fiscalhub-client.js";
import { FiscalHubNcmProvider } from "../lib/fiscalhub-ncm-provider.js";
import { FiscalHubTaxProvider, normalizeFiscalHubTaxResponse } from "../lib/fiscalhub-tax-provider.js";
import { TaxService } from "../js/services/tax-service.js";

function response(status, body = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

function clientWith(fetchImpl, options = {}) {
  return new FiscalHubClient({
    apiKey: "fh_test_chave-ficticia",
    baseUrl: FISCALHUB_BASE_URL,
    fetchImpl,
    logger: { info() {}, warn() {} },
    maxRetries: 0,
    ...options,
  });
}

const successfulPayload = {
  totais: {
    valorIcms: 210,
    valorIpi: 0,
    valorPis: 32.5,
    valorCofins: 150,
    valorDifal: 48,
    valorIbsUf: 0.5,
    valorIbsMun: 0.5,
    valorCbs: 9,
    valorTotalNota: 1_240.5,
  },
};

test("configura FiscalHub sem expor credenciais no health", () => {
  const missing = getFiscalHubConfig({});
  assert.equal(missing.isConfigured, false);
  assert.equal(missing.companyConfigured, false);
  assert.deepEqual(taxHealth(missing), { provider: "FiscalHub", configured: false, companyConfigured: false });

  const configured = getFiscalHubConfig({ FISCALHUB_API_KEY: " segredo ", FISCALHUB_EMPRESA_ID: " empresa-uuid " });
  assert.equal(configured.apiKey, "segredo");
  assert.equal(configured.companyId, "empresa-uuid");
  assert.deepEqual(taxHealth(configured), { provider: "FiscalHub", configured: true, companyConfigured: true });
  assert.equal(JSON.stringify(taxHealth(configured)).includes("segredo"), false);
  assert.equal(JSON.stringify(taxHealth(configured)).includes("empresa-uuid"), false);
});

test("exige API Key somente no backend", () => {
  assert.throws(() => new FiscalHubClient({ apiKey: "" }), {
    code: "FISCALHUB_NOT_CONFIGURED",
    status: 503,
  });
});

test("envia o maior preço uma única vez ao endpoint oficial", async () => {
  let captured;
  const client = clientWith(async (url, options) => {
    captured = { url, options };
    return response(200, successfulPayload);
  });
  const provider = new FiscalHubTaxProvider({ client, companyId: "empresa-uuid", logger: { info() {} } });
  const result = await provider.calculate({
    ncm: "0901.21.00",
    quantity: 1,
    unitValue: 1_000,
    originState: "sp",
    destinationState: "rj",
  });

  assert.equal(captured.url, "https://api.fiscalhub.com.br/api/v1/tributario/calcular");
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers["X-Api-Key"], "fh_test_chave-ficticia");
  assert.deepEqual(JSON.parse(captured.options.body), {
    empresaId: "empresa-uuid",
    ufOrigem: "SP",
    ufDestino: "RJ",
    itens: [{ ncm: "09012100", quantidade: 1, valorUnitario: 1_000 }],
  });
  assert.equal(result.total, 1_240.5);
  assert.equal(result.marketPrice, 1_000);
  assert.deepEqual(result.taxes.map(({ label }) => label), ["ICMS", "IPI", "PIS", "COFINS", "DIFAL", "IBS-UF", "IBS-Mun", "CBS"]);
});

test("empresaId ausente produz o código específico sem fazer request", async () => {
  let calls = 0;
  const provider = new FiscalHubTaxProvider({
    client: { async request() { calls += 1; } },
    companyId: "",
  });
  await assert.rejects(() => provider.calculate({ ncm: "09012100", unitValue: 100, originState: "SP", destinationState: "SP" }), {
    code: "FISCALHUB_EMPRESA_NOT_CONFIGURED",
    status: 503,
  });
  assert.equal(calls, 0);
});

test("rejeita NCM ausente, UF inválida e quantidade diferente de um antes da API", async (context) => {
  const provider = new FiscalHubTaxProvider({ client: { async request() {} }, companyId: "empresa-uuid" });
  await context.test("NCM", async () => {
    await assert.rejects(() => provider.calculate({ unitValue: 100, originState: "SP", destinationState: "SP" }), { code: "NCM_REQUIRED", status: 400 });
  });
  await context.test("UF", async () => {
    await assert.rejects(() => provider.calculate({ ncm: "09012100", unitValue: 100, originState: "XX", destinationState: "SP" }), { code: "INVALID_TAX_CONTEXT", status: 400 });
  });
  await context.test("quantidade", async () => {
    await assert.rejects(() => provider.calculate({ ncm: "09012100", quantity: 2, unitValue: 100, originState: "SP", destinationState: "SP" }), { code: "INVALID_TAX_CONTEXT", status: 400 });
  });
});

test("preserva os status públicos relevantes da FiscalHub", async (context) => {
  for (const [status, code] of [
    [400, "FISCALHUB_INVALID_OPERATION"],
    [401, "FISCALHUB_UNAUTHORIZED"],
    [403, "FISCALHUB_FORBIDDEN"],
    [404, "FISCALHUB_NOT_FOUND"],
    [500, "FISCALHUB_ERROR"],
  ]) {
    await context.test(String(status), async () => {
      const client = clientWith(async () => response(status, { detalhe: "não deve vazar" }));
      await assert.rejects(() => client.request("/api/v1/tributario/calcular", { method: "POST", body: {} }), { code, status });
    });
  }
});

test("não soma automaticamente tributos granulares antigos e IBS/CBS", () => {
  assert.throws(() => normalizeFiscalHubTaxResponse({
    totais: { valorIcms: 18, valorPis: 1.65, valorCofins: 7.6, valorIbsUf: 0.05, valorIbsMun: 0.05, valorCbs: 0.9 },
  }, 100), { code: "FISCALHUB_TOTAL_NOT_PROVIDED", status: 502 });
});

test("aceita total tributário explícito como composição segura", () => {
  const normalized = normalizeFiscalHubTaxResponse({
    totais: { valorIcms: 18, valorTotalTributos: 20 },
  }, 100);
  assert.equal(normalized.taxTotal, 20);
  assert.equal(normalized.total, 120);
});

test("reutiliza cálculo idêntico no cache", async () => {
  let calls = 0;
  const provider = new FiscalHubTaxProvider({
    client: { async request() { calls += 1; return successfulPayload; } },
    companyId: "empresa-uuid",
    logger: { info() {} },
  });
  const input = { ncm: "09012100", unitValue: 1_000, originState: "SP", destinationState: "SP" };
  assert.equal((await provider.calculate(input)).cached, false);
  assert.equal((await provider.calculate(input)).cached, true);
  assert.equal(calls, 1);
});

test("busca NCM por descrição sem selecionar classificação", async () => {
  const provider = new FiscalHubNcmProvider({ client: { async request(path) {
    assert.equal(path, "/api/v1/ncm/buscar?q=iPhone%2017%20Pro%20Max");
    return { resultados: [
      { codigo: "85171300", descricao: "Telefones inteligentes" },
      { codigo: "85177900", descricao: "Outras partes" },
    ] };
  } } });
  const result = await provider.search("iPhone 17 Pro Max");
  assert.equal(result.results.length, 2);
  assert.equal(Object.hasOwn(result, "selected"), false);
});

test("serviço do navegador envia somente uma unidade e reaproveita o preço recebido", async () => {
  const calls = [];
  const service = new TaxService({ apiClient: {
    async post(path, body, options) { calls.push({ path, body, options }); return { calculation: { total: 130 } }; },
    async get() { return {}; },
  } });
  await service.calculateMaximum({ ncm: "09012100", originState: "SP", destinationState: "RJ", unitValue: 100 });
  assert.deepEqual(calls[0], {
    path: "/tax/calculate",
    body: { ncm: "09012100", originState: "SP", destinationState: "RJ", quantity: 1, unitValue: 100 },
    options: { handleUnauthorized: false },
  });
});

test("segredos nunca aparecem em logs públicos ou mensagens", async () => {
  const secret = "fh_live_segredo-ficticio";
  const logs = [];
  const client = new FiscalHubClient({
    apiKey: secret,
    fetchImpl: async () => response(401, { mensagem: secret }),
    logger: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    maxRetries: 0,
  });
  let thrown;
  try {
    await client.request("/api/v1/tributario/calcular", { method: "POST", body: {} });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof FiscalHubError);
  assert.equal(JSON.stringify(logs).includes(secret), false);
  assert.equal(JSON.stringify(fiscalHubErrorForClient(thrown, [secret])).includes(secret), false);
  assert.equal(redactFiscalHubSensitiveData(`X-Api-Key: ${secret}`, [secret]), "X-Api-Key: [REDACTED]");
});
