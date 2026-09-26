import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, main, dashboard, styles, server, envExample, renderConfig] = await Promise.all([
  "../index.html", "../js/main.js", "../js/ui/dashboard.js", "../styles.css", "../server.js", "../.env.example", "../render.yaml",
].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

test("interface identifica a estimativa IBPT e exige escolha explícita da origem", () => {
  const start = html.indexOf('class="market-tax-context"');
  const section = html.slice(start, html.indexOf("</section>", start));
  assert.match(section, /Produto para classificação fiscal/);
  assert.match(section, /id="productOrigin"/);
  assert.match(section, /value="">Selecione a origem/);
  assert.match(section, /value="nacional">Nacional/);
  assert.match(section, /value="importado">Importado \(Fora do País\)/);
  assert.match(section, /id="originStateField"[^>]+hidden/);
  assert.match(section, /id="countryOfOriginField"[^>]+hidden/);
  assert.match(section, /id="countryOfOrigin"[^>]+list="countryOfOriginOptions"/);
  for (const country of ["China", "Estados Unidos", "Japão", "Coreia do Sul", "Alemanha", "França", "Itália", "México", "Canadá", "Argentina", "Chile", "Reino Unido", "Índia", "Vietnã", "Taiwan"]) {
    assert.match(section, new RegExp(`<option value="${country}">`));
  }
  assert.doesNotMatch(section, /id="productOrigin"[^]*?<option[^>]+selected/);
});

test("país de origem possui estado separado e participa do payload tributário", () => {
  assert.match(main, /countryOfOrigin:\s*""/);
  assert.match(main, /countryOfOrigin:\s*elements\.productOrigin\.value === "importado" \? state\.countryOfOrigin : ""/);
  assert.match(main, /elements\.countryOfOrigin\.addEventListener\("change"/);
  assert.match(main.match(/taxService\.calculateForPrice\(\{[\s\S]*?\}\);/)?.[0] || "", /countryOfOrigin: context.countryOfOrigin/);
});

test("card e detalhamento mostram os modos selecionado e extremos com os dados tributários", () => {
  for (const label of ["Baseado no produto selecionado", "Baseado nos extremos da pesquisa", "Menor preço", "Maior preço", "Carga tributária estimada", "Tributos estimados", "Valor final com tributos", "Fonte:", "Versão:", "Vigência:"]) {
    assert.ok(dashboard.includes(label), label);
  }
  assert.match(dashboard, /calculations\.selected/);
  assert.match(dashboard, /calculations\.minimum/);
  assert.match(dashboard, /calculations\.maximum/);
  assert.match(dashboard, /market-tax-summary-grid/);
  assert.doesNotMatch(dashboard, /tributos contidos|tributos já incluídos/i);
  assert.match(styles, /\.market-tax-summary-metric\.is-total strong\s*{\s*color:\s*var\(--green\)/);
  assert.match(styles, /\.market-tax-scenario-card \.is-total dd\s*{\s*color:\s*var\(--green\)/);
});

test("selecionar, remover ou iniciar outra pesquisa invalida a base tributária anterior", () => {
  const selectStart = main.indexOf("function selectMarketProduct");
  const selectEnd = main.indexOf("function restoreManualMarket", selectStart);
  const restoreEnd = main.indexOf("function toggleMarketTaxDetails", selectEnd);
  const searchStart = main.indexOf("async function searchMarket");
  const searchEnd = main.indexOf("function selectMarketProduct", searchStart);

  for (const flow of [main.slice(selectStart, selectEnd), main.slice(selectEnd, restoreEnd)]) {
    assert.match(flow, /tax:\s*emptyMarketTaxState\(\)/);
    assert.match(flow, /maybeCalculateMarketTaxes\(\)/);
  }
  assert.match(main.slice(searchStart, searchEnd), /selectedItem:\s*refresh \? marketState\.selectedItem : null/);
});

test("confirmação de NCM mostra somente status, código, categoria e alteração", () => {
  const start = html.indexOf('class="market-tax-context"');
  const section = html.slice(start, html.indexOf("</section>", start));
  assert.match(section, /id="ncmConfirmedSummary"[^>]+hidden/);
  assert.match(section, /✓ NCM confirmado/);
  assert.match(section, /Categoria:/);
  assert.match(section, /Alterar categoria/);
  assert.doesNotMatch(section, /id="ncmDescription"|id="ncmDetails"|Ver detalhes do NCM/);
  const renderStart = main.indexOf("function renderNcmState()");
  const renderEnd = main.indexOf("function ncmSearchErrorMessage", renderStart);
  assert.doesNotMatch(main.slice(renderStart, renderEnd), /descricao_completa|ncmDescription|ncmDetails/);
});

test("backend usa o provider local e publica taxEstimate no health", () => {
  assert.match(server, /createIbptTaxProvider/);
  assert.match(server, /app\.post\("\/tax\/estimate"/);
  assert.match(server, /taxEstimate: taxProvider\.health\(\)/);
  assert.match(server, /hasRelevantFiscalConfirmation\(req\.body, req\.session\)/);
  assert.doesNotMatch(server, /FiscalHub|FISCALHUB|\/api\/v1\/tributario\/calcular/);
});

test("o fluxo publicado não requer configuração FiscalHub", () => {
  const activeSources = [main, dashboard, server, envExample, renderConfig].join("\n");
  assert.doesNotMatch(activeSources, /FiscalHub|FISCALHUB_API_KEY|FISCALHUB_EMPRESA_ID|api\.fiscalhub\.com\.br/);
  assert.match(main, /response\.taxEstimate/);
  assert.match(main, /productOrigin/);
});
