import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceFiles = [
  "js/config/pricing.js",
  "js/utils/formatters.js",
  "js/domain/pricing-calculator.js",
  "js/domain/tax-rule-engine.js",
  "js/domain/market-analysis.js",
  "js/services/market-service.js",
  "js/services/api-client.js",
  "js/services/market-reference-store.js",
  "js/ui/form.js",
  "js/ui/detail-pages.js",
  "js/ui/dashboard.js",
  "js/ui/history.js",
  "js/ui/pricing-tabs.js",
  "js/ui/pricing-panel.js",
  "js/main.js",
];

function transformModule(source) {
  return source
    .replace(/^import\s.+?;\r?\n/gm, "")
    .replace(/\bexport\s+/g, "");
}

const modules = await Promise.all(sourceFiles.map(async (file) => transformModule(await readFile(resolve(projectRoot, file), "utf8"))));
const bundle = `/* Gerado por scripts/build.mjs. Edite os arquivos em js/ e execute npm run build. */\n\n${modules.join("\n\n")}`;

await writeFile(resolve(projectRoot, "app.js"), bundle, "utf8");
