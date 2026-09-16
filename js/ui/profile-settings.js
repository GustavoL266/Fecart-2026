export function profileInitials(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1
    ? words[0].slice(0, 2)
    : `${words[0][0]}${words[1][0]}`;
  return letters.toLocaleUpperCase("pt-BR");
}

export function validateProfileDraft({ name }) {
  const normalized = {
    name: String(name || "").trim(),
  };
  const errors = { name: "" };

  if (!normalized.name) errors.name = "O nome não pode ficar vazio.";
  else if (normalized.name.length < 2) errors.name = "Informe um nome com pelo menos 2 caracteres.";
  else if (normalized.name.length > 120) errors.name = "O nome deve ter no máximo 120 caracteres.";

  return { normalized, errors, isValid: !errors.name };
}

export function validateProfilePasswordDraft({ currentPassword, newPassword, newPasswordConfirmation }) {
  const values = {
    currentPassword: String(currentPassword || ""),
    newPassword: String(newPassword || ""),
    newPasswordConfirmation: String(newPasswordConfirmation || ""),
  };
  const errors = { currentPassword: "", newPassword: "", newPasswordConfirmation: "" };

  if (!values.currentPassword) errors.currentPassword = "Informe sua senha atual.";
  else if (values.currentPassword.length > 72) errors.currentPassword = "Senha atual inválida.";

  if (!values.newPassword) errors.newPassword = "Informe a nova senha.";
  else if (values.newPassword.length > 72 || values.newPassword.length < 8 || !/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(values.newPassword) || !/\d/.test(values.newPassword)) {
    errors.newPassword = "Use pelo menos 8 caracteres, incluindo letras e números.";
  }

  if (!values.newPasswordConfirmation) errors.newPasswordConfirmation = "Confirme a nova senha.";
  else if (values.newPasswordConfirmation !== values.newPassword) errors.newPasswordConfirmation = "As senhas não coincidem.";

  return { values, errors, isValid: !errors.currentPassword && !errors.newPassword && !errors.newPasswordConfirmation };
}

function setProfileFieldError(input, messageElement, message = "") {
  input.setAttribute("aria-invalid", String(Boolean(message)));
  messageElement.hidden = !message;
  messageElement.textContent = message;
}

function setProfileStatus(element, message = "", success = false) {
  element.hidden = !message;
  element.textContent = message;
  element.classList.toggle("success", success);
}

function setProfileButtonBusy(button, busy, idleLabel, busyLabel) {
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
  button.textContent = busy ? busyLabel : idleLabel;
}

export function createProfileSettings({
  dialog,
  elements,
  api,
  getUser,
  onUserUpdated,
  onOpenProducts,
  schedule = (callback) => window.requestAnimationFrame(callback),
}) {
  const {
    avatar, displayName, displayEmail, productCount, profileForm, nameInput, nameError,
    emailInput, status, saveButton, cancelButton, productsButton,
    changePasswordButton, passwordPanel, passwordForm, currentPasswordInput,
    currentPasswordError, newPasswordInput, newPasswordError,
    newPasswordConfirmationInput, newPasswordConfirmationError, passwordSaveButton,
    passwordToggleButtons,
  } = elements;
  let original = { name: "", email: "" };
  let savingProfile = false;
  let savingPassword = false;
  let openRevision = 0;
  let returnFocus = null;
  let currentPasswordRejected = false;

  function renderProductCount(user) {
    const parsed = Number(user?.savedProductsCount);
    const count = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
    productCount.textContent = `${count} ${count === 1 ? "produto" : "produtos"}`;
  }

  function updateIdentityPreview() {
    const name = nameInput.value.trim() || original.name;
    avatar.textContent = profileInitials(name);
    displayName.textContent = name;
    displayEmail.textContent = original.email;
  }

  function currentProfileValidation() {
    return validateProfileDraft({ name: nameInput.value });
  }

  function isProfileDirty(validation = currentProfileValidation()) {
    return validation.normalized.name !== original.name;
  }

  function updateSaveState({ showErrors = false } = {}) {
    const validation = currentProfileValidation();
    if (showErrors || nameInput.getAttribute("aria-invalid") === "true") setProfileFieldError(nameInput, nameError, validation.errors.name);
    saveButton.disabled = savingProfile || !validation.isValid || !isProfileDirty(validation);
    return validation;
  }

  function setUser(user, { replaceDraft = true } = {}) {
    if (replaceDraft) {
      original = { name: String(user.name || ""), email: String(user.email || "").toLowerCase() };
      nameInput.value = original.name;
      emailInput.value = original.email;
      setProfileFieldError(nameInput, nameError);
    }
    renderProductCount(user);
    updateIdentityPreview();
    updateSaveState();
  }

  function resetPasswordVisibility() {
    [currentPasswordInput, newPasswordInput, newPasswordConfirmationInput].forEach((input) => { input.type = "password"; });
    passwordToggleButtons.forEach((button) => {
      button.setAttribute("aria-label", "Mostrar senha");
      button.setAttribute("aria-pressed", "false");
      const label = button.querySelector("[data-password-toggle-label]");
      if (label) label.textContent = "Mostrar senha";
    });
  }

  function resetPasswordForm({ collapse = true } = {}) {
    currentPasswordRejected = false;
    passwordForm.reset();
    setProfileFieldError(currentPasswordInput, currentPasswordError);
    setProfileFieldError(newPasswordInput, newPasswordError);
    setProfileFieldError(newPasswordConfirmationInput, newPasswordConfirmationError);
    resetPasswordVisibility();
    passwordSaveButton.disabled = true;
    if (collapse) {
      passwordPanel.hidden = true;
      changePasswordButton.setAttribute("aria-expanded", "false");
    }
  }

  function resetProfileDraft() {
    nameInput.value = original.name;
    emailInput.value = original.email;
    setProfileFieldError(nameInput, nameError);
    updateIdentityPreview();
    updateSaveState();
    resetPasswordForm();
    setProfileStatus(status);
  }

  function currentPasswordValidation() {
    const validation = validateProfilePasswordDraft({
      currentPassword: currentPasswordInput.value,
      newPassword: newPasswordInput.value,
      newPasswordConfirmation: newPasswordConfirmationInput.value,
    });
    if (currentPasswordRejected) {
      validation.errors.currentPassword = "A senha atual está incorreta.";
      validation.isValid = false;
    }
    return validation;
  }

  function validatePassword({ showErrors = false } = {}) {
    const validation = currentPasswordValidation();
    if (showErrors || currentPasswordInput.getAttribute("aria-invalid") === "true") setProfileFieldError(currentPasswordInput, currentPasswordError, validation.errors.currentPassword);
    if (showErrors || newPasswordInput.getAttribute("aria-invalid") === "true") setProfileFieldError(newPasswordInput, newPasswordError, validation.errors.newPassword);
    if (showErrors || newPasswordConfirmationInput.getAttribute("aria-invalid") === "true") setProfileFieldError(newPasswordConfirmationInput, newPasswordConfirmationError, validation.errors.newPasswordConfirmation);
    passwordSaveButton.disabled = savingPassword || !validation.isValid;
    return validation;
  }

  async function open(trigger) {
    const cachedUser = getUser();
    if (!cachedUser) return;
    const revision = ++openRevision;
    returnFocus = trigger || document.activeElement;
    setUser(cachedUser);
    resetPasswordForm();
    setProfileStatus(status);
    if (!dialog.open) dialog.showModal();
    schedule(() => nameInput.focus());

    try {
      const response = await api.get("/auth/me");
      if (revision !== openRevision || !dialog.open) return;
      const draftWasChanged = isProfileDirty();
      onUserUpdated(response.user);
      setUser(response.user, { replaceDraft: !draftWasChanged });
    } catch (error) {
      if (revision === openRevision && dialog.open && error?.code !== "SESSION_REQUIRED") {
        setProfileStatus(status, error?.message || "Não foi possível atualizar os dados da conta.");
      }
    }
  }

  async function submitProfile(event) {
    event.preventDefault();
    const validation = updateSaveState({ showErrors: true });
    if (!validation.isValid || !isProfileDirty(validation)) return;

    try {
      savingProfile = true;
      setProfileButtonBusy(saveButton, true, "Salvar alterações", "Salvando...");
      setProfileStatus(status);
      const response = await api.patch("/auth/me", validation.normalized);
      onUserUpdated(response.user);
      setUser(response.user);
      setProfileStatus(status, "Perfil atualizado com sucesso.", true);
    } catch (error) {
      if (error?.code !== "SESSION_REQUIRED") {
        setProfileStatus(status, error?.message || "Não foi possível atualizar o perfil.");
      }
    } finally {
      savingProfile = false;
      setProfileButtonBusy(saveButton, false, "Salvar alterações", "Salvando...");
      const finalValidation = currentProfileValidation();
      saveButton.disabled = !finalValidation.isValid || !isProfileDirty(finalValidation);
    }
  }

  async function submitPassword(event) {
    event.preventDefault();
    const validation = validatePassword({ showErrors: true });
    if (!validation.isValid) return;

    try {
      savingPassword = true;
      setProfileButtonBusy(passwordSaveButton, true, "Atualizar senha", "Atualizando...");
      setProfileStatus(status);
      await api.post("/auth/change-password", validation.values);
      resetPasswordForm();
      setProfileStatus(status, "Senha atualizada com sucesso.", true);
      changePasswordButton.focus();
    } catch (error) {
      if (error?.code === "CURRENT_PASSWORD_INCORRECT") {
        currentPasswordRejected = true;
        setProfileFieldError(currentPasswordInput, currentPasswordError, "A senha atual está incorreta.");
        currentPasswordInput.focus();
      } else if (error?.code !== "SESSION_REQUIRED") {
        setProfileStatus(status, error?.message || "Não foi possível atualizar a senha.");
      }
    } finally {
      savingPassword = false;
      setProfileButtonBusy(passwordSaveButton, false, "Atualizar senha", "Atualizando...");
      const finalValidation = currentPasswordValidation();
      passwordSaveButton.disabled = !finalValidation.isValid;
    }
  }

  nameInput.addEventListener("input", () => { updateIdentityPreview(); updateSaveState(); });
  nameInput.addEventListener("blur", () => {
    nameInput.value = nameInput.value.trim();
    updateIdentityPreview();
    updateSaveState({ showErrors: true });
  });
  profileForm.addEventListener("submit", submitProfile);
  cancelButton.addEventListener("click", () => dialog.close());
  productsButton.addEventListener("click", () => {
    returnFocus = null;
    dialog.close();
    onOpenProducts();
  });
  changePasswordButton.addEventListener("click", () => {
    const willOpen = passwordPanel.hidden;
    passwordPanel.hidden = !willOpen;
    changePasswordButton.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) schedule(() => currentPasswordInput.focus());
    else resetPasswordForm();
  });
  [currentPasswordInput, newPasswordInput, newPasswordConfirmationInput].forEach((input) => {
    input.addEventListener("input", () => {
      if (input === currentPasswordInput) currentPasswordRejected = false;
      validatePassword();
    });
    input.addEventListener("blur", () => validatePassword({ showErrors: true }));
  });
  passwordForm.addEventListener("submit", submitPassword);
  dialog.addEventListener("close", () => {
    openRevision += 1;
    resetProfileDraft();
    const target = returnFocus;
    returnFocus = null;
    if (target?.focus) schedule(() => target.focus());
  });

  return {
    open,
    closeForSession() {
      openRevision += 1;
      returnFocus = null;
      if (dialog.open) dialog.close();
      else resetProfileDraft();
    },
  };
}
