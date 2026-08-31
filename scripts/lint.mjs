import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extname, resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ignoredDirectories = new Set(["node_modules", ".git", ".postgres-data"]);

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) {
      files.push(...await javascriptFiles(resolve(directory, entry.name)));
    } else if (entry.isFile() && [".js", ".mjs"].includes(extname(entry.name))) {
      files.push(resolve(directory, entry.name));
    }
  }
  return files;
}

const files = await javascriptFiles(projectRoot);
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `Falha ao validar ${file}.\n`);
    process.exit(result.status || 1);
  }
}

console.log(`Sintaxe validada em ${files.length} arquivos JavaScript.`);
