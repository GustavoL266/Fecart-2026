import { NexscopeError } from "./nexscope-provider.js";

export async function runMarketSearch({ provider, config, logger = console, query }) {
  logger.info?.(`[Market] Query: ${query}`);
  logger.info?.("[Market] Provider: Nexscope", { marketplace: config.marketplace });

  if (!provider) {
    logger.warn?.("[Market] Configuration: invalid", {
      missingEnvironmentVariables: config.missingEnvironmentVariables,
    });
    throw new NexscopeError("A consulta de mercado ainda não foi configurada neste ambiente.", {
      code: "NEXSCOPE_NOT_CONFIGURED",
      details: { missingEnvironmentVariables: config.missingEnvironmentVariables },
      status: 503,
    });
  }

  logger.info?.("[Market] Configuration: valid");
  const result = await provider.search(query);
  logger.info?.("[Market] Response: 200", {
    cached: result.cached === true,
    itemCount: result.results.length,
  });
  return result;
}
