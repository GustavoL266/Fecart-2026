import { calculatePrice } from "./domain/pricing-calculator.js";
import { buildCalculationMemory, ConfiguredTaxRuleEngine, fiscalDataForStorage } from "./domain/tax-rule-engine.js";
import { MarketService } from "./services/market-service.js";
import { ApiError, api } from "./services/api-client.js";
import { clearMarketReference, loadMarketReference, saveMarketReference } from "./services/market-reference-store.js";
import { applySavedInputs, parseBrazilianNumber, PRICING_FIELD_IDS, renderPricingErrors, validatePricingForm } from "./ui/form.js";
import { renderDashboard, renderIncompleteDashboard } from "./ui/dashboard.js";
import { renderProductDetails, renderProductsList } from "./ui/history.js";
import { createPricingTabs } from "./ui/pricing-tabs.js";
import { createPricingPanel } from "./ui/pricing-panel.js";

const $ = (selector) => document.querySelector(selector);
const themeStorageKey = "assistente-precificacao-theme";
const detailRouteHashes = Object.freeze({ price: "#preco-calculado" });
const market = new MarketService();
const taxRuleEngine = new ConfiguredTaxRuleEngine();
const formFieldIds = [
  "ncmCode",
  "taxRegime",
  "originState",
  "destinationState",
  "cfop",
  "taxSituation",
  "customerType",
  "operationPurpose",
  ...PRICING_FIELD_IDS,
];
const elements = Object.fromEntries(formFieldIds.map((id) => [id, $(`#${id}`)]));
const pricingTabs = createPricingTabs($(".pricing-sidebar"));
createPricingPanel($(".app-shell"));
const state = {
  user: null,
  products: [],
  selectedProduct: null,
};

let marketSource = "manual";
let focusState = {
  status: "idle",
  ncm: null,
  environment: "",
  error: "",
  unavailable: false,
};
let marketState = {
  status: "idle",
  query: "",
  items: [],
  stats: null,
  selectedItem: null,
  error: "",
};
let manualMarketValue = elements.competitorAverage.value;
let productSearchTimer;
let pendingDetailTarget = "";
let revealAllPricingErrors = false;
const touchedPricingFields = new Set();

function applyTheme(theme, persist = true) {
  const normalizedTheme = theme === "dark" ? "dark" : "light";
  const isDark = normalizedTheme === "dark";
  document.documentElement.dataset.theme = normalizedTheme;
  if (persist) {
    try {
      localStorage.setItem(themeStorageKey, normalizedTheme);
    } catch {
      // O tema continua funcionando mesmo que o armazenamento esteja indisponível.
    }
  }
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    const nextThemeLabel = isDark ? "Modo claro" : "Modo escuro";
    button.setAttribute("aria-label", `Ativar ${nextThemeLabel.toLowerCase()}`);
    button.setAttribute("aria-pressed", String(isDark));
    button.querySelector("[data-theme-label]").textContent = nextThemeLabel;
    button.querySelector(".theme-symbol").textContent = isDark ? "☼" : "☾";
  });
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

function messageFor(error) {
  return error instanceof ApiError ? error.message : "Não foi possível concluir a operação. Tente novamente.";
}

function setMessage(element, message = "", success = false) {
  element.hidden = !message;
  element.textContent = message;
  element.classList.toggle("success", success);
}

function setFieldError(fieldId, message = "") {
  const input = $(`#${fieldId}`);
  const field = input.closest(".auth-field");
  const messageElement = $(`#${fieldId}Error`);
  field?.classList.toggle("has-error", Boolean(message));
  input.setAttribute("aria-invalid", String(Boolean(message)));
  if (!messageElement) return;
  messageElement.hidden = !message;
  messageElement.textContent = message;
}

function clearAuthErrors(form) {
  form.querySelectorAll(".auth-field input").forEach((input) => setFieldError(input.id));
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function passwordChecks(value) {
  return {
    length: value.length >= 8,
    letter: /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(value),
    number: /\d/.test(value),
  };
}

function isStrongPassword(value) {
  return Object.values(passwordChecks(value)).every(Boolean);
}

function updatePasswordRequirements() {
  const checks = passwordChecks($("#registerPassword").value);
  document.querySelectorAll("[data-password-rule]").forEach((item) => item.classList.toggle("is-met", checks[item.dataset.passwordRule]));
}

function validateRegisterField(fieldId) {
  const value = $(`#${fieldId}`).value;
  const trimmedValue = value.trim();
  let error = "";

  if (fieldId === "registerName") {
    if (!trimmedValue) error = "Preencha todos os campos obrigatórios.";
    else if (trimmedValue.length < 2) error = "Informe seu nome completo.";
  }

  if (fieldId === "registerEmail") {
    if (!trimmedValue) error = "Preencha todos os campos obrigatórios.";
    else if (!isValidEmail(trimmedValue)) error = "Informe um e-mail válido.";
  }

  if (fieldId === "registerPassword") {
    if (!value) error = "Preencha todos os campos obrigatórios.";
    else if (!isStrongPassword(value)) error = "Use pelo menos 8 caracteres, incluindo letras e números.";
  }

  if (fieldId === "registerPasswordConfirmation") {
    const password = $("#registerPassword").value;
    if (!value) error = "Preencha todos os campos obrigatórios.";
    else if (value !== password) error = "As senhas não coincidem.";
  }

  setFieldError(fieldId, error);
  return !error;
}

function validateLoginField(fieldId) {
  const value = $(`#${fieldId}`).value.trim();
  const error = !value
    ? "Preencha todos os campos obrigatórios."
    : fieldId === "loginEmail" && !isValidEmail(value)
      ? "Informe um e-mail válido."
      : "";
  setFieldError(fieldId, error);
  return !error;
}

function setSubmitState(button, isLoading, label) {
  button.disabled = isLoading;
  button.setAttribute("aria-busy", String(isLoading));
  button.querySelector("span").textContent = label;
}

function currentPricingValidation() {
  const validation = validatePricingForm(elements);
  renderPricingErrors(elements, validation.errors, revealAllPricingErrors ? null : touchedPricingFields);
  return validation;
}

function render() {
  const validation = currentPricingValidation();
  if (validation.isValid) {
    const inputs = validation.inputs;
    const result = calculatePrice(inputs);
    const fiscalAssessment = taxRuleEngine.assess(inputs, focusState);
    const memory = buildCalculationMemory(inputs, result, fiscalAssessment);
    renderDashboard(document, inputs, result, marketState, marketSource, fiscalAssessment, memory);
  } else {
    renderIncompleteDashboard(document, marketState, validation.errors);
  }
  renderNcmState();
  $("#mobileSuggestedPrice").textContent = $("#suggestedPrice").textContent;
  pricingTabs.updateCompletion();
}

function renderNcmState() {
  const status = $("#ncmLookupStatus");
  const description = $("#ncmDescription");
  const button = $("#ncmLookupButton");
  button.disabled = focusState.status === "loading";
  button.textContent = focusState.status === "loading" ? "Consultando..." : "Validar NCM";

  if (focusState.status === "loading") status.textContent = "Consultando o NCM na Focus NFe…";
  else if (focusState.status === "success") status.textContent = `NCM confirmado pela Focus NFe em ${focusState.environment}. Isso não calcula a tributação.`;
  else if (focusState.status === "error") status.textContent = focusState.error;
  else status.textContent = "Consulte a classificação na Focus NFe. O NCM isolado não determina impostos.";

  description.hidden = !focusState.ncm?.descricao_completa;
  description.textContent = focusState.ncm?.descricao_completa || "";
}

async function lookupNcm() {
  const code = String(elements.ncmCode.value || "").replace(/\D/g, "");
  elements.ncmCode.value = code;
  if (!/^\d{8}$/.test(code)) {
    focusState = { status: "error", ncm: null, environment: "", error: "Informe um NCM com exatamente 8 dígitos.", unavailable: false };
    render();
    return;
  }

  focusState = { status: "loading", ncm: null, environment: "", error: "", unavailable: false };
  render();
  try {
    const response = await api.get(`/fiscal/ncms/${encodeURIComponent(code)}`, { handleUnauthorized: false });
    focusState = { status: "success", ncm: response.ncm, environment: response.environment, error: "", unavailable: false };
  } catch (error) {
    focusState = {
      status: "error",
      ncm: null,
      environment: "",
      error: `${messageFor(error)} O cálculo financeiro foi mantido, mas não está fiscalmente validado.`,
      unavailable: true,
    };
  }
  render();
}

function closeMobileMenus({ restoreFocus = false } = {}) {
  document.querySelectorAll("[data-mobile-menu-toggle]").forEach((button) => {
    const wasOpen = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "Abrir menu");
    const menu = button.closest(".mobile-app-header")?.querySelector("[data-mobile-menu]");
    if (menu) menu.hidden = true;
    if (restoreFocus && wasOpen) button.focus();
  });
}

function toggleMobileMenu(button) {
  const menu = button.closest(".mobile-app-header")?.querySelector("[data-mobile-menu]");
  if (!menu) return;
  const willOpen = button.getAttribute("aria-expanded") !== "true";
  closeMobileMenus();
  button.setAttribute("aria-expanded", String(willOpen));
  button.setAttribute("aria-label", willOpen ? "Fechar menu" : "Abrir menu");
  menu.hidden = !willOpen;
  if (willOpen) menu.querySelector("button")?.focus();
}

function showAuth(mode = "login", message = "") {
  closeMobileMenus();
  $("#bootScreen").hidden = true;
  $("#authView").hidden = false;
  $("#assistantView").hidden = true;
  $("#productsView").hidden = true;
  $("#aboutView").hidden = true;
  $("#loginForm").hidden = mode !== "login";
  $("#registerForm").hidden = mode !== "register";
  $("#showLoginButton").classList.toggle("active", mode === "login");
  $("#showRegisterButton").classList.toggle("active", mode === "register");
  $("#showLoginButton").setAttribute("aria-selected", String(mode === "login"));
  $("#showRegisterButton").setAttribute("aria-selected", String(mode === "register"));
  clearAuthErrors($("#loginForm"));
  clearAuthErrors($("#registerForm"));
  setMessage($("#authMessage"), message);
}

function showAssistant(view = "dashboard") {
  closeMobileMenus();
  $("#bootScreen").hidden = true;
  $("#authView").hidden = true;
  $("#assistantView").hidden = false;
  $("#productsView").hidden = true;
  $("#aboutView").hidden = true;
  const isPriceDetails = view === "price-details";
  $("#dashboardView").hidden = isPriceDetails;
  $("#priceDetailsView").hidden = !isPriceDetails;
  $("#mobilePriceSummary").hidden = isPriceDetails;

  if (isPriceDetails) {
    const target = pendingDetailTarget || "overview";
    pendingDetailTarget = "";
    window.requestAnimationFrame(() => {
      const detailSection = document.querySelector(`[data-detail-anchor="${target}"]`);
      detailSection?.scrollIntoView({ block: "start" });
      detailSection?.focus({ preventScroll: true });
    });
  } else {
    window.scrollTo({ top: 0, behavior: "auto" });
  }
}

async function showProducts() {
  closeMobileMenus();
  $("#bootScreen").hidden = true;
  $("#authView").hidden = true;
  $("#assistantView").hidden = true;
  $("#productsView").hidden = false;
  $("#aboutView").hidden = true;
  await loadProducts();
}

function showAbout() {
  closeMobileMenus();
  $("#bootScreen").hidden = true;
  $("#authView").hidden = true;
  $("#assistantView").hidden = true;
  $("#productsView").hidden = true;
  $("#aboutView").hidden = false;
  window.scrollTo({ top: 0, behavior: "auto" });
  $("#about-title")?.focus({ preventScroll: true });
}

async function syncRoute() {
  if (!state.user) return;
  if (window.location.hash === "#produtos") await showProducts();
  else if (window.location.hash === "#sobre") showAbout();
  else if (window.location.hash === detailRouteHashes.price) showAssistant("price-details");
  else showAssistant("dashboard");
}

function navigate(view, detailTarget = "") {
  closeMobileMenus();
  if (detailTarget) pendingDetailTarget = detailTarget;
  const hash = view === "products" ? "#produtos" : view === "about" ? "#sobre" : detailRouteHashes[view] || "#assistente";
  if (window.location.hash === hash) {
    void syncRoute();
  } else {
    window.location.hash = hash;
  }
}

function setAuthenticatedUser(user) {
  state.user = user;
  $("#currentUserName").textContent = user.name;
  void syncRoute();
}

function setMarketError(query, caughtError) {
  let error = "Não foi possível consultar o mercado agora.";
  if (caughtError instanceof ApiError && caughtError.status === 429) {
    error = "O provedor limitou temporariamente as consultas. Aguarde um pouco e tente novamente.";
  } else if (caughtError instanceof ApiError && caughtError.code === "NEXSCOPE_NOT_CONFIGURED") {
    error = "Consulta de mercado temporariamente indisponível.";
  } else if (caughtError instanceof ApiError && caughtError.code === "NEXSCOPE_UNAUTHORIZED") {
    error = "Não foi possível autenticar a consulta de mercado.";
  } else if (caughtError instanceof ApiError && caughtError.code === "NEXSCOPE_FORBIDDEN") {
    error = "A conta do provedor não possui acesso à pesquisa Amazon.";
  } else if (caughtError instanceof ApiError && caughtError.code === "NEXSCOPE_INSUFFICIENT_CREDITS") {
    error = "A conta do provedor está sem créditos suficientes para esta consulta.";
  } else if (caughtError instanceof ApiError && caughtError.code === "NEXSCOPE_TIMEOUT") {
    error = "A consulta demorou mais que o esperado. Tente novamente.";
  }

  marketState = {
    status: "error",
    query,
    items: [],
    stats: null,
    selectedItem: marketState.selectedItem,
    error: `${error} Você ainda pode informar o preço médio dos concorrentes manualmente.`,
  };
}

async function searchMarket() {
  if (marketState.status === "loading") return;
  const query = $("#marketQuery").value.trim();
  if (query.length < 3) {
    marketState = { ...marketState, status: "error", error: "Informe pelo menos 3 caracteres para pesquisar." };
    render();
    return;
  }

  marketState = { ...marketState, status: "loading", query, items: [], stats: null, error: "" };
  render();

  try {
    const data = await market.search(query);
    marketState = {
      ...marketState,
      status: data.stats ? "success" : "empty",
      ...data,
      error: "",
    };
  } catch (error) {
    setMarketError(query, error);
  }

  render();
}

function selectMarketProduct(id) {
  const selected = marketState.items.find((candidate) => candidate.id === id);
  const item = selected ? { ...selected, consultedAt: selected.consultedAt || new Date().toISOString() } : null;
  if (!item) return;
  if (marketSource !== "market-product") manualMarketValue = elements.competitorAverage.value;
  marketState = { ...marketState, selectedItem: item };
  elements.competitorAverage.value = item.price.toFixed(2);
  touchedPricingFields.add("competitorAverage");
  marketSource = "market-product";
  const parsedManualValue = parseBrazilianNumber(manualMarketValue);
  const storedManualValue = parsedManualValue.status === "valid" && parsedManualValue.value > 0 ? parsedManualValue.value : null;
  saveMarketReference(window.sessionStorage, { manualValue: storedManualValue, query: marketState.query, selectedItem: item });
  render();
}

function restoreManualMarket({ focusSearch = false } = {}) {
  elements.competitorAverage.value = manualMarketValue === null ? "" : String(manualMarketValue);
  touchedPricingFields.add("competitorAverage");
  marketSource = "manual";
  marketState = { ...marketState, selectedItem: null };
  clearMarketReference(window.sessionStorage);
  render();
  if (focusSearch) {
    pricingTabs.activate("market");
    $("#marketQuery").focus();
  }
}

function restoreMarketReferenceFromSession() {
  const saved = loadMarketReference(window.sessionStorage);
  if (!saved) return;
  manualMarketValue = saved.manualValue === null ? "" : String(saved.manualValue).replace(".", ",");
  marketState = { ...marketState, query: saved.query, selectedItem: saved.selectedItem };
  marketSource = "market-product";
  elements.competitorAverage.value = saved.selectedItem.price.toFixed(2);
  $("#marketQuery").value = saved.query;
}

function productPayloadFromCalculator() {
  const name = $("#productName").value.trim();
  const description = $("#productDescription").value.trim();
  revealAllPricingErrors = true;
  const validation = currentPricingValidation();
  if (!validation.isValid) {
    renderIncompleteDashboard(document, marketState, validation.errors);
    const firstInvalidField = elements[Object.keys(validation.errors)[0]];
    const panel = firstInvalidField?.closest?.("[data-pricing-panel]");
    if (panel) pricingTabs.activate(panel.dataset.pricingPanel, { focusTab: true });
    firstInvalidField?.focus();
    throw new ApiError("Corrija os campos indicados antes de salvar.", 400);
  }
  const inputs = validation.inputs;
  const result = calculatePrice(inputs);
  const fiscalAssessment = taxRuleEngine.assess(inputs, focusState);
  const memory = buildCalculationMemory(inputs, result, fiscalAssessment);

  if (!name) throw new ApiError("Informe o nome do produto antes de salvar.", 400);
  if (!result.isValid || result.minimumPrice === null) throw new ApiError("Revise os percentuais antes de salvar um cálculo inviável.", 400);

  return {
    name,
    description,
    category: "Não categorizado",
    costPrice: inputs.materialsCost,
    additionalCosts: Math.max(0, result.costs.baseCost - inputs.materialsCost),
    profitMargin: inputs.margin * 100,
    suggestedPrice: result.minimumPrice,
    marketplace: marketSource === "market-product" ? marketState.selectedItem?.source || "Marketplace" : "Manual",
    consultationDate: new Date().toISOString(),
    calculationData: {
      version: 5,
      inputs,
      emptyOptionalFields: validation.emptyOptionalFields,
      result,
      fiscal: fiscalDataForStorage(fiscalAssessment, memory),
      market: {
        source: marketSource,
        query: marketState.query,
        stats: marketState.stats,
        selectedProduct: marketState.selectedItem,
        manualValue: (() => {
          const parsed = parseBrazilianNumber(manualMarketValue);
          return parsed.status === "valid" && parsed.value > 0 ? parsed.value : null;
        })(),
        marketPrice: inputs.competitorAverage,
        taxAdjustedPrice: fiscalAssessment.automaticCalculation && fiscalAssessment.complete
          ? fiscalAssessment.marketAdjustedPrice || null
          : null,
      },
    },
  };
}

async function saveProduct() {
  const status = $("#saveProductStatus");
  const button = $("#saveProductButton");
  try {
    const payload = productPayloadFromCalculator();
    button.disabled = true;
    setMessage(status, "Salvando consulta…");
    await api.post("/products", payload);
    setMessage(status, "Produto salvo no seu histórico.", true);
  } catch (error) {
    setMessage(status, messageFor(error));
  } finally {
    button.disabled = false;
  }
}

async function loadProducts() {
  const list = $("#productsList");
  const search = $("#productSearch").value.trim();
  const sort = $("#productSort").value;
  setMessage($("#historyMessage"), "");
  list.innerHTML = '<div class="empty-history">Carregando produtos…</div>';

  try {
    const params = new URLSearchParams({ search, sort });
    const response = await api.get(`/products?${params.toString()}`);
    state.products = response.products;
    renderProductsList(list, state.products);
  } catch (error) {
    list.innerHTML = "";
    setMessage($("#historyMessage"), messageFor(error));
  }
}

function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

function showProductDetails(product) {
  state.selectedProduct = product;
  $("#productDialogTitle").textContent = product.name;
  $("#productDetails").hidden = false;
  $("#productEditorForm").hidden = true;
  renderProductDetails($("#productDetails"), product);
  openDialog($("#productDialog"));
}

function showProductEditor(product) {
  state.selectedProduct = product;
  $("#productDialogTitle").textContent = `Editar ${product.name}`;
  $("#productDetails").hidden = true;
  const form = $("#productEditorForm");
  form.hidden = false;
  $("#editProductName").value = product.name;
  $("#editProductDescription").value = product.description;
  $("#editProductCategory").value = product.category;
  $("#editCostPrice").value = product.costPrice;
  $("#editAdditionalCosts").value = product.additionalCosts;
  $("#editProfitMargin").value = product.profitMargin;
  $("#editSuggestedPrice").value = product.suggestedPrice;
  $("#editMarketplace").value = product.marketplace;
  openDialog($("#productDialog"));
}

async function getProduct(id) {
  const response = await api.get(`/products/${encodeURIComponent(id)}`);
  return response.product;
}

function reuseProduct(product) {
  const savedInputs = product.calculationData?.inputs;
  if (!applySavedInputs(savedInputs, elements, product.calculationData?.emptyOptionalFields)) {
    setMessage($("#historyMessage"), "Esta consulta não possui os dados necessários para ser reutilizada.");
    return;
  }

  $("#productName").value = product.name;
  $("#productDescription").value = product.description || "";
  const savedNcm = product.calculationData?.fiscal?.ncm;
  focusState = savedNcm?.codigo
    ? { status: "success", ncm: savedNcm, environment: "consulta salva", error: "", unavailable: false }
    : { status: "idle", ncm: null, environment: "", error: "", unavailable: false };
  const savedMarket = product.calculationData?.market;
  marketSource = ["market-product", "amazon-product"].includes(savedMarket?.source) ? "market-product" : "manual";
  const hasSavedManualValue = savedMarket && Object.prototype.hasOwnProperty.call(savedMarket, "manualValue");
  const savedManualValue = hasSavedManualValue ? savedMarket.manualValue : savedInputs?.competitorAverage;
  manualMarketValue = Number.isFinite(savedManualValue) && savedManualValue > 0
    ? String(savedManualValue).replace(".", ",")
    : "";
  marketState = {
    ...marketState,
    status: "idle",
    query: marketSource === "market-product" ? savedMarket?.query || "" : "",
    items: [],
    stats: marketSource === "market-product" ? savedMarket?.stats || null : null,
    selectedItem: marketSource === "market-product" ? savedMarket?.selectedProduct || null : null,
    error: "",
  };
  if (marketSource === "market-product" && marketState.selectedItem) {
    saveMarketReference(window.sessionStorage, {
      manualValue: manualMarketValue,
      query: marketState.query,
      selectedItem: marketState.selectedItem,
    });
  } else {
    clearMarketReference(window.sessionStorage);
  }
  $("#marketQuery").value = marketState.query;
  $("#productDialog").close();
  render();
  navigate("assistant");
  setMessage($("#saveProductStatus"), "Consulta anterior carregada. Ajuste o que quiser e salve uma nova versão.", true);
}

async function deleteProduct(id) {
  if (!window.confirm("Excluir este produto do seu histórico? Esta ação não pode ser desfeita.")) return;

  try {
    await api.delete(`/products/${encodeURIComponent(id)}`);
    if ($("#productDialog").open) $("#productDialog").close();
    setMessage($("#historyMessage"), "Produto excluído do seu histórico.", true);
    await loadProducts();
  } catch (error) {
    setMessage($("#historyMessage"), messageFor(error));
  }
}

async function editCurrentProduct(event) {
  event.preventDefault();
  const product = state.selectedProduct;
  const form = event.currentTarget;
  if (!product || !form.reportValidity()) return;

  const payload = {
    name: $("#editProductName").value.trim(),
    description: $("#editProductDescription").value.trim(),
    category: $("#editProductCategory").value.trim(),
    costPrice: Number($("#editCostPrice").value),
    additionalCosts: Number($("#editAdditionalCosts").value),
    profitMargin: Number($("#editProfitMargin").value),
    suggestedPrice: Number($("#editSuggestedPrice").value),
    marketplace: $("#editMarketplace").value.trim(),
    consultationDate: product.consultationDate,
    calculationData: product.calculationData || {},
  };

  try {
    const response = await api.patch(`/products/${encodeURIComponent(product.id)}`, payload);
    state.selectedProduct = response.product;
    $("#productDialog").close();
    setMessage($("#historyMessage"), "Produto atualizado com sucesso.", true);
    await loadProducts();
  } catch (error) {
    setMessage($("#historyMessage"), messageFor(error));
  }
}

function showProfile() {
  const details = $("#profileDetails");
  details.replaceChildren();
  [["Nome", state.user.name], ["E-mail", state.user.email]].forEach(([label, value]) => {
    const item = document.createElement("div");
    const term = document.createElement("dt");
    const definition = document.createElement("dd");
    term.textContent = label;
    definition.textContent = value;
    item.append(term, definition);
    details.append(item);
  });
  openDialog($("#profileDialog"));
}

async function logout() {
  try {
    await api.post("/auth/logout", undefined, { handleUnauthorized: false });
  } catch (error) {
    setMessage($("#saveProductStatus"), messageFor(error));
    return;
  }

  state.user = null;
  state.products = [];
  state.selectedProduct = null;
  clearMarketReference(window.sessionStorage);
  window.history.replaceState(null, "", window.location.pathname);
  showAuth("login", "Você saiu da sua conta.");
}

async function submitLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const isValid = ["loginEmail", "loginPassword"].every(validateLoginField);
  if (!isValid) return;
  const button = form.querySelector("button[type=submit]");

  try {
    setSubmitState(button, true, "Entrando...");
    setMessage($("#authMessage"), "");
    const response = await api.post("/auth/login", {
      email: $("#loginEmail").value.trim(),
      password: $("#loginPassword").value,
    }, { handleUnauthorized: false });
    form.reset();
    setAuthenticatedUser(response.user);
  } catch (error) {
    setMessage($("#authMessage"), messageFor(error));
  } finally {
    setSubmitState(button, false, "Entrar");
  }
}

async function submitRegistration(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const password = $("#registerPassword").value;
  const confirmation = $("#registerPasswordConfirmation").value;
  const isValid = ["registerName", "registerEmail", "registerPassword", "registerPasswordConfirmation"].every(validateRegisterField);
  if (!isValid) return;
  const button = form.querySelector("button[type=submit]");

  try {
    setSubmitState(button, true, "Criando conta...");
    setMessage($("#authMessage"), "");
    const response = await api.post("/auth/register", {
      name: $("#registerName").value.trim(),
      email: $("#registerEmail").value.trim(),
      password,
      passwordConfirmation: confirmation,
    }, { handleUnauthorized: false });
    form.reset();
    updatePasswordRequirements();
    setAuthenticatedUser(response.user);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      setFieldError("registerEmail", "Já existe uma conta cadastrada com este e-mail.");
      $("#registerEmail").focus();
    } else {
      setMessage($("#authMessage"), messageFor(error));
    }
  } finally {
    setSubmitState(button, false, "Criar conta");
  }
}

PRICING_FIELD_IDS
  .filter((fieldId) => fieldId !== "competitorAverage")
  .forEach((fieldId) => elements[fieldId].addEventListener("input", () => {
    touchedPricingFields.add(fieldId);
    render();
  }));

[
  elements.taxRegime,
  elements.originState,
  elements.destinationState,
  elements.cfop,
  elements.taxSituation,
  elements.customerType,
  elements.operationPurpose,
].forEach((field) => {
  field.addEventListener("input", render);
  field.addEventListener("change", render);
});

elements.ncmCode.addEventListener("input", () => {
  const currentCode = String(elements.ncmCode.value || "").replace(/\D/g, "");
  if (focusState.ncm?.codigo !== currentCode) focusState = { status: "idle", ncm: null, environment: "", error: "", unavailable: false };
  render();
});

$("#ncmLookupButton").addEventListener("click", lookupNcm);
elements.ncmCode.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  void lookupNcm();
});

elements.competitorAverage.addEventListener("input", () => {
  touchedPricingFields.add("competitorAverage");
  marketSource = "manual";
  marketState = { ...marketState, selectedItem: null };
  manualMarketValue = elements.competitorAverage.value;
  clearMarketReference(window.sessionStorage);
  render();
});

$("#marketSearchButton").addEventListener("click", searchMarket);
$("#marketQuery").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  void searchMarket();
});
$("#marketPanel").addEventListener("click", (event) => {
  const button = event.target.closest("[data-market-select]");
  if (button) selectMarketProduct(button.dataset.marketSelect);
  if (event.target.closest("[data-market-retry]")) void searchMarket();
});
$("#selectedMarketProduct").addEventListener("click", (event) => {
  if (event.target.closest("[data-change-market-reference]")) restoreManualMarket({ focusSearch: true });
});

$("#showLoginButton").addEventListener("click", () => showAuth("login"));
$("#showRegisterButton").addEventListener("click", () => showAuth("register"));
document.querySelectorAll("[data-theme-toggle]").forEach((button) => button.addEventListener("click", toggleTheme));
document.querySelectorAll("[data-auth-switch]").forEach((button) => {
  button.addEventListener("click", () => showAuth(button.dataset.authSwitch));
});
$("#loginForm").addEventListener("submit", submitLogin);
$("#registerForm").addEventListener("submit", submitRegistration);

["loginEmail", "loginPassword"].forEach((fieldId) => {
  const field = $(`#${fieldId}`);
  field.addEventListener("blur", () => validateLoginField(fieldId));
  field.addEventListener("input", () => {
    if (field.getAttribute("aria-invalid") === "true") validateLoginField(fieldId);
  });
});

["registerName", "registerEmail", "registerPassword", "registerPasswordConfirmation"].forEach((fieldId) => {
  const field = $(`#${fieldId}`);
  field.addEventListener("blur", () => {
    if (fieldId === "registerEmail") field.value = field.value.trim().toLowerCase();
    validateRegisterField(fieldId);
  });
  field.addEventListener("input", () => {
    if (fieldId === "registerPassword") {
      updatePasswordRequirements();
      if ($("#registerPasswordConfirmation").value) validateRegisterField("registerPasswordConfirmation");
    }
    if (field.getAttribute("aria-invalid") === "true" || fieldId === "registerPassword") validateRegisterField(fieldId);
  });
});

document.querySelectorAll("[data-password-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = $(`#${button.dataset.passwordToggle}`);
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    button.textContent = isPassword ? "Ocultar" : "Mostrar";
    button.setAttribute("aria-label", isPassword ? "Ocultar senha" : "Mostrar senha");
    button.setAttribute("aria-pressed", String(isPassword));
  });
});

document.querySelectorAll("[data-mobile-menu-toggle]").forEach((button) => {
  button.addEventListener("click", () => toggleMobileMenu(button));
});

document.querySelectorAll("[data-app-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.appAction;
    closeMobileMenus();
    if (action === "assistant") navigate("assistant");
    if (action === "products") navigate("products");
    if (action === "about") navigate("about");
    if (action === "profile") showProfile();
    if (action === "logout") void logout();
  });
});

document.querySelectorAll("[data-detail-view]").forEach((button) => {
  button.addEventListener("click", () => navigate(button.dataset.detailView, button.dataset.detailTarget || "overview"));
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".mobile-app-header")) closeMobileMenus();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMobileMenus({ restoreFocus: true });
});

$("#showMobileResultButton").addEventListener("click", () => {
  navigate("price", "overview");
});

$("#logoutButton").addEventListener("click", logout);
$("#showProfileButton").addEventListener("click", showProfile);
$("#showProductsButton").addEventListener("click", () => navigate("products"));
$("#showAboutButton").addEventListener("click", () => navigate("about"));
$("#backToDashboardButton").addEventListener("click", () => navigate("assistant"));
$("#backToAssistantButton").addEventListener("click", () => navigate("assistant"));
$("#aboutBackButton").addEventListener("click", () => navigate("assistant"));
$("#saveProductButton").addEventListener("click", saveProduct);
$("#productEditorForm").addEventListener("submit", editCurrentProduct);

$("#productSearch").addEventListener("input", () => {
  clearTimeout(productSearchTimer);
  productSearchTimer = setTimeout(() => void loadProducts(), 250);
});
$("#productSort").addEventListener("change", () => void loadProducts());
$("#productsList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-product-action]");
  if (!button) return;
  const { productAction: action, productId: id } = button.dataset;
  if (action === "delete") return deleteProduct(id);

  try {
    const product = await getProduct(id);
    if (action === "view") showProductDetails(product);
    if (action === "edit") showProductEditor(product);
    if (action === "reuse") reuseProduct(product);
  } catch (error) {
    setMessage($("#historyMessage"), messageFor(error));
  }
});
$("#productDetails").addEventListener("click", (event) => {
  const button = event.target.closest("[data-dialog-product-action]");
  if (!button || !state.selectedProduct) return;
  const action = button.dataset.dialogProductAction;
  if (action === "edit") showProductEditor(state.selectedProduct);
  if (action === "reuse") reuseProduct(state.selectedProduct);
  if (action === "delete") void deleteProduct(state.selectedProduct.id);
});
document.addEventListener("click", (event) => {
  const closeButton = event.target.closest("[data-close-dialog]");
  if (!closeButton) return;
  closeButton.closest("dialog")?.close();
});
window.addEventListener("hashchange", () => void syncRoute());
window.addEventListener("app:session-expired", () => {
  state.user = null;
  state.products = [];
  state.selectedProduct = null;
  clearMarketReference(window.sessionStorage);
  window.history.replaceState(null, "", window.location.pathname);
  showAuth("login", "Sua sessão expirou. Entre novamente para continuar.");
});

restoreMarketReferenceFromSession();
applyTheme(document.documentElement.dataset.theme, false);
render();

async function bootstrap(attempt = 0) {
  try {
    const response = await api.get("/auth/me", { handleUnauthorized: false });
    setAuthenticatedUser(response.user);
  } catch (error) {
    if (error instanceof ApiError && error.code === "STATIC_HOSTING") {
      showAuth("login", error.message);
      return;
    }
    const isInactiveSession = error instanceof ApiError && error.status === 401;
    if (!isInactiveSession && attempt < 2) {
      window.setTimeout(() => void bootstrap(attempt + 1), 800);
      return;
    }
    const message = error instanceof ApiError && error.status === 401
      ? ""
      : "Não foi possível conectar ao servidor.";
    showAuth("login", message);
  }
}

updatePasswordRequirements();
void bootstrap();
