export const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

// Presentation only: pick a CSS size from the complete, already formatted value.
export function financialValueSize(text) {
  const length = String(text).length;
  if (length <= 8) return "short";
  if (length <= 10) return "medium";
  if (length <= 12) return "long";
  if (length <= 15) return "extra-long";
  if (length <= 20) return "extended";
  return "maximal";
}

export function setFinancialValue(node, text) {
  node.textContent = text;
  node.setAttribute("data-financial-size", financialValueSize(text));
}

export function percent(value) {
  return `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[character];
  });
}
