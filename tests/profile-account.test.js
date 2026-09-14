import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { changeOwnPassword, findOwnProfile, ProfileAccountError, updateOwnProfile } from "../lib/profile-account.js";
import { userForClient } from "../lib/models.js";
import { changePasswordSchema, profileUpdateSchema, validate } from "../lib/validation.js";

test("perfil normaliza nome e e-mail e rejeita campos de identidade enviados pelo navegador", () => {
  const profile = validate(profileUpdateSchema, { name: "  Ana Souza  ", email: " ANA@EXEMPLO.COM " });
  assert.deepEqual(profile, { name: "Ana Souza", email: "ana@exemplo.com" });
  assert.equal(profileUpdateSchema.safeParse({ name: " ", email: "ana@exemplo.com" }).success, false);
  assert.equal(profileUpdateSchema.safeParse({ name: "Ana Souza", email: "inválido" }).success, false);
  assert.equal(profileUpdateSchema.safeParse({ name: "Ana Souza", email: "ana@exemplo.com", userId: "outro" }).success, false);
});

test("troca de senha exige senha forte e confirmação correspondente", () => {
  const input = {
    currentPassword: "senha-atual-123",
    newPassword: "senha-nova-456",
    newPasswordConfirmation: "senha-nova-456",
  };
  assert.equal(changePasswordSchema.safeParse(input).success, true);
  assert.equal(changePasswordSchema.safeParse({ ...input, newPassword: "sóletras", newPasswordConfirmation: "sóletras" }).success, false);
  assert.equal(changePasswordSchema.safeParse({ ...input, newPasswordConfirmation: "outra-senha-789" }).success, false);
});

test("consulta de perfil agrega somente produtos do usuário autenticado", async () => {
  const calls = [];
  const row = { id: "user-a", name: "Ana", email: "ana@exemplo.com", saved_products_count: 12 };
  const profile = await findOwnProfile({ query: async (sql, values) => { calls.push({ sql, values }); return { rows: [row] }; } }, "user-a");
  assert.equal(profile, row);
  assert.deepEqual(calls[0].values, ["user-a"]);
  assert.match(calls[0].sql, /products\.user_id = users\.id/);
  assert.match(calls[0].sql, /WHERE users\.id = \$1/);
});

test("atualização usa o ID autenticado, normaliza a resposta pública e trata e-mail duplicado", async () => {
  const calls = [];
  const database = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [{ id: values[0], name: values[1], email: values[2], saved_products_count: "3" }] };
    },
  };
  const row = await updateOwnProfile(database, "authenticated-user", { name: "Nome novo", email: "novo@exemplo.com", userId: "ignored" });
  assert.equal(row.id, "authenticated-user");
  assert.deepEqual(calls[0].values, ["authenticated-user", "Nome novo", "novo@exemplo.com"]);
  assert.match(calls[0].sql, /WHERE id = \$1/);
  assert.deepEqual(userForClient(row), {
    id: "authenticated-user",
    name: "Nome novo",
    email: "novo@exemplo.com",
    createdAt: undefined,
    updatedAt: undefined,
    savedProductsCount: 3,
  });

  const duplicate = { query: async () => { const error = new Error("duplicate"); error.code = "23505"; throw error; } };
  await assert.rejects(updateOwnProfile(duplicate, "user-a", { name: "Ana", email: "usado@exemplo.com" }), (error) => {
    assert.ok(error instanceof ProfileAccountError);
    assert.equal(error.status, 409);
    assert.equal(error.code, "PROFILE_EMAIL_IN_USE");
    return true;
  });
});

test("troca de senha valida o hash atual e nunca grava texto puro", async () => {
  const calls = [];
  const database = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT")) return { rows: [{ password_hash: "hash-atual" }] };
      return { rowCount: 1 };
    },
  };
  const input = { currentPassword: "atual-123", newPassword: "nova-456", newPasswordConfirmation: "nova-456" };
  await changeOwnPassword(database, "authenticated-user", input, {
    verify: async (plain, hash) => plain === "atual-123" && hash === "hash-atual",
    hash: async (plain) => `hash:${plain}`,
  });
  assert.deepEqual(calls[0].values, ["authenticated-user"]);
  assert.deepEqual(calls[1].values, ["authenticated-user", "hash:nova-456", "hash-atual"]);
  assert.ok(!calls[1].values.includes("nova-456"));

  const wrongPasswordDatabase = { query: async () => ({ rows: [{ password_hash: "hash-atual" }] }) };
  await assert.rejects(changeOwnPassword(wrongPasswordDatabase, "user-a", input, { verify: async () => false }), (error) => {
    assert.equal(error.code, "CURRENT_PASSWORD_INCORRECT");
    assert.equal(error.status, 400);
    return true;
  });
});

test("rotas de perfil usam autenticação e nunca aceitam um ID do corpo", async () => {
  const server = await readFile(new URL("../server.js", import.meta.url), "utf8");
  const profileRoute = server.slice(server.indexOf('app.patch("/auth/me"'), server.indexOf('app.post("/auth/change-password"'));
  const passwordRoute = server.slice(server.indexOf('app.post("/auth/change-password"'), server.indexOf('app.get("/health"'));
  assert.match(profileRoute, /requireAuth/);
  assert.match(profileRoute, /updateOwnProfile\(pool, req\.user\.id, input\)/);
  assert.doesNotMatch(profileRoute, /req\.body\.(?:id|userId)/);
  assert.match(passwordRoute, /requireAuth/);
  assert.match(passwordRoute, /changeOwnPassword\(pool, req\.user\.id, input\)/);
  assert.doesNotMatch(passwordRoute, /password_hash|req\.body\.(?:id|userId)/);
});
