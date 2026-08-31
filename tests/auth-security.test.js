import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  generateLoginCode,
  generatePasswordResetToken,
  hashesMatch,
  hashLoginCode,
  hashPasswordResetToken,
  LOGIN_CODE_MAX_ATTEMPTS,
  loginVerificationStatus,
  parsePasswordResetToken,
  passwordResetStatus,
} from "../lib/auth-security.js";
import { buildLoginVerificationEmail, buildPasswordResetEmail } from "../lib/email.js";

const hashSecret = "segredo-de-teste-com-mais-de-32-caracteres";

test("gera códigos de login com exatamente 6 dígitos", () => {
  for (let index = 0; index < 100; index += 1) assert.match(generateLoginCode(), /^\d{6}$/);
});

test("protege o código com hash vinculado ao desafio", () => {
  const verificationId = randomUUID();
  const hash = hashLoginCode("042019", verificationId, hashSecret);
  assert.equal(hash.includes("042019"), false);
  assert.equal(hashesMatch(hashLoginCode("042019", verificationId, hashSecret), hash), true);
  assert.equal(hashesMatch(hashLoginCode("042018", verificationId, hashSecret), hash), false);
  assert.equal(hashesMatch(hashLoginCode("042019", randomUUID(), hashSecret), hash), false);
});

test("classifica expiração, uso único e limite de tentativas do código", () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);
  assert.equal(loginVerificationStatus({ attempts: 0, expires_at: future, used_at: null }), "active");
  assert.equal(loginVerificationStatus({ attempts: 0, expires_at: past, used_at: null }), "expired");
  assert.equal(loginVerificationStatus({ attempts: LOGIN_CODE_MAX_ATTEMPTS, expires_at: future, used_at: null }), "attempts_exceeded");
  assert.equal(loginVerificationStatus({ attempts: 0, expires_at: future, used_at: new Date() }), "used");
});

test("gera token de recuperação de alta entropia e armazena apenas seu hash", () => {
  const tokenId = randomUUID();
  const token = generatePasswordResetToken(tokenId);
  const parsed = parsePasswordResetToken(token);
  assert.equal(parsed.id, tokenId);
  assert.match(parsed.secret, /^[A-Za-z0-9_-]{43}$/);
  const hash = hashPasswordResetToken(parsed.secret, parsed.id, hashSecret);
  assert.equal(hash.includes(parsed.secret), false);
  assert.equal(hashesMatch(hashPasswordResetToken(parsed.secret, parsed.id, hashSecret), hash), true);
  assert.equal(parsePasswordResetToken(`${tokenId}.curto`), null);
});

test("bloqueia token de recuperação expirado ou já usado", () => {
  assert.equal(passwordResetStatus({ expires_at: new Date(Date.now() + 60_000), used_at: null }), "active");
  assert.equal(passwordResetStatus({ expires_at: new Date(Date.now() - 1), used_at: null }), "expired");
  assert.equal(passwordResetStatus({ expires_at: new Date(Date.now() + 60_000), used_at: new Date() }), "used");
});

test("monta e-mails sem alterar os tempos de segurança comunicados", () => {
  const loginEmail = buildLoginVerificationEmail("123456");
  assert.match(loginEmail.subject, /Código de acesso/);
  assert.match(loginEmail.text, /5 minutos/);
  assert.match(loginEmail.html, /123456/);

  const resetEmail = buildPasswordResetEmail("https://exemplo.com/reset-password?token=segredo");
  assert.match(resetEmail.subject, /Redefinição de senha/);
  assert.match(resetEmail.text, /20 minutos/);
  assert.match(resetEmail.html, /Redefinir minha senha/);
});
