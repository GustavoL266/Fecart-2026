import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { diagnoseFiscalHub } from "../lib/fiscalhub-diagnostic.js";

const server = await readFile(new URL("../server.js", import.meta.url), "utf8");

function response(status) {
  return { status };
}

test("diagnóstico diferencia variável ausente sem chamar a FiscalHub", async () => {
  let calls = 0;
  const logs = [];
  const result = await diagnoseFiscalHub({
    apiKey: "  ",
    fetchImpl: async () => { calls += 1; },
    logger: { info: (message) => logs.push(message) },
  });
  assert.deepEqual(result, { configured: false, provider: "FiscalHub", status: null });
  assert.equal(calls, 0);
  assert.deepEqual(logs, ["[FiscalHub Diagnostic] configured=false"]);
});

test("diagnóstico usa NCM oficial, X-Api-Key e descarta corpo e headers", async () => {
  const apiKey = "chave-ficticia-de-diagnostico";
  let captured;
  const logs = [];
  const result = await diagnoseFiscalHub({
    apiKey: ` ${apiKey} `,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return response(200);
    },
    logger: { info: (message) => logs.push(message) },
  });
  assert.equal(captured.url, "https://api.fiscalhub.com.br/api/v1/ncm/84713012");
  assert.equal(captured.options.method, "GET");
  assert.equal(captured.options.headers["X-Api-Key"], apiKey);
  assert.equal(captured.options.headers["Content-Type"], "application/json");
  assert.deepEqual(result, { configured: true, provider: "FiscalHub", status: 200, authorized: true });
  assert.equal(JSON.stringify(result).includes(apiKey), false);
  assert.equal(Object.hasOwn(result, "headers"), false);
  assert.deepEqual(logs, ["[FiscalHub Diagnostic] configured=true", "[FiscalHub Diagnostic] status=200"]);
  assert.equal(JSON.stringify(logs).includes(apiKey), false);
});

test("diagnóstico distingue 401 e 403 com respostas mínimas", async (context) => {
  await context.test("401", async () => {
    assert.deepEqual(await diagnoseFiscalHub({
      apiKey: "teste",
      fetchImpl: async () => response(401),
      logger: { info() {} },
    }), { configured: true, provider: "FiscalHub", status: 401, authorized: false, error: "UNAUTHORIZED" });
  });
  await context.test("403", async () => {
    assert.deepEqual(await diagnoseFiscalHub({
      apiKey: "teste",
      fetchImpl: async () => response(403),
      logger: { info() {} },
    }), { configured: true, provider: "FiscalHub", status: 403, authorized: true, permission: false, error: "FORBIDDEN" });
  });
});

test("diagnóstico não transforma falha de rede em falha de autenticação", async () => {
  const result = await diagnoseFiscalHub({
    apiKey: "teste",
    fetchImpl: async () => { throw new TypeError("network unavailable"); },
    logger: { info() {} },
  });
  assert.deepEqual(result, {
    configured: true,
    provider: "FiscalHub",
    status: null,
    authorized: null,
    error: "UNAVAILABLE",
  });
});

test("rota temporária exige autenticação, rate limit e nunca aceita chave pela URL", () => {
  assert.match(server, /app\.get\("\/diagnostics\/fiscalhub", requireAuth, fiscalLookupLimiter/);
  assert.match(server, /apiKey: process\.env\.FISCALHUB_API_KEY/);
  assert.doesNotMatch(server, /diagnostics\/fiscalhub[\s\S]{0,300}req\.(query|headers|body)/);
});
