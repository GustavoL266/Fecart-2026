import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProductForFiscalSearch, fiscalNcmSearchTerms, isRelevantFiscalNcm } from "../js/domain/fiscal-classification.js";
import { searchFiscalNcms, confirmFiscalNcm } from "../lib/fiscal-classification.js";
import { FocusNFeClient } from "../lib/focus-nfe-client.js";
import { FISCAL_BRAZIL_STATES, normalizeFiscalState, isValidFiscalState } from "../js/domain/fiscal-context.js";

const phone = { codigo: "85171300", descricao_completa: "Smartphones" };
const food = { codigo: "19059090", descricao_completa: "Produtos de padaria, pastelaria ou da indústria de bolachas e biscoitos" };

test("normaliza os nomes comerciais pedidos sem produzir código NCM", () => {
  for (const [input, category, query] of [
    ["iPhone 15 Pro Max", "telefone celular", "telefone celular smartphone"],
    ["iPhone 15 Pro Max 256GB Natural Titanium", "telefone celular", "telefone celular smartphone"],
    ["Galaxy S26", "telefone celular", "telefone celular smartphone"],
    ["Samsung Galaxy S26", "telefone celular", "telefone celular smartphone"],
    ["Galaxy S26 Ultra", "telefone celular", "telefone celular smartphone"],
    ["Bolo de chocolate 1kg", "bolo / confeitaria", "bolo produto de confeitaria chocolate"],
    ["Coca-Cola 2L", "refrigerante", "refrigerante"],
    ["Nike Air Max 90", "calçado / tênis", "calçado tênis"],
    ["PlayStation 5", "console de videogame", "console de videogame"],
    ["MacBook Air 512GB", "computador portátil", "computador portátil notebook"],
    ["Smart TV Samsung 55", "aparelho de televisão", "aparelho de televisão"],
  ]) {
    const result = normalizeProductForFiscalSearch(input);
    assert.deepEqual(result, { originalQuery: input, normalizedQuery: query, category });
    assert.equal(normalizeProductForFiscalSearch(query).normalizedQuery, query);
    assert.doesNotMatch(JSON.stringify(result), /"(?:ncm|code|codigo)"/);
  }
});

test("preserva composição/função e não classifica acessórios como aparelhos", () => {
  assert.match(normalizeProductForFiscalSearch("Bolo de chocolate sem glúten 1kg").normalizedQuery, /chocolate sem glúten/);
  assert.match(normalizeProductForFiscalSearch("Tênis Nike de couro e borracha tamanho 40").normalizedQuery, /couro borracha/);
  assert.match(normalizeProductForFiscalSearch("Coca-Cola Zero 2L").normalizedQuery, /sem açúcar/);
  assert.match(normalizeProductForFiscalSearch("Torta de frango congelado 1kg").normalizedQuery, /torta frango congelado/);
  assert.notEqual(normalizeProductForFiscalSearch("Capa de silicone para iPhone 15").category, "telefone celular");
  assert.notEqual(normalizeProductForFiscalSearch("Galaxy Watch 7").category, "telefone celular");
  assert.notEqual(normalizeProductForFiscalSearch("Galaxy Tab S9").category, "telefone celular");
  const fallback = normalizeProductForFiscalSearch("Válvula de aço inox 20mm");
  assert.equal(fallback.normalizedQuery, "Válvula de aço inox");
});

test("celular rejeita alimentos, códigos inválidos, descrição vazia e peças", () => {
  const query = normalizeProductForFiscalSearch("iPhone 15 Pro Max").normalizedQuery;
  assert.equal(isRelevantFiscalNcm(query, phone), true);
  assert.equal(isRelevantFiscalNcm(query, { ...phone, descricao_completa: "Máquinas, aparelhos e suas partes. Aparelhos telefônicos. Smartphones" }), true);
  assert.equal(isRelevantFiscalNcm(query, { ...phone, descricao_completa: "Telefones para redes celulares e para outras redes sem fio" }), true);
  for (const ncm of [food, { ...phone, descricao_completa: "Preparações alimentícias diversas" }, { ...phone, codigo: "8517" }, { ...phone, codigo: "8517x1300" }, { ...phone, descricao_completa: "" }, { ...phone, descricao_completa: "Partes de telefones para redes celulares" }, { ...phone, descricao_completa: "Telefones para redes celulares. Partes" }]) assert.equal(isRelevantFiscalNcm(query, ncm), false);
  assert.equal(isRelevantFiscalNcm("bolo de chocolate", food), true);
  assert.equal(isRelevantFiscalNcm("bolo de chocolate", phone), false);
});

test("pesquisa sinônimos separadamente, filtra antes de limitar e não confirma sozinho", async () => {
  const calls = [];
  const logs = [];
  const response = await searchFiscalNcms({ async searchNcms(query) {
    calls.push(query);
    return [...Array(12).fill(food), phone, phone];
  } }, { q: "iPhone 15 Pro Max", originalQuery: "iPhone 15 Pro Max" }, { logger: { info: (line) => logs.push(line) } });
  assert.deepEqual(calls, ["smartphone", "telefones para redes celulares"]);
  assert.deepEqual(fiscalNcmSearchTerms(response.normalizedQuery), calls);
  assert.deepEqual(response.results, [{ code: phone.codigo, description: phone.descricao_completa }]);
  assert.equal(response.rejectedIrrelevantResults, 24);
  assert.equal(response.confirmedNcm, undefined);
  assert.ok(logs.includes("[NCM] originalQuery=iPhone 15 Pro Max"));
  assert.ok(logs.includes("[NCM] normalizedQuery=telefone celular smartphone"));
  assert.ok(logs.includes("[NCM] rejectedIrrelevantResults=24"));
});

test("confirmar exige candidato atual relevante e revalida descrição e código exatos", async () => {
  const search = { classificationId: "search-a", normalizedQuery: "telefone celular smartphone", originalQuery: "iPhone", results: [{ code: phone.codigo, description: phone.descricao_completa }] };
  let calls = 0;
  const client = { async getNcm() { calls += 1; return phone; } };
  await assert.rejects(() => confirmFiscalNcm(client, search, food.codigo, "search-a"), { code: "NCM_CLASSIFICATION_REQUIRED" });
  await assert.rejects(() => confirmFiscalNcm(client, search, phone.codigo, "search-old"), { code: "NCM_CLASSIFICATION_REQUIRED" });
  await assert.rejects(() => confirmFiscalNcm(client, null, phone.codigo, "search-a"), { code: "NCM_CLASSIFICATION_REQUIRED" });
  assert.equal(calls, 0);
  for (const invalid of [{ ...phone, descricao_completa: food.descricao_completa }, { ...phone, codigo: "85171400" }]) await assert.rejects(() => confirmFiscalNcm({ async getNcm() { return invalid; } }, search, phone.codigo, "search-a"), { code: "NCM_IRRELEVANT" });
  assert.equal((await confirmFiscalNcm(client, search, phone.codigo, "search-a")).confirmation.code, phone.codigo);
});

test("cliente Focus preserva resultados além do décimo e rejeita código diferente do solicitado", async () => {
  const client = new FocusNFeClient({ token: "mock", baseUrl: "https://homologacao.focusnfe.com.br", logger: {}, maxRetries: 0, fetchImpl: async (url) => ({ ok: true, status: 200, json: async () => url.includes("?") ? [...Array(12).fill(food), phone] : food }) });
  assert.equal((await client.searchNcms("smartphone"))[12].codigo, phone.codigo);
  await assert.rejects(() => client.getNcm(phone.codigo), { code: "FOCUS_NFE_INVALID_RESPONSE" });
  await assert.rejects(() => client.getNcm("8517.13.00"), { code: "INVALID_NCM_CODE" });
});

test("diagnóstico de classificação remove secrets e quebras de linha", async () => {
  const logs = [];
  await searchFiscalNcms({ async searchNcms() { return []; } }, { q: "smartphone", originalQuery: "iPhone\nfh_live_segredo token-secreto empresa-secreta" }, { logger: { info: (line) => logs.push(line) }, secrets: ["token-secreto", "empresa-secreta"] });
  assert.doesNotMatch(logs.join("|"), /fh_live_segredo|token-secreto|empresa-secreta|\n/);
});

test("as 27 UFs aceitam caixa baixa e espaços, sem aceitar siglas inexistentes", () => {
  assert.equal(FISCAL_BRAZIL_STATES.length, 27);
  for (const uf of FISCAL_BRAZIL_STATES) {
    assert.equal(normalizeFiscalState(` ${uf[0].toLowerCase()} ${uf[1].toLowerCase()} `), uf);
    assert.equal(isValidFiscalState(uf), true);
  }
  for (const uf of ["", "XX", "São Paulo", null, undefined]) assert.equal(isValidFiscalState(uf), false);
});
