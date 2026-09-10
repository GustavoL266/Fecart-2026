import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createAiAssistant, validateAssistantResponse } from "../js/ui/ai-assistant.js";
import { applyAssistantFields, CAPACITY_FIELD_IDS, PRICING_FIELD_IDS, validateAssistantFields, validatePricingForm } from "../js/ui/form.js";
import { calculatePricing } from "../js/domain/pricing-calculator.js";
import { parsePricingMessage } from "../lib/ai-form-assistant.js";

function controls(values = {}) {
  const ids = [...PRICING_FIELD_IDS, ...CAPACITY_FIELD_IDS, "productName", "productDescription", "marketQuery", "taxRegime", "originState", "destinationState", "cfop", "taxSituation", "customerType", "operationPurpose", "productOrigin", "countryOfOrigin", "ncmCode"];
  return Object.fromEntries(ids.map((id) => [id, { value: values[id] ?? "" }]));
}

function response(fields) {
  return { fields, summary: Object.entries(fields).filter(([, value]) => value !== null).map(([field, value]) => ({ field, label: field, value: String(value) })) };
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
  const names = ["form", "message", "analyze", "preview", "fields", "status", "apply", "search", "cancel", "close"];
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

function pending() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

test("patch com vários campos mantém frete e dados ausentes e usa a fórmula existente", () => {
  const fields = controls(Object.fromEntries(PRICING_FIELD_IDS.map((id) => [id, "0"])));
  fields.expectedMonthlyUnits.value = "100";
  fields.marketPrice.value = "";
  fields.deliveryCost.value = "5";
  const patch = { productName: "Bolo de chocolate", materialCost: 18, packagingCost: 3, wasteRate: 10, desiredNetMargin: 25, deliveryCost: null };
  const changed = applyAssistantFields(patch, fields);
  assert.deepEqual(changed, ["productName", "materialCost", "packagingCost", "wasteRate", "desiredNetMargin"]);
  assert.equal(fields.deliveryCost.value, "5");
  const validation = validatePricingForm(fields);
  assert.equal(validation.isValid, true);
  assert.equal(validation.inputs.desiredNetMargin, 0.25);
  assert.equal(calculatePricing(validation.inputs).technicalPrice, 37.34);
});

test("comando de edição altera um campo sem apagar valores ausentes; zero remove desconto", () => {
  const fields = controls({ materialCost: "18,50", deliveryCost: "5", desiredNetMargin: "25", fixedDiscountAmount: "4", discountRate: "" });
  applyAssistantFields({ desiredNetMargin: 22, materialCost: null }, fields);
  assert.equal(fields.desiredNetMargin.value, "22");
  assert.equal(fields.materialCost.value, "18,50");
  assert.equal(fields.deliveryCost.value, "5");
  applyAssistantFields({ discountRate: 0, fixedDiscountAmount: 0 }, fields);
  assert.equal(fields.discountRate.value, "0");
  assert.equal(fields.fixedDiscountAmount.value, "0");
  assert.deepEqual(applyAssistantFields({ deliveryCost: undefined }, fields), []);
});

test("decimais brasileiros, percentuais e custos pequenos não viram notação científica", () => {
  const fields = controls();
  applyAssistantFields({ materialCost: 18.75, commissionRate: 5.5, packagingCost: 0.00000001 }, fields);
  assert.equal(fields.materialCost.value, "18,75");
  assert.equal(fields.commissionRate.value, "5,5");
  assert.equal(fields.packagingCost.value, "0,00000001");
});

test("capacidade parcial preenche só os dois dados informados, sem inventar horas mensais", () => {
  const fields = controls();
  applyAssistantFields({ workerCount: 4, unitsPerWorkerHour: 10 }, fields);
  assert.equal(fields.workerCount.value, "4");
  assert.equal(fields.unitsPerWorkerHour.value, "10");
  assert.equal(fields.productiveHoursPerWorkerMonth.value, "");
});

test("validação rejeita valores fora dos limites e campos desconhecidos antes de qualquer alteração", () => {
  const invalid = [
    { materialCost: -1 }, { materialCost: "20" }, { materialCost: Infinity }, { materialCost: NaN }, { materialCost: 1_000_000_001 },
    { wasteRate: 100 }, { desiredNetMargin: 100 }, { receivingDays: 3651 }, { workerCount: 4.5 }, { workerCount: 1_000_001 },
    { productiveHoursPerWorkerMonth: 745 }, { expectedMonthlyUnits: 0 }, { marketPrice: 0 }, { finalPrice: 100 }, { ncmCode: "19059090" },
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
    { fields: { materialCost: 20 }, summary: [{ field: "desiredNetMargin", label: "Margem", value: "20%" }] },
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
    ["AI_NOT_CONFIGURED", /ainda não está configurado/],
    ["AI_PROVIDER_AUTH_ERROR", /autenticar.*provedor/],
    ["AI_PROVIDER_FORBIDDEN", /não autorizou/],
    ["AI_MODEL_UNAVAILABLE", /configuração.*revisada/i],
    ["AI_PROVIDER_BAD_REQUEST", /configuração.*revisada/i],
    ["AI_PROVIDER_QUOTA_EXCEEDED", /créditos/],
    ["AI_PROVIDER_RATE_LIMITED", /provedor.*limitando/],
    ["AI_TIMEOUT", /demorou/],
    ["AI_CONNECTION_ERROR", /conectar/],
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
  const fields = controls({ deliveryCost: "5" });
  const entry = (field, value, evidence, batchUnits = null, batchEvidence = null) => ({ field, value, evidence, batchUnits, batchEvidence });
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
  assert.equal(ui.elements.fields.children.length, 4);
  assert.equal(fields.materialCost.value, "");
  assert.equal(fields.productName.value, "");
  await ui.elements.apply.emit("click");
  assert.equal(fields.productName.value, "brigadeiros");
  assert.equal(fields.materialCost.value, "0,4");
  assert.equal(fields.packagingCost.value, "0,1");
  assert.equal(fields.desiredNetMargin.value, "30");
  assert.equal(fields.deliveryCost.value, "5");
  for (const id of ["monthlyPayroll", "expectedMonthlyUnits", "wasteRate", "taxRate"]) assert.equal(fields[id].value, "");
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

test("reset, reuso de produto e logout invalidam o assistente existente", async () => {
  const main = await readFile(new URL("../js/main.js", import.meta.url), "utf8");
  for (const name of ["clearAuthenticatedState", "resetCurrentProductForm", "reuseProduct"]) {
    assert.match(main, new RegExp(`function ${name}\\([^)]*\\) \\{\\s*aiAssistant\\.invalidate\\(\\)`));
  }
});
