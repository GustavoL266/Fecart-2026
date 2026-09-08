import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import { ApiError } from "../js/services/api-client.js";
import { TaxService, marketTaxError, marketTaxPrerequisiteError } from "../js/services/tax-service.js";
import { normalizeProductForFiscalSearch, isRelevantFiscalNcm } from "../js/domain/fiscal-classification.js";
import { normalizeFiscalState, FISCAL_BRAZIL_STATES } from "../js/domain/fiscal-context.js";
import { searchFiscalNcms, confirmFiscalNcm, hasRelevantFiscalConfirmation } from "../lib/fiscal-classification.js";
import { FocusNFeClient, FocusNFeError } from "../lib/focus-nfe-client.js";
import { FiscalHubClient, FiscalHubError } from "../lib/fiscalhub-client.js";
import { FiscalHubTaxProvider } from "../lib/fiscalhub-tax-provider.js";
import { getFiscalHubConfig } from "../lib/config.js";
import { ncmSearchSchema, taxCalculationSchema, validate } from "../lib/validation.js";
import { renderIncompleteDashboard } from "../js/ui/dashboard.js";

const [serverSource, mainSource, html] = await Promise.all(["../server.js", "../js/main.js", "../index.html"].map(async (path) => (await readFile(new URL(path, import.meta.url), "utf8")).replace(/\r\n/g, "\n")));
// Fixtures simuladas: nenhum código é derivado de uma marca na implementação.
const phone = { codigo: "85171300", descricao_completa: "Smartphones" };
const food = { codigo: "19059090", descricao_completa: "Produtos de padaria, pastelaria e confeitaria" };

function workflow({ companyConfigured = true, fiscalStatus = 200, confirmedDescription = phone, searchResults = [food, phone], confirmDelay, taxDelay } = {}) {
  const routes = new Map();
  const logs = [];
  const external = [];
  const session = {};
  const requests = [];
  const marketQueries = [];
  const logger = { info: (line) => logs.push(line), warn: (line) => logs.push(line) };
  const focusNfeClient = new FocusNFeClient({ token: "fixture-focus-token", baseUrl: "https://homologacao.focusnfe.com.br", logger, maxRetries: 0, fetchImpl: async (url) => {
    external.push({ provider: "FocusNFe", url });
    if (!url.includes("?")) await confirmDelay;
    return { ok: true, status: 200, json: async () => url.includes("?") ? searchResults : confirmedDescription };
  } });
  const fiscalHubConfig = getFiscalHubConfig({ FISCALHUB_API_KEY: " fixture-fiscal-key ", FISCALHUB_EMPRESA_ID: companyConfigured ? " fixture-company " : "" });
  const fiscalHubClient = new FiscalHubClient({ apiKey: fiscalHubConfig.apiKey, logger, maxRetries: 0, fetchImpl: async (url, options) => {
    external.push({ provider: "FiscalHub", url, options });
    await taxDelay;
    return { ok: fiscalStatus === 200, status: fiscalStatus, json: async () => ({ totais: { valorIcms: 100, valorTotalNota: 9100 } }) };
  } });
  const taxProvider = new FiscalHubTaxProvider({ client: fiscalHubClient, companyId: fiscalHubConfig.companyId, logger });
  vm.runInNewContext(serverSource.slice(serverSource.indexOf('app.get("/fiscal/ncms/search"'), serverSource.indexOf('app.get("/products"')), {
    app: Object.fromEntries(["get", "post"].map((method) => [method, (path, _auth, _limit, callback) => routes.set(`${method} ${path}`, callback)])),
    requireAuth() {}, fiscalLookupLimiter() {}, taxCalculationLimiter() {}, sessionSave: async () => {},
    focusNfeClient, focusNfeConfig: { environment: "homologation", token: "fixture-focus-token" }, fiscalHubConfig, taxProvider,
    FocusNFeError, FiscalHubError, randomUUID, ncmSearchSchema, taxCalculationSchema, validate,
    searchFiscalNcms: (client, input, options) => searchFiscalNcms(client, input, { ...options, logger }),
    confirmFiscalNcm, hasRelevantFiscalConfirmation, console: logger,
  });
  const api = { async get(path) { return request("get", path); }, async post(path, body) { return request("post", path, body); } };
  async function request(method, path, body) {
    requests.push({ method, path, body });
    const url = new URL(path, "https://local.test");
    const route = url.pathname.startsWith("/fiscal/ncms/") && url.pathname !== "/fiscal/ncms/search" ? "/fiscal/ncms/:codigo" : url.pathname;
    let result;
    let error;
    await routes.get(`${method} ${route}`)({ body, session, query: Object.fromEntries(url.searchParams), params: { codigo: url.pathname.split("/").at(-1) } }, { json: (value) => { result = value; } }, (caught) => { error = caught; });
    if (error) throw new ApiError(error.message, error.status, error.code);
    return result;
  }
  const nodes = new Map();
  function node() { return { value: "", textContent: "", innerHTML: "", hidden: false, children: [], listeners: {}, classList: { toggle() {} }, dataset: {}, setAttribute(name, value) { this[name] = value; }, replaceChildren() { this.children = []; }, append(...children) { this.children.push(...children); }, focus() {}, addEventListener(event, callback) { (this.listeners[event] ||= []).push(callback); } }; }
  const document = { querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); }, createElement: node };
  const $ = (selector) => document.querySelector(selector);
  const elements = Object.fromEntries(["ncmCode", "originState", "destinationState", "taxRegime", "cfop", "taxSituation", "customerType", "operationPurpose"].map((id) => [id, $(`#${id}`)]));
  const context = vm.createContext({
    $, document, elements, state: { taxAvailability: { configured: true, companyConfigured } },
    ncmSearchRevision: 0, ncmLookupRevision: 0, marketSearchRevision: 0,
    normalizeProductForFiscalSearch, isRelevantFiscalNcm, normalizeFiscalState, marketTaxError, marketTaxPrerequisiteError, ApiError,
    taxService: new TaxService({ apiClient: api }), api,
    market: { async search(query) {
      marketQueries.push(query);
      return { query, items: [{ id: "min", title: "Menor", price: 100 }, { id: "max", title: "Maior", price: 8899 }, { id: "mid", title: "Intermediário", price: 700 }], stats: { count: 3, min: 100, max: 8899, average: 3233, median: 700 } };
    } },
    render() { context.renderNcmState(); renderIncompleteDashboard(document, context.marketStateForRender(), {}); },
    setMarketError(_query, error) { throw error; },
  });
  for (const name of ["emptyFocusState", "emptyNcmSearchState", "emptyMarketState", "emptyMarketTaxState", "currentFiscalClassification", "prepareFiscalClassification", "currentMarketTaxContext", "marketTaxSignature", "marketStateForRender", "maximumMarketItem", "messageFor", "ncmSearchErrorMessage", "renderNcmState", "searchNcmSuggestions", "lookupNcm", "resetNcmClassification", "setMarketTaxError", "maybeCalculateMaximumTaxes", "calculateMaximumTaxes", "searchMarket"]) {
    const start = mainSource.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
    assert.ok(start >= 0, name);
    const remainder = mainSource.slice(start);
    const next = remainder.slice(1).search(/\n(?:async )?function /);
    vm.runInContext(next < 0 ? remainder : remainder.slice(0, next + 1), context);
  }
  const apiMessages = mainSource.match(/const apiMessages = Object\.freeze\([\s\S]*?\n\}\);/)?.[0];
  vm.runInContext(apiMessages, context);
  context.focusState = context.emptyFocusState();
  context.ncmSearchState = context.emptyNcmSearchState();
  context.marketState = context.emptyMarketState();
  const ufEvents = mainSource.slice(mainSource.indexOf("[\n  elements.taxRegime"), mainSource.indexOf('$("#ncmSearchButton").addEventListener'));
  assert.match(ufEvents, /addEventListener/);
  vm.runInContext(ufEvents, context);
  async function begin(query = "iPhone 15 Pro Max") {
    $("#marketQuery").value = query;
    await context.searchMarket();
    await settle(() => context.ncmSearchState.status !== "loading");
  }
  function selectUf(field, value) {
    elements[field].value = value;
    for (const event of ["input", "change"]) for (const callback of elements[field].listeners[event]) callback();
  }
  return { context, api, external, session, nodes, requests, marketQueries, logs, begin, selectUf, $ };
}

async function settle(done) {
  for (let index = 0; index < 30 && !done(); index += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(done(), "O fluxo não concluiu");
}

test("fluxo completo usa categoria, confirmação explícita, SP → SP e exclusivamente o maior", async () => {
  const w = workflow();
  await w.begin();
  assert.deepEqual(w.marketQueries, ["iPhone 15 Pro Max"]);
  assert.equal(w.$("#ncmProductQuery").value, "telefone celular smartphone");
  assert.equal(w.$("#fiscalOriginalProduct").textContent, "iPhone 15 Pro Max");
  assert.equal(w.context.ncmSearchState.results.length, 1);
  assert.equal(w.context.focusState.status, "idle");
  assert.equal(w.session.confirmedNcm, undefined);
  assert.equal(w.external.filter((r) => r.provider === "FiscalHub").length, 0);
  assert.ok(w.$("#marketStats").innerHTML.includes("Classificação fiscal necessária"));
  const originalStats = JSON.stringify(w.context.marketState.stats);
  await w.context.lookupNcm(phone.codigo);
  assert.equal(w.context.currentMarketTaxContext().ncmConfirmed, true);
  assert.ok(w.$("#marketStats").innerHTML.includes("Informe UF de origem e destino"));
  assert.equal(w.external.filter((r) => r.provider === "FiscalHub").length, 0);
  w.selectUf("originState", "SP");
  w.selectUf("destinationState", "SP");
  await settle(() => w.context.marketState.tax.status === "success");
  const taxCalls = w.external.filter((r) => r.provider === "FiscalHub");
  assert.equal(taxCalls.length, 1, "input/change não duplicam a chamada");
  assert.deepEqual(JSON.parse(taxCalls[0].options.body), { empresaId: "fixture-company", ufOrigem: "SP", ufDestino: "SP", itens: [{ ncm: phone.codigo, quantidade: 1, valorUnitario: 8899 }] });
  assert.equal(taxCalls[0].options.headers["X-Api-Key"], "fixture-fiscal-key");
  assert.equal(taxCalls[0].options.headers.Authorization, undefined);
  const request = w.requests.find((r) => r.method === "post").body;
  assert.equal(request.originState, w.context.elements.originState.value);
  assert.equal(request.destinationState, w.context.elements.destinationState.value);
  assert.equal(w.context.marketState.tax.result.total, 9100);
  assert.equal(w.context.marketState.items[1].price, 8899);
  assert.equal(JSON.stringify(w.context.marketState.stats), originalStats);
  assert.match(w.$("#marketStats").innerHTML, /9\.100,00/);
  assert.match(w.$("#marketStats").innerHTML, /Calculado pela FiscalHub/);
  for (const log of ["ncmValid=true", "ncmConfirmed=true", "origin=SP", "destination=SP", "price=8899", "requestStarted=true", "upstreamStatus=200"]) assert.ok(w.logs.includes(`[Tax] ${log}`));
  assert.doesNotMatch(w.logs.join("|"), /fixture-fiscal-key|fixture-company|fixture-focus-token/);
});

test("alimento não aparece nem pode ser confirmado para celular, mesmo forçando o endpoint", async () => {
  const w = workflow();
  await w.begin();
  const id = w.context.ncmSearchState.classificationId;
  assert.equal(w.context.ncmSearchState.results.some((r) => r.code === food.codigo), false);
  await w.context.lookupNcm(food.codigo);
  assert.equal(w.context.currentMarketTaxContext().ncmConfirmed, false);
  await assert.rejects(() => w.api.get(`/fiscal/ncms/${food.codigo}?classificationId=${id}`), { code: "NCM_CLASSIFICATION_REQUIRED" });
  assert.equal(w.session.confirmedNcm, undefined);
  assert.equal(w.external.some((r) => r.provider === "FiscalHub"), false);
});

test("descrição incompatível na confirmação não gera ✓ nem libera FiscalHub", async () => {
  const w = workflow({ confirmedDescription: { ...phone, descricao_completa: "Preparações alimentícias diversas" } });
  await w.begin();
  await w.context.lookupNcm(phone.codigo);
  assert.equal(w.context.currentMarketTaxContext().ncmConfirmed, false);
  assert.doesNotMatch(w.$("#ncmLookupStatus").textContent, /✓/);
  assert.equal(w.session.confirmedNcm, undefined);
  assert.equal(w.external.some((r) => r.provider === "FiscalHub"), false);
});

test("mudar categoria invalida NCM/total e backend rejeita prova de categoria diferente", async () => {
  const w = workflow();
  await w.begin();
  w.selectUf("originState", "SP");
  w.selectUf("destinationState", "SP");
  await w.context.lookupNcm(phone.codigo);
  await settle(() => w.context.marketState.tax.status === "success");
  const input = w.requests.find((r) => r.method === "post").body;
  for (const changed of [{ normalizedQuery: "bolo" }, { originalQuery: "Bolo de chocolate" }, { classificationId: "outdated" }]) await assert.rejects(() => w.api.post("/tax/calculate", { ...input, ...changed }), { code: "FOCUS_NFE_NCM_CONFIRMATION_REQUIRED" });
  w.$("#ncmProductQuery").value = "bolo de chocolate";
  w.context.resetNcmClassification();
  assert.equal(w.context.currentMarketTaxContext().ncmConfirmed, false);
  assert.equal(w.context.marketState.tax.result, null);
  assert.equal(w.$("#ncmProductQuery").readOnly, false);
  assert.equal(w.external.filter((r) => r.provider === "FiscalHub").length, 1);
});

test("trocar a pesquisa de produto não reaproveita a classificação anterior", async () => {
  const w = workflow();
  await w.begin();
  await w.context.lookupNcm(phone.codigo);
  await w.begin("Bolo de chocolate");
  assert.equal(w.context.currentMarketTaxContext().ncmConfirmed, false);
  assert.equal(w.context.ncmSearchState.results.length, 1);
  assert.equal(w.context.ncmSearchState.results[0].code, food.codigo);
  assert.equal(w.$("#fiscalOriginalProduct").textContent, "Bolo de chocolate");
  assert.match(w.$("#ncmProductQuery").value, /bolo.*chocolate/);
});

test("editar a categoria durante uma confirmação descarta a resposta antiga", async () => {
  let release;
  const w = workflow({ confirmDelay: new Promise((resolve) => { release = resolve; }) });
  await w.begin();
  const pending = w.context.lookupNcm(phone.codigo);
  assert.equal(w.context.focusState.status, "loading");
  w.$("#ncmProductQuery").value = "bolo de chocolate";
  w.context.resetNcmClassification();
  release();
  await pending;
  assert.equal(w.context.currentMarketTaxContext().ncmConfirmed, false);
  assert.equal(w.context.elements.ncmCode.value, "");
  assert.equal(w.external.some((r) => r.provider === "FiscalHub"), false);
});

test("editar categoria durante o cálculo descarta o total tributado anterior", async () => {
  let release;
  const w = workflow({ taxDelay: new Promise((resolve) => { release = resolve; }) });
  await w.begin();
  w.selectUf("originState", "SP");
  w.selectUf("destinationState", "SP");
  await w.context.lookupNcm(phone.codigo);
  assert.equal(w.context.marketState.tax.status, "loading");
  w.$("#ncmProductQuery").value = "bolo de chocolate";
  w.context.resetNcmClassification();
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(w.context.marketState.tax.result, null);
  assert.equal(w.context.currentMarketTaxContext().ncmConfirmed, false);
});

test("empresa ausente bloqueia a chamada e orienta configurar a FiscalHub", async () => {
  const w = workflow({ companyConfigured: false });
  await w.begin();
  w.selectUf("originState", "SP");
  w.selectUf("destinationState", "SP");
  await w.context.lookupNcm(phone.codigo);
  assert.equal(w.external.some((r) => r.provider === "FiscalHub"), false);
  assert.match(w.$("#marketStats").innerHTML, /Empresa FiscalHub não configurada/);
  assert.match(w.$("#marketTaxDetails").innerHTML, /Configure a empresa da FiscalHub para calcular os tributos/);
});

test("400/401/403/422 preservam os estados do card no fluxo completo", async (t) => {
  for (const [status, label] of [[400, "Revise os dados fiscais"], [401, "Erro de autenticação FiscalHub"], [403, "Sem permissão na FiscalHub"], [422, "Revise os dados fiscais"]]) await t.test(String(status), async () => {
    const w = workflow({ fiscalStatus: status });
    await w.begin();
    w.selectUf("originState", "SP");
    w.selectUf("destinationState", "SP");
    await w.context.lookupNcm(phone.codigo);
    await settle(() => w.context.marketState.tax.status === "error");
    assert.ok(w.$("#marketStats").innerHTML.includes(label));
    assert.ok(w.logs.includes(`[Tax] upstreamStatus=${status}`));
  });
});

test("UFs visíveis começam vazias e oferecem exatamente as 27 siglas válidas", () => {
  for (const id of ["originState", "destinationState"]) {
    const select = html.match(new RegExp(`<select id="${id}">([\\s\\S]*?)<\\/select>`))?.[1];
    assert.ok(select);
    assert.deepEqual([...select.matchAll(/<option value="([^"]*)"/g)].map((match) => match[1]), ["", ...FISCAL_BRAZIL_STATES]);
    assert.doesNotMatch(select, /selected/);
    assert.match(select, /value="">Selecione a UF/);
  }
});
