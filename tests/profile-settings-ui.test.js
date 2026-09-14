import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createProfileSettings, profileInitials, validateProfileDraft, validateProfilePasswordDraft } from "../js/ui/profile-settings.js";

class FakeClassList {
  constructor() { this.values = new Set(); }
  toggle(name, enabled) { if (enabled) this.values.add(name); else this.values.delete(name); }
  contains(name) { return this.values.has(name); }
}

class FakeElement {
  constructor(value = "") {
    this.value = value;
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.type = "text";
    this.open = false;
    this.focused = false;
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = new FakeClassList();
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  async emit(type) {
    const event = { currentTarget: this, target: this, preventDefault() {} };
    for (const listener of this.listeners.get(type) || []) await listener(event);
  }
  focus() { this.focused = true; }
  querySelector() { return null; }
  showModal() { this.open = true; }
  close() {
    this.open = false;
    for (const listener of this.listeners.get("close") || []) listener({ currentTarget: this, target: this });
  }
}

function fixture({ patchError = null, passwordError = null } = {}) {
  const elements = Object.fromEntries([
    "avatar", "displayName", "displayEmail", "productCount", "profileForm", "nameInput", "nameError",
    "emailInput", "emailError", "status", "saveButton", "cancelButton", "productsButton",
    "changePasswordButton", "passwordPanel", "passwordForm", "currentPasswordInput", "currentPasswordError",
    "newPasswordInput", "newPasswordError", "newPasswordConfirmationInput", "newPasswordConfirmationError",
    "passwordSaveButton",
  ].map((name) => [name, new FakeElement()]));
  elements.passwordToggleButtons = [];
  elements.passwordPanel.hidden = true;
  elements.currentPasswordInput.type = "password";
  elements.newPasswordInput.type = "password";
  elements.newPasswordConfirmationInput.type = "password";
  elements.passwordForm.reset = () => {
    elements.currentPasswordInput.value = "";
    elements.newPasswordInput.value = "";
    elements.newPasswordConfirmationInput.value = "";
  };
  const dialog = new FakeElement();
  const requests = [];
  const updatedUsers = [];
  let openedProducts = 0;
  const cachedUser = { id: "user-a", name: "Lucca Rodrigues Frazili", email: "lucca@example.com", savedProductsCount: 11 };
  const api = {
    get: async (path) => { requests.push({ method: "GET", path }); return { user: { ...cachedUser, savedProductsCount: 12 } }; },
    patch: async (path, body) => {
      requests.push({ method: "PATCH", path, body });
      if (patchError) throw patchError;
      return { user: { ...cachedUser, ...body, savedProductsCount: 12 } };
    },
    post: async (path, body) => {
      requests.push({ method: "POST", path, body });
      if (passwordError) throw passwordError;
      return null;
    },
  };
  const controller = createProfileSettings({
    dialog,
    elements,
    api,
    getUser: () => cachedUser,
    onUserUpdated: (user) => updatedUsers.push(user),
    onOpenProducts: () => { openedProducts += 1; },
    schedule: (callback) => callback(),
  });
  return { controller, dialog, elements, requests, updatedUsers, cachedUser, openedProducts: () => openedProducts };
}

test("iniciais e validações do perfil respeitam normalização e senha forte", () => {
  assert.equal(profileInitials("Lucca Rodrigues Frazili"), "LR");
  assert.equal(profileInitials("Lucca"), "LU");
  assert.equal(validateProfileDraft({ name: " ", email: "x" }).errors.name, "O nome não pode ficar vazio.");
  assert.deepEqual(validateProfileDraft({ name: " Ana ", email: " ANA@EXEMPLO.COM " }).normalized, { name: "Ana", email: "ana@exemplo.com" });
  assert.equal(validateProfilePasswordDraft({ currentPassword: "atual-123", newPassword: "nova-456", newPasswordConfirmation: "diferente-789" }).errors.newPasswordConfirmation, "As senhas não coincidem.");
});

test("perfil carrega a conta, salva sem fechar e restaura o foco ao cancelar", async () => {
  const app = fixture();
  const trigger = new FakeElement();
  await app.controller.open(trigger);
  assert.equal(app.dialog.open, true);
  assert.equal(app.elements.avatar.textContent, "LR");
  assert.equal(app.elements.productCount.textContent, "12 produtos");
  assert.equal(app.elements.nameInput.focused, true);
  assert.equal(app.elements.saveButton.disabled, true);

  app.elements.nameInput.value = "Lucca Frazili";
  await app.elements.nameInput.emit("input");
  assert.equal(app.elements.saveButton.disabled, false);
  await app.elements.profileForm.emit("submit");
  assert.deepEqual(app.requests.at(-1), {
    method: "PATCH",
    path: "/auth/me",
    body: { name: "Lucca Frazili", email: "lucca@example.com" },
  });
  assert.equal(app.updatedUsers.at(-1).name, "Lucca Frazili");
  assert.equal(app.elements.status.textContent, "Perfil atualizado com sucesso.");
  assert.equal(app.dialog.open, true);
  assert.equal(app.elements.saveButton.disabled, true);

  app.elements.nameInput.value = "Mudança não salva";
  await app.elements.cancelButton.emit("click");
  assert.equal(app.dialog.open, false);
  assert.equal(app.elements.nameInput.value, "Lucca Frazili");
  assert.equal(trigger.focused, true);
});

test("perfil mostra validação local e duplicidade próximas ao campo", async () => {
  const duplicate = new Error("duplicado");
  duplicate.code = "PROFILE_EMAIL_IN_USE";
  const app = fixture({ patchError: duplicate });
  await app.controller.open(new FakeElement());
  app.elements.nameInput.value = " ";
  await app.elements.nameInput.emit("blur");
  assert.equal(app.elements.nameError.textContent, "O nome não pode ficar vazio.");
  assert.equal(app.elements.saveButton.disabled, true);

  app.elements.nameInput.value = "Lucca Rodrigues Frazili";
  app.elements.emailInput.value = "outro@example.com";
  await app.elements.emailInput.emit("input");
  await app.elements.profileForm.emit("submit");
  assert.equal(app.elements.emailError.textContent, "Este e-mail já está sendo utilizado.");
  assert.equal(app.elements.emailInput.focused, true);
  assert.equal(app.elements.saveButton.disabled, true);
  app.elements.nameInput.value = "Outro nome";
  await app.elements.nameInput.emit("input");
  assert.equal(app.elements.emailError.textContent, "Este e-mail já está sendo utilizado.");
  assert.equal(app.elements.saveButton.disabled, true);
  app.elements.emailInput.value = "livre@example.com";
  await app.elements.emailInput.emit("input");
  assert.equal(app.elements.emailError.textContent, "");
  assert.equal(app.elements.saveButton.disabled, false);
});

test("alteração de senha exige confirmação e mantém sessão em erro da senha atual", async () => {
  const wrong = new Error("senha incorreta");
  wrong.code = "CURRENT_PASSWORD_INCORRECT";
  const app = fixture({ passwordError: wrong });
  await app.controller.open(new FakeElement());
  await app.elements.changePasswordButton.emit("click");
  assert.equal(app.elements.passwordPanel.hidden, false);
  assert.equal(app.elements.currentPasswordInput.focused, true);

  app.elements.currentPasswordInput.value = "atual-123";
  app.elements.newPasswordInput.value = "nova-456";
  app.elements.newPasswordConfirmationInput.value = "outra-789";
  await app.elements.newPasswordConfirmationInput.emit("blur");
  assert.equal(app.elements.newPasswordConfirmationError.textContent, "As senhas não coincidem.");
  assert.equal(app.elements.passwordSaveButton.disabled, true);

  app.elements.newPasswordConfirmationInput.value = "nova-456";
  await app.elements.newPasswordConfirmationInput.emit("input");
  assert.equal(app.elements.passwordSaveButton.disabled, false);
  await app.elements.passwordForm.emit("submit");
  assert.equal(app.elements.currentPasswordError.textContent, "A senha atual está incorreta.");
  assert.equal(app.elements.currentPasswordInput.focused, true);
  assert.equal(app.elements.passwordSaveButton.disabled, true);
  assert.equal(app.dialog.open, true);
});

test("senha válida usa a rota própria, limpa os campos e mantém o perfil aberto", async () => {
  const app = fixture();
  await app.controller.open(new FakeElement());
  await app.elements.changePasswordButton.emit("click");
  app.elements.currentPasswordInput.value = "atual-123";
  app.elements.newPasswordInput.value = "nova-456";
  app.elements.newPasswordConfirmationInput.value = "nova-456";
  await app.elements.newPasswordConfirmationInput.emit("input");
  await app.elements.passwordForm.emit("submit");
  assert.deepEqual(app.requests.at(-1), {
    method: "POST",
    path: "/auth/change-password",
    body: {
      currentPassword: "atual-123",
      newPassword: "nova-456",
      newPasswordConfirmation: "nova-456",
    },
  });
  assert.equal(app.elements.currentPasswordInput.value, "");
  assert.equal(app.elements.newPasswordInput.value, "");
  assert.equal(app.elements.passwordPanel.hidden, true);
  assert.equal(app.elements.status.textContent, "Senha atualizada com sucesso.");
  assert.equal(app.dialog.open, true);
});

test("atalho de produtos fecha o perfil e reutiliza a navegação existente", async () => {
  const app = fixture();
  await app.controller.open(new FakeElement());
  await app.elements.productsButton.emit("click");
  assert.equal(app.dialog.open, false);
  assert.equal(app.openedProducts(), 1);
});

test("HTML mantém labels, descrições e controles acessíveis do perfil", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="profileDialog"[^>]+aria-labelledby="profileDialogTitle"[^>]+aria-describedby="profileDialogDescription"/);
  assert.match(html, /id="profileAvatar"/);
  assert.match(html, /<label for="profileName">Nome<\/label>/);
  assert.match(html, /<label for="profileEmail">E-mail<\/label>/);
  assert.match(html, /id="profilePasswordPanel"/);
  assert.match(html, /data-password-toggle="profileCurrentPassword"/);
  assert.match(html, /id="profileProductCount"/);
  assert.match(html, /id="profileProductsButton"/);
});
