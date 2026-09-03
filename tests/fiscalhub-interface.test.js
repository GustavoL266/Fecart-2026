import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, dashboard, main, server, styles, envExample, bundle] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../js/ui/dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../js/main.js", import.meta.url), "utf8"),
  readFile(new URL("../server.js", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
  readFile(new URL("../.env.example", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
]);

test("Consulta de Mercado contém somente os dados obrigatórios do cálculo", () => {
  const start = html.indexOf('class="market-tax-context"');
  const end = html.indexOf("</section>", start);
  const section = html.slice(start, end);
  assert.match(section, /Dados para cálculo tributário/);
  assert.match(section, /id="ncmCode"/);
  assert.match(section, /id="originState"/);
  assert.match(section, /id="destinationState"/);
  assert.doesNotMatch(section, /id="taxRegime"/);
  assert.equal((html.match(/id="ncmCode"/g) || []).length, 1);
});

test("dashboard apresenta estados, ação manual e detalhamento responsivo", () => {
  assert.match(dashboard, /Maior \+ tributos/);
  assert.match(dashboard, /Calculado pela FiscalHub/);
  assert.match(dashboard, /Ver tributos/);
  assert.match(dashboard, /NCM necessário/);
  assert.match(dashboard, /Informar\/confirmar NCM/);
  assert.match(dashboard, /Classificação fiscal precisa ser confirmada/);
  assert.match(dashboard, /Preço de mercado/);
  assert.match(styles, /\.market-tax-breakdown/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*\.market-dashboard-section \.market-stats\s*{\s*grid-template-columns: 1fr;/);
});

test("cálculo tributário é acionado separadamente e usa o maior item do state", () => {
  assert.match(main, /function maximumMarketItem/);
  assert.match(main, /unitValue: maximumItem\.price/);
  assert.match(main, /data-calculate-market-taxes/);
  assert.doesNotMatch(dashboard, /taxService|\/tax\/calculate/);
});

test("backend usa endpoint e autenticação oficiais e publica health sem segredos", () => {
  assert.match(server, /app\.post\("\/tax\/calculate"/);
  assert.match(server, /tax: taxHealth\(fiscalHubConfig\)/);
  assert.match(envExample, /FISCALHUB_API_KEY=/);
  assert.match(envExample, /FISCALHUB_EMPRESA_ID=/);
  assert.doesNotMatch(envExample, /fh_live_/);
  assert.doesNotMatch(bundle, /X-Api-Key|api\.fiscalhub\.com\.br|fh_(?:live|test)_/);
});
