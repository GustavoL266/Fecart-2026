import pg from "pg";
import { getConfig } from "./config.js";

const { Pool } = pg;
const config = getConfig();

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.isProduction ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on("error", (error) => {
  console.error("Erro inesperado no pool do PostgreSQL:", error.message);
});

export async function verifyDatabase() {
  await pool.query("SELECT 1");
  const { rows } = await pool.query(
    `SELECT
      to_regclass('public.users') AS users,
      to_regclass('public.products') AS products,
      to_regclass('public.user_sessions') AS sessions,
      to_regclass('public.login_verifications') AS login_verifications,
      to_regclass('public.password_reset_tokens') AS password_reset_tokens,
      to_regclass('public.auth_rate_limits') AS auth_rate_limits`,
  );
  const tables = rows[0];

  if (!tables.users || !tables.products || !tables.sessions || !tables.login_verifications || !tables.password_reset_tokens || !tables.auth_rate_limits) {
    const error = new Error("As tabelas do banco ainda não foram criadas. Execute pnpm migrate antes de iniciar o servidor.");
    error.code = "MIGRATIONS_PENDING";
    throw error;
  }
}
