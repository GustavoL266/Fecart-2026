import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";

import { createAiPricingRouter, handleAiRequestError } from "../lib/ai-pricing-route.js";

const extraction = { entries: [{ field: "deliveryCost", value: 7, evidence: "frete de 7 reais", batchUnits: null, batchEvidence: null }] };
const input = { message: "Coloque frete de 7 reais." };

async function serverFor(t, provider, rateLimitOptions = {}, { trustProxy = false } = {}) {
  const app = express();
  if (trustProxy) app.set("trust proxy", 1);
  app.use(express.json());
  // Only this isolated HTTP harness has test headers; production uses requireAuth.
  const requireAuth = (req, res, next) => {
    const id = req.get("x-test-user");
    if (!id) return res.status(401).json({ code: "SESSION_REQUIRED" });
    req.user = { id };
    next();
  };
  app.use("/ai", createAiPricingRouter({ requireAuth, provider, rateLimitOptions }));
  app.use("/ai", handleAiRequestError);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  const base = `http://127.0.0.1:${server.address().port}/ai/parse-pricing`;
  return async (body = input, headers = { "x-test-user": "user-a" }, raw = false) => {
    const res = await fetch(base, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw ? body : JSON.stringify(body) });
    return { status: res.status, headers: res.headers, body: await res.json() };
  };
}

test("rota HTTP exige autenticação antes de chamar o provider", async (t) => {
  let calls = 0;
  const request = await serverFor(t, { extract: async () => { calls += 1; return extraction; } });
  const result = await request(input, {});
  assert.equal(result.status, 401);
  assert.equal(result.body.code, "SESSION_REQUIRED");
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal(calls, 0);
});

test("rota HTTP retorna patch e prévia validados, sem prompts ou extração bruta", async (t) => {
  const request = await serverFor(t, { extract: async (message) => {
    assert.equal(message, input.message);
    return extraction;
  } });
  const result = await request();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.fields, { deliveryCost: 7 });
  assert.equal(result.body.summary[0].field, "deliveryCost");
  assert.deepEqual(Object.keys(result.body), ["fields", "summary"]);
  assert.equal(result.headers.get("cache-control"), "no-store");
});

test("rota HTTP rejeita corpo desconhecido antes de consumir chamada paga", async (t) => {
  let calls = 0;
  const request = await serverFor(t, { extract: async () => { calls += 1; return extraction; } });
  const result = await request({ ...input, fields: { materialCost: 20 } });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "INVALID_AI_REQUEST");
  assert.equal(calls, 0);
});

test("JSON malformado e corpo excessivo não expõem trechos da mensagem nem chamam o modelo", async (t) => {
  let calls = 0;
  const request = await serverFor(t, { extract: async () => { calls += 1; return extraction; } });
  for (const [body, status] of [["{PRIVATE_USER_CONTENT", 400], [JSON.stringify({ message: "PRIVATE_USER_CONTENT".repeat(10000) }), 413]]) {
    const result = await request(body, {}, true);
    assert.equal(result.status, status);
    assert.equal(result.body.code, "INVALID_AI_REQUEST");
    assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_USER_CONTENT/);
    assert.equal(result.headers.get("cache-control"), "no-store");
  }
  assert.equal(calls, 0);
});

test("rota HTTP distingue API indisponível, resposta inválida e insuficiente", async (t) => {
  for (const [provider, status, code] of [
    [null, 503, "AI_UNAVAILABLE"],
    [{ extract: async () => { throw new Error("test-only-secret + private prompt"); } }, 503, "AI_UNAVAILABLE"],
    [{ extract: async () => ({ fields: { finalPrice: 100 } }) }, 502, "AI_INVALID_RESPONSE"],
    [{ extract: async () => ({ entries: [] }) }, 422, "AI_INSUFFICIENT_INFORMATION"],
  ]) {
    const request = await serverFor(t, provider);
    const result = await request();
    assert.equal(result.status, status);
    assert.equal(result.body.code, code);
    assert.doesNotMatch(JSON.stringify(result.body), /test-only-secret|private prompt/);
  }
});

test("limite padrão é oito chamadas por minuto por usuário", async (t) => {
  let calls = 0;
  const request = await serverFor(t, { extract: async () => { calls += 1; return extraction; } });
  for (let index = 0; index < 8; index += 1) assert.equal((await request()).status, 200);
  const limited = await request();
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, "AI_RATE_LIMITED");
  assert.ok(limited.headers.get("retry-after"));
  assert.equal(calls, 8);
});

test("trocar IP não evade limite do usuário e trocar conta não evade limite do IP", async (t) => {
  const provider = { extract: async () => extraction };
  const accountRequest = await serverFor(t, provider, { limit: 2 }, { trustProxy: true });
  assert.equal((await accountRequest(input, { "x-test-user": "a", "x-forwarded-for": "192.0.2.1" })).status, 200);
  assert.equal((await accountRequest(input, { "x-test-user": "a", "x-forwarded-for": "192.0.2.2" })).status, 200);
  assert.equal((await accountRequest(input, { "x-test-user": "a", "x-forwarded-for": "192.0.2.3" })).status, 429);
  const ipRequest = await serverFor(t, provider, { limit: 2 });
  assert.equal((await ipRequest(input, { "x-test-user": "a" })).status, 200);
  assert.equal((await ipRequest(input, { "x-test-user": "b" })).status, 200);
  assert.equal((await ipRequest(input, { "x-test-user": "c" })).status, 429);
});

test("bloqueia concorrência na mesma conta e libera após conclusão ou erro", async (t) => {
  let complete;
  let started;
  const begin = new Promise((resolve) => { started = resolve; });
  let calls = 0;
  const request = await serverFor(t, { extract: async () => {
    calls += 1;
    if (calls === 1) {
      started();
      return new Promise((resolve) => { complete = resolve; });
    }
    if (calls === 2) throw new Error("unavailable");
    return extraction;
  } });
  const first = request();
  await begin;
  const duplicate = await request();
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "AI_REQUEST_IN_PROGRESS");
  assert.equal(calls, 1);
  complete(extraction);
  assert.equal((await first).status, 200);
  assert.equal((await request()).status, 503);
  assert.equal((await request()).status, 200);
});
