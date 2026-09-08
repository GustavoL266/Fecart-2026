import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { getFiscalHubConfig } from "../lib/config.js";
import { FiscalHubClient, FiscalHubError, fiscalHubErrorForClient } from "../lib/fiscalhub-client.js";
import { FiscalHubTaxProvider, normalizeFiscalHubTaxResponse } from "../lib/fiscalhub-tax-provider.js";
import { taxCalculationSchema } from "../lib/validation.js";
import { marketTaxError, marketTaxPrerequisiteError } from "../js/services/tax-service.js";
import { renderIncompleteDashboard } from "../js/ui/dashboard.js";

const [serverSource, mainSource] = await Promise.all([
  readFile(new URL("../server.js", import.meta.url), "utf8"),
  readFile(new URL("../js/main.js", import.meta.url), "utf8"),
]);
const validInput = { ncm: "09012100", quantity: 1, unitValue: 280, originState: "SP", destinationState: "RJ" };
const configuredEnv = { FISCALHUB_API_KEY: "  fh_test_fixture-secret  ", FISCALHUB_EMPRESA_ID: "  fixture-company-id  " };
const finalPayload = { totais: { valorIcms: 50.4, valorTotalNota: 310 } };

// Executa o handler real, isolando somente autenticação/banco e o transporte externo.
function taxRoute({ env = configuredEnv, upstreamStatus = 200, payload = finalPayload } = {}) {
  const logs = [];
  const calls = [];
  const logger = { info: (value) => logs.push(value), warn: (value) => logs.push(value) };
  const config = getFiscalHubConfig(env);
  const client = config.isConfigured ? new FiscalHubClient({ apiKey: config.apiKey, logger, maxRetries: 0, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { ok: upstreamStatus >= 200 && upstreamStatus < 300, status: upstreamStatus, json: async () => payload };
  } }) : null;
  const provider = client ? new FiscalHubTaxProvider({ client, companyId: config.companyId, logger }) : null;
  let handler;
  vm.runInNewContext(serverSource.slice(serverSource.indexOf('app.post("/tax/calculate"'), serverSource.indexOf('app.get("/products"')), {
    app: { post: (_path, _auth, _limiter, callback) => { handler = callback; } },
    requireAuth() {}, taxCalculationLimiter() {}, console: logger,
    taxCalculationSchema, FiscalHubError, fiscalHubConfig: config, taxProvider: provider,
  });
  return { logs, calls, async request(body = validInput, confirmedNcm = validInput.ncm) {
    let result;
    await handler({ body, session: { confirmedNcm } }, { json: (value) => { result = { status: 200, body: value }; } }, (error) => {
      result = { status: error.status, body: fiscalHubErrorForClient(error, [config.apiKey, config.companyId]) };
    });
    return result;
  } };
}

test("rota reproduz a configuração real: chave presente e empresa ausente, sem request", async () => {
  const route = taxRoute({ env: { FISCALHUB_API_KEY: configuredEnv.FISCALHUB_API_KEY } });
  const result = await route.request();
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "FISCALHUB_EMPRESA_NOT_CONFIGURED");
  assert.match(result.body.error, /FISCALHUB_EMPRESA_ID/);
  assert.equal(route.calls.length, 0);
  assert.ok(route.logs.includes("[Tax] upstreamStatus=not_called"));
});

test("rota valida todos os pré-requisitos antes de alcançar o provider", async (t) => {
  const cases = [
    ["chave", validInput, { FISCALHUB_EMPRESA_ID: configuredEnv.FISCALHUB_EMPRESA_ID }, validInput.ncm, "FISCALHUB_NOT_CONFIGURED"],
    ["NCM ausente", { ...validInput, ncm: "" }, configuredEnv, validInput.ncm, "NCM_REQUIRED"],
    ["NCM sem confirmação", validInput, configuredEnv, "", "FOCUS_NFE_NCM_CONFIRMATION_REQUIRED"],
    ["NCM diferente do confirmado", { ...validInput, ncm: "09012200" }, configuredEnv, validInput.ncm, "FOCUS_NFE_NCM_CONFIRMATION_REQUIRED"],
    ...["0901.21.00", "09012100 ", " 09012100", "0901x2100", "0901 2100", "0901210", 9012100].map((ncm) => [`NCM ${ncm}`, { ...validInput, ncm }, configuredEnv, validInput.ncm, "NCM_REQUIRED"]),
    ...[0, -1, null, "280", Infinity, NaN].map((unitValue) => [`preço ${unitValue}`, { ...validInput, unitValue }, configuredEnv, validInput.ncm, "INVALID_TAX_CONTEXT"]),
    ...["originState", "destinationState"].flatMap((field) => ["", "XX", "São Paulo"].map((value) => [`${field} ${value}`, { ...validInput, [field]: value }, configuredEnv, validInput.ncm, "INVALID_TAX_CONTEXT"])),
    ["quantidade", { ...validInput, quantity: 2 }, configuredEnv, validInput.ncm, "INVALID_TAX_CONTEXT"],
  ];
  for (const [label, body, env, confirmedNcm, code] of cases) await t.test(label, async () => {
    const route = taxRoute({ env });
    const result = await route.request(body, confirmedNcm);
    assert.equal(result.body.code, code);
    assert.equal(route.calls.length, 0);
  });
  const result = await taxRoute({ env: {} }).request({}, "");
  for (const field of [/NCM/, /UF de origem/, /UF de destino/, /maior preço/, /FISCALHUB_API_KEY/, /FISCALHUB_EMPRESA_ID/]) assert.match(result.body.error, field);
});

test("rota envia quantidade 1 e maior 280, lê o total final e registra diagnóstico seguro", async () => {
  const route = taxRoute();
  const result = await route.request({ ...validInput, originState: " sp ", destinationState: " rj " });
  assert.equal(result.status, 200);
  assert.equal(result.body.calculation.total, 310);
  assert.equal(result.body.calculation.marketPrice, 280);
  assert.equal(route.calls.length, 1);
  const [{ url, options }] = route.calls;
  assert.equal(url, "https://api.fiscalhub.com.br/api/v1/tributario/calcular");
  assert.equal(options.headers["X-Api-Key"], "fh_test_fixture-secret");
  assert.equal(options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(options.body), { empresaId: "fixture-company-id", ufOrigem: "SP", ufDestino: "RJ", itens: [{ ncm: "09012100", quantidade: 1, valorUnitario: 280 }] });
  for (const entry of ["requested=true", "configured=true", "companyConfigured=true", "ncmConfirmed=true", "origin=SP", "destination=RJ", "price=280", "upstreamStatus=200"]) assert.ok(route.logs.includes(`[Tax] ${entry}`), entry);
  assert.doesNotMatch(JSON.stringify(route.logs), /fixture-secret|fixture-company-id/);
});

test("status reais do transporte simulado preservam erro e mensagem específica até o card", async (t) => {
  for (const [status, code, label] of [
    [400, "FISCALHUB_INVALID_OPERATION", "Revise os dados fiscais"],
    [401, "FISCALHUB_UNAUTHORIZED", "Erro de autenticação FiscalHub"],
    [403, "FISCALHUB_FORBIDDEN", "Sem permissão na FiscalHub"],
    [404, "FISCALHUB_NOT_FOUND", "Empresa/recurso não encontrado"],
    [422, "FISCALHUB_REJECTED", "Revise os dados fiscais"],
    [500, "FISCALHUB_ERROR", "Erro na FiscalHub"],
    [503, "FISCALHUB_ERROR", "Erro na FiscalHub"],
  ]) await t.test(String(status), async () => {
    const route = taxRoute({ upstreamStatus: status, payload: { message: "fh_test_fixture-secret fixture-company-id" } });
    const result = await route.request();
    assert.equal(result.status, status);
    assert.equal(result.body.code, code);
    assert.equal(marketTaxError(result.body).shortMessage, label);
    assert.ok(route.logs.includes(`[Tax] upstreamStatus=${status}`));
    assert.doesNotMatch(JSON.stringify([result, route.logs]), /fixture-secret|fixture-company-id/);
  });
});

test("200 sem total final conserva o status observado e não inventa preço tributado", async () => {
  const route = taxRoute({ payload: { totais: { valorIcms: 50.4, valorTotalTributos: 50.4 } } });
  const result = await route.request();
  assert.equal(result.status, 502);
  assert.equal(result.body.code, "FISCALHUB_TOTAL_NOT_PROVIDED");
  assert.ok(route.logs.includes("[Tax] upstreamStatus=200"));
  assert.equal(route.logs.includes("[Tax] upstreamStatus=not_called"), false);
});

test("total final não converte null, vazio, booleano ou array em preço zero", () => {
  for (const total of [null, "", " ", true, false, [], {}, -1, NaN, Infinity]) {
    assert.throws(() => normalizeFiscalHubTaxResponse({ valorFinal: total }, 280), { code: "FISCALHUB_TOTAL_NOT_PROVIDED" });
  }
  assert.equal(normalizeFiscalHubTaxResponse({ valorFinal: "310.50", valorTotalTributos: 100 }, 280).total, 310.5);
  assert.equal(normalizeFiscalHubTaxResponse({ valorTotalNota: 0 }, 280).total, 0);
});

test("cache separa NCM, UFs e qualquer alteração de preço sem arredondar a chave", async () => {
  const route = taxRoute();
  await route.request();
  assert.equal((await route.request()).body.calculation.cached, true);
  for (const body of [
    { ...validInput, unitValue: 280.001 },
    { ...validInput, ncm: "09012200" },
    { ...validInput, originState: "MG" },
    { ...validInput, destinationState: "MG" },
  ]) assert.equal((await route.request(body, body.ncm)).body.calculation.cached, false);
  assert.equal(route.calls.length, 5);
});

function frontend() {
  const calls = [];
  const context = vm.createContext({
    state: { taxAvailability: { configured: true, companyConfigured: true } },
    focusState: { status: "success", ncm: { codigo: validInput.ncm } },
    elements: { ncmCode: { value: validInput.ncm }, originState: { value: "SP" }, destinationState: { value: "RJ" } },
    marketState: { items: [{ id: "low", price: 100 }, { id: "high", price: 280 }, { id: "mid", price: 200 }], stats: { min: 100, max: 280, average: 193.33, median: 200 }, tax: { status: "idle" } },
    marketTaxError, marketTaxPrerequisiteError,
    taxService: { calculateMaximum(input) { return new Promise((resolve, reject) => calls.push({ input, resolve, reject })); } },
    $: () => ({ focus() {} }),
    render() { context.marketStateForRender(); },
  });
  for (const name of ["emptyMarketTaxState", "currentMarketTaxContext", "marketTaxSignature", "marketStateForRender", "maximumMarketItem", "setMarketTaxError", "calculateMaximumTaxes"]) {
    const start = mainSource.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
    assert.ok(start >= 0, name);
    const remainder = mainSource.slice(start);
    const next = remainder.slice(1).search(/\n(?:async )?function /);
    vm.runInContext(next < 0 ? remainder : remainder.slice(0, next + 1), context);
  }
  return { context, calls };
}

test("navegador usa exclusivamente o maior, mantém mercado intacto e recebe sucesso", async () => {
  const { context, calls } = frontend();
  const before = JSON.stringify([context.marketState.items, context.marketState.stats]);
  const pending = context.calculateMaximumTaxes();
  assert.equal(calls[0].input.unitValue, 280);
  calls[0].resolve({ calculation: { total: 310 } });
  await pending;
  assert.equal(context.marketState.tax.result.total, 310);
  assert.equal(context.marketState.tax.status, "success");
  assert.equal(JSON.stringify([context.marketState.items, context.marketState.stats]), before);
});

const changes = [
  ["preço", (c) => { c.marketState.items[1].price = 290; }],
  ["NCM", (c) => { c.elements.ncmCode.value = "09012200"; c.focusState.ncm.codigo = "09012200"; }],
  ["origem", (c) => { c.elements.originState.value = "MG"; }],
  ["destino", (c) => { c.elements.destinationState.value = "MG"; }],
  ["confirmação", (c) => { c.focusState.status = "loading"; }],
];
for (const [label, change] of changes) {
  test(`mudança de ${label} apaga sucesso anterior`, async () => {
    const { context, calls } = frontend();
    const pending = context.calculateMaximumTaxes();
    calls[0].resolve({ calculation: { total: 310 } });
    await pending;
    change(context);
    context.marketStateForRender();
    assert.equal(context.marketState.tax.result, null);
    assert.equal(context.marketState.tax.status, "idle");
  });
  test(`mudança de ${label} ignora resposta ou erro em andamento`, async () => {
    for (const fail of [false, true]) {
      const { context, calls } = frontend();
      const pending = context.calculateMaximumTaxes();
      change(context);
      context.marketStateForRender();
      if (fail) calls[0].reject({ code: "FISCALHUB_UNAUTHORIZED" });
      else calls[0].resolve({ calculation: { total: 310 } });
      await pending;
      assert.equal(context.marketState.tax.result, null);
      assert.equal(context.marketState.tax.status, "idle");
    }
  });
}

test("mudar UF e voltar à original não permite que uma chamada velha substitua a nova", async () => {
  const { context, calls } = frontend();
  const old = context.calculateMaximumTaxes();
  context.elements.originState.value = "MG";
  context.marketStateForRender();
  context.elements.originState.value = "SP";
  context.marketStateForRender();
  const current = context.calculateMaximumTaxes();
  calls[1].resolve({ calculation: { total: 320 } });
  await current;
  calls[0].resolve({ calculation: { total: 310 } });
  await old;
  assert.equal(context.marketState.tax.result.total, 320);
});

test("card distingue pré-requisitos, mostra instrução exata e bloqueia request inválido", async () => {
  for (const [change, label, detail] of [
    [(c) => { c.state.taxAvailability.companyConfigured = false; }, "Empresa FiscalHub não configurada", "empresa"],
    [(c) => { c.state.taxAvailability.configured = false; }, "Chave FiscalHub não configurada", "chave"],
    [(c) => { c.focusState.status = "idle"; }, "NCM necessário", "NCM"],
    [(c) => { c.elements.originState.value = "XX"; }, "Revise os dados fiscais", "UF de origem"],
    [(c) => { c.elements.destinationState.value = ""; }, "Revise os dados fiscais", "UF de destino"],
  ]) {
    const { context, calls } = frontend();
    change(context);
    await context.calculateMaximumTaxes();
    assert.equal(calls.length, 0);
    assert.equal(context.marketState.tax.shortMessage, label);
    const nodes = new Map();
    const document = { querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, { classList: { toggle() {} }, setAttribute() {} });
      return nodes.get(selector);
    } };
    context.marketState.status = "success";
    renderIncompleteDashboard(document, context.marketStateForRender(), {});
    assert.ok(nodes.get("#marketStats").innerHTML.includes(label));
    assert.ok(nodes.get("#marketTaxDetails").innerHTML.includes(detail));
  }
});
