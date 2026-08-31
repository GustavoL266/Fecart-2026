import "dotenv/config";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} não foi definida. Consulte .env.example.`);
  return value;
}

export function getConfig() {
  const nodeEnv = process.env.NODE_ENV || "development";
  const sessionSecret = required("SESSION_SECRET");

  if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET deve ter ao menos 32 caracteres aleatórios.");
  }

  return {
    databaseUrl: required("DATABASE_URL"),
    nodeEnv,
    isProduction: nodeEnv === "production",
    port: Number.parseInt(process.env.PORT || "3000", 10),
    sessionSecret,
    secureCookie: process.env.SESSION_COOKIE_SECURE === "true" || nodeEnv === "production",
  };
}
