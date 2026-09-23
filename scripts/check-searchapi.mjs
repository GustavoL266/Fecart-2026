import "dotenv/config";
import { getSearchApiConfig } from "../lib/config.js";
import { createSearchApiMarketProvider } from "../lib/searchapi-market-provider.js";

const config = getSearchApiConfig();
if (!config.isConfigured) {
  throw new Error("SEARCHAPI_API_KEY não foi definida. Configure-a somente no ambiente do backend.");
}

const argumentsWithoutSeparator = process.argv.slice(2).filter((argument) => argument !== "--");
const requestedQuery = argumentsWithoutSeparator.join(" ").trim();
const compareVariants = requestedQuery === "--variants";
const queries = compareVariants ? [
  "Iphone 18 Pro Max",
  "iPhone 18 Pro Max",
  "Apple iPhone 18 Pro Max",
  "iphone 18 pro max",
  "iPhone 18 Pro Max 256GB",
] : [requestedQuery || "Iphone 18 Pro Max"];
const provider = createSearchApiMarketProvider(config);

for (const query of queries) {
  const result = await provider.search(query, { refresh: compareVariants });
  console.log(JSON.stringify({
    input: query,
    querySent: result.query,
    searches: result.searches,
    received: result.receivedCount,
    normalized: result.normalizedCount,
    retained: result.retainedCount,
    consultedAt: result.consultedAt,
    results: result.results.slice(0, 5).map(({ title, price, currency, seller }) => ({
      title,
      price,
      currency,
      seller,
    })),
  }, null, 2));
}
