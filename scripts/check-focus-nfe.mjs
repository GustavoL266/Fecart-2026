import { getFocusNfeConfig } from "../lib/config.js";
import { createFocusNFeClient } from "../lib/focus-nfe-client.js";

const config = getFocusNfeConfig();
if (!config.isConfigured) throw new Error("FOCUS_NFE_TOKEN não está configurado no ambiente.");
if (config.environment !== "homologation") {
  throw new Error("A verificação manual é bloqueada fora do ambiente de homologação.");
}

const code = String(process.argv[2] || "09012100").replace(/\D/g, "");
const ncm = await createFocusNFeClient(config).getNcm(code);
console.log(`Conectividade de homologação confirmada para o NCM ${ncm.codigo}.`);
