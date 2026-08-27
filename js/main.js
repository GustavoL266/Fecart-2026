import { calculatePrice } from "./domain/pricing-calculator.js";
import { buildSearchUrl, MercadoLivreService } from "./services/mercado-livre-service.js";
import { ApiError, api } from "./services/api-client.js";
import { applyCategoryPreset, applySavedInputs, isAboveCompetitorLimit, readInputs } from "./ui/form.js";
import { renderDashboard } from "./ui/dashboard.js";
import { renderProductDetails, renderProductsList } from "./ui/history.js";

const $ = (selector) => document.querySelector(selector);
const mercadoLivre = new MercadoLivreService();
const formFieldIds = [
  "productType",
  "materialsCost",
  "waste",
  "packagingCost",
  "deliveryCost",
  "totalPayroll",
  "workerCount",
  "outputPerWorkerHour",
  "monthlyFixedCosts",
  "monthlyVolume",
  "taxRate",
  "paymentFeeRate",
  "commissionRate",
  "margin",
  "competitorAverage",
  "receiveDays",
  "payDays",
  "capitalRate",
];
const elements = Object.fromEntries(formFieldIds.map((id) => [id, $(`#${id}`)]));
const state = {
  user: null,
  products: [],
  selectedProduct: null,
};

let marketSource = "manual";
let meliState = {
  status: "idle",
  query: "",
  searchUrl: "",
  listings: [],
  comparableListings: [],
  stats: null,
  selectedId: null,
  error: "",
};
let productSearchTimer;

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

function render() {
  const inputs = readInputs(elements);
  renderDashboard(document, inputs, calculatePrice(inputs), meliState, marketSource);
}

function showAuth(mode = "login", message = "") {
  $("#bootScreen").hidden = true;
  $("#authView").hidden = false;
  $("#assistantView").hidden = true;
  $("#productsView").hidden = true;
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

function showAssistant() {
  $("#bootScreen").hidden = true;
  $("#authView").hidden = true;
  $("#assistantView").hidden = false;
  $("#productsView").hidden = true;
}

async function showProducts() {
  $("#bootScreen").hidden = true;
  $("#authView").hidden = true;
  $("#assistantView").hidden = true;
  $("#productsView").hidden = false;
  await loadProducts();
}

async function syncRoute() {
  if (!state.user) return;
  if (window.location.hash === "#produtos") await showProducts();
  else showAssistant();
}

function navigate(view) {
  const hash = view === "products" ? "#produtos" : "#assistente";
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

function setMeliError(query, status) {
  const error =
    status === 429
      ? "O Mercado Livre limitou as consultas no momento. Aguarde um pouco e tente novamente."
      : status === 403
        ? "O Mercado Livre bloqueou a consulta automática de anúncios para este acesso."
        : "Não foi possível consultar o Mercado Livre agora. Verifique sua conexão ou tente novamente mais tarde.";

  meliState = { ...meliState, status: "error", query, searchUrl: buildSearchUrl(query), listings: [], comparableListings: [], stats: null, selectedId: null, error };
}

async function searchMercadoLivre() {
  const query = $("#meliQuery").value.trim();
  if (query.length < 3) {
    meliState = { ...meliState, status: "error", error: "Informe pelo menos 3 caracteres para pesquisar." };
    render();
    return;
  }

  meliState = { status: "loading", query, searchUrl: buildSearchUrl(query), listings: [], comparableListings: [], stats: null, selectedId: null, error: "" };
  render();

  try {
    const data = await mercadoLivre.search(query);
    meliState = {
      status: data.stats ? "success" : "empty",
      ...data,
      selectedId: data.comparableListings[0]?.id || null,
      error: "",
    };
  } catch (error) {
    setMeliError(query, error.status);
  }

  render();
}

function productPayloadFromCalculator() {
  const name = $("#productName").value.trim();
  const description = $("#productDescription").value.trim();
  const inputs = readInputs(elements);
  const result = calculatePrice(inputs);

  if (!name) throw new ApiError("Informe o nome do produto antes de salvar.", 400);
  if (!result.isValid || result.minimumPrice === null) throw new ApiError("Revise os percentuais antes de salvar um cálculo inviável.", 400);

  const selectedListing = meliState.comparableListings.find((listing) => listing.id === meliState.selectedId);
  return {
    name,
    description,
    category: inputs.productType,
    costPrice: inputs.materialsCost,
    additionalCosts: Math.max(0, result.costs.baseCost - inputs.materialsCost),
    profitMargin: inputs.margin * 100,
    suggestedPrice: result.minimumPrice,
    marketplace: marketSource.startsWith("meli") ? "Mercado Livre" : "Manual",
    consultationDate: new Date().toISOString(),
    calculationData: {
      version: 1,
      inputs,
      result,
      market: {
        source: marketSource,
        query: meliState.query,
        stats: meliState.stats,
        selectedListing: selectedListing
          ? { id: selectedListing.id, title: selectedListing.title, price: selectedListing.price, link: selectedListing.link }
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
  if (!applySavedInputs(savedInputs, elements)) {
    setMessage($("#historyMessage"), "Esta consulta não possui os dados necessários para ser reutilizada.");
    return;
  }

  $("#productName").value = product.name;
  $("#productDescription").value = product.description || "";
  marketSource = product.calculationData?.market?.source || "manual";
  meliState = { ...meliState, status: "idle", query: product.calculationData?.market?.query || "", stats: product.calculationData?.market?.stats || null };
  $("#meliQuery").value = meliState.query;
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

[
  elements.materialsCost,
  elements.waste,
  elements.packagingCost,
  elements.deliveryCost,
  elements.totalPayroll,
  elements.workerCount,
  elements.outputPerWorkerHour,
  elements.monthlyFixedCosts,
  elements.monthlyVolume,
  elements.taxRate,
  elements.paymentFeeRate,
  elements.commissionRate,
  elements.margin,
  elements.receiveDays,
  elements.payDays,
  elements.capitalRate,
].forEach((field) => field.addEventListener("input", render));

elements.productType.addEventListener("change", () => {
  applyCategoryPreset(elements.productType.value, elements);
  marketSource = "manual";
  render();
});

elements.competitorAverage.addEventListener("input", () => {
  marketSource = "manual";
  if (isAboveCompetitorLimit(elements)) elements.competitorAverage.value = "1000000";
  render();
});

$("#meliSearchButton").addEventListener("click", searchMercadoLivre);
$("#meliQuery").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  searchMercadoLivre();
});
$("#applyMeliMarket").addEventListener("click", () => {
  if (!meliState.stats) return;
  elements.competitorAverage.value = meliState.stats.median.toFixed(2);
  marketSource = "meli-median";
  render();
});
$("#meliResults").addEventListener("click", (event) => {
  const button = event.target.closest("[data-meli-select]");
  if (!button) return;
  const selectedListing = meliState.comparableListings.find((listing) => listing.id === button.dataset.meliSelect);
  meliState = { ...meliState, selectedId: button.dataset.meliSelect };
  if (selectedListing) {
    elements.competitorAverage.value = selectedListing.price.toFixed(2);
    marketSource = "meli-listing";
  }
  render();
});

$("#showLoginButton").addEventListener("click", () => showAuth("login"));
$("#showRegisterButton").addEventListener("click", () => showAuth("register"));
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

$("#logoutButton").addEventListener("click", logout);
$("#showProfileButton").addEventListener("click", showProfile);
$("#showProductsButton").addEventListener("click", () => navigate("products"));
$("#backToAssistantButton").addEventListener("click", () => navigate("assistant"));
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
  window.history.replaceState(null, "", window.location.pathname);
  showAuth("login", "Sua sessão expirou. Entre novamente para continuar.");
});

applyCategoryPreset(elements.productType.value, elements);
render();

async function bootstrap(attempt = 0) {
  try {
    const response = await api.get("/auth/me", { handleUnauthorized: false });
    setAuthenticatedUser(response.user);
  } catch (error) {
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
