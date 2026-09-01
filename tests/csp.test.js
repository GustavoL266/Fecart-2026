import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { contentSecurityPolicyDirectives } from "../lib/security.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) files.push(...await javascriptFiles(resolve(directory, entry.name)));
    else if (extname(entry.name) === ".js") files.push(resolve(directory, entry.name));
  }
  return files;
}

test("CSP mantém scripts e estilos restritos à aplicação", () => {
  assert.deepEqual(contentSecurityPolicyDirectives.scriptSrc, ["'self'"]);
  assert.deepEqual(contentSecurityPolicyDirectives.styleSrc, ["'self'"]);
  assert.deepEqual(contentSecurityPolicyDirectives.styleSrcElem, ["'self'"]);
  assert.deepEqual(contentSecurityPolicyDirectives.styleSrcAttr, ["'none'"]);
  assert.equal(contentSecurityPolicyDirectives.styleSrc.includes("'unsafe-inline'"), false);
});

test("interface não cria atributos style incompatíveis com a CSP", async () => {
  const sourceFiles = [
    resolve(projectRoot, "theme-init.js"),
    resolve(projectRoot, "app.js"),
    ...await javascriptFiles(resolve(projectRoot, "js")),
  ];
  const sources = await Promise.all(sourceFiles.map((file) => readFile(file, "utf8")));
  const html = await readFile(resolve(projectRoot, "index.html"), "utf8");

  for (const source of sources) {
    assert.doesNotMatch(source, /\.style\b|setAttribute\(\s*["']style["']|\.cssText\b|\.setProperty\s*\(/);
  }
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.match(html, /<progress[^>]+id="marketMeter"[^>]+max="100"[^>]+value="0"/);
});
