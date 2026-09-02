import "dotenv/config";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { getConfig, getFocusNfeConfig, getSearchApiConfig, marketHealth } from "./lib/config.js";
import { pool, verifyDatabase } from "./lib/database.js";
import { runMarketSearch } from "./lib/market-search.js";
import { createSearchApiMarketProvider, searchApiErrorForClient, SearchApiError, redactSearchApiSensitiveData } from "./lib/searchapi-market-provider.js";
import { createFocusNFeClient, focusNFeErrorForClient, FocusNFeError, redactFocusNFeSensitiveData } from "./lib/focus-nfe-client.js";
import { productForClient, userForClient } from "./lib/models.js";
import { hashPassword, verifyPassword } from "./lib/passwords.js";
import { authoritativeProductSnapshot } from "./lib/pricing-persistence.js";
import { loginSchema, marketSearchSchema, productCreateSchema, productIdSchema, productListSchema, productMetadataSchema, registerSchema, validate } from "./lib/validation.js";

const config = getConfig();
const focusNfeConfig = getFocusNfeConfig();
const focusNfeClient = focusNfeConfig.isConfigured ? createFocusNFeClient(focusNfeConfig) : null;
const searchApiConfig = getSearchApiConfig();
const marketProvider = searchApiConfig.isConfigured ? createSearchApiMarketProvider(searchApiConfig) : null;
const projectRoot = dirname(fileURLToPath(import.meta.url));
const app = express();
const PgSession = connectPgSimple(session);

console.info(
  `[Fiscal] Provider: FocusNFe | configured=${focusNfeConfig.isConfigured} | environment=${focusNfeConfig.environment}`,
);
console.info("[Market] Provider: SearchAPI Google Shopping");
console.info(`[Market] Configured: ${searchApiConfig.isConfigured}`);
if (!searchApiConfig.isConfigured) {
  console.warn(`[Market] Missing environment variables: ${searchApiConfig.missingEnvironmentVariables.join(", ")}`);
}

app.disable("x-powered-by");
if (config.secureCookie) app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:", "https:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        styleSrcElem: ["'self'"],
        styleSrcAttr: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(express.json({ limit: "100kb" }));
app.use((req, res, next) => {
  if (req.path.startsWith("/auth") || req.path.startsWith("/products") || req.path.startsWith("/fiscal") || req.path.startsWith("/market")) {
    res.set("Cache-Control", "no-store");
  }
  next();
});
app.use(
  session({
    name: "pricing.sid",
    store: new PgSession({ pool, tableName: "user_sessions", createTableIfMissing: false }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
      secure: config.secureCookie,
    },
  }),
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente." },
});

const fiscalLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Muitas consultas fiscais. Aguarde um minuto e tente novamente." },
});

const marketSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Muitas consultas de mercado. Aguarde um minuto e tente novamente.", code: "MARKET_RATE_LIMITED" },
});

function sessionRegenerate(req) {
  return new Promise((resolvePromise, reject) => req.session.regenerate((error) => (error ? reject(error) : resolvePromise())));
}

function sessionSave(req) {
  return new Promise((resolvePromise, reject) => req.session.save((error) => (error ? reject(error) : resolvePromise())));
}

async function authenticateSession(req, user) {
  await sessionRegenerate(req);
  req.session.userId = user.id;
  await sessionSave(req);
}

async function currentUser(req) {
  if (!req.session.userId) return null;
  const { rows } = await pool.query("SELECT id, name, email, created_at, updated_at FROM users WHERE id = $1", [req.session.userId]);
  return rows[0] || null;
}

async function requireAuth(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: "Sua sessão expirou. Entre novamente para continuar." });
    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

function productColumns(includeCalculation = true) {
  const calculation = includeCalculation ? ", calculation_data" : "";
  return `id, name, description, category, cost_price, additional_costs, profit_margin, suggested_price, marketplace, consultation_date, created_at, updated_at${calculation}`;
}

app.post("/auth/register", authLimiter, async (req, res, next) => {
  try {
    const input = validate(registerSchema, req.body);
    const passwordHash = await hashPassword(input.password);
    const { rows } = await pool.query(
      "INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, name, email, created_at, updated_at",
      [randomUUID(), input.name, input.email, passwordHash],
    );
    const user = rows[0];
    await authenticateSession(req, user);
    console.info(`[auth] Conta criada com sucesso: ${user.id}`);
    return res.status(201).json({ user: userForClient(user) });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Já existe uma conta cadastrada com este e-mail." });
    return next(error);
  }
});

app.post("/auth/login", authLimiter, async (req, res, next) => {
  try {
    const input = validate(loginSchema, req.body);
    const { rows } = await pool.query("SELECT id, name, email, password_hash, created_at, updated_at FROM users WHERE email = $1", [input.email]);
    const user = rows[0];
    const validPassword = user && (await verifyPassword(input.password, user.password_hash));
    if (!validPassword) return res.status(401).json({ error: "E-mail ou senha inválidos." });

    await authenticateSession(req, user);
    return res.json({ user: userForClient(user) });
  } catch (error) {
    return next(error);
  }
});

app.post("/auth/logout", async (req, res, next) => {
  try {
    if (!req.session) return res.status(204).end();
    await new Promise((resolvePromise, reject) => req.session.destroy((error) => (error ? reject(error) : resolvePromise())));
    res.clearCookie("pricing.sid");
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

app.get("/auth/me", async (req, res, next) => {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: "Nenhuma sessão ativa." });
    return res.json({ user: userForClient(user) });
  } catch (error) {
    return next(error);
  }
});

app.get("/health", async (req, res, next) => {
  try {
    await pool.query("SELECT 1");
    return res.json({
      status: "ok",
      database: "connected",
      fiscal: {
        configured: focusNfeConfig.isConfigured,
        environment: focusNfeConfig.environment,
        provider: "FocusNFe",
      },
      market: marketHealth(searchApiConfig),
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/market/search", requireAuth, marketSearchLimiter, async (req, res, next) => {
  try {
    const { q } = validate(marketSearchSchema, req.query, { code: "INVALID_MARKET_QUERY" });
    const result = await runMarketSearch({ provider: marketProvider, config: searchApiConfig, query: q });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

app.get("/fiscal/ncms/:codigo", requireAuth, fiscalLookupLimiter, async (req, res, next) => {
  try {
    const normalizedCode = String(req.params.codigo || "").replace(/\D/g, "");
    console.info(`[Fiscal] Consultando NCM ${normalizedCode || "inválido"}`, {
      environment: focusNfeConfig.environment,
      provider: "FocusNFe",
    });
    if (!focusNfeClient) {
      throw new FocusNFeError("A consulta fiscal ainda não foi configurada neste ambiente.", {
        code: "FOCUS_NFE_NOT_CONFIGURED",
        status: 503,
      });
    }

    const ncm = await focusNfeClient.getNcm(normalizedCode);
    console.info(`[Fiscal] Consulta concluída para NCM ${ncm.codigo}`, { provider: "FocusNFe" });
    return res.json({
      ncm,
      source: "Focus NFe",
      environment: focusNfeConfig.environment === "production" ? "produção" : "homologação",
      taxCalculationAvailable: false,
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/products", requireAuth, async (req, res, next) => {
  try {
    const { search, sort, limit } = validate(productListSchema, req.query);
    const direction = sort === "asc" ? "ASC" : "DESC";
    const { rows } = await pool.query(
      `SELECT ${productColumns()} FROM products
       WHERE user_id = $1 AND name ILIKE $2
       ORDER BY consultation_date ${direction}, created_at ${direction}
       LIMIT $3`,
      [req.user.id, `%${search}%`, limit],
    );
    return res.json({ products: rows.map((row) => productForClient(row)) });
  } catch (error) {
    return next(error);
  }
});

app.get("/products/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = validate(productIdSchema, req.params);
    const { rows } = await pool.query(`SELECT ${productColumns()} FROM products WHERE id = $1 AND user_id = $2`, [id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: "Produto não encontrado." });
    return res.json({ product: productForClient(rows[0]) });
  } catch (error) {
    return next(error);
  }
});

app.post("/products", requireAuth, async (req, res, next) => {
  try {
    const request = validate(productCreateSchema, req.body);
    const input = authoritativeProductSnapshot(request);
    const { rows } = await pool.query(
      `INSERT INTO products (
        id, user_id, name, description, category, cost_price, additional_costs, profit_margin,
        suggested_price, marketplace, consultation_date, calculation_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::timestamptz, NOW()), $12::jsonb)
      RETURNING ${productColumns()}`,
      [
        randomUUID(), req.user.id, input.name, input.description, input.category, input.costPrice,
        input.additionalCosts, input.profitMargin, input.suggestedPrice, input.marketplace,
        null, JSON.stringify(input.calculationData),
      ],
    );
    return res.status(201).json({ product: productForClient(rows[0]) });
  } catch (error) {
    return next(error);
  }
});

app.patch("/products/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = validate(productIdSchema, req.params);
    const input = validate(productMetadataSchema, req.body);
    const { rows } = await pool.query(
      `UPDATE products SET
        name = $3, description = $4, category = $5
       WHERE id = $1 AND user_id = $2
       RETURNING ${productColumns()}`,
      [
        id, req.user.id, input.name, input.description, input.category,
      ],
    );
    if (!rows[0]) return res.status(404).json({ error: "Produto não encontrado." });
    return res.json({ product: productForClient(rows[0]) });
  } catch (error) {
    return next(error);
  }
});

app.delete("/products/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = validate(productIdSchema, req.params);
    const { rowCount } = await pool.query("DELETE FROM products WHERE id = $1 AND user_id = $2", [id, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: "Produto não encontrado." });
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

app.get(["/", "/index.html"], (req, res) => res.sendFile(resolve(projectRoot, "index.html")));
app.get("/styles.css", (req, res) => res.sendFile(resolve(projectRoot, "styles.css")));
app.get("/favicon.svg", (req, res) => res.sendFile(resolve(projectRoot, "favicon.svg")));
app.get("/theme-init.js", (req, res) => res.sendFile(resolve(projectRoot, "theme-init.js")));
app.get("/file-protocol-redirect.js", (req, res) => res.sendFile(resolve(projectRoot, "file-protocol-redirect.js")));
app.get("/app.js", (req, res) => res.sendFile(resolve(projectRoot, "app.js")));

function isDatabaseError(error) {
  return ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "28P01", "3D000", "57P01", "MIGRATIONS_PENDING"].includes(error.code);
}

app.use((error, req, res, next) => {
  const safeLogMessage = error instanceof FocusNFeError
    ? redactFocusNFeSensitiveData(error.message, [focusNfeConfig.token])
    : error instanceof SearchApiError
      ? redactSearchApiSensitiveData(error.message, [searchApiConfig.apiKey])
      : error.message;
  console.error(`[api] ${req.method} ${req.path} falhou (${error.code || "UNKNOWN"}):`, safeLogMessage);
  if (res.headersSent) return next(error);
  const status = isDatabaseError(error) ? 503 : error.status || 500;
  const message =
    status === 503
      ? "Não foi possível conectar ao banco de dados. Tente novamente mais tarde."
      : status >= 500 && req.path === "/auth/register"
        ? "Não foi possível criar sua conta. Tente novamente."
        : status >= 500
          ? "Não foi possível concluir a operação. Tente novamente em instantes."
          : error.message;
  const payload = error instanceof FocusNFeError
    ? focusNFeErrorForClient(error, [focusNfeConfig.token])
    : error instanceof SearchApiError
      ? searchApiErrorForClient(error)
      : { error: message };
  return res.status(status).json(payload);
});

async function startServer() {
  try {
    await verifyDatabase();
    app.listen(config.port, () => {
      console.log(`Assistente de Precificação disponível em http://localhost:${config.port}`);
    });
  } catch (error) {
    console.error(`[startup] Não foi possível iniciar o servidor (${error.code || "DATABASE_ERROR"}): ${error.message}`);
    await pool.end();
    process.exitCode = 1;
  }
}

void startServer();
