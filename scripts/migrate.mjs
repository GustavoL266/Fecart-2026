import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não foi definida. Copie .env.example para .env e informe o PostgreSQL local.");
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = resolve(projectRoot, "migrations");
const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

await client.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const applied = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((row) => row.name));
  const migrationFiles = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();

  for (const name of migrationFiles) {
    if (applied.has(name)) continue;

    const sql = await readFile(resolve(migrationsDirectory, name), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      await client.query("COMMIT");
      console.log(`Migração aplicada: ${name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.end();
}
