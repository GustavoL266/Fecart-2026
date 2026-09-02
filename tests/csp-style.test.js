import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function clientJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await clientJavaScriptFiles(path));
    else if (entry.isFile() && extname(entry.name) === ".js") files.push(path);
  }
  return files;
}

test("a interface não cria estilos inline incompatíveis com a CSP", async () => {
  const clientFiles = [
    resolve(projectRoot, "index.html"),
    resolve(projectRoot, "theme-init.js"),
    resolve(projectRoot, "app.js"),
    ...await clientJavaScriptFiles(resolve(projectRoot, "js")),
  ];
  const forbidden = [
    { label: "atributo style", pattern: /\bstyle\s*=/i },
    { label: "CSSOM element.style", pattern: /\.style(?:\.|\[)/ },
    { label: "setAttribute style", pattern: /setAttribute\(\s*["']style["']/ },
    { label: "cssText", pattern: /\.cssText\b/ },
  ];

  for (const file of clientFiles) {
    const source = await readFile(file, "utf8");
    for (const rule of forbidden) {
      assert.doesNotMatch(source, rule.pattern, `${rule.label} encontrado em ${file}`);
    }
  }
});

test("a CSP mantém estilos restritos à própria aplicação", async () => {
  const source = await readFile(resolve(projectRoot, "server.js"), "utf8");

  assert.match(source, /styleSrc:\s*\["'self'"\]/);
  assert.match(source, /styleSrcElem:\s*\["'self'"\]/);
  assert.match(source, /styleSrcAttr:\s*\["'none'"\]/);
  assert.doesNotMatch(source, /unsafe-inline/);
  assert.doesNotMatch(source, /contentSecurityPolicy:\s*false/);
  assert.match(source, /connectSrc:\s*\["'self'"\]/);
  const formerMarketplaceApiHost = ["api", "mercado", "libre", "com"].join(".");
  assert.ok(!source.toLowerCase().includes(formerMarketplaceApiHost));
});

test("o bundle do navegador não contém a chave nem o endpoint autenticado da Nexscope", async () => {
  const bundle = await readFile(resolve(projectRoot, "app.js"), "utf8");

  assert.doesNotMatch(bundle, /AMAZON_CREATORS_CREDENTIAL_(?:ID|SECRET)\b|\bAMAZON_PARTNER_TAG\b/);
  assert.doesNotMatch(bundle, /creatorsapi\.amazon|api\.amazon\.(?:com|co\.uk|co\.jp)\/auth\/o2\/token/);
  assert.doesNotMatch(bundle, /NEXSCOPE_API_KEY|api\.nexscope\.ai/);
  assert.match(bundle, /\/market\/search\?q=/);
});

test("indicadores dinâmicos usam progress e SVG sem atributo style", async () => {
  const source = await readFile(resolve(projectRoot, "index.html"), "utf8");

  assert.match(source, /<progress id="marketMeter"/);
  assert.match(source, /id="priceDonutSegments"/);
  assert.doesNotMatch(source, /\bstyle\s*=/i);
});
