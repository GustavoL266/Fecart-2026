import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { CAPACITY_FIELD_IDS, PRICING_FIELD_IDS } from "../js/ui/form.js";

const indexUrl = new URL("../index.html", import.meta.url);
const mainUrl = new URL("../js/main.js", import.meta.url);

function htmlIds(source) {
  return new Set(Array.from(source.matchAll(/\bid="([^"]+)"/g), (match) => match[1]));
}

test("todos os campos usados na precificação existem no HTML e no mapa de elementos", async () => {
  const [html, main] = await Promise.all([
    readFile(indexUrl, "utf8"),
    readFile(mainUrl, "utf8"),
  ]);
  const ids = htmlIds(html);
  const requiredFieldIds = [...PRICING_FIELD_IDS, ...CAPACITY_FIELD_IDS];
  const fieldMap = main.match(/const formFieldIds = \[([\s\S]*?)\n\];/)?.[1] || "";

  for (const fieldId of requiredFieldIds) {
    assert.ok(ids.has(fieldId), `Campo obrigatório ausente no HTML: #${fieldId}`);
  }
  assert.match(fieldMap, /\.\.\.PRICING_FIELD_IDS/);
  assert.match(fieldMap, /\.\.\.CAPACITY_FIELD_IDS/);
});

test("seletores de ID obrigatórios do módulo principal existem no HTML", async () => {
  const [html, main] = await Promise.all([
    readFile(indexUrl, "utf8"),
    readFile(mainUrl, "utf8"),
  ]);
  const ids = htmlIds(html);
  const selectors = new Set(Array.from(main.matchAll(/\$\("#([A-Za-z][\w:-]*)"\)/g), (match) => match[1]));

  for (const id of selectors) {
    assert.ok(ids.has(id), `Seletor obrigatório sem elemento correspondente: #${id}`);
  }
});

test("estrutura obrigatória de abas e redimensionamento está presente", async () => {
  const html = await readFile(indexUrl, "utf8");

  assert.match(html, /class="[^"]*\bapp-shell\b/);
  assert.match(html, /class="[^"]*\bpricing-sidebar\b/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /data-pricing-tab=/);
  assert.match(html, /data-pricing-panel=/);
  assert.match(html, /data-panel-resizer/);
});
