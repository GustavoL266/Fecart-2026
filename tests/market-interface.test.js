import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, dashboard, main, styles] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"), readFile(new URL("../js/ui/dashboard.js", import.meta.url), "utf8"), readFile(new URL("../js/main.js", import.meta.url), "utf8"), readFile(new URL("../styles.css", import.meta.url), "utf8"),
]);

test("mercado mantém Nexscope/Amazon opcional e distingue regras de referência", () => {
  assert.match(html, /Pesquisa de preços/);
  assert.match(html, /Preço médio local dos concorrentes/);
  assert.match(html, /Produto individual selecionado/);
  assert.match(html, /Média da pesquisa Amazon/);
  assert.match(html, /Mediana da pesquisa Amazon/);
  assert.match(dashboard, /Provedor técnico/);
  assert.match(dashboard, /Mercado é opcional/);
  assert.match(main, /saveMarketReference\(window\.sessionStorage/);
  assert.match(styles, /\.market-error-alert/);
});
