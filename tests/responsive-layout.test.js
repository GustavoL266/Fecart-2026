import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, styles, scripts] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
  Promise.all([
    readFile(new URL("../js/main.js", import.meta.url), "utf8"),
    readFile(new URL("../js/ui/dashboard.js", import.meta.url), "utf8"),
    readFile(new URL("../js/ui/pricing-panel.js", import.meta.url), "utf8"),
  ]).then((contents) => contents.join("\n")),
]);

test("viewport permite zoom nativo e a interface nao aplica escala global", () => {
  assert.match(html, /<meta\s+name="viewport"\s+content="width=device-width, initial-scale=1\.0"\s*\/?>/);
  assert.doesNotMatch(html, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i);
  assert.doesNotMatch(styles, /(^|[;{]\s*)zoom\s*:/m);
  assert.doesNotMatch(scripts, /devicePixelRatio|visualViewport\.scale/);
});

test("shell limita a lateral e adota modo compacto antes de esmagar o dashboard", () => {
  assert.match(styles, /\.app-shell\s*{[\s\S]*?clamp\(20rem,[\s\S]*?34vw[\s\S]*?minmax\(0, 1fr\)/);
  assert.match(styles, /@media \(max-width: 75rem\) and \(min-width: 56\.3125rem\)[\s\S]*?\.app-shell\s*{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /\.pricing-sidebar\s*{[\s\S]*?scrollbar-gutter: stable/);
});

test("grids principais respondem a largura do proprio conteudo", () => {
  assert.match(styles, /container: dashboard-summary \/ inline-size/);
  assert.match(styles, /container: market-dashboard \/ inline-size/);
  assert.match(styles, /@container market-dashboard \(max-width: 66rem\)[\s\S]*?\.market-results\s*{[\s\S]*?repeat\(2/);
  assert.match(styles, /@container market-dashboard \(max-width: 42rem\)[\s\S]*?\.market-results,[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /@container market-dashboard \(max-width: 42rem\)[\s\S]*?\.market-tax-scenarios,[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
});

test("overflow horizontal fica restrito a componentes que realmente precisam dele", () => {
  const bodyRule = styles.match(/body\s*{[\s\S]*?\n}/)?.[0] || "";
  assert.doesNotMatch(bodyRule, /overflow-x:\s*hidden/);
  assert.match(styles, /\.pricing-tabs\s*{[\s\S]*?overflow-x:\s*auto/);
  assert.match(styles, /\.detail-table-scroll\s*{[\s\S]*?overflow-x:\s*auto/);
  assert.match(styles, /\.table-panel\s*{[\s\S]*?overflow-x:\s*auto/);
});

test("modais respeitam largura e altura dinamicas da viewport", () => {
  assert.match(styles, /\.modal-dialog,[\s\S]*?max-block-size: calc\(100dvh - 2rem\)/);
  assert.match(styles, /\.modal-dialog,[\s\S]*?overflow: auto/);
});
