import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, main, dashboard, server, envExample, renderConfig] = await Promise.all([
  "../index.html", "../js/main.js", "../js/ui/dashboard.js", "../server.js", "../.env.example", "../render.yaml",
].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

test("interface identifica a estimativa IBPT e exige escolha explícita da origem", () => {
  const start = html.indexOf('class="market-tax-context"');
  const section = html.slice(start, html.indexOf("</section>", start));
  assert.match(section, /IBPT \/ Empresômetro/);
  assert.match(section, /Dados para estimativa tributária/);
  assert.match(section, /id="productOrigin"/);
  assert.match(section, /value="">Selecione a origem/);
  assert.match(section, /value="nacional">Nacional/);
  assert.match(section, /value="importado">Importado/);
  assert.doesNotMatch(section, /id="productOrigin"[^]*?<option[^>]+selected/);
});

test("card e detalhamento mostram carga, tributos, total, fonte, versão e vigência", () => {
  for (const label of ["Maior + tributos estimados", "Carga tributária estimada", "Tributos estimados", "IBPT / Empresômetro", "Versão:", "Vigência:"]) {
    assert.match(dashboard, new RegExp(label.replace(/[+]/g, "\\+")));
  }
  assert.match(dashboard, /tax\.result\.rates\.total/);
  assert.match(dashboard, /tax\.result\.estimatedTaxes/);
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
