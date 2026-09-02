import { getSearchApiConfig } from "../lib/config.js";
import { createSearchApiMarketProvider } from "../lib/searchapi-market-provider.js";

const config = getSearchApiConfig();
if (!config.isConfigured) {
  throw new Error("SEARCHAPI_API_KEY não foi definida. Configure-a somente no ambiente do backend.");
}

const requestedQuery = process.argv.slice(2).join(" ").trim();
const queries = requestedQuery ? [requestedQuery] : [
  "iPhone 15 Pro Max",
  "PlayStation 5",
  "Samsung Galaxy S25",
  "Notebook Lenovo",
  "Cafeteira Nespresso",
];
const provider = createSearchApiMarketProvider(config);

for (const query of queries) {
  const result = await provider.search(query);
  console.log(JSON.stringify({
    query,
    count: result.results.length,
    results: result.results.slice(0, 5).map(({ id, title, price, currency, seller, url, rating, reviews }) => ({
      id,
      title,
      price,
      currency,
      seller,
      url,
      ...(rating === undefined ? {} : { rating }),
      ...(reviews === undefined ? {} : { reviews }),
    })),
  }, null, 2));
}
