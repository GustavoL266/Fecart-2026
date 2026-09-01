const MARKET_REFERENCE_KEY = "assistente-precificacao-market-reference-v1";

function safeAmazonItem(value) {
  const price = Number(value?.price);
  if (!value?.asin || !value?.title || !Number.isFinite(price) || price <= 0) return null;
  return {
    id: String(value.id || value.asin),
    asin: String(value.asin),
    title: String(value.title),
    price,
    source: "Amazon",
    currency: "BRL",
    category: String(value.category || ""),
    image: String(value.image || ""),
    url: String(value.url || ""),
  };
}

export function loadMarketReference(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(MARKET_REFERENCE_KEY) || "null");
    const selectedItem = safeAmazonItem(parsed?.selectedItem);
    const manualValue = Number(parsed?.manualValue);
    if (!selectedItem || !Number.isFinite(manualValue) || manualValue <= 0) return null;
    return { manualValue, query: String(parsed.query || ""), selectedItem };
  } catch {
    return null;
  }
}

export function saveMarketReference(storage, { manualValue, query, selectedItem }) {
  const safeItem = safeAmazonItem(selectedItem);
  const safeManualValue = Number(manualValue);
  if (!safeItem || !Number.isFinite(safeManualValue) || safeManualValue <= 0) return false;
  try {
    storage?.setItem(MARKET_REFERENCE_KEY, JSON.stringify({ manualValue: safeManualValue, query, selectedItem: safeItem }));
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
