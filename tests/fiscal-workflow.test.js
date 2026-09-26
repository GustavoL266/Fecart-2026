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

function workflow({ originRuleProvider = null, beforeTax = async () => {} } = {}) {
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
  const taxProvider = new IbptTaxProvider({ filePath: tablePath, logger, originRuleProvider });
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
    if (path === "/tax/estimate") await beforeTax(body);
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
  const elements = Object.fromEntries(["ncmCode", "productOrigin", "countryOfOrigin", "originState", "destinationState", "taxRegime", "cfop", "taxSituation", "customerType", "operationPurpose", "marketReferenceRule", "marketPrice"].map((id) => [id, $(`#${id}`)]));
  const context = vm.createContext({
    setTimeout: (callback) => setImmediate(callback), clearTimeout: clearImmediate,
    $, document, elements, state: { taxAvailability: taxProvider.health(), countryOfOrigin: "" },
    ncmSearchRevision: 0, ncmLookupRevision: 0, marketSearchRevision: 0, manualMarketValue: null,
    normalizeProductForFiscalSearch, isRelevantFiscalNcm, normalizeNcmDescription, normalizeFiscalState, marketTaxError, marketTaxPrerequisiteError, ApiError,
    taxService: new TaxService({ apiClient: api }), api,
    clearMarketReference() {}, window: { sessionStorage: {} },
    market: { async search(query) {
      marketQueries.push(query);
      return { query, items: [{ id: "min", title: "Menor", price: 100 }, { id: "max", title: "Maior", price: 8_899 }, { id: "mid", title: "Intermediário", price: 700 }], stats: { count: 3, min: 100, max: 8_899, average: 3_233, median: 700 } };
    } },
    render() { context.renderProductOriginFields(); context.renderNcmState(); renderIncompleteDashboard(document, context.marketStateForRender(), {}); },
    setMarketError(_query, error) { throw error; },
  });
  for (const name of ["emptyFocusState", "emptyNcmSearchState", "emptyMarketState", "emptyMarketTaxState", "currentFiscalClassification", "fiscalCategoryLabel", "normalizeCountryOfOrigin", "clearProductOriginGeography", "renderProductOriginFields", "prepareFiscalClassification", "currentMarketTaxContext", "marketTaxSignature", "marketStateForRender", "maximumMarketItem", "minimumMarketItem", "marketTaxTargets", "messageFor", "ncmSearchErrorMessage", "renderNcmState", "searchNcmSuggestions", "lookupNcm", "resetNcmClassification", "setMarketTaxError", "maybeCalculateMarketTaxes", "calculateMarketTaxes", "searchMarket"]) {
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
  function selectCountry(value) {
    elements.countryOfOrigin.value = value;
    for (const callback of elements.countryOfOrigin.listeners.input || []) callback();
    for (const callback of elements.countryOfOrigin.listeners.change || []) callback();
  }
  return { context, external, session, nodes, requests, marketQueries, logs, begin, selectOrigin, selectCountry, $ };
}

async function settle(done) {
  for (let index = 0; index < 30 && !done(); index += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(done(), "O fluxo não concluiu");
}

for (const selected of [false, true]) {
  test(`trocar China, Japão e EUA recalcula ${selected ? "produto selecionado" : "menor e maior preço"} sem alterar o mercado`, async () => {
    const w = workflow();
    await w.begin();
    await w.context.lookupNcm(phone.codigo);
    if (selected) w.context.marketState.selectedItem = w.context.marketState.items.find((item) => item.id === "mid");
    w.context.elements.destinationState.value = "RJ";
    w.selectOrigin("importado");
    const marketSnapshot = JSON.stringify({ items: w.context.marketState.items, stats: w.context.marketState.stats, selectedItem: w.context.marketState.selectedItem });
    let first;
    for (const country of ["China", "Japão", "Estados Unidos"]) {
      const requestCount = w.requests.length;
      // Exercise input alone: no blur, search, NCM selection or page reload.
      w.context.elements.countryOfOrigin.value = country;
      for (const callback of w.context.elements.countryOfOrigin.listeners.input) callback();
      await settle(() => w.context.marketState.tax.status === "success");
      const recent = w.requests.slice(requestCount);
      assert.equal(recent.length, selected ? 1 : 2);
      assert.ok(recent.every(({ path, body }) => path === "/tax/estimate" && body.countryOfOrigin === country && body.destinationState === "RJ" && body.originState === ""));
      const calculations = w.context.marketState.tax.calculations;
      assert.deepEqual(Object.keys(calculations), selected ? ["selected"] : ["minimum", "maximum"]);
      const financial = Object.values(calculations).map(({ marketPrice, estimatedTaxes, rates }) => ({ marketPrice, estimatedTaxes, rates, finalPrice: marketPrice + estimatedTaxes }));
      if (!first) first = financial;
      else assert.deepEqual(financial, first);
      assert.ok(Object.values(calculations).every((result) => result.fiscalContext.countryOfOrigin === country && result.originTreatment.status === "unavailable"));
      assert.match(w.$("#marketStats").innerHTML, /Não foi identificada diferença tributária por país de origem/);
      w.context.marketState.tax.expanded = true;
      w.context.render();
      assert.ok(w.$("#marketTaxDetails").innerHTML.includes(country));
      assert.equal(JSON.stringify({ items: w.context.marketState.items, stats: w.context.marketState.stats, selectedItem: w.context.marketState.selectedItem }), marketSnapshot);
    }
    assert.equal(w.marketQueries.length, 1);
    const count = w.requests.length;
    w.selectCountry(" ");
    assert.equal(w.requests.length, count);
    assert.equal(w.context.marketState.tax.result, null);
    assert.match(w.$("#marketStats").innerHTML, /País de origem necessário/);
  });
}

test("UF de destino segue separada do país e invalida a estimativa", async () => {
  const w = workflow();
  await w.begin();
  await w.context.lookupNcm(phone.codigo);
  w.selectOrigin("importado");
  w.selectCountry("China");
  await settle(() => w.context.marketState.tax.status === "success");
  const original = w.context.marketState.tax.result;
  w.context.elements.destinationState.value = "SP";
  for (const callback of w.context.elements.destinationState.listeners.change) callback();
  await settle(() => w.context.marketState.tax.status === "success");
  const result = w.context.marketState.tax.result;
  assert.equal(result.fiscalContext.destinationState, "SP");
  assert.equal(result.fiscalContext.countryOfOrigin, "China");
  assert.notEqual(result, original);
  assert.deepEqual(result.rates, original.rates); // Current CSV remains the SP table.
});

test("resposta atrasada da China não substitui a estimativa atual do Japão", async () => {
  let release;
  const delayed = new Promise((resolve) => { release = resolve; });
  const w = workflow({ beforeTax: ({ countryOfOrigin }) => countryOfOrigin === "China" ? delayed : undefined });
  await w.begin();
  await w.context.lookupNcm(phone.codigo);
  w.selectOrigin("importado");
  w.selectCountry("China");
  assert.equal(w.context.marketState.tax.status, "loading");
  w.selectCountry("Japão");
  await settle(() => w.context.marketState.tax.status === "success");
  const current = w.context.marketState.tax;
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(w.context.marketState.tax, current);
  assert.equal(current.result.fiscalContext.countryOfOrigin, "Japão");
});

test("digitação do país agrupa alterações e o endpoint rejeita país vazio", async () => {
  const w = workflow();
  await w.begin();
  await w.context.lookupNcm(phone.codigo);
  w.selectOrigin("importado");
  const count = w.requests.length;
  for (const value of ["J", "Ja", "Jap", "Japão"]) {
    w.context.elements.countryOfOrigin.value = value;
    for (const callback of w.context.elements.countryOfOrigin.listeners.input) callback();
  }
  assert.equal(w.requests.length, count);
  await settle(() => w.context.marketState.tax.status === "success");
  assert.equal(w.requests.length - count, 2);
  const body = w.requests.at(-1).body;
  assert.equal(body.countryOfOrigin, "Japão");
  await assert.rejects(() => w.context.taxService.calculateForPrice({ ...body, countryOfOrigin: " " }), { code: "COUNTRY_OF_ORIGIN_REQUIRED" });
  await assert.rejects(() => w.context.taxService.calculateForPrice({ ...body, destinationState: "China" }), { code: "INVALID_TAX_CONTEXT" });
  assert.equal(w.context.marketState.tax.result.fiscalContext.countryOfOrigin, "Japão");
});

test("adaptador de fonte por origem pode diferenciar os cenários com proveniência (fixture, não regra fiscal real)", async () => {
  const seen = [];
  const w = workflow({ originRuleProvider: { resolve(context) {
    seen.push(context);
    // Synthetic contract fixture only; not shipped as a configured tax source.
    if (context.countryOfOrigin === "País de teste" && context.ncm === phone.codigo && context.destinationState === "RJ") return { federalRate: 20, source: "Fonte de teste", reference: "fixture-only" };
    return null;
  } } });
  await w.begin();
  await w.context.lookupNcm(phone.codigo);
  w.context.elements.destinationState.value = "RJ";
  w.selectOrigin("importado");
  w.selectCountry("China");
  await settle(() => w.context.marketState.tax.status === "success");
  const before = w.context.marketState.tax.calculations;
  w.selectCountry("País de teste");
  await settle(() => w.context.marketState.tax.status === "success");
  for (const key of ["minimum", "maximum"]) {
    const result = w.context.marketState.tax.calculations[key];
    assert.equal(result.rates.total, 32);
    assert.notEqual(result.estimatedTaxes, before[key].estimatedTaxes);
    assert.equal(result.marketPrice, before[key].marketPrice);
    assert.equal(result.baseFederalRate, 24.57);
    assert.equal(result.originTreatment.reference, "fixture-only");
    assert.equal(result.originTreatment.status, "applied");
  }
  w.context.marketState.selectedItem = w.context.marketState.items[2];
  await w.context.maybeCalculateMarketTaxes();
  assert.equal(w.context.marketState.tax.calculations.selected.estimatedTaxes, 224);
  assert.ok(seen.every((context) => context.ncm === phone.codigo && context.productOrigin === "importado" && context.destinationState === "RJ"));
});

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
    assert.equal(calculation.marketPrice, 1_000, query);
    assert.equal(Object.hasOwn(calculation, "total"), false, query);
  }
});

test("fluxo completo preserva a pesquisa, confirma NCM e estima os extremos sem seleção", async () => {
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
  const requests = w.requests.filter((candidate) => candidate.path === "/tax/estimate");
  assert.deepEqual(requests.map((request) => request.body.unitValue), [100, 8_899]);
  for (const request of requests) assert.deepEqual(request.body, {
      ncm: phone.codigo,
      productOrigin: "nacional",
      countryOfOrigin: "",
      originState: "",
      destinationState: "",
      unitValue: request.body.unitValue,
      classificationId: w.session.fiscalNcmConfirmation.classificationId,
      originalQuery: "iPhone 15 Pro Max",
      normalizedQuery: "telefone celular smartphone",
    });
  assert.equal(w.context.marketState.tax.mode, "extremes");
  assert.equal(w.context.marketState.tax.calculations.minimum.marketPrice, 100);
  assert.equal(w.context.marketState.tax.calculations.maximum.marketPrice, 8_899);
  assert.equal(w.context.marketState.tax.result.marketPrice, 8_899);
  assert.equal(w.context.marketState.items.find((item) => item.id === "max").price, 8_899);
  assert.equal(JSON.stringify(w.context.marketState.stats), originalStats);
  assert.match(w.$("#marketStats").innerHTML, /Valor final com tributos<\/dt><dd[^>]*>R\$\s129,88/);
  assert.match(w.$("#marketStats").innerHTML, /Valor final com tributos<\/dt><dd[^>]*>R\$\s11\.558,02/);
  assert.match(w.$("#marketStats").innerHTML, /29,88%/);
  assert.match(w.$("#marketStats").innerHTML, /2\.659,02/);
  assert.match(w.$("#marketStats").innerHTML, /IBPT \/ Empresômetro/);
  assert.equal(w.$("#marketTaxDetails").innerHTML, "");
  assert.equal(w.external.some((entry) => entry.provider !== "FocusNFe"), false);
});

test("alternar a origem troca UF por país, limpa o estado anterior e preserva importadosfederal", async () => {
  const w = workflow();
  await w.begin();
  await w.context.lookupNcm(phone.codigo);
  w.context.elements.destinationState.value = "RJ";
  w.selectOrigin("nacional");
  assert.equal(w.$("#originStateField").hidden, false);
  assert.equal(w.$("#countryOfOriginField").hidden, true);
  await settle(() => w.context.marketState.tax.status === "success");
  w.context.elements.originState.value = "SP";
  const nationalSignature = w.context.marketState.tax.signature;
  w.selectOrigin("importado");
  assert.equal(w.$("#originStateField").hidden, true);
  assert.equal(w.$("#countryOfOriginField").hidden, false);
  assert.equal(w.context.elements.originState.value, "");
  assert.equal(w.context.state.countryOfOrigin, "");
  assert.notEqual(w.context.marketState.tax.signature, nationalSignature);
  assert.match(w.$("#marketStats").innerHTML, /País de origem necessário/);
  assert.equal(w.requests.filter((request) => request.path === "/tax/estimate").length, 2);

  w.selectCountry("  China  ");
  await settle(() => w.context.marketState.tax.status === "success" && w.context.marketState.tax.signature !== nationalSignature);
  assert.equal(w.context.state.countryOfOrigin, "China");
  assert.equal(w.context.currentMarketTaxContext().countryOfOrigin, "China");
  assert.equal(w.context.marketState.tax.result.rates.federal, 24.57);
  assert.equal(w.context.marketState.tax.result.marketPrice, 8_899);
  assert.equal(Object.hasOwn(w.context.marketState.tax.result, "total"), false);
  assert.equal(w.requests.filter((request) => request.path === "/tax/estimate").length, 4);
  assert.equal(w.requests.at(-1).body.countryOfOrigin, "China");
  assert.equal(w.requests.at(-1).body.destinationState, "RJ");

  w.selectOrigin("nacional");
  assert.equal(w.$("#originStateField").hidden, false);
  assert.equal(w.$("#countryOfOriginField").hidden, true);
  assert.equal(w.context.elements.countryOfOrigin.value, "");
  assert.equal(w.context.state.countryOfOrigin, "");
});

test("seleção troca a base tributária e remoção restaura automaticamente os extremos", async () => {
  const w = workflow();
  await w.begin();
  await w.context.lookupNcm(phone.codigo);
  w.selectOrigin("nacional");
  await settle(() => w.context.marketState.tax.status === "success");

  const selectedItem = w.context.marketState.items.find((item) => item.id === "mid");
  w.context.marketState = { ...w.context.marketState, selectedItem, tax: w.context.emptyMarketTaxState() };
  await w.context.maybeCalculateMarketTaxes();
  await settle(() => w.context.marketState.tax.status === "success");
  assert.equal(w.context.marketState.tax.mode, "selected");
  assert.deepEqual(Object.keys(w.context.marketState.tax.calculations), ["selected"]);
  assert.equal(w.context.marketState.tax.calculations.selected.marketPrice, 700);
  assert.equal(w.requests.filter((request) => request.path === "/tax/estimate").at(-1).body.unitValue, 700);
  assert.match(w.$("#marketStats").innerHTML, /Baseado no produto selecionado/);

  w.context.marketState = { ...w.context.marketState, selectedItem: null, tax: w.context.emptyMarketTaxState() };
  await w.context.maybeCalculateMarketTaxes();
  await settle(() => w.context.marketState.tax.status === "success");
  assert.equal(w.context.marketState.tax.mode, "extremes");
  assert.deepEqual(Object.keys(w.context.marketState.tax.calculations), ["minimum", "maximum"]);
  assert.deepEqual(w.requests.filter((request) => request.path === "/tax/estimate").slice(-2).map((request) => request.body.unitValue), [100, 8_899]);
  assert.match(w.$("#marketStats").innerHTML, /Baseado nos extremos da pesquisa/);
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
