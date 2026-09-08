import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [apiClient, main, server] = await Promise.all([
  readFile(new URL("../js/services/api-client.js", import.meta.url), "utf8"),
  readFile(new URL("../js/main.js", import.meta.url), "utf8"),
  readFile(new URL("../server.js", import.meta.url), "utf8"),
]);

test("/auth/me diferencia sessão ativa de sessão expirada com código interno", () => {
  assert.match(server, /app\.get\("\/auth\/me"/);
  assert.match(server, /\[Auth\] \/auth\/me authenticated=false/);
  assert.match(server, /\[Auth\] \/auth\/me authenticated=true/);
  assert.match(server, /code: "SESSION_REQUIRED"/);
  assert.match(server, /return res\.json\(authenticatedPayload\(user\)\)/);
});

test("o navegador envia cookie e só encerra a conta para SESSION_REQUIRED", () => {
  assert.match(apiClient, /credentials: "include"/);
  assert.match(apiClient, /error\.code === "SESSION_REQUIRED"/);
  assert.doesNotMatch(apiClient, /response\.status === 401\) window\.dispatchEvent/);
  assert.match(main, /function clearAuthenticatedState/);
  assert.match(main, /\$\("#currentUserName"\)\.textContent = "Conta"/);
  assert.match(main, /endSession\(\)/);
});

test("/fiscal/ncms/search usa apenas a busca por descrição da Focus NFe", () => {
  const searchStart = server.indexOf('app.get("/fiscal/ncms/search"');
  const validationStart = server.indexOf('app.get("/fiscal/ncms/:codigo"');
  const searchRoute = server.slice(searchStart, validationStart);

  assert.ok(searchStart >= 0 && validationStart > searchStart);
  assert.match(searchRoute, /focusNfeClient\.searchNcms\(q\)/);
  assert.doesNotMatch(searchRoute, /confirmedNcm/);
  assert.match(searchRoute, /provider=FocusNFe/);
  assert.doesNotMatch(searchRoute, /FiscalHub|fiscalHubClient|ncmProvider/);
});

test("FiscalHub só é alcançada após a confirmação de NCM e configuração da empresa", () => {
  const taxStart = server.indexOf('app.post("/tax/calculate"');
  const taxRoute = server.slice(taxStart);
  const confirmation = taxRoute.indexOf("FOCUS_NFE_NCM_CONFIRMATION_REQUIRED");
  const company = taxRoute.indexOf("FISCALHUB_EMPRESA_NOT_CONFIGURED");
  const providerCall = taxRoute.indexOf("taxProvider.calculate(input)");

  assert.ok(confirmation >= 0 && company > confirmation && providerCall > company);
  assert.match(taxRoute, /configured=\$\{fiscalHubConfig\.isConfigured\}/);
  assert.match(taxRoute, /companyConfigured=\$\{fiscalHubConfig\.companyConfigured\}/);
  assert.match(taxRoute, /provider=FiscalHub/);
});

test("as mensagens de sessão, Focus NFe e FiscalHub são específicas", () => {
  assert.match(main, /SESSION_REQUIRED: "Sua sessão expirou\. Entre novamente\."/);
  assert.match(main, /FOCUS_NFE_UNAUTHORIZED: "Não foi possível autenticar na Focus NFe\."/);
  assert.match(main, /FISCALHUB_UNAUTHORIZED: "Não foi possível autenticar na FiscalHub\."/);
  assert.match(main, /FISCALHUB_EMPRESA_NOT_CONFIGURED: "A empresa para cálculo tributário ainda não foi configurada\."/);
});
