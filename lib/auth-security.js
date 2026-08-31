import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const LOGIN_CODE_TTL_MS = 5 * 60 * 1000;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
export const LOGIN_CODE_RESEND_DELAY_MS = 45 * 1000;
export const LOGIN_CODE_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_CODE_WINDOW_LIMIT = 5;
export const PASSWORD_RESET_TTL_MS = 20 * 60 * 1000;

export function generateLoginCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function keyedHash(value, secret, purpose) {
  return createHmac("sha256", secret).update(`${purpose}:${value}`, "utf8").digest("hex");
}

export function hashLoginCode(code, verificationId, secret) {
  return keyedHash(`${verificationId}:${code}`, secret, "login-code");
}

export function generatePasswordResetToken(tokenId) {
  const secret = randomBytes(32).toString("base64url");
  return `${tokenId}.${secret}`;
}

export function parsePasswordResetToken(token) {
  if (typeof token !== "string") return null;
  const match = token.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i);
  return match ? { id: match[1].toLowerCase(), secret: match[2] } : null;
}

export function hashPasswordResetToken(tokenSecret, tokenId, secret) {
  return keyedHash(`${tokenId}:${tokenSecret}`, secret, "password-reset");
}

export function hashRateLimitKey(value, secret) {
  return keyedHash(value.trim().toLowerCase(), secret, "rate-limit");
}

export function hashesMatch(actualHash, expectedHash) {
  if (typeof actualHash !== "string" || typeof expectedHash !== "string") return false;
  const actual = Buffer.from(actualHash, "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && actual.length > 0 && timingSafeEqual(actual, expected);
}

export function loginVerificationStatus(verification, now = new Date()) {
  if (!verification || verification.used_at) return "used";
  if (Number(verification.attempts) >= LOGIN_CODE_MAX_ATTEMPTS) return "attempts_exceeded";
  if (new Date(verification.expires_at).getTime() <= now.getTime()) return "expired";
  return "active";
}

export function passwordResetStatus(resetToken, now = new Date()) {
  if (!resetToken || resetToken.used_at) return "used";
  if (new Date(resetToken.expires_at).getTime() <= now.getTime()) return "expired";
  return "active";
}
