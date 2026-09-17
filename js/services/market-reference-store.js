const MARKET_REFERENCE_KEY = "assistente-precificacao-market-reference-v1";
const MARKET_REFERENCE_RULES = Object.freeze(["manual", "selected-product", "market-average", "market-median"]);

export function marketRuleForForm(rule) {
  return MARKET_REFERENCE_RULES.includes(rule) ? rule : "manual";
}

export function marketRequestPayload(reference) {
  if (!reference || reference.rule === "" || reference.rule === null || reference.rule === undefined) return {};
  return {
    rule: reference.rule,
    query: String(reference.query || ""),
    marketplace: String(reference.marketplace || ""),
    provider: String(reference.provider || ""),
    selectedProduct: reference.selectedProduct || null,
    stats: reference.stats || null,
  };
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || "").slice(0, 2_048));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function safeMarketItem(value) {
  const price = Number(value?.price);
  if (!value?.id || !value?.title || !Number.isFinite(price) || price <= 0) return null;
  return {
    id: String(value.id),
    title: String(value.title),
    price,
    source: String(value.source || "Marketplace"),
    seller: String(value.seller || value.source || "Marketplace"),
    currency: String(value.currency || "BRL"),
    category: String(value.category || ""),
    image: safeHttpsUrl(value.image),
    url: safeHttpsUrl(value.url),
    consultedAt: String(value.consultedAt || ""),
    ...(Number.isFinite(Number(value.rating)) ? { rating: Number(value.rating) } : {}),
    ...(Number.isInteger(Number(value.reviews)) && Number(value.reviews) >= 0 ? { reviews: Number(value.reviews) } : {}),
  };
}

export function loadMarketReference(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(MARKET_REFERENCE_KEY) || "null");
    const selectedItem = safeMarketItem(parsed?.selectedItem);
    const manualValue = Number(parsed?.manualValue);
    const hasManualValue = parsed?.manualValue !== null && parsed?.manualValue !== "";
    if (!selectedItem || (hasManualValue && (!Number.isFinite(manualValue) || manualValue <= 0))) return null;
    return { manualValue: hasManualValue ? manualValue : null, query: String(parsed.query || ""), selectedItem };
  } catch {
    return null;
  }
}

export function saveMarketReference(storage, { manualValue, query, selectedItem }) {
  const safeItem = safeMarketItem(selectedItem);
  const safeManualValue = Number(manualValue);
  const hasManualValue = manualValue !== null && manualValue !== "";
  if (!safeItem || (hasManualValue && (!Number.isFinite(safeManualValue) || safeManualValue <= 0))) return false;
  try {
    storage?.setItem(MARKET_REFERENCE_KEY, JSON.stringify({ manualValue: hasManualValue ? safeManualValue : null, query, selectedItem: safeItem }));
    return true;
  } catch {
    return false;
  }
}

export function clearMarketReference(storage) {
  try {
    storage?.removeItem(MARKET_REFERENCE_KEY);
  } catch {
    // A referência continua válida em memória quando o armazenamento está indisponível.
  }
}
