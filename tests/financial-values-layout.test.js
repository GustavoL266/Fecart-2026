import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, styles, dashboard, detailPages] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
  readFile(new URL("../js/ui/dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../js/ui/detail-pages.js", import.meta.url), "utf8"),
]);

test("valores financeiros principais usam a classe reutilizável sem quebra", () => {
  [
    "mobileSuggestedPrice",
    "suggestedPrice",
    "primaryMarketPrice",
    "marketReferencePrice",
    "baseCost",
    "profitPerSale",
    "detailSuggestedPrice",
    "detailBaseCost",
    "detailProfit",
    "detailDonutPrice",
    "detailMarketPrice",
    "detailMarketCostLimit",
  ].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"[^>]*class="[^"]*financial-value`), `${id} precisa ser financeiro sem quebra`);
  });
  assert.match(styles, /\.financial-value\s*{[\s\S]*white-space:\s*nowrap/);
  assert.match(styles, /\.financial-value\s*{[\s\S]*overflow-wrap:\s*normal !important/);
  assert.match(styles, /\.financial-value\s*{[\s\S]*word-break:\s*normal !important/);
  assert.doesNotMatch(styles.match(/\.financial-value\s*{[\s\S]*?\n}/)?.[0] || "", /overflow:\s*hidden/);
});

test("KPIs dinâmicos de mercado e detalhes recebem a mesma proteção financeira", () => {
  assert.match(dashboard, /market-tax-stat is-success[\s\S]*financial-value/);
  assert.match(dashboard, /const standardStats[\s\S]*financial-value/);
  assert.match(dashboard, /market-result-price[\s\S]*financial-value/);
  assert.match(dashboard, /market-tax-breakdown[\s\S]*financial-value/);
  assert.match(detailPages, /chart-legend-color-[\s\S]*financial-value/);
  assert.match(detailPages, /#priceComparisonBars[\s\S]*financial-value/);
});

test("a tipografia financeira usa o tamanho do container e reserva mais espaço ao preço sustentável", () => {
  assert.match(styles, /container-type:\s*inline-size/);
  assert.match(styles, /font-size:\s*clamp\(0\.72rem,\s*8\.5cqi,\s*4\.7rem\)/);
  assert.match(styles, /\.primary-price-grid\s*{[\s\S]*grid-template-columns:\s*minmax\(0, 1\.7fr\) minmax\(0, 1fr\)/);
  assert.match(styles, /\.summary-card-primary\s*{[\s\S]*grid-column:\s*span 8/);
  assert.match(styles, /\.summary-card-primary \+ \.summary-card\s*{[\s\S]*grid-column:\s*span 4/);
  assert.match(styles, /@container \(max-width: 34rem\)[\s\S]*\.primary-price-grid[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(styles, /\.dashboard-summary-grid,[\s\S]*\.primary-price-cell,[\s\S]*min-width:\s*0/);
});

test("formatos monetários grandes continuam sendo tratados como uma única unidade visual", () => {
  ["R$ 32,00", "R$ 999,99", "R$ 9.999,99", "R$ 25.287,10", "R$ 99.999,99", "R$ 999.999,99", "R$ 9.999.999,99"].forEach((value) => {
    assert.equal(value.includes("\n"), false);
    assert.match(value, /^R\$ [\d.]+,\d{2}$/);
  });
});
