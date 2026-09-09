import { normalizeProductForFiscalSearch, fiscalNcmSearchTerms, isRelevantFiscalNcm, normalizeNcmDescription } from "../js/domain/fiscal-classification.js";
import { FocusNFeError } from "./focus-nfe-client.js";

export async function searchFiscalNcms(client, { q, originalQuery = q }, { logger = console, secrets = [] } = {}) {
  const classification = { ...normalizeProductForFiscalSearch(q), originalQuery };
  const safeLog = (value) => {
    let text = String(value).replace(/[\r\n\x00-\x1f]/g, " ").replace(/fh_(?:live|test)_[\w-]+/gi, "[REDACTED]");
    for (const secret of secrets) if (secret) text = text.replaceAll(secret, "[REDACTED]");
    return text.slice(0, 160);
  };
  logger.info?.(`[NCM] originalQuery=${safeLog(originalQuery)}`);
  logger.info?.(`[NCM] normalizedQuery=${safeLog(classification.normalizedQuery)}`);
  logger.info?.("[NCM] provider=FocusNFe");
  const candidates = new Map();
  let rejectedIrrelevantResults = 0;
  for (const term of fiscalNcmSearchTerms(classification.normalizedQuery)) {
    const results = await client.searchNcms(term);
    for (const ncm of results) {
      if (!isRelevantFiscalNcm(classification.normalizedQuery, ncm)) { rejectedIrrelevantResults += 1; continue; }
      candidates.set(ncm.codigo, { code: ncm.codigo, description: normalizeNcmDescription(ncm.descricao_completa) });
    }
  }
  const results = [...candidates.values()].slice(0, 10);
  logger.info?.(`[NCM] results=${results.length}`);
  logger.info?.(`[NCM] rejectedIrrelevantResults=${rejectedIrrelevantResults}`);
  return { ...classification, results, rejectedIrrelevantResults, source: "Focus NFe" };
}

export async function confirmFiscalNcm(client, search, code, classificationId) {
  const candidate = search?.results?.find((result) => result.code === code);
  if (!classificationId || search?.classificationId !== classificationId || !isRelevantFiscalNcm(search?.normalizedQuery, candidate)) {
    throw new FocusNFeError("Pesquise a categoria e escolha um NCM relacionado entre as sugestões atuais.", { code: "NCM_CLASSIFICATION_REQUIRED", status: 400 });
  }
  const providerNcm = await client.getNcm(code);
  if (providerNcm.codigo !== code || !isRelevantFiscalNcm(search.normalizedQuery, providerNcm)) {
    throw new FocusNFeError("A descrição do NCM não corresponde à categoria usada na classificação. Escolha outra sugestão.", { code: "NCM_IRRELEVANT", status: 422 });
  }
  const description = normalizeNcmDescription(providerNcm.descricao_completa);
  const ncm = { ...providerNcm, descricao_completa: description };
  return { ncm, confirmation: { classificationId, originalQuery: search.originalQuery, normalizedQuery: search.normalizedQuery, code, description } };
}

export function hasRelevantFiscalConfirmation(input, session) {
  const proof = session?.fiscalNcmConfirmation;
  return Boolean(input?.classificationId && proof?.classificationId === input.classificationId
    && session.confirmedNcm === input.ncm && proof.code === input.ncm
    && proof.originalQuery === input.originalQuery && proof.normalizedQuery === input.normalizedQuery
    && isRelevantFiscalNcm(input.normalizedQuery, proof));
}
