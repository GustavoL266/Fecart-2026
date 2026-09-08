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
  assert.match(searchRoute, /searchFiscalNcms\(focusNfeClient, input/);
  assert.doesNotMatch(searchRoute, /req\.session\.confirmedNcm\s*=/);
  assert.match(searchRoute, /provider=FocusNFe/);
  assert.doesNotMatch(searchRoute, /FiscalHub|fiscalHubClient|ncmProvider/);
});

test("IBPT só calcula após confirmação de NCM e validação do contexto", () => {
  const taxStart = server.indexOf('app.post("/tax/estimate"');
  const taxRoute = server.slice(taxStart);
  const confirmation = taxRoute.indexOf("FOCUS_NFE_NCM_CONFIRMATION_REQUIRED");
  const providerCall = taxRoute.indexOf("taxProvider.calculate(input)");

  assert.ok(confirmation >= 0 && providerCall > confirmation);
  assert.match(taxRoute, /provider=IBPT/);
  assert.match(taxRoute, /productOrigin/);
  assert.doesNotMatch(taxRoute, /fetch|FiscalHub|FISCALHUB/);
});

test("as mensagens de sessão, Focus NFe e IBPT são específicas", () => {
  assert.match(main, /SESSION_REQUIRED: "Sua sessão expirou\. Entre novamente\."/);
  assert.match(main, /FOCUS_NFE_UNAUTHORIZED: "Não foi possível autenticar na Focus NFe\."/);
  assert.match(main, /IBPT_NCM_NOT_FOUND: "O NCM confirmado não existe na tabela IBPT\."/);
  assert.match(main, /IBPT_INVALID_FILE: "Não foi possível carregar a tabela tributária\."/);
});
