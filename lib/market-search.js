import { SearchApiError } from "./searchapi-market-provider.js";
import { normalizeMarketQuery } from "../js/domain/market-relevance.js";

export async function runMarketSearch({ provider, config, logger = console, query, refresh = false }) {
  const normalizedQuery = normalizeMarketQuery(query);
  if (normalizedQuery.length < 3) {
    throw new SearchApiError("Informe um produto para pesquisar.", {
      code: "INVALID_MARKET_QUERY",
      status: 400,
    });
  }

  logger.info?.(`[Market] queryLength=${normalizedQuery.length}`);
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
  const result = await provider.search(normalizedQuery, { refresh });
  logger.info?.("[Market] Response: 200", {
    cached: result.cached === true,
    itemCount: result.results.length,
  });
  return result;
}
