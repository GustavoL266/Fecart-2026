import { AmazonCreatorsError } from "./amazon-creators-client.js";

export async function runAmazonSearch({ client, config, logger = console, query }) {
  logger.info?.(`[Amazon] Searching: ${query}`, {
    marketplace: config.marketplace,
    provider: "Amazon Creators API",
  });

  if (!client) {
    throw new AmazonCreatorsError("A consulta da Amazon ainda não foi configurada neste ambiente.", {
      code: "AMAZON_NOT_CONFIGURED",
      details: { missingEnvironmentVariables: config.missingEnvironmentVariables },
      status: 503,
    });
  }

  const result = await client.search(query);
  logger.info?.("[Amazon] Provider response: 200", {
    cached: result.cached === true,
    itemCount: result.items.length,
  });
  return result;
}
