import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, dashboard, main, styles] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../js/ui/dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../js/main.js", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
]);

test("Consulta de Mercado tem identidade própria, fallback manual e cards selecionáveis", () => {
  assert.match(html, /Pesquise produtos reais de mercado e compare com seu preço sustentável\./);
  assert.match(html, /Produto para pesquisar/);
  assert.match(html, /Resultados encontrados/);
  assert.match(html, /Preço médio local dos concorrentes/);
  assert.match(html, /data-pricing-tab="fiscal"/);
  assert.match(html, /data-pricing-panel="fiscal"/);
  assert.match(dashboard, /Usar como referência/);
  assert.match(dashboard, /Referência selecionada/);
  assert.match(dashboard, /data-market-retry/);
  assert.match(dashboard, /selectedMarketProduct\.source/);
  assert.match(dashboard, /Buscando produtos\.\.\./);
});

test("dashboard possui três áreas responsivas e tributação pendente sem valor inventado", () => {
  assert.match(html, /id="primaryPriceGrid"/);
  assert.match(html, /Seu preço sustentável/);
  assert.match(html, /Preço de mercado/);
  assert.match(html, /Mercado \+ impacto tributário/);
  assert.match(dashboard, /Tributação pendente/);
  assert.match(styles, /\.primary-price-grid[\s\S]*grid-template-columns:/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.primary-price-grid[\s\S]*grid-template-columns: 1fr/);
});

test("referência selecionada usa sessionStorage e pode voltar ao valor manual", () => {
  assert.match(main, /saveMarketReference\(window\.sessionStorage/);
  assert.match(main, /restoreMarketReferenceFromSession\(\)/);
  assert.match(main, /clearMarketReference\(window\.sessionStorage\)/);
  assert.match(main, /restoreManualMarket\(\{ focusSearch: true \}\)/);
});
