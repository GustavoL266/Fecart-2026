import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../js/main.js", import.meta.url), "utf8");

function sourceBetween(startMarker, endMarker) {
  const start = main.indexOf(startMarker);
  const end = main.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Não foi possível localizar ${startMarker}`);
  return main.slice(start, end);
}

test("resetCurrentProductForm centraliza a limpeza do cálculo atual sem chamadas externas", () => {
  const reset = sourceBetween("function resetCurrentProductForm()", "function productPayloadFromCalculator()");

  assert.match(reset, /clearPricingInputs\(elements\)/);
  assert.match(reset, /clearProductOriginGeography\(\)/);
  assert.match(reset, /#productName/);
  assert.match(reset, /#productDescription/);
  assert.match(reset, /#marketQuery/);
  assert.match(reset, /#ncmProductQuery/);
  assert.match(reset, /marketReferenceRule\.value = "manual"/);
  assert.match(reset, /focusState = emptyFocusState\(\)/);
  assert.match(reset, /marketState = emptyMarketState\(\)/);
  assert.match(reset, /clearMarketReference\(window\.sessionStorage\)/);
  assert.match(reset, /pricingTabs\.activate\("product"/);
  assert.match(reset, /#productName"\)\.focus/);
  assert.doesNotMatch(reset, /market\.search|taxService|api\.(get|post|patch|delete)|lookupNcm/);
});

test("o reset ocorre somente depois da resposta bem-sucedida de salvar", () => {
  const save = sourceBetween("async function saveProduct()", "async function loadProducts()");
  const response = save.indexOf("await api.post(\"/products\", payload)");
  const reset = save.indexOf("resetCurrentProductForm()");
  const errorHandler = save.indexOf("catch (error)");

  assert.ok(response >= 0 && reset > response && errorHandler > reset);
  assert.match(save, /Produto salvo com sucesso\./);
  assert.doesNotMatch(save.slice(errorHandler), /resetCurrentProductForm\(\)/);
});

test("respostas pendentes de NCM ou mercado não restauram dados após o reset", () => {
  const ncm = sourceBetween("async function lookupNcm(code)", "function resetNcmClassification");
  const market = sourceBetween("async function searchMarket()", "function selectMarketProduct");

  assert.match(ncm, /lookupRevision !== ncmLookupRevision/);
  assert.match(market, /searchRevision !== marketSearchRevision/);
  assert.match(main, /marketSearchRevision \+= 1/);
  assert.match(main, /ncmLookupRevision \+= 1/);
  assert.match(main, /ncmSearchRevision \+= 1/);
});
