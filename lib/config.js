import "dotenv/config";

export const FOCUS_NFE_ENVIRONMENTS = Object.freeze({
  homologation: "https://homologacao.focusnfe.com.br",
  production: "https://api.focusnfe.com.br",
});

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

function parseFocusTimeout(value) {
  const timeoutMs = Number.parseInt(value || "5000", 10);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new Error("FOCUS_NFE_TIMEOUT_MS deve ser um inteiro entre 100 e 30000.");
  }
  return timeoutMs;
}

export function getFocusNfeConfig(env = process.env) {
  const token = env.FOCUS_NFE_TOKEN?.trim() || "";
  const defaultBaseUrl = env.NODE_ENV === "production"
    ? FOCUS_NFE_ENVIRONMENTS.production
    : FOCUS_NFE_ENVIRONMENTS.homologation;
  const rawBaseUrl = env.FOCUS_NFE_BASE_URL?.trim() || defaultBaseUrl;
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");
  const environment = Object.entries(FOCUS_NFE_ENVIRONMENTS).find(([, url]) => url === baseUrl)?.[0];

  if (!environment) {
    throw new Error(
      "FOCUS_NFE_BASE_URL deve apontar exatamente para homologação ou produção. Consulte .env.example.",
    );
  }

  return {
    baseUrl,
    environment,
    isConfigured: token.length > 0,
    timeoutMs: parseFocusTimeout(env.FOCUS_NFE_TIMEOUT_MS),
    token,
  };
}

function parseSearchApiTimeout(value) {
  const timeoutMs = Number.parseInt(value || "15000", 10);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new Error("SEARCHAPI_TIMEOUT_MS deve ser um inteiro entre 100 e 30000.");
  }
  return timeoutMs;
}

export function getSearchApiConfig(env = process.env) {
  const apiKey = env.SEARCHAPI_API_KEY?.trim() || "";
  return {
    apiKey,
    country: "br",
    engine: "google_shopping",
    isConfigured: apiKey.length > 0,
    language: "pt-br",
    marketplace: "Google Shopping",
    missingEnvironmentVariables: apiKey ? [] : ["SEARCHAPI_API_KEY"],
    timeoutMs: parseSearchApiTimeout(env.SEARCHAPI_TIMEOUT_MS),
  };
}

export function marketHealth(config) {
  return {
    provider: "SearchAPI / Google Shopping",
    configured: config.isConfigured === true,
  };
}
