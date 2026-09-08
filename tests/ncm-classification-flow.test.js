import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, main, server, styles] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../js/main.js", import.meta.url), "utf8"),
  readFile(new URL("../server.js", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
]);

function sourceBetween(startMarker, endMarker) {
  const start = main.indexOf(startMarker);
  const end = main.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Não foi possível localizar ${startMarker}`);
  return main.slice(start, end);
}

test("a interface busca por produto, mostra sugestões e não oferece entrada manual de NCM", () => {
  const fiscalStart = html.indexOf('class="market-tax-context"');
  const fiscalEnd = html.indexOf("</section>", fiscalStart);
  const fiscalSection = html.slice(fiscalStart, fiscalEnd);

  assert.match(fiscalSection, /Produto para classificação fiscal/);
  assert.match(fiscalSection, /id="ncmProductQuery"/);
  assert.match(fiscalSection, /id="ncmSearchButton"/);
  assert.match(fiscalSection, /id="ncmSuggestions"/);
  assert.match(fiscalSection, /id="ncmChangeButton"/);
  assert.match(fiscalSection, /id="ncmCode" type="hidden"/);
  assert.doesNotMatch(fiscalSection, /NCM confirmado \(8 dígitos\)|Validar NCM/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*\.ncm-suggestion-list li\s*{\s*grid-template-columns: 1fr;/);
});

test("a busca por descrição é explícita, preserva ambiguidade e confirma somente uma escolha", () => {
  const search = sourceBetween("async function searchNcmSuggestions()", "async function lookupNcm(code)");
  const confirmation = sourceBetween("async function lookupNcm(code)", "function resetNcmClassification");

  assert.match(search, /\/fiscal\/ncms\/search\?q=/);
  assert.match(search, /status: results\.length \? "success" : "empty"/);
  assert.match(main, /Nenhuma classificação NCM foi encontrada/);
  assert.doesNotMatch(search, /lookupNcm\(/);
  assert.match(confirmation, /\/fiscal\/ncms\/\$\{encodeURIComponent\(normalizedCode\)\}/);
  assert.match(confirmation, /productNameForNcmSearch/);
  assert.match(main, /data-ncm-select/);
  assert.match(main, /Usar este NCM/);
});

test("uma pesquisa de mercado só sugere o texto para NCM, sem chamar o provider fiscal", () => {
  const market = sourceBetween("async function searchMarket()", "function selectMarketProduct");

  assert.match(market, /#ncmProductQuery/);
  assert.doesNotMatch(market, /fiscal\/ncms|searchNcmSuggestions|lookupNcm/);
});

test("alterar ou salvar limpa a classificação atual sem nova chamada fiscal", () => {
  const resetNcm = sourceBetween("function resetNcmClassification", "function closeMobileMenus");
  const resetForm = sourceBetween("function resetCurrentProductForm()", "function productPayloadFromCalculator()");

  assert.match(resetNcm, /elements\.ncmCode\.value = ""/);
  assert.match(resetNcm, /ncmSearchState = emptyNcmSearchState/);
  assert.doesNotMatch(resetNcm, /api\.(get|post)|searchNcmSuggestions|lookupNcm/);
  assert.match(resetForm, /#ncmProductQuery/);
  assert.match(resetForm, /ncmSearchState = emptyNcmSearchState/);
});

test("o endpoint de sugestões não confirma sessão e a FiscalHub continua condicionada ao NCM confirmado", () => {
  const searchStart = server.indexOf('app.get("/fiscal/ncms/search"');
  const validateStart = server.indexOf('app.get("/fiscal/ncms/:codigo"');
  const taxStart = server.indexOf('app.post("/tax/calculate"');
  const searchRoute = server.slice(searchStart, validateStart);
  const taxRoute = server.slice(taxStart);

  assert.match(searchRoute, /focusNfeClient\.searchNcms\(q\)/);
  assert.doesNotMatch(searchRoute, /req\.session\.confirmedNcm/);
  assert.match(taxRoute, /req\.session\.confirmedNcm !== input\.ncm/);
  assert.match(taxRoute, /taxProvider\.calculate\(input\)/);
});
