const sectionFields = Object.freeze({
  product: ["productType", "productName"],
  fiscal: ["taxRegime", "originState", "destinationState", "customerType"],
  direct: ["materialsCost", "waste", "packagingCost", "deliveryCost", "insuranceCost", "discountAmount", "otherExpenses"],
  indirect: ["totalPayroll", "monthlyFixedCosts"],
  production: ["workerCount", "outputPerWorkerHour", "monthlyVolume"],
  sales: ["taxRate", "paymentFeeRate", "commissionRate"],
  market: ["margin", "competitorAverage"],
  terms: ["receiveDays", "payDays", "capitalRate"],
});

function fieldHasValidValue(field) {
  if (!field || String(field.value).trim() === "") return false;
  return typeof field.checkValidity !== "function" || field.checkValidity();
}

export function createPricingTabs(root) {
  if (!root) throw new Error("O painel de precificação não foi encontrado.");

  const tabList = root.querySelector('[role="tablist"]');
  const tabs = Array.from(root.querySelectorAll("[data-pricing-tab]"));
  const panels = Array.from(root.querySelectorAll("[data-pricing-panel]"));
  const order = tabs.map((tab) => tab.dataset.pricingTab);
  let activeSection = order[0];
  const visitedSections = new Set();
  let pointerStartX = 0;
  let scrollStart = 0;
  let dragging = false;
  let moved = false;

  function updateCompletion() {
    for (const tab of tabs) {
      const section = tab.dataset.pricingTab;
      const valid = (sectionFields[section] || []).every((fieldId) => fieldHasValidValue(root.querySelector(`#${fieldId}`)));
      const complete = section !== activeSection && visitedSections.has(section) && valid;
      const active = section === activeSection;
      const label = tab.dataset.pricingLabel || tab.textContent.trim();
      const status = tab.querySelector(".pricing-tab-status");

      tab.classList.toggle("is-complete", complete);
      tab.classList.toggle("is-future", !active && !complete);
      tab.setAttribute("aria-label", `${label}, ${active ? "etapa atual" : complete ? "concluída" : "futura"}`);
      if (status) status.textContent = complete ? "✓" : active ? "●" : "○";
    }
  }

  function resetInternalScroll() {
    const view = root.ownerDocument.defaultView;
    const overflowY = view?.getComputedStyle(root).overflowY;
    if (overflowY !== "auto" && overflowY !== "scroll") return;

    if (typeof root.scrollTo === "function") root.scrollTo({ top: 0, behavior: "auto" });
    else root.scrollTop = 0;
  }

  function revealTab(tab) {
    if (!tabList || tabList.scrollWidth <= tabList.clientWidth) return;
    const left = Math.max(0, tab.offsetLeft - tabList.clientWidth / 2 + tab.clientWidth / 2);
    tabList.scrollTo({ left, behavior: "smooth" });
  }

  function activate(section, { focusTab = false, resetScroll = true } = {}) {
    if (!order.includes(section)) return;
    if (section !== activeSection) visitedSections.add(activeSection);
    activeSection = section;

    for (const tab of tabs) {
      const isActive = tab.dataset.pricingTab === section;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
      tab.tabIndex = isActive ? 0 : -1;
    }

    for (const panel of panels) {
      const isActive = panel.dataset.pricingPanel === section;
      panel.hidden = !isActive;
      panel.classList.toggle("is-active", isActive);
    }

    const activeTab = tabs.find((tab) => tab.dataset.pricingTab === section);
    if (activeTab) {
      revealTab(activeTab);
      if (focusTab) activeTab.focus({ preventScroll: true });
    }
    if (resetScroll) resetInternalScroll();
    updateCompletion();
  }

  function activateByOffset(currentTab, offset) {
    const currentIndex = tabs.indexOf(currentTab);
    const nextIndex = (currentIndex + offset + tabs.length) % tabs.length;
    activate(tabs[nextIndex].dataset.pricingTab, { focusTab: true });
  }

  for (const tab of tabs) {
    tab.addEventListener("click", (event) => {
      if (moved) {
        event.preventDefault();
        return;
      }
      activate(tab.dataset.pricingTab);
    });
    tab.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        activateByOffset(tab, 1);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        activateByOffset(tab, -1);
      } else if (event.key === "Home") {
        event.preventDefault();
        activate(order[0], { focusTab: true });
      } else if (event.key === "End") {
        event.preventDefault();
        activate(order.at(-1), { focusTab: true });
      }
    });
  }

  if (tabList && typeof tabList.addEventListener === "function") {
    tabList.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      pointerStartX = event.clientX;
      scrollStart = tabList.scrollLeft;
      dragging = true;
      moved = false;
    });
    tabList.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const distance = event.clientX - pointerStartX;
      if (Math.abs(distance) > 5) moved = true;
      if (!moved) return;
      if (event.pointerId !== undefined && typeof tabList.setPointerCapture === "function" && !tabList.hasPointerCapture?.(event.pointerId)) {
        tabList.setPointerCapture(event.pointerId);
      }
      tabList.scrollLeft = scrollStart - distance;
      tabList.classList.add("is-dragging");
      event.preventDefault();
    });
    const stopDrag = (event) => {
      if (!dragging) return;
      dragging = false;
      tabList.classList.remove("is-dragging");
      if (event.pointerId !== undefined && tabList.hasPointerCapture?.(event.pointerId)) tabList.releasePointerCapture(event.pointerId);
      globalThis.setTimeout(() => { moved = false; }, 0);
    };
    tabList.addEventListener("pointerup", stopDrag);
    tabList.addEventListener("pointercancel", stopDrag);
  }

  root.querySelectorAll("[data-pricing-go]").forEach((button) => {
    button.addEventListener("click", () => activate(button.dataset.pricingGo, { focusTab: true }));
  });

  root.addEventListener("input", updateCompletion);
  root.addEventListener("change", updateCompletion);
  activate(activeSection, { resetScroll: false });
  updateCompletion();

  return Object.freeze({
    activate,
    updateCompletion,
    getActiveSection: () => activeSection,
  });
}
