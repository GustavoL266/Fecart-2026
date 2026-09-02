const MARKET_REFERENCE_KEY = "assistente-precificacao-market-reference-v1";

function safeMarketItem(value) {
  const price = Number(value?.price);
  if (!value?.id || !value?.title || !Number.isFinite(price) || price <= 0) return null;
  return {
    id: String(value.id),
    asin: String(value.asin || value.id),
    title: String(value.title),
    price,
    source: String(value.source || "Marketplace"),
    currency: String(value.currency || "BRL"),
    category: String(value.category || ""),
    image: String(value.image || ""),
    url: String(value.url || ""),
    consultedAt: String(value.consultedAt || ""),
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
