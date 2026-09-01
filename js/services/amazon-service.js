import { api } from "./api-client.js";

const ACCESSORY_TERMS = new Set([
  "acessorio", "accessory", "cabo", "cable", "capa", "case", "carregador", "charger",
  "pelicula", "protector", "suporte", "holder",
]);

function normalizeText(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function extractTokens(value) {
  return normalizeText(value)
    .match(/[a-z0-9]+/g)
    ?.filter((token) => token.length >= 3 || /^\d+$/.test(token)) || [];
}

function isComparable(item, query) {
  const queryTokens = extractTokens(query);
  const titleTokens = extractTokens(item.title);
  const categoryTokens = extractTokens(item.category);
  const compactTitle = normalizeText(item.title).replace(/\s+/g, "");
  const introducesAccessory = [...ACCESSORY_TERMS].some((term) =>
    (titleTokens.includes(term) || categoryTokens.includes(term)) && !queryTokens.includes(term));
  return !introducesAccessory
    && queryTokens.every((token) => titleTokens.includes(token) || compactTitle.includes(token));
}

function calculateMedian(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function calculateAmazonStats(items) {
  const prices = items
    .filter((item) => item.currency === "BRL")
    .map((item) => Number(item.price))
    .filter((price) => Number.isFinite(price) && price > 0);
  if (prices.length === 0) return null;

  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
    average: prices.reduce((sum, price) => sum + price, 0) / prices.length,
    median: calculateMedian(prices),
    count: prices.length,
  };
}

function normalizeItem(item) {
  const price = Number(item?.price);
  if (
    !item?.asin
    || !item?.title
    || !item?.url
    || item.currency !== "BRL"
    || !Number.isFinite(price)
    || price <= 0
  ) return null;

  return {
    id: String(item.id || item.asin),
    asin: String(item.asin),
    title: String(item.title),
    price,
    source: "Amazon",
    currency: "BRL",
    category: String(item.category || ""),
    image: String(item.image || ""),
    url: String(item.url),
  };
}

export class AmazonService {
  #api;

  constructor(apiClient = api) {
    this.#api = apiClient;
  }

  async search(query) {
    const normalizedQuery = String(query || "").trim().replace(/\s+/g, " ");
    const response = await this.#api.get(`/amazon/search?q=${encodeURIComponent(normalizedQuery)}`, { handleUnauthorized: false });
    const seenAsins = new Set();
    const items = (Array.isArray(response?.items) ? response.items : [])
      .map(normalizeItem)
      .filter((item) => {
        if (!item || seenAsins.has(item.asin) || !isComparable(item, normalizedQuery)) return false;
        seenAsins.add(item.asin);
        return true;
      });
    return {
      query: normalizedQuery,
      marketplace: response?.marketplace || "www.amazon.com.br",
      items,
      stats: calculateAmazonStats(items),
    };
  }
}
