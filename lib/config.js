import "dotenv/config";

export const FOCUS_NFE_ENVIRONMENTS = Object.freeze({
  homologation: "https://homologacao.focusnfe.com.br",
  production: "https://api.focusnfe.com.br",
});

export const AMAZON_MARKETPLACE_BRAZIL = "www.amazon.com.br";
export const AMAZON_CREATORS_TOKEN_ENDPOINTS = Object.freeze({
  "3.1": "https://api.amazon.com/auth/o2/token",
  "3.2": "https://api.amazon.co.uk/auth/o2/token",
  "3.3": "https://api.amazon.co.jp/auth/o2/token",
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

function parseAmazonTimeout(value) {
  const timeoutMs = Number.parseInt(value || "5000", 10);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new Error("AMAZON_CREATORS_TIMEOUT_MS deve ser um inteiro entre 100 e 30000.");
  }
  return timeoutMs;
}

export function getAmazonCreatorsConfig(env = process.env) {
  const credentialId = env.AMAZON_CREATORS_CREDENTIAL_ID?.trim() || "";
  const credentialSecret = env.AMAZON_CREATORS_CREDENTIAL_SECRET?.trim() || "";
  const credentialVersion = env.AMAZON_CREATORS_CREDENTIAL_VERSION?.trim() || "3.1";
  const partnerTag = env.AMAZON_PARTNER_TAG?.trim() || "";
  const marketplace = env.AMAZON_MARKETPLACE?.trim() || AMAZON_MARKETPLACE_BRAZIL;
  const tokenEndpoint = AMAZON_CREATORS_TOKEN_ENDPOINTS[credentialVersion];

  if (!tokenEndpoint) {
    throw new Error("AMAZON_CREATORS_CREDENTIAL_VERSION deve ser 3.1, 3.2 ou 3.3.");
  }
  if (marketplace !== AMAZON_MARKETPLACE_BRAZIL) {
    throw new Error(`AMAZON_MARKETPLACE deve ser ${AMAZON_MARKETPLACE_BRAZIL}.`);
  }

  const missingEnvironmentVariables = [
    ["AMAZON_CREATORS_CREDENTIAL_ID", credentialId],
    ["AMAZON_CREATORS_CREDENTIAL_SECRET", credentialSecret],
    ["AMAZON_PARTNER_TAG", partnerTag],
  ].filter(([, value]) => !value).map(([name]) => name);

  return {
    credentialId,
    credentialSecret,
    credentialVersion,
    isConfigured: missingEnvironmentVariables.length === 0,
    marketplace,
    missingEnvironmentVariables,
    partnerTag,
    timeoutMs: parseAmazonTimeout(env.AMAZON_CREATORS_TIMEOUT_MS),
    tokenEndpoint,
  };
}
