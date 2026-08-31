import "dotenv/config";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} não foi definida. Consulte .env.example.`);
  return value;
}

export function getConfig() {
  const nodeEnv = process.env.NODE_ENV || "development";
  const sessionSecret = required("SESSION_SECRET");
  const port = Number.parseInt(process.env.PORT || "3000", 10);
  const resendApiKey = process.env.RESEND_API_KEY?.trim() || "";
  const emailFrom = process.env.EMAIL_FROM?.trim() || "";
  const appUrl = (process.env.APP_URL?.trim() || process.env.RENDER_EXTERNAL_URL?.trim() || `http://localhost:${port}`).replace(/\/+$/, "");

  if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET deve ter ao menos 32 caracteres aleatórios.");
  }

  if (nodeEnv === "production" && (!resendApiKey || !emailFrom)) {
    throw new Error("RESEND_API_KEY e EMAIL_FROM devem ser definidos em produção.");
  }

  try {
    const parsedAppUrl = new URL(appUrl);
    if (!(["http:", "https:"].includes(parsedAppUrl.protocol))) throw new Error();
  } catch {
    throw new Error("APP_URL deve ser uma URL HTTP ou HTTPS válida.");
  }

  return {
    appUrl,
    databaseUrl: required("DATABASE_URL"),
    emailFrom,
    nodeEnv,
    isProduction: nodeEnv === "production",
    port,
    resendApiKey,
    sessionSecret,
    secureCookie: process.env.SESSION_COOKIE_SECURE === "true" || nodeEnv === "production",
  };
}
