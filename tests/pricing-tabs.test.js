import test from "node:test";
import assert from "node:assert/strict";

import { createPricingTabs } from "../js/ui/pricing-tabs.js";

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
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
  const sectionNames = ["product", "fiscal", "direct", "indirect", "production", "sales", "market", "terms"];
  const tabs = sectionNames.map((section) => {
    const tab = new FakeElement({ dataset: { pricingTab: section, pricingLabel: section } });
    tab.status = new FakeElement();
    return tab;
  });
  const panels = sectionNames.map((section) => new FakeElement({ dataset: { pricingPanel: section } }));
  const goToMarket = new FakeElement({ dataset: { pricingGo: "market" } });
  const fieldIds = [
    "productType", "productName", "ncmCode", "taxRegime", "originState", "destinationState", "cfop", "taxSituation", "customerType", "operationPurpose",
    "materialsCost", "waste", "packagingCost", "deliveryCost", "insuranceCost", "discountAmount", "otherExpenses",
    "totalPayroll", "monthlyFixedCosts", "workerCount", "outputPerWorkerHour", "monthlyVolume",
    "taxRate", "paymentFeeRate", "commissionRate", "margin", "competitorAverage",
    "receiveDays", "payDays", "capitalRate",
  ];
  const fields = Object.fromEntries(fieldIds.map((id) => [id, new FakeElement({ value: id === "productName" ? "" : "1" })]));
  const tabList = { clientWidth: 500, scrollWidth: 500, scrollTo() {} };
  const rootListeners = new Map();
  const root = {
    scrollTop: 180,
    ownerDocument: { defaultView: { getComputedStyle: () => ({ overflowY: "auto" }) } },
    querySelector(selector) {
      if (selector === '[role="tablist"]') return tabList;
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

  return { root, tabs, panels, fields, goToMarket };
}

test("trocar de aba mantém valores e exibe somente o painel ativo", () => {
  const fixture = createFixture();
  const controller = createPricingTabs(fixture.root);

  assert.equal(controller.getActiveSection(), "product");
  assert.equal(fixture.panels[0].hidden, false);
  assert.equal(fixture.panels.filter((panel) => panel.hidden).length, 7);

  fixture.fields.materialsCost.value = "37.5";
  controller.activate("direct");
  controller.activate("market");
  controller.activate("direct");

  assert.equal(fixture.fields.materialsCost.value, "37.5");
  assert.equal(fixture.panels[2].hidden, false);
  assert.equal(fixture.panels.filter((panel) => panel.hidden).length, 7);
  assert.equal(fixture.root.scrollTop, 0);
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

  assert.equal(fixture.tabs[0].classList.contains("is-complete"), false);
  fixture.fields.productName.value = "Produto de teste";
  controller.updateCompletion();
  assert.equal(fixture.tabs[0].classList.contains("is-complete"), true);
  assert.equal(fixture.tabs[0].status.textContent, "✓");
});
