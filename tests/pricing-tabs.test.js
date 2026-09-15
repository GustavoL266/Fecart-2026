import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createPricingTabs } from "../js/ui/pricing-tabs.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
  }

  add(name) {
    this.values.add(name);
  }

  remove(name) {
    this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor({ dataset = {}, value = "", valid = true } = {}) {
    this.dataset = dataset;
    this.value = value;
    this.valid = valid;
    this.hidden = false;
    this.tabIndex = 0;
    this.classList = new FakeClassList();
    this.attributes = new Map();
    this.listeners = new Map();
    this.status = null;
    this.focused = false;
    this.offsetLeft = 0;
    this.clientWidth = 80;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  querySelector(selector) {
    return selector === ".pricing-tab-status" ? this.status : null;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  focus() {
    this.focused = true;
  }

  checkValidity() {
    return this.valid;
  }
}

function createFixture() {
  const sectionNames = ["product", "fiscal", "direct", "indirect", "production", "sales", "terms", "market"];
  const tabs = sectionNames.map((section) => {
    const tab = new FakeElement({ dataset: { pricingTab: section, pricingLabel: section } });
    tab.status = new FakeElement();
    return tab;
  });
  const panels = sectionNames.map((section) => new FakeElement({ dataset: { pricingPanel: section } }));
  const goToMarket = new FakeElement({ dataset: { pricingGo: "market" } });
  const fieldIds = [
    "productName", "ncmCode", "taxRegime", "originState", "destinationState", "cfop", "taxSituation", "customerType", "operationPurpose",
    "materialCost", "wasteRate", "packagingCost", "averageOrderFreight", "averageOrderUnits",
    "monthlyFixedCosts", "expectedMonthlyUnits", "productionTimeMinutes", "laborCostMode",
    "taxRate", "desiredNetMargin", "inventoryDays", "receivingDays", "paymentDays", "capitalRateSource",
  ];
  const fields = Object.fromEntries(fieldIds.map((id) => [id, new FakeElement({ value: id === "productName" ? "" : "1" })]));
  const tabList = new FakeElement();
  const mobileStep = new FakeElement();
  const mobileTitle = new FakeElement();
  const mobileProgress = new FakeElement();
  const mobileStepsToggle = new FakeElement();
  tabList.clientWidth = 500;
  tabList.scrollWidth = 800;
  tabList.scrollLeft = 0;
  tabList.capturedPointer = null;
  tabList.scrollTo = ({ left }) => { tabList.scrollLeft = left; };
  tabList.setPointerCapture = (pointerId) => { tabList.capturedPointer = pointerId; };
  tabList.hasPointerCapture = (pointerId) => tabList.capturedPointer === pointerId;
  tabList.releasePointerCapture = () => { tabList.capturedPointer = null; };
  const rootListeners = new Map();
  const root = {
    scrollTop: 180,
    ownerDocument: { defaultView: { getComputedStyle: () => ({ overflowY: "auto" }) } },
    querySelector(selector) {
      if (selector === '[role="tablist"]') return tabList;
      if (selector === "[data-mobile-pricing-step]") return mobileStep;
      if (selector === "[data-mobile-pricing-title]") return mobileTitle;
      if (selector === "[data-mobile-pricing-progress]") return mobileProgress;
      if (selector === "[data-mobile-steps-toggle]") return mobileStepsToggle;
      if (selector.startsWith("#")) return fields[selector.slice(1)] || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-pricing-tab]") return tabs;
      if (selector === "[data-pricing-panel]") return panels;
      if (selector === "[data-pricing-go]") return [goToMarket];
      return [];
    },
    addEventListener(type, listener) {
      if (!rootListeners.has(type)) rootListeners.set(type, []);
      rootListeners.get(type).push(listener);
    },
    scrollTo({ top }) {
      this.scrollTop = top;
    },
  };

  return { root, tabs, panels, fields, goToMarket, tabList, mobileStep, mobileTitle, mobileProgress };
}

test("trocar de aba mantém valores e exibe somente o painel ativo", () => {
  const fixture = createFixture();
  const controller = createPricingTabs(fixture.root);

  assert.equal(controller.getActiveSection(), "product");
  assert.equal(fixture.panels[0].hidden, false);
  assert.equal(fixture.panels.filter((panel) => panel.hidden).length, 7);

  fixture.fields.materialCost.value = "37.5";
  controller.activate("direct");
  controller.activate("market");
  controller.activate("direct");

  assert.equal(fixture.fields.materialCost.value, "37.5");
  assert.equal(fixture.panels[2].hidden, false);
  assert.equal(fixture.panels.filter((panel) => panel.hidden).length, 7);
  assert.equal(fixture.root.scrollTop, 0);
});

test("toque ou clique abre a aba e a captura do ponteiro acontece somente durante arraste", () => {
  const fixture = createFixture();
  const controller = createPricingTabs(fixture.root);

  fixture.tabList.emit("pointerdown", { button: 0, pointerType: "touch", pointerId: 7, clientX: 120 });
  assert.equal(fixture.tabList.capturedPointer, null);
  fixture.tabs[3].emit("click", { preventDefault() {} });
  assert.equal(controller.getActiveSection(), "indirect");

  fixture.tabList.emit("pointerdown", { button: 0, pointerType: "touch", pointerId: 8, clientX: 120 });
  fixture.tabList.emit("pointermove", { pointerId: 8, clientX: 80, preventDefault() {} });
  assert.equal(fixture.tabList.capturedPointer, 8);
  fixture.tabList.emit("pointerup", { pointerId: 8 });
  assert.equal(fixture.tabList.capturedPointer, null);
});

test("abas aceitam teclado, navegação direta e indicador de preenchimento", () => {
  const fixture = createFixture();
  const controller = createPricingTabs(fixture.root);

  let prevented = false;
  fixture.tabs[0].emit("keydown", { key: "ArrowRight", preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(controller.getActiveSection(), "fiscal");
  assert.equal(fixture.tabs[1].focused, true);

  fixture.goToMarket.emit("click");
  assert.equal(controller.getActiveSection(), "market");
  assert.equal(fixture.mobileStep.textContent, "Etapa 8 de 8");
  assert.equal(fixture.mobileProgress.value, 8);

  assert.equal(fixture.tabs[0].classList.contains("is-complete"), false);
  fixture.fields.productName.value = "Produto de teste";
  controller.updateCompletion();
  assert.equal(fixture.tabs[0].classList.contains("is-complete"), true);
  assert.equal(fixture.tabs[0].status.textContent, "✓");
});

test("ordem visual, painéis e botões seguem Despesas, Prazos e Consulta sem duplicação", () => {
  const expectedOrder = ["product", "fiscal", "direct", "indirect", "production", "sales", "terms", "market"];
  assert.deepEqual([...html.matchAll(/data-pricing-tab="([^"]+)"/g)].map((match) => match[1]), expectedOrder);

  const panelMatches = [...html.matchAll(/<section id="pricing-panel-([^"]+)"/g)];
  assert.deepEqual(panelMatches.map((match) => match[1]), expectedOrder);
  const panelMarkup = (name) => {
    const index = panelMatches.findIndex((match) => match[1] === name);
    const start = panelMatches[index].index;
    const end = panelMatches[index + 1]?.index ?? html.indexOf("      </aside>", start);
    return html.slice(start, end);
  };
  const destinations = (name) => [...panelMarkup(name).matchAll(/data-pricing-go="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(destinations("sales"), ["production", "terms"]);
  assert.deepEqual(destinations("terms"), ["sales", "market"]);
  assert.deepEqual(destinations("market"), ["terms"]);
});

test("navegação percorre a nova sequência nos dois sentidos e preserva os dados", () => {
  const fixture = createFixture();
  const controller = createPricingTabs(fixture.root);
  const expectedOrder = ["product", "fiscal", "direct", "indirect", "production", "sales", "terms", "market"];
  fixture.fields.materialCost.value = "37.5";

  for (let index = 0; index < expectedOrder.length - 1; index += 1) {
    fixture.tabs[index].emit("keydown", { key: "ArrowRight", preventDefault() {} });
    assert.equal(controller.getActiveSection(), expectedOrder[index + 1]);
    assert.equal(fixture.tabs[index + 1].classList.contains("is-active"), true);
    assert.equal(fixture.panels[index + 1].hidden, false);
  }
  assert.equal(fixture.mobileStep.textContent, "Etapa 8 de 8");

  fixture.tabs[7].emit("keydown", { key: "ArrowLeft", preventDefault() {} });
  assert.equal(controller.getActiveSection(), "terms");
  assert.equal(fixture.mobileStep.textContent, "Etapa 7 de 8");
  fixture.tabs[6].emit("keydown", { key: "ArrowLeft", preventDefault() {} });
  assert.equal(controller.getActiveSection(), "sales");
  assert.equal(fixture.fields.materialCost.value, "37.5");
});
