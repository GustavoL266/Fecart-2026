import { MARKET_RULES } from "../config/pricing.js";

export function marketBadgeForGap(gap) {
  const absoluteGap = Math.abs(gap);

  if (absoluteGap <= MARKET_RULES.closeGap) return ["ok", "Competitivo"];
  if (absoluteGap <= MARKET_RULES.attentionGap) return ["warning", "Atenção"];

  return ["risk", "Incompatível"];
}
