import { REQUIRED_PRICING_FIELD_IDS, validateAssistantFields } from "./form.js";

const AI_ASSISTANT_MESSAGES = Object.freeze({
  insufficient: "Não consegui identificar informações suficientes. Tente informar custos, margem ou dados do produto.",
  unavailable: "O assistente está temporariamente indisponível. Você ainda pode preencher os dados manualmente.",
  invalid: "Não foi possível validar a resposta do assistente. Nenhum campo foi alterado. Tente novamente.",
});

const AI_PENDING_CODES = new Set([
  "AI_COST_BASIS_UNKNOWN", "AI_BATCH_UNITS_REQUIRED", "AI_BATCH_UNITS_INVALID",
  "AI_NEGATIVE_VALUE", "AI_VALUE_OUT_OF_RANGE", "AI_AMBIGUOUS_VALUE",
  "AI_CONFIRM_FIELD", "AI_MEANING_UNCERTAIN", "AI_RATE_SUM_INVALID", "AI_REQUIRED_FIELD_MISSING",
  "AI_USER_VALUE_REQUIRED",
]);
const AI_VALUE_SOURCES = new Set(["user_provided", "inferred", "estimated"]);
const REQUIRED_FIELDS = new Set(REQUIRED_PRICING_FIELD_IDS);
const CLARIFICATION_IN_FLIGHT = Symbol.for("fecart.ai.clarificationInFlight");

export function validateAssistantResponse(response) {
  const fields = validateAssistantFields(response?.fields);
  const fieldIds = Object.keys(fields);
  if (!response?.sources || typeof response.sources !== "object" || Array.isArray(response.sources)) throw new Error("AI_INVALID_RESPONSE");
  const sourceIds = Object.keys(response.sources);
  if (sourceIds.length !== fieldIds.length || sourceIds.some((field) => !Object.hasOwn(fields, field)
    || !AI_VALUE_SOURCES.has(response.sources[field]))) throw new Error("AI_INVALID_RESPONSE");
  const sources = Object.fromEntries(fieldIds.map((field) => [field, response.sources[field]]));
  const skippedInput = response?.skipped ?? {};
  if (!skippedInput || typeof skippedInput !== "object" || Array.isArray(skippedInput)) throw new Error("AI_INVALID_RESPONSE");
  const skipped = {};
  for (const [field, decision] of Object.entries(skippedInput)) {
    validateAssistantFields({ [field]: null });
    if (!decision || typeof decision !== "object" || Array.isArray(decision)
      || Object.keys(decision).length !== 2 || decision.value !== null || decision.source !== "skipped"
      || Object.hasOwn(fields, field)) throw new Error("AI_INVALID_RESPONSE");
    skipped[field] = { value: null, source: "skipped" };
  }
  const skippedIds = Object.keys(skipped);
  if (!Array.isArray(response.summary) || response.summary.length !== fieldIds.length + skippedIds.length) throw new Error("AI_INVALID_RESPONSE");
  const seen = new Set();
  const summary = response.summary.map((item) => {
    const skippedField = Object.hasOwn(skipped, item?.field);
    if (!item || (!Object.hasOwn(fields, item.field) && !Object.hasOwn(skipped, item.field)) || seen.has(item.field)
      || typeof item.label !== "string" || !item.label || item.label.length > 120
      || typeof item.value !== "string" || !item.value || item.value.length > 2300
      || (skippedField ? item.source !== "skipped" : item.source !== sources[item.field])) throw new Error("AI_INVALID_RESPONSE");
    seen.add(item.field);
    return { field: item.field, label: item.label, value: item.value, source: item.source };
  });
  if (!Array.isArray(response.pending)) throw new Error("AI_INVALID_RESPONSE");
  const pendingSeen = new Set();
  const pending = response.pending.map((item) => {
    if (!item || !AI_PENDING_CODES.has(item.code)
      || typeof item.field !== "string" || !item.field
      || typeof item.message !== "string" || !item.message || item.message.length > 300
      || (item.label !== undefined && (typeof item.label !== "string" || !item.label || item.label.length > 120))
      || (item.required !== undefined && typeof item.required !== "boolean")) throw new Error("AI_INVALID_RESPONSE");
    // Reuse the form allowlist without treating a pending value as an update.
    validateAssistantFields({ [item.field]: null });
    const key = `${item.code}:${item.field}`;
    if (pendingSeen.has(key)) throw new Error("AI_INVALID_RESPONSE");
    pendingSeen.add(key);
    if (Object.hasOwn(skipped, item.field) || Object.hasOwn(fields, item.field)) throw new Error("AI_INVALID_RESPONSE");
    return { code: item.code, field: item.field, message: item.message, label: item.label || item.field, required: item.required ?? REQUIRED_FIELDS.has(item.field) };
  });
  const needsClarification = pending.length > 0;
  if (response.needsClarification !== needsClarification) throw new Error("AI_INVALID_RESPONSE");
  if (!fieldIds.length && !pending.length && !skippedIds.length) {
    throw Object.assign(new Error(AI_ASSISTANT_MESSAGES.insufficient), { code: "AI_INSUFFICIENT_INFORMATION" });
  }
  if (Object.hasOwn(response, "calculationReady") && typeof response.calculationReady !== "boolean") throw new Error("AI_INVALID_RESPONSE");
  const calculationReady = typeof response.calculationReady === "boolean" ? response.calculationReady : null;
  return { fields, sources, skipped, summary, pending, needsClarification, calculationReady };
}

function assistantErrorMessage(error) {
  const code = error?.code || error?.message;
  if (code === "AI_INSUFFICIENT_INFORMATION") return AI_ASSISTANT_MESSAGES.insufficient;
  if (code === "AI_INVALID_RESPONSE" || code === "GEMINI_INVALID_RESPONSE") return AI_ASSISTANT_MESSAGES.invalid;
  if (code === "AI_CLARIFICATION_MERGE_FAILED") return "Não foi possível combinar o esclarecimento com a análise anterior. A prévia anterior foi preservada.";
  if (code === "AI_VALIDATION_FAILED") return "O esclarecimento não passou pela validação final. A prévia anterior foi preservada.";
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
  const estimateWarning = select("[data-ai-estimate-warning]");
  const pendingSection = select("[data-ai-pending]");
  const pendingList = select("[data-ai-pending-list]");
  const clarificationForm = select("[data-ai-clarification-form]");
  const clarificationLabel = select("[data-ai-clarification-label]");
  const clarification = select("[data-ai-clarification]");
  const clarifyButton = select("[data-ai-clarify]");
  const status = select("[data-ai-status]");
  const applyButton = select("[data-ai-apply]");
  const adjustButton = select("[data-ai-adjust]");
  const searchButton = select("[data-ai-search]");
  const cancelButton = select("[data-ai-cancel]");
  let result = null;
  let phase = "idle";
  let revision = 0;
  let abortController = null;
  let analysisContext = "";
  let loadingAction = "analysis";
  let activeField = null;
  const acceptedEstimates = new Set();

  function update() {
    const loading = phase === "loading";
    form.setAttribute("aria-busy", String(loading));
    textarea.readOnly = loading;
    analyzeButton.disabled = loading || !textarea.value.trim();
    analyzeButton.setAttribute("aria-busy", String(loading));
    analyzeButton.textContent = loading && loadingAction === "analysis" ? "Analisando informações..." : "Analisar informações";
    const showingResult = Boolean(result) && (["preview", "partial-applied"].includes(phase) || loading);
    const hasFields = Boolean(result && Object.keys(result.fields).length);
    const hasSkipped = Boolean(result && Object.keys(result.skipped).length);
    const hasPending = Boolean(result?.pending.length);
    const unresolvedEstimates = result?.summary.filter((item) => item.source === "estimated" && !acceptedEstimates.has(item.field)) || [];
    const hasChoices = hasPending || unresolvedEstimates.length > 0;
    preview.hidden = !showingResult;
    fieldsList.hidden = !hasFields && !hasSkipped;
    estimateWarning.hidden = !showingResult || !result?.summary.some((item) => item.source === "estimated");
    pendingSection.hidden = !showingResult || !hasChoices;
    clarificationForm.hidden = !showingResult || !activeField;
    clarification.readOnly = loading;
    clarifyButton.disabled = loading || !clarification.value.trim();
    clarifyButton.setAttribute("aria-busy", String(loading && loadingAction === "clarification"));
    clarifyButton.textContent = loading && loadingAction === "clarification" ? "Confirmando..." : "Confirmar";
    const unresolvedChoices = hasPending || unresolvedEstimates.length > 0;
    applyButton.hidden = phase !== "preview" || (!hasFields && !hasSkipped) || unresolvedChoices;
    applyButton.disabled = phase !== "preview" || (!hasFields && !hasSkipped) || unresolvedChoices;
    adjustButton.hidden = !showingResult || loading;
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
    activeField = null;
    acceptedEstimates.clear();
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

  function summaryLabel(field) {
    return result.summary.find((item) => item.field === field)?.label
      || result.pending.find((item) => item.field === field)?.label
      || field;
  }

  function requiredWarning(document) {
    const warning = document.createElement("p");
    warning.className = "ai-assistant-required-warning";
    warning.textContent = "Sem esse valor, o simulador pode não conseguir calcular o preço final.";
    return warning;
  }

  function chooseManualValue(field) {
    if (phase === "loading") return;
    activeField = { field, label: summaryLabel(field) };
    clarification.value = "";
    clarificationLabel.textContent = `${activeField.label}:`;
    clarification.setAttribute("placeholder", "Digite o valor");
    update();
    clarification.focus();
  }

  function skipField(field) {
    if (phase === "loading") return;
    const label = summaryLabel(field);
    delete result.fields[field];
    delete result.sources[field];
    result.pending = result.pending.filter((item) => item.field !== field);
    result.skipped[field] = { value: null, source: "skipped" };
    result.summary = result.summary.filter((item) => item.field !== field);
    result.summary.push({ field, label, value: "Não informado", source: "skipped" });
    result.needsClarification = result.pending.length > 0;
    if (REQUIRED_FIELDS.has(field)) result.calculationReady = false;
    acceptedEstimates.delete(field);
    if (activeField?.field === field) {
      activeField = null;
      clarification.value = "";
    }
    renderResult();
    update();
  }

  function choiceButton(label, action, className = "secondary-button") {
    const button = dialog.ownerDocument.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }

  function renderChoice({ field, message, estimate }) {
    const row = dialog.ownerDocument.createElement("li");
    row.className = "ai-assistant-choice";
    const copy = dialog.ownerDocument.createElement("div");
    const title = dialog.ownerDocument.createElement("strong");
    title.textContent = summaryLabel(field);
    const detail = dialog.ownerDocument.createElement("p");
    detail.textContent = estimate ? `Estimativa sugerida: ${estimate}` : message;
    const question = dialog.ownerDocument.createElement("p");
    question.textContent = "Você deseja informar esse valor ou deixar em branco?";
    copy.append(title, detail, question);
    if (REQUIRED_FIELDS.has(field)) copy.append(requiredWarning(dialog.ownerDocument));
    const actions = dialog.ownerDocument.createElement("div");
    actions.className = "ai-assistant-choice-actions";
    if (estimate) {
      actions.append(choiceButton("Usar estimativa", () => {
        acceptedEstimates.add(field);
        renderResult();
        update();
      }, ""));
    }
    actions.append(
      choiceButton(estimate ? "Informar outro valor" : "Informar valor", () => chooseManualValue(field)),
      choiceButton("Deixar em branco", () => skipField(field), "secondary-button"),
    );
    row.append(copy, actions);
    pendingList.append(row);
  }

  function renderResult() {
    fieldsList.replaceChildren();
    pendingList.replaceChildren();
    const groups = [
      ["user_provided", "Informado pelo usuário"],
      ["inferred", "Inferido com segurança"],
      ["estimated", "Estimado pela IA"],
      ["skipped", "Deixado em branco"],
    ];
    for (const [source, title] of groups) {
      const items = result.summary.filter((item) => item.source === source);
      if (!items.length) continue;
      const section = dialog.ownerDocument.createElement("section");
      section.className = "ai-assistant-source-group";
      const heading = dialog.ownerDocument.createElement("h4");
      heading.textContent = title;
      const list = dialog.ownerDocument.createElement("dl");
      list.className = "ai-assistant-source-fields";
      for (const item of items) {
        const row = dialog.ownerDocument.createElement("div");
        const label = dialog.ownerDocument.createElement("dt");
        const value = dialog.ownerDocument.createElement("dd");
        label.textContent = item.label;
        value.textContent = item.value;
        row.append(label, value);
        if (source === "skipped" && REQUIRED_FIELDS.has(item.field)) row.append(requiredWarning(dialog.ownerDocument));
        list.append(row);
      }
      section.append(heading, list);
      fieldsList.append(section);
    }
    const pendingByField = new Map();
    for (const item of result.pending) {
      const existing = pendingByField.get(item.field);
      if (!existing) pendingByField.set(item.field, { ...item });
      else if (!existing.message.includes(item.message)) existing.message = `${existing.message} ${item.message}`;
    }
    for (const item of pendingByField.values()) renderChoice(item);
    for (const item of result.summary) {
      if (item.source === "estimated" && !acceptedEstimates.has(item.field)) {
        renderChoice({ field: item.field, estimate: item.value });
      }
    }
  }

  async function runAnalysis(message, { clarificationContext = null, preserveResult = false, retainedPending = [] } = {}) {
    if (phase === "loading" || !dialog.open || !hasSession()) return;
    const preserved = preserveResult ? { result, phase } : null;
    if (preserveResult) {
      revision += 1;
      abortController?.abort();
      abortController = null;
    } else {
      clearAnalysis({ clearContext: false });
    }
    if (!message || message.length > 4000) {
      showStatus(message ? "Use até 4.000 caracteres na descrição." : AI_ASSISTANT_MESSAGES.insufficient, "error");
      return false;
    }
    phase = "loading";
    loadingAction = clarificationContext ? "clarification" : "analysis";
    const requestRevision = revision;
    abortController = new AbortController();
    showStatus(loadingAction === "clarification" ? "Analisando esclarecimento..." : "Analisando informações...");
    update();
    try {
      const response = await parse(message, {
        signal: abortController.signal,
        ...(clarificationContext ? { clarification: clarificationContext } : {}),
      });
      if (revision !== requestRevision || !dialog.open || !hasSession()) return;
      result = validateAssistantResponse(response);
      if (retainedPending.length) {
        const resolved = new Set([...Object.keys(result.fields), ...Object.keys(result.skipped)]);
        const pendingKeys = new Set(result.pending.map((item) => `${item.code}:${item.field}`));
        for (const item of retainedPending) {
          const key = `${item.code}:${item.field}`;
          if (!resolved.has(item.field) && !pendingKeys.has(key)) {
            result.pending.push(item);
            pendingKeys.add(key);
          }
        }
        result.needsClarification = result.pending.length > 0;
      }
      activeField = null;
      clarification.value = "";
      renderResult();
      phase = "preview";
      status.hidden = true;
      update();
      (Object.keys(result.fields).length || Object.keys(result.skipped).length ? applyButton : pendingList).focus?.();
      return true;
    } catch (error) {
      if (revision !== requestRevision || !dialog.open) return;
      if (preserved) {
        result = preserved.result;
        phase = preserved.phase;
        renderResult();
      } else {
        phase = "error";
      }
      showStatus(assistantErrorMessage(error), "error");
      update();
      return false;
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
    event?.stopPropagation?.();
    if (clarificationForm[CLARIFICATION_IN_FLIGHT]) return false;
    if (!["preview", "partial-applied"].includes(phase) || !result || !activeField) return;
    const answer = clarification.value.trim();
    if (!answer) return;
    const previousContext = analysisContext;
    const combined = `${previousContext}\n\nEsclarecimento do usuário: ${answer}`;
    if (combined.length > 4000) {
      showStatus("A descrição e os esclarecimentos juntos devem ter até 4.000 caracteres.", "error");
      return;
    }
    const targetField = activeField.field;
    const retainedPending = result.pending.filter((item) => item.field !== targetField);
    const previousFields = { ...result.fields };
    const previousSources = { ...result.sources };
    delete previousFields[targetField];
    delete previousSources[targetField];
    const previousAnalysis = {
      fields: previousFields,
      sources: previousSources,
      skipped: { ...result.skipped },
      pending: [{ code: "AI_USER_VALUE_REQUIRED", field: targetField }],
      needsClarification: true,
    };
    clarificationForm[CLARIFICATION_IN_FLIGHT] = true;
    try {
      const succeeded = await runAnalysis(answer, {
        clarificationContext: { context: previousContext, previousAnalysis },
        preserveResult: true,
        retainedPending,
      });
      if (succeeded) {
        analysisContext = combined;
      }
      return succeeded;
    } finally {
      clarificationForm[CLARIFICATION_IN_FLIGHT] = false;
      update();
    }
  }

  function apply() {
    if (phase !== "preview" || !result || !dialog.open || !hasSession()) return;
    try {
      const message = onApply(result.fields, result.skipped);
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
  adjustButton.addEventListener("click", () => {
    clearAnalysis({ clearText: false });
    textarea.focus();
  });
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
