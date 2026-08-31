import "dotenv/config";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { getConfig } from "./lib/config.js";
import { pool, verifyDatabase } from "./lib/database.js";
import { sendLoginVerificationEmail, sendPasswordResetEmail } from "./lib/email.js";
import { productForClient, userForClient } from "./lib/models.js";
import { hashPassword, verifyPassword } from "./lib/passwords.js";
import {
  generateLoginCode,
  generatePasswordResetToken,
  hashesMatch,
  hashLoginCode,
  hashPasswordResetToken,
  hashRateLimitKey,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_RESEND_DELAY_MS,
  LOGIN_CODE_TTL_MS,
  LOGIN_CODE_WINDOW_LIMIT,
  LOGIN_CODE_WINDOW_MS,
  loginVerificationStatus,
  parsePasswordResetToken,
  PASSWORD_RESET_TTL_MS,
  passwordResetStatus,
} from "./lib/auth-security.js";
import {
  forgotPasswordSchema,
  loginSchema,
  loginVerificationSchema,
  productIdSchema,
  productListSchema,
  productSchema,
  registerSchema,
  resetPasswordSchema,
  resetTokenSchema,
  validate,
} from "./lib/validation.js";

const config = getConfig();
const projectRoot = dirname(fileURLToPath(import.meta.url));
const app = express();
const PgSession = connectPgSimple(session);
const genericPasswordResetMessage = "Se existir uma conta com este e-mail, enviaremos as instruções para redefinir sua senha.";
const dummyPasswordHashPromise = hashPassword("comparacao-temporal-sem-usuario-48291");

app.disable("x-powered-by");
if (config.secureCookie) app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'", "https://api.mercadolibre.com"],
        fontSrc: ["'self'", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:", "https:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(express.json({ limit: "100kb" }));
app.use((req, res, next) => {
  if (req.path.startsWith("/auth") || req.path.startsWith("/products")) res.set("Cache-Control", "no-store");
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

function createRateLimiter(limit, windowMs = 15 * 60 * 1000) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente." },
  });
}

const registrationLimiter = createRateLimiter(10);
const loginLimiter = createRateLimiter(10);
const verificationLimiter = createRateLimiter(15);
const resendLimiter = createRateLimiter(5);
const forgotPasswordLimiter = createRateLimiter(5);
const resetPasswordLimiter = createRateLimiter(10);

function httpError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function consumeIdentifierRateLimit(action, identifier, limit, windowMs) {
  const keyHash = hashRateLimitKey(identifier, config.sessionSecret);
  const { rows } = await pool.query(
    `INSERT INTO auth_rate_limits (action, key_hash, window_started_at, attempts, updated_at)
     VALUES ($1, $2, NOW(), 1, NOW())
     ON CONFLICT (action, key_hash) DO UPDATE SET
       attempts = CASE
         WHEN auth_rate_limits.window_started_at <= NOW() - ($3::double precision * INTERVAL '1 millisecond') THEN 1
         ELSE auth_rate_limits.attempts + 1
       END,
       window_started_at = CASE
         WHEN auth_rate_limits.window_started_at <= NOW() - ($3::double precision * INTERVAL '1 millisecond') THEN NOW()
         ELSE auth_rate_limits.window_started_at
       END,
       updated_at = NOW()
     RETURNING attempts`,
    [action, keyHash, windowMs],
  );
  return Number(rows[0].attempts) <= limit;
}

async function createLoginVerification(user, minimumIntervalMs) {
  const verificationId = randomUUID();
  const code = generateLoginCode();
  const codeHash = hashLoginCode(code, verificationId, config.sessionSecret);
  const expiresAt = new Date(Date.now() + LOGIN_CODE_TTL_MS);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [user.id]);
    const { rows } = await client.query(
      `SELECT created_at, COUNT(*) OVER ()::integer AS recent_count
       FROM login_verifications
       WHERE user_id = $1 AND created_at > NOW() - ($2::double precision * INTERVAL '1 millisecond')
       ORDER BY created_at DESC
       LIMIT 1`,
      [user.id, LOGIN_CODE_WINDOW_MS],
    );
    const latest = rows[0];
    if (latest && Number(latest.recent_count) >= LOGIN_CODE_WINDOW_LIMIT) {
      throw httpError("Muitas solicitações de código. Aguarde alguns minutos e tente novamente.", 429, "LOGIN_CODE_RATE_LIMIT");
    }
    if (latest && Date.now() - new Date(latest.created_at).getTime() < minimumIntervalMs) {
      throw httpError("Aguarde alguns segundos antes de solicitar outro código.", 429, "LOGIN_CODE_COOLDOWN");
    }

    await client.query("UPDATE login_verifications SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL", [user.id]);
    await client.query(
      `INSERT INTO login_verifications (id, user_id, code_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [verificationId, user.id, codeHash, expiresAt],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  try {
    const providerId = await sendLoginVerificationEmail(config, user.email, code);
    console.info(`[auth] Código de login enviado: verification=${verificationId} provider=${providerId}`);
  } catch (error) {
    await pool.query("UPDATE login_verifications SET used_at = NOW() WHERE id = $1", [verificationId]);
    console.error(`[auth] Falha ao enviar código de login (${error.code || "EMAIL_ERROR"}): ${error.message}`);
    throw httpError("Não foi possível enviar o código de acesso. Tente novamente em instantes.", 503, "LOGIN_CODE_DELIVERY_FAILED");
  }

  return { id: verificationId, expiresAt };
}

async function setPendingLogin(req, userId, verificationId, regenerate = false) {
  if (regenerate) await sessionRegenerate(req);
  req.session.pendingLogin = { userId, verificationId };
  delete req.session.userId;
  await sessionSave(req);
}

async function attemptLoginVerification(pendingLogin, code) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT lv.*, u.name, u.email, u.created_at AS user_created_at, u.updated_at AS user_updated_at
       FROM login_verifications lv
       JOIN users u ON u.id = lv.user_id
       WHERE lv.id = $1 AND lv.user_id = $2
       FOR UPDATE OF lv`,
      [pendingLogin.verificationId, pendingLogin.userId],
    );
    const verification = rows[0];
    const status = loginVerificationStatus(verification);
    if (status !== "active") {
      await client.query("COMMIT");
      return { status };
    }

    const candidateHash = hashLoginCode(code, verification.id, config.sessionSecret);
    if (!hashesMatch(candidateHash, verification.code_hash)) {
      const attempts = Number(verification.attempts) + 1;
      await client.query("UPDATE login_verifications SET attempts = $2 WHERE id = $1", [verification.id, attempts]);
      await client.query("COMMIT");
      return { status: attempts >= LOGIN_CODE_MAX_ATTEMPTS ? "attempts_exceeded" : "incorrect" };
    }

    await client.query("UPDATE login_verifications SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL", [verification.user_id]);
    await client.query("COMMIT");
    return {
      status: "verified",
      user: {
        id: verification.user_id,
        name: verification.name,
        email: verification.email,
        created_at: verification.user_created_at,
        updated_at: verification.user_updated_at,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createPasswordReset(user) {
  const tokenId = randomUUID();
  const token = generatePasswordResetToken(tokenId);
  const parsed = parsePasswordResetToken(token);
  const tokenHash = hashPasswordResetToken(parsed.secret, tokenId, config.sessionSecret);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [user.id]);
    await client.query("UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL", [user.id]);
    await client.query(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [tokenId, user.id, tokenHash, expiresAt],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  try {
    const resetUrl = `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
    const providerId = await sendPasswordResetEmail(config, user.email, resetUrl);
    console.info(`[auth] E-mail de recuperação enviado: reset=${tokenId} provider=${providerId}`);
  } catch (error) {
    await pool.query("UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1", [tokenId]);
    console.error(`[auth] Falha ao enviar recuperação de senha (${error.code || "EMAIL_ERROR"}): ${error.message}`);
  }
}

async function applyPasswordReset(parsedToken, passwordHash) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT pr.*
       FROM password_reset_tokens pr
       JOIN users u ON u.id = pr.user_id
       WHERE pr.id = $1
       FOR UPDATE OF pr`,
      [parsedToken.id],
    );
    const resetToken = rows[0];
    if (!resetToken) {
      await client.query("COMMIT");
      return "invalid";
    }

    const candidateHash = hashPasswordResetToken(parsedToken.secret, parsedToken.id, config.sessionSecret);
    if (!hashesMatch(candidateHash, resetToken.token_hash)) {
      await client.query("COMMIT");
      return "invalid";
    }

    const status = passwordResetStatus(resetToken);
    if (status !== "active") {
      await client.query("COMMIT");
      return status;
    }

    await client.query("UPDATE users SET password_hash = $2 WHERE id = $1", [resetToken.user_id, passwordHash]);
    await client.query("UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL", [resetToken.user_id]);
    await client.query("UPDATE login_verifications SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL", [resetToken.user_id]);
    await client.query("DELETE FROM user_sessions WHERE sess->>'userId' = $1", [resetToken.user_id]);
    await client.query("COMMIT");
    console.info(`[auth] Senha redefinida e sessões invalidadas: user=${resetToken.user_id}`);
    return "reset";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function isPasswordResetTokenValid(parsedToken) {
  const { rows } = await pool.query(
    "SELECT token_hash, expires_at, used_at FROM password_reset_tokens WHERE id = $1",
    [parsedToken.id],
  );
  const resetToken = rows[0];
  if (!resetToken) return false;
  const candidateHash = hashPasswordResetToken(parsedToken.secret, parsedToken.id, config.sessionSecret);
  return hashesMatch(candidateHash, resetToken.token_hash) && passwordResetStatus(resetToken) === "active";
}

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

app.post("/auth/register", registrationLimiter, async (req, res, next) => {
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

app.post("/auth/login", loginLimiter, async (req, res, next) => {
  try {
    const input = validate(loginSchema, req.body);
    const { rows } = await pool.query("SELECT id, name, email, password_hash, created_at, updated_at FROM users WHERE email = $1", [input.email]);
    const user = rows[0];
    const passwordHash = user?.password_hash || (await dummyPasswordHashPromise);
    const validPassword = await verifyPassword(input.password, passwordHash);
    if (!user || !validPassword) return res.status(401).json({ error: "E-mail ou senha inválidos." });

    const verification = await createLoginVerification(user, 0);
    await setPendingLogin(req, user.id, verification.id, true);
    return res.status(202).json({
      requiresVerification: true,
      expiresInSeconds: Math.round(LOGIN_CODE_TTL_MS / 1000),
      resendAfterSeconds: Math.round(LOGIN_CODE_RESEND_DELAY_MS / 1000),
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/auth/verify-login", verificationLimiter, async (req, res, next) => {
  try {
    const input = validate(loginVerificationSchema, req.body);
    const pendingLogin = req.session.pendingLogin;
    if (!pendingLogin) return res.status(400).json({ error: "Inicie o login novamente para solicitar um novo código." });

    const result = await attemptLoginVerification(pendingLogin, input.code);
    if (result.status === "incorrect") return res.status(400).json({ error: "O código informado está incorreto." });
    if (result.status === "expired") return res.status(410).json({ error: "Este código expirou. Solicite um novo." });
    if (result.status === "attempts_exceeded") {
      return res.status(429).json({ error: "Você excedeu o número de tentativas. Solicite um novo código." });
    }
    if (result.status !== "verified") {
      return res.status(400).json({ error: "Este código não é mais válido. Inicie o login novamente." });
    }

    await authenticateSession(req, result.user);
    console.info(`[auth] Login confirmado por código: user=${result.user.id}`);
    return res.json({ user: userForClient(result.user) });
  } catch (error) {
    return next(error);
  }
});

app.post("/auth/resend-login-code", resendLimiter, async (req, res, next) => {
  try {
    const pendingLogin = req.session.pendingLogin;
    if (!pendingLogin) return res.status(400).json({ error: "Inicie o login novamente para solicitar um novo código." });

    const { rows } = await pool.query("SELECT id, email FROM users WHERE id = $1", [pendingLogin.userId]);
    const user = rows[0];
    if (!user) return res.status(400).json({ error: "Inicie o login novamente para solicitar um novo código." });

    const verification = await createLoginVerification(user, LOGIN_CODE_RESEND_DELAY_MS);
    await setPendingLogin(req, user.id, verification.id);
    return res.status(202).json({
      requiresVerification: true,
      expiresInSeconds: Math.round(LOGIN_CODE_TTL_MS / 1000),
      resendAfterSeconds: Math.round(LOGIN_CODE_RESEND_DELAY_MS / 1000),
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/auth/forgot-password", forgotPasswordLimiter, async (req, res, next) => {
  const startedAt = Date.now();
  try {
    const input = validate(forgotPasswordSchema, req.body);
    const allowed = await consumeIdentifierRateLimit("forgot-password", input.email, 3, 60 * 60 * 1000);
    if (allowed) {
      const { rows } = await pool.query("SELECT id, email FROM users WHERE email = $1", [input.email]);
      if (rows[0]) await createPasswordReset(rows[0]);
    } else {
      console.warn("[auth] Solicitação de recuperação limitada por identificador.");
    }
    await sleep(Math.max(0, 350 - (Date.now() - startedAt)));
    return res.json({ message: genericPasswordResetMessage });
  } catch (error) {
    if (error.code === "VALIDATION_ERROR") return next(error);
    console.error(`[auth] Falha interna na recuperação de senha (${error.code || "UNKNOWN"}): ${error.message}`);
    await sleep(Math.max(0, 350 - (Date.now() - startedAt)));
    return res.json({ message: genericPasswordResetMessage });
  }
});

app.post("/auth/reset-password", resetPasswordLimiter, async (req, res, next) => {
  try {
    const input = validate(resetPasswordSchema, req.body);
    const parsedToken = parsePasswordResetToken(input.token);
    if (!parsedToken) return res.status(400).json({ error: "Este link de redefinição é inválido ou expirou." });

    const passwordHash = await hashPassword(input.password);
    const result = await applyPasswordReset(parsedToken, passwordHash);
    if (result !== "reset") return res.status(400).json({ error: "Este link de redefinição é inválido ou expirou." });
    return res.json({ message: "Senha redefinida com sucesso." });
  } catch (error) {
    return next(error);
  }
});

app.post("/auth/validate-reset-token", resetPasswordLimiter, async (req, res, next) => {
  try {
    const input = validate(resetTokenSchema, req.body);
    const parsedToken = parsePasswordResetToken(input.token);
    const valid = parsedToken && (await isPasswordResetTokenValid(parsedToken));
    if (!valid) return res.status(400).json({ error: "Este link de redefinição é inválido ou expirou." });
    return res.json({ valid: true });
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
    return res.json({ status: "ok", database: "connected" });
  } catch (error) {
    return next(error);
  }
});

app.get("/products", requireAuth, async (req, res, next) => {
  try {
    const { search, sort, limit } = validate(productListSchema, req.query);
    const direction = sort === "asc" ? "ASC" : "DESC";
    const { rows } = await pool.query(
      `SELECT ${productColumns(false)} FROM products
       WHERE user_id = $1 AND name ILIKE $2
       ORDER BY consultation_date ${direction}, created_at ${direction}
       LIMIT $3`,
      [req.user.id, `%${search}%`, limit],
    );
    return res.json({ products: rows.map((row) => productForClient(row, false)) });
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
    const input = validate(productSchema, req.body);
    const { rows } = await pool.query(
      `INSERT INTO products (
        id, user_id, name, description, category, cost_price, additional_costs, profit_margin,
        suggested_price, marketplace, consultation_date, calculation_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::timestamptz, NOW()), $12::jsonb)
      RETURNING ${productColumns()}`,
      [
        randomUUID(), req.user.id, input.name, input.description, input.category, input.costPrice,
        input.additionalCosts, input.profitMargin, input.suggestedPrice, input.marketplace,
        input.consultationDate || null, JSON.stringify(input.calculationData),
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
    const input = validate(productSchema, req.body);
    const { rows } = await pool.query(
      `UPDATE products SET
        name = $3, description = $4, category = $5, cost_price = $6, additional_costs = $7,
        profit_margin = $8, suggested_price = $9, marketplace = $10,
        consultation_date = COALESCE($11::timestamptz, consultation_date), calculation_data = $12::jsonb
       WHERE id = $1 AND user_id = $2
       RETURNING ${productColumns()}`,
      [
        id, req.user.id, input.name, input.description, input.category, input.costPrice,
        input.additionalCosts, input.profitMargin, input.suggestedPrice, input.marketplace,
        input.consultationDate || null, JSON.stringify(input.calculationData),
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

app.get(["/", "/index.html", "/reset-password"], (req, res) => res.sendFile(resolve(projectRoot, "index.html")));
app.get("/styles.css", (req, res) => res.sendFile(resolve(projectRoot, "styles.css")));
app.get("/favicon.svg", (req, res) => res.sendFile(resolve(projectRoot, "favicon.svg")));
app.get("/theme-init.js", (req, res) => res.sendFile(resolve(projectRoot, "theme-init.js")));
app.get("/file-protocol-redirect.js", (req, res) => res.sendFile(resolve(projectRoot, "file-protocol-redirect.js")));
app.get("/app.js", (req, res) => res.sendFile(resolve(projectRoot, "app.js")));

function isDatabaseError(error) {
  return ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "28P01", "3D000", "57P01", "MIGRATIONS_PENDING"].includes(error.code);
}

app.use((error, req, res, next) => {
  console.error(`[api] ${req.method} ${req.path} falhou (${error.code || "UNKNOWN"}):`, error.message);
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
  return res.status(status).json({ error: message });
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
