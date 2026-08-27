import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "../lib/passwords.js";
import { productSchema, registerSchema, validate } from "../lib/validation.js";

test("gera hash bcrypt verificável sem manter a senha em texto puro", async () => {
  const password = "senha-segura-123";
  const hash = await hashPassword(password);

  assert.notEqual(hash, password);
  assert.match(hash, /^\$2[aby]\$/);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("senha-incorreta", hash), false);
});

test("normaliza e valida o cadastro", () => {
  const registration = validate(registerSchema, {
    name: "  Ana Souza  ",
    email: "ANA@EXEMPLO.COM ",
    password: "senha-segura-123",
    passwordConfirmation: "senha-segura-123",
  });

  assert.equal(registration.name, "Ana Souza");
  assert.equal(registration.email, "ana@exemplo.com");
  assert.throws(
    () => validate(registerSchema, { name: "A", email: "invalido", password: "123", passwordConfirmation: "123" }),
    { status: 400 },
  );
});

test("rejeita senha sem letra, sem número ou confirmação diferente", () => {
  const baseRegistration = {
    name: "Ana Souza",
    email: "ana@exemplo.com",
    password: "senha-segura-123",
    passwordConfirmation: "senha-segura-123",
  };

  assert.equal(registerSchema.safeParse({ ...baseRegistration, password: "somenteletras", passwordConfirmation: "somenteletras" }).success, false);
  assert.equal(registerSchema.safeParse({ ...baseRegistration, password: "12345678", passwordConfirmation: "12345678" }).success, false);
  assert.equal(registerSchema.safeParse({ ...baseRegistration, passwordConfirmation: "senha-outra-123" }).success, false);
});

test("rejeita produto com margem fora dos limites", () => {
  const baseProduct = {
    name: "Produto teste",
    category: "Outros",
    costPrice: 10,
    additionalCosts: 5,
    profitMargin: 20,
    suggestedPrice: 20,
    marketplace: "Manual",
  };

  assert.equal(productSchema.safeParse(baseProduct).success, true);
  assert.equal(productSchema.safeParse({ ...baseProduct, profitMargin: 101 }).success, false);
});
