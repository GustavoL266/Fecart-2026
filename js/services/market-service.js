import { api } from "./api-client.js";
import { normalizeMarketQuery, rankMarketResults } from "../domain/market-relevance.js";

function calculateMedian(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function calculateMarketStats(items) {
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
    !item?.id
    || !item?.title
    || !item?.url
    || item.currency !== "BRL"
    || !Number.isFinite(price)
    || price <= 0
  ) return null;

  return {
    id: String(item.id),
    title: String(item.title),
    price,
    source: String(item.source || "Marketplace"),
    seller: String(item.seller || item.source || "Marketplace"),
    currency: "BRL",
    category: String(item.category || ""),
    image: String(item.image || ""),
    url: String(item.url),
    consultedAt: String(item.consultedAt || ""),
    ...(Number.isFinite(Number(item.rating)) ? { rating: Number(item.rating) } : {}),
    ...(Number.isInteger(Number(item.reviews)) && Number(item.reviews) >= 0 ? { reviews: Number(item.reviews) } : {}),
  };
}

export class MarketService {
  #api;

  constructor(apiClient = api) {
    this.#api = apiClient;
  }

  async search(query, { refresh = false } = {}) {
    const normalizedQuery = normalizeMarketQuery(query);
    const path = `/market/search?q=${encodeURIComponent(normalizedQuery)}${refresh ? "&refresh=1" : ""}`;
    const response = await this.#api.get(path, { handleUnauthorized: false });
    const seenIds = new Set();
    const candidates = (Array.isArray(response?.results) ? response.results : [])
      .map(normalizeItem)
      .filter((item) => {
        if (!item || seenIds.has(item.id)) return false;
        seenIds.add(item.id);
        return true;
      });
    const items = rankMarketResults(candidates, normalizedQuery).results.slice(0, 5);
    const consultedAt = String(response?.consultedAt || items[0]?.consultedAt || "");
    return {
      query: normalizedQuery,
      marketplace: response?.marketplace || "Marketplace",
      provider: response?.provider || "SearchAPI / Google Shopping",
      items,
      stats: calculateMarketStats(items),
      consultedAt: Number.isFinite(Date.parse(consultedAt)) ? consultedAt : "",
    };
  }
}
