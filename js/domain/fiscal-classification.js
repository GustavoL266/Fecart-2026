const HTML_ENTITIES = Object.freeze({ amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' });

function decodeHtmlEntities(value) {
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (entity, decimal, hexadecimal, named) => {
    if (named) return HTML_ENTITIES[named.toLowerCase()] ?? entity;
    const codePoint = Number.parseInt(decimal || hexadecimal, decimal ? 10 : 16);
    return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : entity;
  });
}

export function normalizeNcmDescription(value) {
  const decoded = decodeHtmlEntities(String(value || ""));
  return decoded
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fiscalText(value) {
  return normalizeNcmDescription(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

// Regras de vocabulário, nunca códigos NCM. A seleção final continua com o usuário.
const fiscalCategories = [
  { category: "acessório para telefone", match: /\b(capa|capinha|pelicula|carregador|fone|fones)\b.*\b(iphone|galaxy|celular|smartphone)\b/, terms: ["acessório para telefone"] },
  { category: "relógio inteligente", match: /\b(smartwatch|galaxy watch|apple watch)\b/, terms: ["relógio"] },
  { category: "tablet", match: /\b(tablet|ipad|galaxy tab)\b/, terms: ["máquinas automáticas para processamento de dados"] },
  { category: "telefone celular", match: /\b(iphone|galaxy|smartphones?|celular|celulares|telefone celular)\b/, normalized: "telefone celular smartphone", terms: ["smartphone", "telefones para redes celulares"], relevant: /\bsmartphones?\b|\btelefones?\b.*\b(celulares?|redes sem fio)\b/ },
  { category: "computador portátil", match: /\b(notebook|macbook|laptop|computador portatil)\b/, normalized: "computador portátil notebook", terms: ["processamento de dados", "computadores portáteis"], relevant: /\b(computadores?|maquinas|processamento de dados)\b.*\bportateis\b|\b(notebooks?|laptops?)\b/ },
  { category: "aparelho de televisão", match: /\b(tv|televisor|televisao)\b/, normalized: "aparelho de televisão", terms: ["aparelhos receptores de televisão"], relevant: /\b(televisao|televisores?)\b/ },
  { category: "console de videogame", match: /\b(playstation|xbox|videogame|nintendo switch)\b/, normalized: "console de videogame", terms: ["consoles", "jogos de vídeo"], relevant: /\bconsoles?\b|\bjogos de video\b|\bvideogames?\b/ },
  { category: "bolo / confeitaria", match: /\b(bolos?|tortas?)\b/, normalized: "bolo produto de confeitaria", terms: ["bolos", "produtos de padaria", "pastelaria"], relevant: /\b(bolos?|tortas?|padaria|pastelaria|confeitaria)\b/, preserve: true },
  { category: "refrigerante", match: /\b(refrigerantes?|coca cola|pepsi)\b/, normalized: "refrigerante", terms: ["refrigerantes", "águas gaseificadas"], relevant: /\brefrigerantes?\b|\b(aguas|bebidas)\b.*\b(gaseificadas|aromatizadas|adicionadas de acucar)\b/, preserve: true },
  { category: "calçado / tênis", match: /\b(nike air max|tenis|calcados?)\b/, normalized: "calçado tênis", terms: ["calçados"], relevant: /\bcalcados?\b/, preserve: true },
];

function fiscalCategoryFor(value) {
  const text = fiscalText(value);
  return fiscalCategories.find((rule) => rule.match.test(text));
}

function fiscalCharacteristics(value) {
  const text = fiscalText(value);
  return [
    [/\bchocolate\b/, "chocolate"], [/\bsem gluten\b/, "sem glúten"],
    [/\b(sem acucar|zero acucar|diet|zero)\b/, "sem açúcar"],
    [/\bsem lactose\b/, "sem lactose"], [/\b(couro|cabedal de couro)\b/, "couro"],
    [/\b(torta|frango|carne|recheado|salgado|congelado|cru)\b/g, null],
    [/\b(borracha|plastico|textil|tecido|sintetico)\b/g, null],
  ].flatMap(([pattern, label]) => label ? (pattern.test(text) ? [label] : []) : [...text.matchAll(pattern)].map((match) => match[0]));
}

export function normalizeProductForFiscalSearch(value) {
  const originalQuery = String(value || "").trim().replace(/\s+/g, " ");
  const rule = fiscalCategoryFor(originalQuery);
  if (rule?.normalized) {
    const characteristics = rule.preserve ? fiscalCharacteristics(originalQuery) : [];
    return { originalQuery, normalizedQuery: [rule.normalized, ...characteristics].join(" "), category: rule.category };
  }
  // Sem categoria reconhecida, preservar material/função e pedir uma descrição
  // editável. Não eliminar palavras desconhecidas que podem ser essenciais.
  const normalizedQuery = originalQuery
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:gb|tb|ml|kg|cm|mm|litros?|l)\b/gi, "")
    .replace(/\b(?:cor|tamanho)\s+\S+/gi, "")
    .replace(/\s+/g, " ").trim();
  return { originalQuery, normalizedQuery, category: rule?.category || normalizedQuery };
}

export function fiscalNcmSearchTerms(normalizedQuery) {
  const rule = fiscalCategoryFor(normalizedQuery);
  // A Focus pesquisa trechos da descrição; sinônimos concatenados não são um
  // operador OR. Consultar os poucos termos da categoria separadamente.
  if (rule?.normalized) return rule.terms;
  const words = fiscalText(normalizedQuery).split(" ").filter((word) => word.length >= 3 && !["para", "com", "sem", "produto", "produtos"].includes(word));
  return [...new Set([normalizedQuery, words[0]])].filter((term) => term?.length >= 3).slice(0, 2);
}

export function isRelevantFiscalNcm(normalizedQuery, ncm) {
  const code = ncm?.codigo ?? ncm?.code;
  const description = normalizeNcmDescription(ncm?.descricao_completa ?? ncm?.description);
  if (typeof code !== "string" || !/^\d{8}$/.test(code) || typeof description !== "string" || !description.trim()) return false;
  const text = fiscalText(description);
  const rule = fiscalCategoryFor(normalizedQuery);
  // Examinar a especialização, sem confundir uma menção genérica a "partes"
  // no título ancestral com a classificação específica de um smartphone.
  const detail = fiscalText(description.split(/[.;>]/).filter((part) => part.trim()).at(-1));
  const accessory = /^(partes|acessorios|capas|carregadores|fones)\b/;
  if (rule?.normalized && ["telefone celular", "computador portátil", "aparelho de televisão", "console de videogame"].includes(rule.category)
    && (accessory.test(text) || accessory.test(detail) || /\bpartes(?: outras?)?$/.test(text))) return false;
  if (rule?.relevant) return rule.relevant.test(text);
  const stopWords = new Set(["para", "com", "sem", "dos", "das", "uma", "produto", "produtos", "outros", "outras", "diversos"]);
  const words = [...new Set(fiscalText(normalizedQuery).split(" ").filter((word) => word.length >= 3 && !stopWords.has(word)))];
  const descriptionWords = new Set(text.split(" ").map((word) => word.replace(/s$/, "")));
  const matches = words.filter((word) => descriptionWords.has(word.replace(/s$/, "")));
  // Exigir o substantivo principal, além de sobreposição mínima para fallback.
  return words.length > 0 && descriptionWords.has(words[0].replace(/s$/, "")) && matches.length >= Math.min(2, words.length);
}
