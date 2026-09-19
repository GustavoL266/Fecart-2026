import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createAiAssistant, validateAssistantResponse } from "../js/ui/ai-assistant.js";
import { applyAssistantFields, FORM_OPTION_FIELD_IDS, PRICING_FIELD_IDS, readAssistantFieldContext, readAssistantRateContext, validateAssistantFields, validatePricingForm } from "../js/ui/form.js";
import { calculatePricing } from "../js/domain/pricing-calculator.js";
import { parsePricingMessage } from "../lib/ai-form-assistant.js";

function controls(values = {}) {
  const defaults = { laborCostMode: "automatic", freightPayer: "company", allocationMethod: "quantity", capitalRateSource: "informed", discountType: "none" };
  const ids = [...PRICING_FIELD_IDS, ...FORM_OPTION_FIELD_IDS, "productName", "productDescription", "marketQuery", "taxRegime", "originState", "destinationState", "cfop", "taxSituation", "customerType", "operationPurpose", "productOrigin", "countryOfOrigin", "ncmCode"];
  return Object.fromEntries(ids.map((id) => [id, { value: values[id] ?? defaults[id] ?? "" }]));
}

function response(fields, pending = [], sourceOverrides = {}, skipped = {}) {
  const resolvedFields = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null));
  const sources = Object.fromEntries(Object.keys(resolvedFields).map((field) => [field, sourceOverrides[field] || "user_provided"]));
  return {
    fields,
    sources,
    skipped,
    summary: [
      ...Object.entries(resolvedFields).map(([field, value]) => ({ field, label: field, value: String(value), source: sources[field] })),
      ...Object.keys(skipped).map((field) => ({ field, label: field, value: "Não informado", source: "skipped" })),
    ],
    pending,
    needsClarification: pending.length > 0,
  };
}

class Element {
  constructor() {
    this.value = "";
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    const classes = new Set();
    this.classList = {
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
      contains: (name) => classes.has(name),
    };
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(event, listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(listener);
  }
  async emit(event, value = { preventDefault() {} }) {
    await Promise.all((this.listeners.get(event) || []).map((listener) => listener(value)));
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; void this.emit("close"); }
}

function fixture({ parse = async () => response({ desiredNetMargin: 20 }), apply } = {}) {
  const names = ["form", "message", "analyze", "preview", "fields", "estimate-warning", "pending", "pending-list", "clarification-form", "clarification-label", "clarification", "clarify", "status", "apply", "adjust", "search", "cancel", "close"];
  const elements = Object.fromEntries(names.map((name) => [name, new Element()]));
  const dialog = new Element();
  const openButton = new Element();
  dialog.querySelector = (selector) => elements[selector.match(/^\[data-ai-(.+)\]$/)[1]];
  dialog.ownerDocument = { createElement: () => new Element() };
  const applied = [];
  let session = true;
  let searched = 0;
  const controller = createAiAssistant({
    dialog, openButtons: [openButton], parse,
    hasSession: () => session,
    onApply: (fields) => { if (apply) apply(fields); applied.push(fields); },
    onSearchMarket: () => { searched += 1; },
  });
  return {
    dialog, elements, controller, openButton, applied,
    setSession: (value) => { session = value; },
    searched: () => searched,
    async enter(message = "Mude minha margem para 20%.") {
      controller.open();
      elements.message.value = message;
      await elements.message.emit("input");
    },
  };
}

function descendants(element) {
  return [element, ...element.children.flatMap(descendants)];
}

async function clickButton(element, label) {
  const button = descendants(element).find((candidate) => candidate.textContent === label);
  assert.ok(button, `Botão não encontrado: ${label}`);
  await button.emit("click");
  return button;
}

function pending() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

test("patch com vários campos mantém frete e dados ausentes e usa a fórmula existente", () => {
  const fields = controls({
    materialCost: "0", wasteRate: "0", packagingCost: "0", averageOrderFreight: "5", averageOrderUnits: "1",
    monthlyLaborCost: "0", monthlyProductiveHours: "160", productionTimeMinutes: "0", monthlyFixedCosts: "0",
    expectedMonthlyUnits: "100", taxRate: "0", desiredNetMargin: "0", inventoryDays: "0", receivingDays: "0",
    paymentDays: "0", monthlyCapitalRate: "0",
  });
  const patch = { productName: "Bolo de chocolate", materialCost: 18, packagingCost: 3, wasteRate: 10, desiredNetMargin: 25, averageOrderFreight: null };
  const changed = applyAssistantFields(patch, fields);
  assert.deepEqual(changed, ["productName", "materialCost", "packagingCost", "wasteRate", "desiredNetMargin"]);
  assert.equal(fields.averageOrderFreight.value, "5");
  const validation = validatePricingForm(fields);
  assert.equal(validation.isValid, true);
  assert.equal(validation.inputs.desiredNetMargin, 0.25);
  assert.equal(calculatePricing(validation.inputs).technicalPrice, 37.34);
});

test("comando de edição altera um campo sem apagar valores ausentes; zero remove desconto", () => {
  const fields = controls({ materialCost: "18,50", averageOrderFreight: "5", desiredNetMargin: "25", fixedDiscountAmount: "4", discountRate: "" });
  applyAssistantFields({ desiredNetMargin: 22, materialCost: null }, fields);
  assert.equal(fields.desiredNetMargin.value, "22");
  assert.equal(fields.materialCost.value, "18,50");
  assert.equal(fields.averageOrderFreight.value, "5");
  applyAssistantFields({ discountRate: 0, fixedDiscountAmount: 0 }, fields);
  assert.equal(fields.discountRate.value, "0");
  assert.equal(fields.fixedDiscountAmount.value, "0");
  assert.deepEqual(applyAssistantFields({ averageOrderFreight: undefined }, fields), []);
});

test("decimais brasileiros, percentuais e custos pequenos não viram notação científica", () => {
  const fields = controls();
  applyAssistantFields({ materialCost: 18.75, commissionRate: 5.5, packagingCost: 0.00000001 }, fields);
  assert.equal(fields.materialCost.value, "18,75");
  assert.equal(fields.commissionRate.value, "5,5");
  assert.equal(fields.packagingCost.value, "0,00000001");
});

test("mão de obra parcial preenche só os dados informados, sem inventar horas produtivas", () => {
  const fields = controls();
  applyAssistantFields({ monthlyLaborCost: 4000, productionTimeMinutes: 10 }, fields);
  assert.equal(fields.monthlyLaborCost.value, "4000");
  assert.equal(fields.productionTimeMinutes.value, "10");
  assert.equal(fields.monthlyProductiveHours.value, "");
});

test("validação rejeita valores fora dos limites e campos desconhecidos antes de qualquer alteração", () => {
  const invalid = [
    { materialCost: -1 }, { materialCost: "20" }, { materialCost: Infinity }, { materialCost: NaN }, { materialCost: 1_000_000_001 },
    { wasteRate: 100 }, { desiredNetMargin: 100 }, { receivingDays: 3651 }, { monthlyProductiveHours: 0 },
    { averageOrderUnits: 0 }, { expectedMonthlyUnits: 0 }, { marketPrice: 0 }, { finalPrice: 100 }, { ncmCode: "19059090" },
    { icms: 18 }, { apiKey: "secret" }, { productName: "<script>alert(1)</script>" }, { marketQuery: "x".repeat(161) },
    { cfop: "9999" }, { taxSituation: "abc" }, { taxRegime: "inventado" }, { originState: "XX" },
    { discountRate: 10, fixedDiscountAmount: 4 }, { taxRate: 80, desiredNetMargin: 20 },
  ];
  for (const patch of invalid) {
    const fields = controls({ productName: "Original", materialCost: "3" });
    assert.throws(() => applyAssistantFields({ productName: "Alterado", ...patch }, fields), /AI_INVALID_RESPONSE/);
    assert.equal(fields.productName.value, "Original");
    assert.equal(fields.materialCost.value, "3");
  }
});

test("valida todas as opções dos selects antes de aplicar o patch", () => {
  const fields = controls({ materialCost: "3" });
  fields.taxRegime.options = [{ value: "mei" }];
  assert.throws(() => applyAssistantFields({ materialCost: 20, taxRegime: "simples-nacional" }, fields), /AI_INVALID_RESPONSE/);
  assert.equal(fields.materialCost.value, "3");
  applyAssistantFields({ taxRegime: "mei", cfop: "5102", taxSituation: "102", originState: "SP" }, fields);
  assert.equal(fields.taxRegime.value, "mei");
  assert.equal(fields.ncmCode.value, "");
});

test("resposta exige prévia de cada campo válido e não aceita saída vazia ou desconhecida", () => {
  assert.deepEqual(validateAssistantResponse(response({ materialCost: 20, packagingCost: null })).fields, { materialCost: 20 });
  assert.deepEqual(validateAssistantFields({ materialCost: null }), {});
  for (const raw of [null, [], { fields: [] }, { fields: {} }, { fields: { materialCost: 20 }, summary: [] },
    { fields: { materialCost: 20 }, sources: { materialCost: "user_provided" }, summary: [{ field: "desiredNetMargin", label: "Margem", value: "20%", source: "user_provided" }] },
    { ...response({}, [], {}, { averageOrderFreight: { value: null, source: "skipped" } }), summary: [{ field: "averageOrderFreight", label: "Frete", value: "Não informado", source: undefined }] },
    { fields: { materialCost: 20, packagingCost: 1 }, summary: [response({ materialCost: 20 }).summary[0], response({ materialCost: 20 }).summary[0]] }]) {
    assert.throws(() => validateAssistantResponse(raw));
  }
});

test("análise só exibe a prévia; confirmação aplica uma única vez", async () => {
  const ui = fixture();
  await ui.enter();
  await ui.elements.form.emit("submit");
  assert.deepEqual(ui.applied, []);
  assert.equal(ui.elements.preview.hidden, false);
  assert.equal(ui.elements.fields.children.length, 1);
  await ui.elements.apply.emit("click");
  await ui.elements.apply.emit("click");
  assert.deepEqual(ui.applied, [{ desiredNetMargin: 20 }]);
  assert.match(ui.elements.status.textContent, /aplicadas/);
});

test("resposta parcialmente válida exibe prévia e não aplica o campo rejeitado", async () => {
  const message = "Quero vender brigadeiros, tenho R$ 20 de outros custos e quero margem de 30%.";
  const provider = { fillMode: "partial", extract: async () => ({ entries: [
    { field: "productName", value: "brigadeiros", source: "user_provided", evidence: "vender brigadeiros", basis: "not-applicable", certainty: "certain", batchUnits: null, batchEvidence: null, correctionEvidence: null },
    { field: "otherVariableCost", value: 20, source: "user_provided", evidence: "R$ 20 de outros custos", basis: "unit", certainty: "certain", batchUnits: null, batchEvidence: null, correctionEvidence: null },
    { field: "desiredNetMargin", value: 30, source: "user_provided", evidence: "margem de 30%", basis: "not-applicable", certainty: "certain", batchUnits: null, batchEvidence: null, correctionEvidence: null },
  ] }) };
  const form = controls({ otherVariableCost: "9" });
  const ui = fixture({
    parse: (text) => parsePricingMessage({ provider, input: { message: text } }),
    apply: (fields) => applyAssistantFields(fields, form),
  });
  await ui.enter(message);
  await ui.elements.form.emit("submit");
  assert.equal(ui.elements.preview.hidden, false);
  assert.ok(ui.elements.fields.children.length >= 1);
  assert.equal(ui.applied.length, 0);
  assert.equal(form.otherVariableCost.value, "9");
  assert.doesNotMatch(ui.elements.status.textContent, /Não foi possível validar/);
  await ui.elements.apply.emit("click");
  assert.equal(form.productName.value, "brigadeiros");
  assert.equal(form.desiredNetMargin.value, "30");
  assert.equal(form.otherVariableCost.value, "9");
});

test("envio imediato lê o último caractere já presente no textarea", async () => {
  const calls = [];
  const ui = fixture({ parse: async (message) => { calls.push(message); return response({ desiredNetMargin: 10 }); } });
  ui.controller.open();
  ui.elements.message.value = "Quero vender bolo e quero margem de 10";
  await ui.elements.message.emit("input");
  ui.elements.message.value += "%";
  const finalInput = ui.elements.message.emit("input", { isComposing: false });
  const immediateSubmit = ui.elements.form.emit("submit");
  await Promise.all([finalInput, immediateSubmit]);
  assert.deepEqual(calls, ["Quero vender bolo e quero margem de 10%"]);
  assert.deepEqual(ui.applied, []);
});

test("submit durante composição usa o valor atual completo sem atraso artificial", async () => {
  const calls = [];
  const ui = fixture({ parse: async (message) => { calls.push(message); return response({ desiredNetMargin: 10 }); } });
  ui.controller.open();
  ui.elements.message.value = "Quero vender bolo e quero margem de 10%";
  const composingInput = ui.elements.message.emit("input", { isComposing: true });
  const immediateSubmit = ui.elements.form.emit("submit");
  await Promise.all([composingInput, immediateSubmit]);
  assert.deepEqual(calls, ["Quero vender bolo e quero margem de 10%"]);
});

test("loading desabilita envio e impede chamadas simultâneas", async () => {
  const work = pending();
  let calls = 0;
  const ui = fixture({ parse: () => { calls += 1; return work.promise; } });
  await ui.enter();
  const analysis = ui.elements.form.emit("submit");
  assert.equal(ui.elements.analyze.disabled, true);
  assert.equal(ui.elements.message.readOnly, true);
  assert.equal(ui.elements.analyze.attributes.get("aria-busy"), "true");
  assert.match(ui.elements.analyze.textContent, /Analisando/);
  await ui.elements.form.emit("submit");
  assert.equal(calls, 1);
  work.resolve(response({ desiredNetMargin: 20 }));
  await analysis;
  assert.equal(ui.elements.analyze.disabled, false);
  assert.equal(ui.elements.message.readOnly, false);
});

test("cancelar aborta requisição e descarta resposta tardia", async () => {
  const work = pending();
  let signal;
  const ui = fixture({ parse: (_message, options) => { signal = options.signal; return work.promise; } });
  await ui.enter();
  const analysis = ui.elements.form.emit("submit");
  await ui.elements.cancel.emit("click");
  assert.equal(signal.aborted, true);
  assert.equal(ui.dialog.open, false);
  work.resolve(response({ materialCost: 20 }));
  await analysis;
  assert.deepEqual(ui.applied, []);
  assert.equal(ui.elements.fields.children.length, 0);
});

test("resposta de análise cancelada não substitui nova prévia", async () => {
  const old = pending();
  let calls = 0;
  const ui = fixture({ parse: () => ++calls === 1 ? old.promise : Promise.resolve(response({ desiredNetMargin: 22 })) });
  await ui.enter();
  const first = ui.elements.form.emit("submit");
  ui.controller.invalidate();
  await ui.enter("Mude a margem para 22%.");
  await ui.elements.form.emit("submit");
  old.resolve(response({ desiredNetMargin: 80 }));
  await first;
  await ui.elements.apply.emit("click");
  assert.deepEqual(ui.applied, [{ desiredNetMargin: 22 }]);
});

test("editar mensagem invalida prévia e exige nova análise", async () => {
  const ui = fixture();
  await ui.enter();
  await ui.elements.form.emit("submit");
  ui.elements.message.value = "Coloque frete de 7 reais.";
  await ui.elements.message.emit("input");
  await ui.elements.apply.emit("click");
  assert.deepEqual(ui.applied, []);
  assert.equal(ui.elements.preview.hidden, true);
});

test("consulta de mercado preenche busca e só pesquisa pelo botão explícito", async () => {
  const fields = controls({ marketPrice: "5000" });
  const ui = fixture({ parse: async () => response({ marketQuery: "iPhone 15 Pro Max" }), apply: (patch) => applyAssistantFields(patch, fields) });
  await ui.enter("Pesquise iPhone 15 Pro Max no mercado.");
  await ui.elements.form.emit("submit");
  assert.equal(ui.elements.search.hidden, true);
  await ui.elements.apply.emit("click");
  assert.equal(fields.marketQuery.value, "iPhone 15 Pro Max");
  assert.equal(fields.marketPrice.value, "5000");
  assert.equal(ui.searched(), 0);
  assert.equal(ui.elements.search.hidden, false);
  await ui.elements.search.emit("click");
  assert.equal(ui.searched(), 1);
  assert.equal(ui.dialog.open, false);
});

test("API indisponível, resposta inválida e texto vago deixam formulário intacto e liberam nova tentativa", async () => {
  for (const [parse, expected] of [
    [async () => { throw new Error("failure"); }, /temporariamente indisponível/],
    [async () => ({ fields: { materialCost: -20 }, summary: [] }), /validar a resposta/],
    [async () => response({}), /informações suficientes/],
    [async () => { throw { code: "AI_RATE_LIMITED" }; }, /Aguarde um minuto/],
  ]) {
    const ui = fixture({ parse });
    await ui.enter("Me ajude.");
    await ui.elements.form.emit("submit");
    assert.match(ui.elements.status.textContent, expected);
    assert.equal(ui.elements.analyze.disabled, false);
    assert.equal(ui.elements.preview.hidden, true);
    assert.deepEqual(ui.applied, []);
  }
});

test("diagnósticos de configuração, provedor e timeout são seguros e não aplicam campos", async () => {
  for (const [code, expected] of [
    ["GEMINI_NOT_CONFIGURED", /ainda não está configurado/],
    ["GEMINI_UNAUTHORIZED", /autenticar.*provedor/],
    ["GEMINI_FORBIDDEN", /não autorizou/],
    ["GEMINI_MODEL_UNAVAILABLE", /modelo.*não está disponível/i],
    ["GEMINI_BAD_REQUEST", /recusou o formato/i],
    ["GEMINI_QUOTA_EXCEEDED", /créditos/],
    ["GEMINI_RATE_LIMITED", /provedor.*limitando/],
    ["GEMINI_TIMEOUT", /demorou/],
    ["GEMINI_CONNECTION_ERROR", /conectar/],
    ["GEMINI_INVALID_RESPONSE", /validar/],
    ["GEMINI_UNAVAILABLE", /Gemini.*indisponível/],
    ["AI_CLARIFICATION_MERGE_FAILED", /combinar.*análise anterior/],
    ["AI_VALIDATION_FAILED", /validação final/],
    ["AI_INTERNAL_ERROR", /falha interna/],
  ]) {
    const ui = fixture({ parse: async () => { throw { code, message: "SECRET_WITH_PRIVATE_USER_MESSAGE" }; } });
    await ui.enter();
    await ui.elements.form.emit("submit");
    assert.match(ui.elements.status.textContent, expected);
    assert.doesNotMatch(ui.elements.status.textContent, /SECRET_WITH_PRIVATE_USER_MESSAGE/);
    assert.equal(ui.elements.analyze.disabled, false);
    assert.equal(ui.elements.preview.hidden, true);
    assert.equal(ui.elements.apply.disabled, true);
    assert.deepEqual(ui.applied, []);
  }
});

test("brigadeiros: prévia de lote preserva pendências e só confirmação altera controles", async () => {
  const message = "quero vender brigadeiros. gasto R$ 40 em ingredientes para produzir 100 unidades, R$ 10 em embalagens e quero margem de 30%";
  const fields = controls({ averageOrderFreight: "5" });
  const entry = (field, value, evidence, batchUnits = null, batchEvidence = null) => ({
    field, value, source: "user_provided", evidence,
    basis: ["materialCost", "packagingCost"].includes(field) ? "batch-total" : "not-applicable",
    certainty: "certain", batchUnits, batchEvidence, correctionEvidence: null,
  });
  // The model output is a fixture; the extraction validator and form controller are real.
  const provider = { extract: async () => ({ entries: [
    entry("productName", "brigadeiros", "quero vender brigadeiros"),
    entry("materialCost", 40, "R$ 40 em ingredientes", 100, "produzir 100 unidades"),
    entry("packagingCost", 10, "R$ 10 em embalagens", 100, "produzir 100 unidades"),
    entry("desiredNetMargin", 30, "margem de 30%"),
  ] }) };
  const ui = fixture({ parse: (text) => parsePricingMessage({ provider, input: { message: text } }), apply: (patch) => applyAssistantFields(patch, fields) });
  await ui.enter(message);
  await ui.elements.form.emit("submit");
  assert.equal(ui.elements.preview.hidden, false);
  assert.equal(ui.elements.fields.children.length, 1);
  assert.equal(fields.materialCost.value, "");
  assert.equal(fields.productName.value, "");
  await ui.elements.apply.emit("click");
  assert.equal(fields.productName.value, "brigadeiros");
  assert.equal(fields.materialCost.value, "0,4");
  assert.equal(fields.packagingCost.value, "0,1");
  assert.equal(fields.desiredNetMargin.value, "30");
  assert.equal(fields.averageOrderFreight.value, "5");
  for (const id of ["monthlyLaborCost", "expectedMonthlyUnits", "wasteRate", "taxRate"]) assert.equal(fields[id].value, "");
  assert.equal(validatePricingForm(fields).isValid, false);
});

test("sessão encerrada impede abrir, aplicar e aceitar resposta pendente", async () => {
  const work = pending();
  const ui = fixture({ parse: () => work.promise });
  await ui.enter();
  const analysis = ui.elements.form.emit("submit");
  ui.setSession(false);
  ui.controller.invalidate();
  work.resolve(response({ desiredNetMargin: 20 }));
  await analysis;
  await ui.elements.apply.emit("click");
  ui.controller.open();
  assert.equal(ui.dialog.open, false);
  assert.deepEqual(ui.applied, []);
});

test("contexto do assistente contém somente percentuais válidos exibidos", () => {
  const fields = controls({ taxRate: "6,5", paymentFeeRate: "2,8", commissionRate: "", desiredNetMargin: "25", materialCost: "999", averageOrderFreight: "7" });
  assert.deepEqual(readAssistantRateContext(fields), { taxRate: 6.5, paymentFeeRate: 2.8, desiredNetMargin: 25 });
  fields.taxRate.value = "100";
  fields.paymentFeeRate.value = "inválido";
  assert.deepEqual(readAssistantRateContext(fields), { desiredNetMargin: 25 });
});

test("contexto completo preserva inputs manuais válidos e opções, sem enviar mercado", () => {
  const fields = controls({
    productName: "Bolo", productDescription: "Chocolate", materialCost: "15,50", packagingCost: "2",
    desiredNetMargin: "10", marketPrice: "99", wasteRate: "inválido",
  });
  assert.deepEqual(readAssistantFieldContext(fields), {
    materialCost: 15.5,
    packagingCost: 2,
    desiredNetMargin: 10,
    productName: "Bolo",
    productDescription: "Chocolate",
    laborCostMode: "automatic",
    freightPayer: "company",
    allocationMethod: "quantity",
    capitalRateSource: "informed",
    discountType: "none",
  });
});

test("prévia separa origens, mostra aviso e Ajustar dados não aplica valores", async () => {
  const ui = fixture({ parse: async () => response(
    { productName: "bolo", materialCost: 15, averageOrderFreight: 0, packagingCost: 2 },
    [],
    { averageOrderFreight: "inferred", packagingCost: "estimated" },
  ) });
  const message = "Quero vender bolo e gasto R$ 15 por unidade.";
  await ui.enter(message);
  await ui.elements.form.emit("submit");
  assert.equal(ui.elements.fields.children.length, 3);
  assert.equal(ui.elements.fields.children[0].children[0].textContent, "Informado pelo usuário");
  assert.equal(ui.elements.fields.children[1].children[0].textContent, "Inferido com segurança");
  assert.equal(ui.elements.fields.children[2].children[0].textContent, "Estimado pela IA");
  assert.equal(ui.elements["estimate-warning"].hidden, false);
  assert.deepEqual(ui.applied, []);
  await ui.elements.adjust.emit("click");
  assert.equal(ui.elements.preview.hidden, true);
  assert.equal(ui.elements.message.value, message);
  assert.equal(ui.elements.message.focused, true);
  assert.deepEqual(ui.applied, []);
});

test("campo faltando permite informar valor e reanalisa somente o campo escolhido", async () => {
  const calls = [];
  const issue = { code: "AI_COST_BASIS_UNKNOWN", field: "materialCost", message: "O custo é por unidade ou pelo lote?" };
  const ui = fixture({ parse: async (message, options) => {
    calls.push({ message, options });
    return calls.length === 1 ? response({ desiredNetMargin: 30 }, [issue]) : response({ materialCost: 7, desiredNetMargin: 30 });
  } });
  const original = "Gastei R$ 350 em ingredientes e quero margem de 30%.";
  await ui.enter(original);
  await ui.elements.form.emit("submit");
  assert.equal(ui.elements.pending.hidden, false);
  assert.equal(ui.elements["pending-list"].children.length, 1);
  assert.deepEqual(ui.applied, []);
  assert.equal(ui.elements.message.value, original);
  assert.equal(ui.elements["clarification-form"].hidden, true);
  await clickButton(ui.elements["pending-list"], "Informar valor");
  assert.equal(ui.elements["clarification-form"].hidden, false);
  ui.elements.clarification.value = "7";
  await ui.elements.clarification.emit("input");
  await ui.elements["clarification-form"].emit("submit");
  assert.equal(calls[1].message, "7");
  assert.equal(calls[1].options.clarification.context, original);
  assert.deepEqual(calls[1].options.clarification.previousAnalysis, {
    fields: { desiredNetMargin: 30 },
    sources: { desiredNetMargin: "user_provided" },
    skipped: {},
    pending: [{ code: "AI_USER_VALUE_REQUIRED", field: "materialCost" }],
    needsClarification: true,
  });
  assert.equal(ui.elements.message.value, original);
  assert.equal(ui.elements.pending.hidden, true);
  assert.deepEqual(ui.applied, []);
  await ui.elements.apply.emit("click");
  assert.deepEqual(ui.applied, [{ materialCost: 7, desiredNetMargin: 30 }]);
});

test("quantidade mensal faltando aceita resposta curta no contexto da escolha", async () => {
  const issue = {
    code: "AI_REQUIRED_FIELD_MISSING",
    field: "expectedMonthlyUnits",
    message: "Não foi possível estimar quantidade mensal prevista com segurança. Informe esse valor.",
  };
  const previousFields = { productName: "bolo", materialCost: 15, desiredNetMargin: 10 };
  const calls = [];
  const initial = { ...response(previousFields, [issue]), calculationReady: false };
  const completed = { ...response({ ...previousFields, expectedMonthlyUnits: 10 }), calculationReady: true };
  const ui = fixture({ parse: async (message, options) => {
    calls.push({ message, options });
    return calls.length === 1 ? initial : completed;
  } });
  const original = "Quero vender bolo, meu custo por unidade é R$ 15 e quero margem de 10%";
  await ui.enter(original);
  await ui.elements.form.emit("submit");
  assert.ok(descendants(ui.elements["pending-list"].children[0]).some((item) => item.textContent === issue.message));
  assert.equal(ui.elements.apply.hidden, true);

  await clickButton(ui.elements["pending-list"], "Informar valor");
  ui.elements.clarification.value = "É DE 10";
  await ui.elements.clarification.emit("input");
  await ui.elements["clarification-form"].emit("submit");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].message, "É DE 10");
  assert.equal(calls[1].options.clarification.context, original);
  assert.deepEqual(calls[1].options.clarification.previousAnalysis.pending, [
    { code: "AI_USER_VALUE_REQUIRED", field: "expectedMonthlyUnits" },
  ]);
  assert.equal(ui.elements.pending.hidden, true);
  assert.equal(ui.elements["clarification-form"].hidden, true);
  assert.equal(ui.elements.apply.hidden, false);
  assert.equal(ui.elements.apply.disabled, false);
  assert.equal(ui.elements.clarify.textContent, "Confirmar");
  assert.equal(ui.elements.form.attributes.get("aria-busy"), "false");
  assert.equal(ui.elements.status.hidden, true);
  assert.deepEqual(ui.applied, []);

  await ui.elements.apply.emit("click");
  assert.deepEqual(ui.applied, [{ ...previousFields, expectedMonthlyUnits: 10 }]);
});

test("campo obrigatório pode ficar em branco com aviso e aplicação parcial", async () => {
  const issue = { code: "AI_BATCH_UNITS_REQUIRED", field: "packagingCost", message: "Quantas unidades o lote produz?" };
  const ui = fixture({ parse: async () => response({ desiredNetMargin: 20 }, [issue]) });
  await ui.enter("Margem 20%; embalagem R$ 80 por lote.");
  await ui.elements.form.emit("submit");
  assert.equal(ui.elements.apply.hidden, true);
  assert.ok(descendants(ui.elements["pending-list"]).some((item) => /Sem esse valor/.test(item.textContent)));
  await clickButton(ui.elements["pending-list"], "Deixar em branco");
  await ui.elements.apply.emit("click");
  assert.deepEqual(ui.applied, [{ desiredNetMargin: 20 }]);
  assert.equal(ui.elements.pending.hidden, true);
  assert.equal(ui.elements["clarification-form"].hidden, true);
  assert.equal(ui.elements.apply.hidden, true);
  assert.ok(descendants(ui.elements.fields).some((item) => item.textContent === "Não informado"));
});

test("falha no esclarecimento preserva prévia anterior e texto digitado", async () => {
  const issue = { code: "AI_COST_BASIS_UNKNOWN", field: "materialCost", message: "O custo é por unidade ou pelo lote?" };
  let calls = 0;
  const ui = fixture({ parse: async () => {
    calls += 1;
    if (calls === 1) return response({ productName: "bolo", desiredNetMargin: 10 }, [issue]);
    throw { code: "GEMINI_INVALID_RESPONSE" };
  } });
  const original = "Quero vender um bolo, usei 15 reais para fazer, e quero lucro de 10%";
  await ui.enter(original);
  await ui.elements.form.emit("submit");
  await clickButton(ui.elements["pending-list"], "Informar valor");
  ui.elements.clarification.value = "por unidade";
  await ui.elements.clarification.emit("input");
  await ui.elements["clarification-form"].emit("submit");
  assert.equal(ui.elements.preview.hidden, false);
  assert.equal(ui.elements.fields.children.length, 1);
  assert.equal(ui.elements.pending.hidden, false);
  assert.equal(ui.elements.clarification.value, "por unidade");
  assert.equal(ui.elements.message.value, original);
  assert.match(ui.elements.status.textContent, /validar a resposta/);
  assert.equal(ui.elements.apply.hidden, true);
  assert.equal(ui.elements.clarify.disabled, false);
  assert.equal(ui.elements.clarify.textContent, "Confirmar");
});

test("clique duplo no esclarecimento cria uma requisição e mostra loading específico", async () => {
  const issue = { code: "AI_COST_BASIS_UNKNOWN", field: "materialCost", message: "O custo é por unidade ou pelo lote?" };
  const followUp = pending();
  let calls = 0;
  const ui = fixture({ parse: async () => {
    calls += 1;
    if (calls === 1) return response({ productName: "bolo", desiredNetMargin: 10 }, [issue]);
    return followUp.promise;
  } });
  await ui.enter("Quero vender um bolo, usei 15 reais para fazer e quero lucro de 10%");
  await ui.elements.form.emit("submit");
  await clickButton(ui.elements["pending-list"], "Informar valor");
  ui.elements.clarification.value = "15 reais de um lote de 3";
  await ui.elements.clarification.emit("input");
  let stopped = 0;
  const submitEvent = { preventDefault() {}, stopPropagation() { stopped += 1; } };
  const firstSubmit = ui.elements["clarification-form"].emit("submit", submitEvent);
  await Promise.resolve();
  const duplicateSubmit = ui.elements["clarification-form"].emit("submit", submitEvent);
  await Promise.resolve();
  assert.equal(calls, 2);
  assert.equal(stopped, 2);
  assert.equal(ui.elements.clarify.disabled, true);
  assert.equal(ui.elements.clarify.textContent, "Confirmando...");
  assert.equal(ui.elements.status.textContent, "Analisando esclarecimento...");
  followUp.resolve(response({ productName: "bolo", desiredNetMargin: 10, materialCost: 5 }));
  await Promise.all([firstSubmit, duplicateSubmit]);
  assert.equal(calls, 2);
  assert.equal(ui.elements.clarify.disabled, true);
  assert.equal(ui.elements.clarification.value, "");
});

test("esclarecimento vazio não apaga prévia nem cria nova chamada", async () => {
  const issue = { code: "AI_COST_BASIS_UNKNOWN", field: "materialCost", message: "O custo é por unidade ou pelo lote?" };
  let calls = 0;
  const ui = fixture({ parse: async () => { calls += 1; return response({ productName: "bolo" }, [issue]); } });
  await ui.enter("Quero vender bolo e gastei R$ 15 em ingredientes.");
  await ui.elements.form.emit("submit");
  await clickButton(ui.elements["pending-list"], "Informar valor");
  ui.elements.clarification.value = "   ";
  await ui.elements.clarification.emit("input");
  await ui.elements["clarification-form"].emit("submit");
  assert.equal(calls, 1);
  assert.equal(ui.elements.preview.hidden, false);
  assert.equal(ui.elements.pending.hidden, false);
  assert.equal(ui.elements.clarify.disabled, true);
});

test("campo ignorado permanece skipped e não volta após informar outra pendência", async () => {
  const expectedUnits = { code: "AI_REQUIRED_FIELD_MISSING", field: "expectedMonthlyUnits", message: "Não consegui determinar a quantidade mensal prevista." };
  const receivingDays = { code: "AI_REQUIRED_FIELD_MISSING", field: "receivingDays", message: "Não consegui determinar o prazo de recebimento." };
  const skipped = { expectedMonthlyUnits: { value: null, source: "skipped" } };
  const calls = [];
  const ui = fixture({ parse: async (message, options) => {
    calls.push({ message, options });
    return calls.length === 1
      ? response({ productName: "bolo" }, [expectedUnits, receivingDays])
      : response({ productName: "bolo", receivingDays: 30 }, [], {}, skipped);
  } });
  await ui.enter("Quero vender bolo.");
  await ui.elements.form.emit("submit");
  assert.equal(ui.elements["pending-list"].children.length, 2);
  await clickButton(ui.elements["pending-list"].children[0], "Deixar em branco");
  assert.equal(ui.elements["pending-list"].children.length, 1);
  await clickButton(ui.elements["pending-list"], "Informar valor");
  ui.elements.clarification.value = "30";
  await ui.elements.clarification.emit("input");
  await ui.elements["clarification-form"].emit("submit");
  assert.deepEqual(calls[1].options.clarification.previousAnalysis.skipped, skipped);
  assert.equal(ui.elements["pending-list"].children.length, 0);
  assert.ok(descendants(ui.elements.fields).some((item) => item.textContent === "Não informado"));
  await ui.elements.apply.emit("click");
  assert.deepEqual(ui.applied, [{ productName: "bolo", receivingDays: 30 }]);
});

test("campo opcional ignorado não bloqueia a aplicação nem mostra aviso obrigatório", async () => {
  const issue = { code: "AI_CONFIRM_FIELD", field: "otherDirectExpenses", message: "Não consegui determinar outras despesas diretas." };
  const ui = fixture({ parse: async () => response({ desiredNetMargin: 20 }, [issue]) });
  await ui.enter();
  await ui.elements.form.emit("submit");
  assert.equal(descendants(ui.elements["pending-list"]).some((item) => /Sem esse valor/.test(item.textContent)), false);
  await clickButton(ui.elements["pending-list"], "Deixar em branco");
  assert.equal(ui.elements.apply.hidden, false);
  await ui.elements.apply.emit("click");
  assert.deepEqual(ui.applied, [{ desiredNetMargin: 20 }]);
});

test("estimativa disponível pode ser aceita explicitamente", async () => {
  const ui = fixture({ parse: async () => response(
    { desiredNetMargin: 20, packagingCost: 2 }, [], { packagingCost: "estimated" },
  ) });
  await ui.enter();
  await ui.elements.form.emit("submit");
  assert.ok(descendants(ui.elements["pending-list"]).some((item) => item.textContent === "Estimativa sugerida: 2"));
  assert.equal(ui.elements.apply.hidden, true);
  await clickButton(ui.elements["pending-list"], "Usar estimativa");
  assert.equal(ui.elements.apply.hidden, false);
  await ui.elements.apply.emit("click");
  assert.deepEqual(ui.applied, [{ desiredNetMargin: 20, packagingCost: 2 }]);
});

test("estimativa disponível pode ser substituída por valor informado", async () => {
  let calls = 0;
  const ui = fixture({ parse: async (_message, options) => {
    calls += 1;
    if (calls === 1) return response({ desiredNetMargin: 20, packagingCost: 2 }, [], { packagingCost: "estimated" });
    assert.deepEqual(options.clarification.previousAnalysis.pending, [
      { code: "AI_USER_VALUE_REQUIRED", field: "packagingCost" },
    ]);
    assert.equal("packagingCost" in options.clarification.previousAnalysis.fields, false);
    return response({ desiredNetMargin: 20, packagingCost: 3 });
  } });
  await ui.enter();
  await ui.elements.form.emit("submit");
  await clickButton(ui.elements["pending-list"], "Informar outro valor");
  ui.elements.clarification.value = "3";
  await ui.elements.clarification.emit("input");
  await ui.elements["clarification-form"].emit("submit");
  await ui.elements.apply.emit("click");
  assert.deepEqual(ui.applied, [{ desiredNetMargin: 20, packagingCost: 3 }]);
});

test("estimativa disponível pode ficar em branco sem aplicar zero", async () => {
  const ui = fixture({ parse: async () => response(
    { desiredNetMargin: 20, otherDirectExpenses: 2 }, [], { otherDirectExpenses: "estimated" },
  ) });
  await ui.enter();
  await ui.elements.form.emit("submit");
  await clickButton(ui.elements["pending-list"], "Deixar em branco");
  await ui.elements.apply.emit("click");
  assert.deepEqual(ui.applied, [{ desiredNetMargin: 20 }]);
  assert.ok(descendants(ui.elements.fields).some((item) => item.textContent === "Não informado"));
});

test("vários campos faltando aparecem juntos em uma lista compacta", async () => {
  const issues = [
    { code: "AI_REQUIRED_FIELD_MISSING", field: "expectedMonthlyUnits", message: "Não consegui determinar a quantidade mensal prevista." },
    { code: "AI_REQUIRED_FIELD_MISSING", field: "averageOrderFreight", message: "Não consegui determinar o frete médio do pedido." },
    { code: "AI_REQUIRED_FIELD_MISSING", field: "receivingDays", message: "Não consegui determinar o prazo de recebimento." },
  ];
  const ui = fixture({ parse: async () => response({ productName: "bolo" }, issues) });
  await ui.enter("Quero vender bolo.");
  await ui.elements.form.emit("submit");
  assert.equal(ui.elements["pending-list"].children.length, 3);
  assert.equal(ui.elements["clarification-form"].hidden, true);
  assert.equal(descendants(ui.elements["pending-list"]).filter((item) => item.textContent === "Informar valor").length, 3);
  assert.equal(descendants(ui.elements["pending-list"]).filter((item) => item.textContent === "Deixar em branco").length, 3);
});

test("frontend rejeita código, campo ou mensagem de pendência fora do contrato", () => {
  for (const issue of [
    { code: "PRIVATE_CODE", field: "materialCost", message: "texto" },
    { code: "AI_COST_BASIS_UNKNOWN", field: "apiKey", message: "texto" },
    { code: "AI_COST_BASIS_UNKNOWN", field: "materialCost", message: "" },
  ]) assert.throws(() => validateAssistantResponse(response({}, [issue])), /AI_INVALID_RESPONSE/);
  const duplicate = { code: "AI_COST_BASIS_UNKNOWN", field: "materialCost", message: "Confirme a base." };
  assert.throws(() => validateAssistantResponse(response({}, [duplicate, duplicate])), /AI_INVALID_RESPONSE/);
});

test("reset, reuso de produto e logout invalidam o assistente existente", async () => {
  const main = await readFile(new URL("../js/main.js", import.meta.url), "utf8");
  for (const name of ["clearAuthenticatedState", "resetCurrentProductForm", "reuseProduct"]) {
    assert.match(main, new RegExp(`function ${name}\\([^)]*\\) \\{\\s*aiAssistant\\.invalidate\\(\\)`));
  }
});
