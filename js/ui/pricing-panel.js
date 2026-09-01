const clampPanelSize = (value, min, max) => Math.min(max, Math.max(min, value));

export function createPricingPanel(shell) {
  if (!shell) throw new Error("A área do simulador não foi encontrada.");
  const sidebar = shell.querySelector(".pricing-sidebar");
  const handle = shell.querySelector("[data-panel-resizer]");
  if (!sidebar || !handle) return Object.freeze({});

  let startPosition = 0;
  let startSize = 0;
  let dragging = false;
  const isMobile = () => window.matchMedia("(max-width: 900px)").matches;
  const currentSize = () => isMobile() ? sidebar.getBoundingClientRect().height : sidebar.getBoundingClientRect().width;
  const limits = () => isMobile()
    ? { min: 420, max: Math.max(480, window.innerHeight * 0.86) }
    : { min: 320, max: Math.min(620, window.innerWidth * 0.55) };

  function applySize(size) {
    const { min, max } = limits();
    const next = clampPanelSize(size, min, max);
    shell.dataset.panelSize = String(Math.round(((next - min) / (max - min)) * 10));
    handle.setAttribute("aria-valuemin", String(Math.round(min)));
    handle.setAttribute("aria-valuemax", String(Math.round(max)));
    handle.setAttribute("aria-valuenow", String(Math.round(next)));
  }

  function toggleExpanded() {
    const { min, max } = limits();
    applySize(currentSize() < min + (max - min) / 2 ? max : min);
  }

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    dragging = true;
    startPosition = isMobile() ? event.clientY : event.clientX;
    startSize = currentSize();
    handle.setPointerCapture(event.pointerId);
    shell.classList.add("is-resizing");
    event.preventDefault();
  });
  handle.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const position = isMobile() ? event.clientY : event.clientX;
    applySize(startSize + position - startPosition);
  });
  function stopDragging(event) {
    if (!dragging) return;
    dragging = false;
    shell.classList.remove("is-resizing");
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  }
  handle.addEventListener("pointerup", stopDragging);
  handle.addEventListener("pointercancel", stopDragging);
  handle.addEventListener("dblclick", toggleExpanded);
  handle.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleExpanded();
      return;
    }
    const decrease = event.key === "ArrowLeft" || event.key === "ArrowUp";
    const increase = event.key === "ArrowRight" || event.key === "ArrowDown";
    if (!decrease && !increase) return;
    event.preventDefault();
    applySize(currentSize() + (increase ? 32 : -32));
  });
  window.addEventListener("resize", () => {
    if (shell.dataset.panelSize) applySize(currentSize());
  });
  return Object.freeze({ toggleExpanded });
}
