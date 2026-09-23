const ACCESSORY_TERMS = new Set([
  "acessorio", "accessory", "adaptador", "bateria", "cabo", "capa", "capinha",
  "carregador", "case", "charger", "controle", "cover", "display", "headset",
  "lcd", "modulo", "peca", "pecas", "pelicula", "placa", "protetor",
  "protector", "reparo", "replacement", "screen", "suporte", "tela",
]);
const IDENTITY_TERMS = new Set(["max", "mini", "plus", "pro", "ultra"]);
const CONNECTORS = new Set(["a", "as", "com", "da", "de", "do", "e", "em", "o", "os", "para"]);

function words(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter((word) => !CONNECTORS.has(word)) || [];
}

export function normalizeMarketQuery(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\biphone\b/gi, "iPhone")
    .replace(/\bmacbook\b/gi, "MacBook")
    .replace(/\bplaystation\b/gi, "PlayStation");
}

export function simplifyMarketQuery(value) {
  const original = normalizeMarketQuery(value);
  let simplified = original
    .replace(/^Apple\s+(?=iPhone\b|iPad\b|MacBook\b)/i, "")
    .replace(/^Samsung\s+(?=Galaxy\b)/i, "")
    .replace(/^Sony\s+(?=PlayStation\b)/i, "");
  if (words(simplified).length >= 4) {
    simplified = simplified.replace(/\s+\d+\s*(?:GB|TB)\b$/i, "");
  }
  return simplified;
}

function titleWords(value) {
  const tokens = words(value);
  const combinations = tokens.flatMap((token, index) => {
    const next = tokens[index + 1] || "";
    const joined = /^\d+$/.test(token) && /^[a-z]{1,2}$/.test(next)
      || /^[a-z]{3,}$/.test(token) && /^\d+$/.test(next);
    const compound = token.match(/^([a-z]{3,})(\d+)$/);
    return [...(joined ? [`${token}${next}`] : []), ...(compound ? compound.slice(1) : [])];
  });
  return new Set([...tokens, ...combinations]);
}

function scoreItem(item, coreTokens, fullTokens) {
  const titleTokens = words(item.title);
  const titleSet = titleWords(item.title);
  const matchedCore = coreTokens.filter((token) => titleSet.has(token));
  if (!coreTokens.length || matchedCore.length / coreTokens.length < 0.75) return null;
  if (coreTokens.some((token) => (/\d/.test(token) || IDENTITY_TERMS.has(token)) && !titleSet.has(token))) return null;

  const unrequestedAccessories = titleTokens.filter((token) => ACCESSORY_TERMS.has(token) && !fullTokens.includes(token));
  const accessory = unrequestedAccessories.length > 0;
  const leadingAccessory = titleTokens.slice(0, 3).some((token) => unrequestedAccessories.includes(token));
  const corePhrase = coreTokens.join(" ");
  const titlePhrase = titleTokens.join(" ");
  const optionalMatches = fullTokens.filter((token) => !coreTokens.includes(token) && titleSet.has(token)).length;
  const score = (matchedCore.length / coreTokens.length) * 10
    + (titlePhrase.includes(corePhrase) ? 2 : 0)
    + optionalMatches * 0.5
    - (leadingAccessory ? 10 : accessory ? 4 : 0);
  return score >= 5 ? { item, score, accessory } : null;
}

export function rankMarketResults(items, query) {
  const fullTokens = words(normalizeMarketQuery(query));
  const coreTokens = words(simplifyMarketQuery(query));
  const ranked = items
    .map((item, index) => ({ assessment: scoreItem(item, coreTokens, fullTokens), index }))
    .filter(({ assessment }) => assessment)
    .sort((left, right) => right.assessment.score - left.assessment.score || left.index - right.index);
  return {
    results: ranked.map(({ assessment }) => assessment.item),
    primaryCount: ranked.filter(({ assessment }) => !assessment.accessory).length,
    accessoryCount: ranked.filter(({ assessment }) => assessment.accessory).length,
  };
}
