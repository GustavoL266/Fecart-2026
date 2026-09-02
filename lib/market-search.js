import { SearchApiError } from "./searchapi-market-provider.js";

export async function runMarketSearch({ provider, config, logger = console, query }) {
  const normalizedQuery = String(query || "").trim().replace(/\s+/g, " ");
  if (normalizedQuery.length < 3) {
    throw new SearchApiError("Informe um produto para pesquisar.", {
      code: "INVALID_MARKET_QUERY",
      status: 400,
    });
  }

  logger.info?.(`[Market] Query: ${normalizedQuery}`);
  logger.info?.("[Market] Provider: SearchAPI Google Shopping", { marketplace: config.marketplace });

  if (!provider) {
    logger.warn?.("[Market] Configuration: invalid", {
      missingEnvironmentVariables: config.missingEnvironmentVariables,
    });
    throw new SearchApiError("A consulta de mercado ainda não foi configurada neste ambiente.", {
      code: "SEARCHAPI_NOT_CONFIGURED",
      details: { missingEnvironmentVariables: config.missingEnvironmentVariables },
      status: 503,
    });
  }

  logger.info?.("[Market] Configuration: valid");
  const result = await provider.search(normalizedQuery);
  logger.info?.("[Market] Response: 200", {
    cached: result.cached === true,
    itemCount: result.results.length,
  });
  return result;
}
