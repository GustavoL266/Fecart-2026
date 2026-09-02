import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, dashboard, main, styles] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"), readFile(new URL("../js/ui/dashboard.js", import.meta.url), "utf8"), readFile(new URL("../js/main.js", import.meta.url), "utf8"), readFile(new URL("../styles.css", import.meta.url), "utf8"),
]);

test("mercado mantém Google Shopping opcional e distingue regras de referência", () => {
  assert.match(html, /Pesquisa de preços/);
  assert.match(html, /Preço médio local dos concorrentes/);
  assert.match(html, /Produto individual selecionado/);
  assert.match(html, /Média da pesquisa Google Shopping/);
  assert.match(html, /Mediana da pesquisa Google Shopping/);
  assert.match(html, /Dados via Google Shopping/);
  assert.match(dashboard, /Loja:/);
  assert.match(dashboard, /Ver no Google Shopping/);
  assert.match(dashboard, /Mercado é opcional/);
  assert.match(main, /saveMarketReference\(window\.sessionStorage/);
  assert.match(styles, /\.market-error-alert/);
});

test("resultados de mercado pertencem ao dashboard e não à sidebar", () => {
  const sidebarEnd = html.indexOf("</aside>");
  const dashboardHeading = html.indexOf('class="dashboard-heading"');
  const marketPanel = html.indexOf('id="marketPanel"');
  const summaryGrid = html.indexOf('class="dashboard-summary-grid"');

  assert.ok(sidebarEnd > 0);
  assert.ok(marketPanel > sidebarEnd);
  assert.ok(marketPanel > dashboardHeading);
  assert.ok(marketPanel < summaryGrid);
  assert.equal((html.match(/id="marketPanel"/g) || []).length, 1);
  assert.match(html, /Escolha o produto que mais se aproxima/);
  assert.match(dashboard, /Buscando produtos no mercado/);
  assert.match(dashboard, /Nenhum produto compatível foi encontrado/);
  assert.match(dashboard, /Usar como referência/);
  assert.match(styles, /market-dashboard-section \.market-stats[\s\S]*grid-template-columns:\s*repeat\(5,/);
  assert.match(styles, /grid-template-columns:\s*repeat\(3,/);
});

test("renderização do dashboard reutiliza o state sem disparar nova consulta", () => {
  assert.doesNotMatch(dashboard, /market\.search|\/market\/search/);
  assert.match(main, /await market\.search\(query\)/);
  assert.match(main, /marketSearchButton.*addEventListener\("click", searchMarket\)/s);
});
