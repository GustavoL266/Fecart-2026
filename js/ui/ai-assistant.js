import { validateAssistantFields } from "./form.js";

const AI_ASSISTANT_MESSAGES = Object.freeze({
  insufficient: "Não consegui identificar informações suficientes. Tente informar custos, margem ou dados do produto.",
  unavailable: "O assistente está temporariamente indisponível. Você ainda pode preencher os dados manualmente.",
  invalid: "Não foi possível validar a resposta do assistente. Nenhum campo foi alterado. Tente novamente.",
});

const AI_PENDING_CODES = new Set([
  "AI_COST_BASIS_UNKNOWN", "AI_BATCH_UNITS_REQUIRED", "AI_BATCH_UNITS_INVALID",
  "AI_NEGATIVE_VALUE", "AI_VALUE_OUT_OF_RANGE", "AI_AMBIGUOUS_VALUE",
  "AI_CONFIRM_FIELD", "AI_MEANING_UNCERTAIN", "AI_RATE_SUM_INVALID",
]);

export function validateAssistantResponse(response) {
  const fields = validateAssistantFields(response?.fields);
  const fieldIds = Object.keys(fields);
  if (!Array.isArray(response.summary) || response.summary.length !== fieldIds.length) throw new Error("AI_INVALID_RESPONSE");
  const seen = new Set();
  const summary = response.summary.map((item) => {
    if (!item || !Object.hasOwn(fields, item.field) || seen.has(item.field)
      || typeof item.label !== "string" || !item.label || item.label.length > 120
      || typeof item.value !== "string" || !item.value || item.value.length > 2300) throw new Error("AI_INVALID_RESPONSE");
    seen.add(item.field);
    return { field: item.field, label: item.label, value: item.value };
  });
  if (!Array.isArray(response.pending)) throw new Error("AI_INVALID_RESPONSE");
  const pendingSeen = new Set();
  const pending = response.pending.map((item) => {
    if (!item || !AI_PENDING_CODES.has(item.code)
      || typeof item.field !== "string" || !item.field
      || typeof item.message !== "string" || !item.message || item.message.length > 300) throw new Error("AI_INVALID_RESPONSE");
    // Reuse the form allowlist without treating a pending value as an update.
    validateAssistantFields({ [item.field]: null });
    const key = `${item.code}:${item.field}`;
    if (pendingSeen.has(key)) throw new Error("AI_INVALID_RESPONSE");
    pendingSeen.add(key);
    return { code: item.code, field: item.field, message: item.message };
  });
  if (!fieldIds.length && !pending.length) {
    throw Object.assign(new Error(AI_ASSISTANT_MESSAGES.insufficient), { code: "AI_INSUFFICIENT_INFORMATION" });
  }
  return { fields, summary, pending };
}

function assistantErrorMessage(error) {
  const code = error?.code || error?.message;
  if (code === "AI_INSUFFICIENT_INFORMATION") return AI_ASSISTANT_MESSAGES.insufficient;
  if (code === "AI_INVALID_RESPONSE" || code === "GEMINI_INVALID_RESPONSE") return AI_ASSISTANT_MESSAGES.invalid;
  if (code === "GEMINI_UNAVAILABLE") return "A Gemini está temporariamente indisponível. Você ainda pode preencher os dados manualmente.";
  if (code === "GEMINI_NOT_CONFIGURED") return "O assistente ainda não está configurado neste ambiente. Você pode preencher os dados manualmente.";
  if (code === "GEMINI_UNAUTHORIZED") return "Não foi possível autenticar o assistente no provedor de IA. Avise o responsável pelo site.";
  if (code === "GEMINI_FORBIDDEN") return "O provedor de IA não autorizou esta operação. Avise o responsável pelo site.";
  if (code === "GEMINI_MODEL_UNAVAILABLE") return "O modelo de IA configurado não está disponível para esta integração. Avise o responsável pelo site.";
  if (code === "GEMINI_BAD_REQUEST") return "O provedor recusou o formato da análise. Avise o responsável pelo site.";
  if (code === "GEMINI_QUOTA_EXCEEDED") return "O limite de uso ou de créditos da integração de IA foi atingido. Avise o responsável pelo site.";
  if (code === "GEMINI_RATE_LIMITED") return "O provedor de IA está limitando as análises. Aguarde um pouco e tente novamente.";
  if (code === "GEMINI_TIMEOUT") return "A análise demorou mais que o esperado. Tente novamente em alguns instantes.";
  if (code === "GEMINI_CONNECTION_ERROR") return "Não foi possível conectar ao provedor de IA. Tente novamente em alguns instantes.";
  if (code === "AI_INTERNAL_ERROR") return "Não foi possível concluir a análise devido a uma falha interna. Você pode preencher os dados manualmente.";
  if (code === "AI_RATE_LIMITED") return "Você fez várias análises em pouco tempo. Aguarde um minuto e tente novamente.";
  if (code === "AI_REQUEST_IN_PROGRESS") return "Uma análise ainda está em andamento. Aguarde alguns instantes para tentar novamente.";
  if (code === "INVALID_AI_REQUEST") return "Descreva seu produto em uma mensagem de até 4.000 caracteres.";
  if (code === "SESSION_REQUIRED") return "Sua sessão expirou. Entre novamente para usar o assistente.";
  return AI_ASSISTANT_MESSAGES.unavailable;
}

/** Manages a single ephemeral analysis. Only onApply is allowed to mutate pricing. */
export function createAiAssistant({ dialog, openButtons, parse, onApply, onSearchMarket, hasSession = () => true }) {
  const select = (selector) => dialog.querySelector(selector);
  const form = select("[data-ai-form]");
  const textarea = select("[data-ai-message]");
  const analyzeButton = select("[data-ai-analyze]");
  const preview = select("[data-ai-preview]");
  const fieldsList = select("[data-ai-fields]");
  const pendingSection = select("[data-ai-pending]");
  const pendingList = select("[data-ai-pending-list]");
  const clarificationForm = select("[data-ai-clarification-form]");
  const clarification = select("[data-ai-clarification]");
  const clarifyButton = select("[data-ai-clarify]");
  const status = select("[data-ai-status]");
  const applyButton = select("[data-ai-apply]");
  const searchButton = select("[data-ai-search]");
  const cancelButton = select("[data-ai-cancel]");
  let result = null;
  let phase = "idle";
  let revision = 0;
  let abortController = null;
  let analysisContext = "";

  function update() {
    const loading = phase === "loading";
    form.setAttribute("aria-busy", String(loading));
    textarea.readOnly = loading;
    analyzeButton.disabled = loading || !textarea.value.trim();
    analyzeButton.setAttribute("aria-busy", String(loading));
    analyzeButton.textContent = loading ? "Analisando informações..." : "Analisar informações";
    const showingResult = ["preview", "partial-applied"].includes(phase);
    const hasFields = Boolean(result && Object.keys(result.fields).length);
    const hasPending = Boolean(result?.pending.length);
    preview.hidden = !showingResult;
    fieldsList.hidden = !hasFields;
    pendingSection.hidden = !showingResult || !hasPending;
    clarificationForm.hidden = !showingResult || !hasPending;
    clarification.readOnly = loading;
    clarifyButton.disabled = loading || !clarification.value.trim();
    applyButton.hidden = phase !== "preview" || !hasFields;
    applyButton.disabled = phase !== "preview" || !hasFields;
    searchButton.hidden = phase !== "applied" || !result?.fields.marketQuery;
    cancelButton.textContent = ["applied", "partial-applied"].includes(phase) ? "Fechar" : "Cancelar";
  }

  function clearAnalysis({ clearText = false, clearContext = true } = {}) {
    revision += 1;
    abortController?.abort();
    abortController = null;
    result = null;
    phase = "idle";
    status.textContent = "";
    status.hidden = true;
    status.classList.remove("is-error", "is-success");
    fieldsList.replaceChildren();
    pendingList.replaceChildren();
    clarification.value = "";
    if (clearContext) analysisContext = "";
    if (clearText) textarea.value = "";
    update();
  }

  function close() {
    clearAnalysis({ clearText: true });
    if (dialog.open) dialog.close();
  }

  function open() {
    if (!hasSession()) return;
    clearAnalysis({ clearText: true });
    if (!dialog.open) dialog.showModal();
    textarea.focus();
  }

  function showStatus(message, kind = "") {
    status.textContent = message;
    status.hidden = false;
    status.classList.toggle("is-error", kind === "error");
    status.classList.toggle("is-success", kind === "success");
  }

  function renderResult() {
    fieldsList.replaceChildren();
    pendingList.replaceChildren();
    for (const item of result.summary) {
      const row = dialog.ownerDocument.createElement("div");
      const label = dialog.ownerDocument.createElement("dt");
      const value = dialog.ownerDocument.createElement("dd");
      label.textContent = item.label;
      value.textContent = item.value;
      row.append(label, value);
      fieldsList.append(row);
    }
    for (const item of result.pending) {
      const row = dialog.ownerDocument.createElement("li");
      row.textContent = item.message;
      pendingList.append(row);
    }
  }

  async function runAnalysis(message) {
    if (phase === "loading" || !dialog.open || !hasSession()) return;
    clearAnalysis({ clearContext: false });
    if (!message || message.length > 4000) {
      showStatus(message ? "Use até 4.000 caracteres na descrição." : AI_ASSISTANT_MESSAGES.insufficient, "error");
      return;
    }
    phase = "loading";
    const requestRevision = revision;
    abortController = new AbortController();
    showStatus("Analisando informações...");
    update();
    try {
      const response = await parse(message, { signal: abortController.signal });
      if (revision !== requestRevision || !dialog.open || !hasSession()) return;
      result = validateAssistantResponse(response);
      renderResult();
      phase = "preview";
      status.hidden = true;
      update();
      (Object.keys(result.fields).length ? applyButton : clarification).focus();
    } catch (error) {
      if (revision !== requestRevision || !dialog.open) return;
      phase = "error";
      showStatus(assistantErrorMessage(error), "error");
      update();
    } finally {
      if (revision === requestRevision) abortController = null;
    }
  }

  async function analyze(event) {
    event?.preventDefault();
    analysisContext = textarea.value.trim();
    await runAnalysis(analysisContext);
  }

  async function clarify(event) {
    event?.preventDefault();
    if (!["preview", "partial-applied"].includes(phase) || !result?.pending.length) return;
    const answer = clarification.value.trim();
    if (!answer) return;
    const combined = `${analysisContext}\n\nEsclarecimento do usuário: ${answer}`;
    if (combined.length > 4000) {
      showStatus("A descrição e os esclarecimentos juntos devem ter até 4.000 caracteres.", "error");
      return;
    }
    analysisContext = combined;
    await runAnalysis(analysisContext);
  }

  function apply() {
    if (phase !== "preview" || !result || !dialog.open || !hasSession()) return;
    try {
      const message = onApply(result.fields);
      phase = result.pending.length ? "partial-applied" : "applied";
      const suffix = result.pending.length ? " Responda às pendências para analisar os demais dados." : "";
      showStatus(`${message || "Informações aplicadas. O simulador foi atualizado."}${suffix}`, "success");
      update();
      (result.fields.marketQuery ? searchButton : cancelButton).focus();
    } catch (error) {
      result = null;
      phase = "error";
      showStatus(assistantErrorMessage(error), "error");
      update();
    }
  }

  openButtons.forEach((button) => button.addEventListener("click", open));
  form.addEventListener("submit", analyze);
  textarea.addEventListener("input", () => clearAnalysis());
  clarificationForm.addEventListener("submit", clarify);
  clarification.addEventListener("input", update);
  applyButton.addEventListener("click", apply);
  cancelButton.addEventListener("click", close);
  select("[data-ai-close]").addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.addEventListener("close", () => clearAnalysis({ clearText: true }));
  searchButton.addEventListener("click", () => {
    if (phase !== "applied" || !result?.fields.marketQuery || !hasSession()) return;
    close();
    onSearchMarket();
  });
  update();
  return { open, close, invalidate: close };
}
