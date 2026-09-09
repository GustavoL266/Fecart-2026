import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ApiError } from "../js/services/api-client.js";
import { TaxService, marketTaxError, marketTaxPrerequisiteError } from "../js/services/tax-service.js";
import { normalizeProductForFiscalSearch, isRelevantFiscalNcm, normalizeNcmDescription } from "../js/domain/fiscal-classification.js";
import { normalizeFiscalState } from "../js/domain/fiscal-context.js";
import { searchFiscalNcms, confirmFiscalNcm, hasRelevantFiscalConfirmation } from "../lib/fiscal-classification.js";
import { FocusNFeClient, FocusNFeError } from "../lib/focus-nfe-client.js";
import { IbptTaxError, IbptTaxProvider } from "../lib/ibpt-tax-provider.js";
import { ncmSearchSchema, taxEstimateSchema, validate } from "../lib/validation.js";
import { renderIncompleteDashboard } from "../js/ui/dashboard.js";

const [serverSource, mainSource] = await Promise.all(["../server.js", "../js/main.js"].map(async (path) => (await readFile(new URL(path, import.meta.url), "utf8")).replace(/\r\n/g, "\n")));
const tablePath = fileURLToPath(new URL("../data/ibpt/TabelaIBPTaxSP26.2.A.csv", import.meta.url));
const phone = { codigo: "85171300", descricao_completa: "Smartphones" };
const food = { codigo: "19059090", descricao_completa: "Produtos de padaria, pastelaria e confeitaria" };

function workflow() {
  const routes = new Map();
  const logs = [];
  const external = [];
  const session = {};
  const requests = [];
  const marketQueries = [];
  const logger = { info: (line) => logs.push(line), warn: (line) => logs.push(line), error: (line) => logs.push(line) };
  const focusNfeClient = new FocusNFeClient({ token: "fixture-focus-token", baseUrl: "https://homologacao.focusnfe.com.br", logger, maxRetries: 0, fetchImpl: async (url) => {
    external.push({ provider: "FocusNFe", url });
    return { ok: true, status: 200, json: async () => url.includes("?") ? [food, phone] : phone };
  } });
  const taxProvider = new IbptTaxProvider({ filePath: tablePath, logger });
  vm.runInNewContext(serverSource.slice(serverSource.indexOf('app.get("/fiscal/ncms/search"'), serverSource.indexOf('app.get("/products"')), {
    app: Object.fromEntries(["get", "post"].map((method) => [method, (path, _auth, _limit, callback) => routes.set(`${method} ${path}`, callback)])),
    requireAuth() {}, fiscalLookupLimiter() {}, taxCalculationLimiter() {}, sessionSave: async () => {},
    focusNfeClient, focusNfeConfig: { environment: "homologation", token: "fixture-focus-token" }, taxProvider,
    FocusNFeError, IbptTaxError, randomUUID, ncmSearchSchema, taxEstimateSchema, validate,
    searchFiscalNcms: (client, input, options) => searchFiscalNcms(client, input, { ...options, logger }),
    confirmFiscalNcm, hasRelevantFiscalConfirmation, console: logger,
  });

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
  const api = { get: (path) => request("get", path), post: (path, body) => request("post", path, body) };
  const nodes = new Map();
  function node() {
    return { value: "", textContent: "", innerHTML: "", hidden: false, children: [], listeners: {}, classList: { toggle() {} }, dataset: {}, setAttribute(name, value) { this[name] = value; }, replaceChildren() { this.children = []; }, append(...children) { this.children.push(...children); }, focus() {}, addEventListener(event, callback) { (this.listeners[event] ||= []).push(callback); } };
  }
  const document = { querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); }, createElement: node };
  const $ = (selector) => document.querySelector(selector);
  const elements = Object.fromEntries(["ncmCode", "productOrigin", "originState", "destinationState", "taxRegime", "cfop", "taxSituation", "customerType", "operationPurpose"].map((id) => [id, $(`#${id}`)]));
  const context = vm.createContext({
    $, document, elements, state: { taxAvailability: taxProvider.health() },
    ncmSearchRevision: 0, ncmLookupRevision: 0, marketSearchRevision: 0,
    normalizeProductForFiscalSearch, isRelevantFiscalNcm, normalizeNcmDescription, normalizeFiscalState, marketTaxError, marketTaxPrerequisiteError, ApiError,
    taxService: new TaxService({ apiClient: api }), api,
    market: { async search(query) {
      marketQueries.push(query);
      return { query, items: [{ id: "min", title: "Menor", price: 100 }, { id: "max", title: "Maior", price: 8_899 }, { id: "mid", title: "Intermediário", price: 700 }], stats: { count: 3, min: 100, max: 8_899, average: 3_233, median: 700 } };
    } },
    render() { context.renderNcmState(); renderIncompleteDashboard(document, context.marketStateForRender(), {}); },
    setMarketError(_query, error) { throw error; },
  });
  for (const name of ["emptyFocusState", "emptyNcmSearchState", "emptyMarketState", "emptyMarketTaxState", "currentFiscalClassification", "fiscalCategoryLabel", "prepareFiscalClassification", "currentMarketTaxContext", "marketTaxSignature", "marketStateForRender", "maximumMarketItem", "messageFor", "ncmSearchErrorMessage", "renderNcmState", "searchNcmSuggestions", "lookupNcm", "resetNcmClassification", "setMarketTaxError", "maybeCalculateMaximumTaxes", "calculateMaximumTaxes", "searchMarket"]) {
    const start = mainSource.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
    assert.ok(start >= 0, name);
    const remainder = mainSource.slice(start);
    const next = remainder.slice(1).search(/\n(?:async )?function /);
    vm.runInContext(next < 0 ? remainder : remainder.slice(0, next + 1), context);
  }
  vm.runInContext(mainSource.match(/const apiMessages = Object\.freeze\([\s\S]*?\n\}\);/)?.[0], context);
  context.focusState = context.emptyFocusState();
  context.ncmSearchState = context.emptyNcmSearchState();
  context.marketState = context.emptyMarketState();
  const fieldEvents = mainSource.slice(mainSource.indexOf("[\n  elements.taxRegime"), mainSource.indexOf('$("#ncmSearchButton").addEventListener'));
  vm.runInContext(fieldEvents, context);

  async function begin(query = "iPhone 15 Pro Max") {
    $("#marketQuery").value = query;
    await context.searchMarket();
    await settle(() => context.ncmSearchState.status !== "loading");
  }
  function selectOrigin(value) {
    elements.productOrigin.value = value;
    for (const callback of elements.productOrigin.listeners.change || []) callback();
  }
  return { context, external, session, nodes, requests, marketQueries, logs, begin, selectOrigin, $ };
}

async function settle(done) {
  for (let index = 0; index < 30 && !done(); index += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(done(), "O fluxo não concluiu");
}

test("iPhone, bolo, notebook e televisão têm NCM relevante e estimativa IBPT", () => {
  const provider = new IbptTaxProvider({ filePath: tablePath, logger: { info() {}, error() {} } });
  const scenarios = [
    ["iPhone 15 Pro Max", "85171300", "<i>Smartphones</i>"],
    ["bolo", "19059090", "Produtos de padaria, pastelaria e confeitaria. Bolos"],
    ["notebook", "84713012", "Máquinas automáticas para processamento de dados, portáteis. Notebooks"],
    ["televisão", "85287200", "Aparelhos receptores de televisão"],
  ];

  for (const [query, code, description] of scenarios) {
    const classification = normalizeProductForFiscalSearch(query);
    assert.equal(isRelevantFiscalNcm(classification.normalizedQuery, { codigo: code, descricao_completa: description }), true, query);
    const calculation = provider.calculate({ ncm: code, productOrigin: "nacional", unitValue: 1_000 });
    assert.equal(calculation.ncm, code, query);
    assert.equal(calculation.provider, "IBPT", query);
    assert.equal(calculation.version, "26.2.A", query);
    assert.ok(calculation.estimatedTaxes > 0, query);
    assert.equal(calculation.total, 1_000 + calculation.estimatedTaxes, query);
  }
});

test("fluxo completo preserva a pesquisa, confirma NCM e estima exclusivamente o maior", async () => {
  const w = workflow();
  await w.begin();
  assert.deepEqual(w.marketQueries, ["iPhone 15 Pro Max"]);
  assert.equal(w.$("#ncmProductQuery").value, "telefone celular smartphone");
  assert.equal(w.context.ncmSearchState.results.length, 1);
  assert.equal(w.context.ncmSearchState.results[0].code, phone.codigo);
  assert.equal(w.requests.some((request) => request.path === "/tax/estimate"), false);

  await w.context.lookupNcm(phone.codigo);
  assert.equal(w.context.currentMarketTaxContext().ncmConfirmed, true);
  assert.match(w.$("#marketStats").innerHTML, /Origem do produto necessária/);
  assert.equal(w.requests.some((request) => request.path === "/tax/estimate"), false);

  const originalStats = JSON.stringify(w.context.marketState.stats);
  w.selectOrigin("nacional");
  await settle(() => w.context.marketState.tax.status === "success");
  const request = w.requests.find((candidate) => candidate.path === "/tax/estimate");
  assert.deepEqual(request.body, {
    ncm: phone.codigo,
    productOrigin: "nacional",
    unitValue: 8_899,
    classificationId: w.session.fiscalNcmConfirmation.classificationId,
    originalQuery: "iPhone 15 Pro Max",
    normalizedQuery: "telefone celular smartphone",
  });
  assert.equal(w.context.marketState.tax.result.total, 11_558.02);
  assert.equal(w.context.marketState.items.find((item) => item.id === "max").price, 8_899);
  assert.equal(JSON.stringify(w.context.marketState.stats), originalStats);
  assert.match(w.$("#marketStats").innerHTML, /11\.558,02/);
  assert.match(w.$("#marketStats").innerHTML, /29,88%/);
  assert.match(w.$("#marketStats").innerHTML, /2\.659,02/);
  assert.match(w.$("#marketStats").innerHTML, /IBPT \/ Empresômetro/);
  assert.equal(w.$("#marketTaxDetails").innerHTML, "");
  assert.equal(w.external.some((entry) => entry.provider !== "FocusNFe"), false);
});

test("mudar a origem invalida e refaz a estimativa com importadosfederal", async () => {
  const w = workflow();
  await w.begin();
  await w.context.lookupNcm(phone.codigo);
  w.selectOrigin("nacional");
  await settle(() => w.context.marketState.tax.status === "success");
  const nationalSignature = w.context.marketState.tax.signature;
  w.selectOrigin("importado");
  await settle(() => w.context.marketState.tax.status === "success" && w.context.marketState.tax.signature !== nationalSignature);
  assert.equal(w.context.marketState.tax.result.rates.federal, 24.57);
  assert.equal(w.context.marketState.tax.result.total, 12_153.36);
  assert.equal(w.requests.filter((request) => request.path === "/tax/estimate").length, 2);
});

test("mudar categoria ou NCM invalida a estimativa anterior", async () => {
  const w = workflow();
  await w.begin();
  await w.context.lookupNcm(phone.codigo);
  w.selectOrigin("nacional");
  await settle(() => w.context.marketState.tax.status === "success");
  w.context.elements.ncmCode.value = "09012100";
  w.context.marketStateForRender();
  assert.equal(w.context.currentMarketTaxContext().ncmConfirmed, false);
  assert.equal(w.context.marketState.tax.result, null);
  w.context.elements.ncmCode.value = phone.codigo;
  w.$("#ncmProductQuery").value = "produto de confeitaria bolo";
  w.context.resetNcmClassification();
  assert.equal(w.context.currentMarketTaxContext().ncmConfirmed, false);
  assert.equal(w.context.marketState.tax.result, null);
  assert.match(w.$("#marketStats").innerHTML, /NCM necessário/);
});

test("resultado irrelevante por substring não aparece nem pode ser confirmado", async () => {
  const w = workflow();
  await w.begin();
  assert.equal(w.context.ncmSearchState.results.some((result) => result.code === food.codigo), false);
  await w.context.lookupNcm(food.codigo);
  assert.equal(w.context.currentMarketTaxContext().ncmConfirmed, false);
  assert.equal(w.requests.some((request) => request.path === "/tax/estimate"), false);
});
