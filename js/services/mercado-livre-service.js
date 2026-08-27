import { MELI_CONFIG } from "../config/pricing.js";

function normalizeText(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function extractTokens(value) {
  return (
    normalizeText(value)
      .match(/[a-z0-9]+/g)
      ?.filter((token) => token.length >= 3 || /^\d+$/.test(token)) || []
  );
}

function normalizeItem(item) {
  const image = item.thumbnail ? item.thumbnail.replace(/^http:/, "https:") : "";
  const category = item.domain_id || item.category_id || item.attributes?.find((attribute) => attribute.id === "BRAND")?.value_name || "";

  return {
    id: item.id,
    title: item.title,
    price: Number(item.price),
    image,
    link: item.permalink,
    category,
    condition: item.condition,
    attributes: Array.isArray(item.attributes) ? item.attributes : [],
  };
}

function isComparable(listing, queryTokens) {
  const title = normalizeText(listing.title);
  const compactTitle = title.replace(/\s+/g, "");
  const titleTokens = extractTokens(listing.title);

  return queryTokens.every((token) => (/^\d+$/.test(token) ? titleTokens.includes(token) : titleTokens.includes(token) || compactTitle.includes(token)));
}

function filterComparableListings(listings, query) {
  const queryTokens = extractTokens(query);
  const seenIds = new Set();

  return listings.filter((listing) => {
    const isValid = Number.isFinite(listing.price) && listing.price > 0 && listing.title && listing.link;
    if (!isValid || seenIds.has(listing.id)) return false;

    seenIds.add(listing.id);
    return queryTokens.length === 0 || isComparable(listing, queryTokens);
  });
}

function calculateMedian(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function calculateStats(listings) {
  const prices = listings.map((listing) => listing.price).filter((price) => Number.isFinite(price) && price > 0);
  if (prices.length === 0) return null;

  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
    average: prices.reduce((sum, price) => sum + price, 0) / prices.length,
    median: calculateMedian(prices),
    count: prices.length,
  };
}

export function buildSearchUrl(query) {
  return `https://lista.mercadolivre.com.br/${encodeURIComponent(query.trim().replace(/\s+/g, "-"))}`;
}

export class MercadoLivreService {
  #cache = new Map();

  async search(query) {
    const cacheKey = normalizeText(query);
    const cached = this.#cache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < MELI_CONFIG.cacheTtlMs) return cached.data;

    const params = new URLSearchParams({ q: query, limit: String(MELI_CONFIG.searchLimit) });
    const response = await fetch(`https://api.mercadolibre.com/sites/${MELI_CONFIG.siteId}/search?${params.toString()}`);

    if (!response.ok) {
      const error = new Error("api-error");
      error.status = response.status;
      throw error;
    }

    const payload = await response.json();
    const listings = Array.isArray(payload.results) ? payload.results.map(normalizeItem) : [];
    const comparableListings = filterComparableListings(listings, query);
    const data = {
      query,
      searchUrl: buildSearchUrl(query),
      listings,
      comparableListings,
      stats: calculateStats(comparableListings),
    };

    this.#cache.set(cacheKey, { createdAt: Date.now(), data });
    return data;
  }
}
