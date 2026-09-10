import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { parsePricingMessage } from "./ai-form-assistant.js";
import { AiAssistantError } from "./ai-pricing-schema.js";

function logAiFailure(error, logger = console) {
  // Deliberately select metadata instead of logging the Error/request/config.
  logger.warn("[AI] Analysis failed", {
    code: error.code,
    status: error.status,
    upstreamStatus: error.upstreamStatus ?? null,
  });
}

// Handles failures before the router (JSON parsing/session/database), too.
// Never pass a raw parsing error with excerpts of the user's message to logs.
export function handleAiRequestError(error, req, res, next) {
  if (res.headersSent) return next(error);
  res.set("Cache-Control", "no-store");
  const invalidBody = error.status === 400 || error.status === 413;
  const safe = invalidBody ? new AiAssistantError("INVALID_AI_REQUEST", error.status) : new AiAssistantError("AI_INTERNAL_ERROR", 500);
  logAiFailure(safe);
  return res.status(safe.status).json({ error: safe.message, code: safe.code });
}

export function createAiPricingRouter({ requireAuth, provider, rateLimitOptions = {}, logger = console }) {
  const router = Router();
  const pendingUsers = new Set();
  const options = {
    windowMs: 60_000,
    limit: 8,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Muitas análises. Aguarde um minuto e tente novamente.", code: "AI_RATE_LIMITED" },
    ...rateLimitOptions,
  };
  // Both limits apply independently: switching IP does not evade the account
  // budget, and switching accounts does not evade the IP budget (IPv6 included).
  const userLimiter = rateLimit({ ...options, keyGenerator: (req) => String(req.user.id), identifier: "ai-user" });
  const ipLimiter = rateLimit({ ...options, identifier: "ai-ip" });
  router.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.post("/parse-pricing", requireAuth, userLimiter, ipLimiter, async (req, res) => {
    const userId = String(req.user.id);
    if (pendingUsers.has(userId)) {
      return res.status(409).json({ error: "Uma análise já está em andamento. Aguarde sua conclusão.", code: "AI_REQUEST_IN_PROGRESS" });
    }
    pendingUsers.add(userId);
    try {
      return res.json(await parsePricingMessage({ provider, input: req.body }));
    } catch (error) {
      const safe = error instanceof AiAssistantError ? error : new AiAssistantError("AI_INTERNAL_ERROR", 500);
      logAiFailure(safe, logger);
      return res.status(safe.status).json({ error: safe.message, code: safe.code });
    } finally {
      pendingUsers.delete(userId);
    }
  });
  return router;
}
