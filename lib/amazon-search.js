import { AmazonCreatorsError } from "./amazon-creators-client.js";

export async function runAmazonSearch({ client, config, logger = console, query }) {
  logger.info?.(`[Amazon] Query: ${query}`);
  logger.info?.("[Amazon] Provider: Amazon Creators API", { marketplace: config.marketplace });

  if (!client) {
    logger.warn?.("[Amazon] Configuration: invalid", {
      missingEnvironmentVariables: config.missingEnvironmentVariables,
    });
    throw new AmazonCreatorsError("A consulta da Amazon ainda não foi configurada neste ambiente.", {
      code: "AMAZON_NOT_CONFIGURED",
      details: { missingEnvironmentVariables: config.missingEnvironmentVariables },
      status: 503,
    });
  }

  logger.info?.("[Amazon] Configuration: valid");
  const result = await client.search(query);
  logger.info?.("[Amazon] Response: 200", {
    cached: result.cached === true,
    itemCount: result.items.length,
  });
  return result;
}
