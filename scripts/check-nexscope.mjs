import { getNexscopeConfig } from "../lib/config.js";
import { createNexscopeProvider } from "../lib/nexscope-provider.js";

const config = getNexscopeConfig();
if (!config.isConfigured) {
  throw new Error("NEXSCOPE_API_KEY não foi definida. Configure-a somente no ambiente do backend.");
}

const query = process.argv.slice(2).join(" ").trim() || "iPhone 15 Pro Max";
const provider = createNexscopeProvider(config);
const result = await provider.search(query);
console.log(JSON.stringify({
  query,
  count: result.results.length,
  results: result.results.slice(0, 5).map(({ id, title, price, currency, source, url }) => ({
    id,
    title,
    price,
    currency,
    source,
    url,
  })),
}, null, 2));
