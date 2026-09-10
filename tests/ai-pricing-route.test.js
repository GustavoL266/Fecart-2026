import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";

import { createAiPricingRouter, handleAiRequestError } from "../lib/ai-pricing-route.js";
import { createAiFormProvider } from "../lib/ai-form-assistant.js";
import { getAiAssistantConfig } from "../lib/config.js";
import { createGeminiFormProvider } from "../lib/gemini-form-provider.js";

const extraction = { entries: [{ field: "deliveryCost", value: 7, evidence: "frete de 7 reais", batchUnits: null, batchEvidence: null }] };
const input = { message: "Coloque frete de 7 reais." };

async function serverFor(t, provider, rateLimitOptions = {}, { trustProxy = false, logger = { warn() {} }, sessionError } = {}) {
  const app = express();
  if (trustProxy) app.set("trust proxy", 1);
  app.use(express.json());
  // Only this isolated HTTP harness has test headers; production uses requireAuth.
  const requireAuth = (req, res, next) => {
    if (sessionError) return next(sessionError);
    const id = req.get("x-test-user");
    if (!id) return res.status(401).json({ code: "SESSION_REQUIRED" });
    req.user = { id };
    next();
  };
  app.use("/ai", createAiPricingRouter({ requireAuth, provider, rateLimitOptions, logger }));
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

test("brigadeiros: provider simulado passa pelo HTTP e valida lote sem inventar dados pendentes", async (t) => {
  const message = "quero vender brigadeiros. gasto R$ 40 em ingredientes para produzir 100 unidades, R$ 10 em embalagens e quero margem de 30%";
  const batchEvidence = "para produzir 100 unidades";
  const entries = [
    { field: "productName", value: "brigadeiros", evidence: "quero vender brigadeiros", batchUnits: null, batchEvidence: null },
    { field: "materialCost", value: 40, evidence: "gasto R$ 40 em ingredientes", batchUnits: 100, batchEvidence },
    { field: "packagingCost", value: 10, evidence: "R$ 10 em embalagens", batchUnits: 100, batchEvidence },
    { field: "desiredNetMargin", value: 30, evidence: "quero margem de 30%", batchUnits: null, batchEvidence: null },
  ];
  let calls = 0;
  const provider = createGeminiFormProvider({ apiKey: "test-only-secret", model: "gemini-3.5-flash-lite", timeoutMs: 5000 }, { fetchImpl: async (_url, options) => {
    calls += 1;
    assert.equal(JSON.parse(options.body).contents[0].parts[0].text, message);
    return Response.json({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: JSON.stringify({ entries }) }] } }] });
  } });
  const request = await serverFor(t, provider);
  const result = await request({ message });
  assert.equal(result.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(result.body.fields, { productName: "brigadeiros", materialCost: 0.4, packagingCost: 0.1, desiredNetMargin: 30 });
  assert.deepEqual(result.body.summary.map(({ field }) => field), ["productName", "materialCost", "packagingCost", "desiredNetMargin"]);
  assert.match(result.body.summary.find(({ field }) => field === "materialCost").value, /0,40.*100 unidades/);
  assert.match(result.body.summary.find(({ field }) => field === "packagingCost").value, /0,10.*100 unidades/);
  assert.doesNotMatch(JSON.stringify(result.body), /monthlyPayroll|expectedMonthlyUnits|taxRate|finalPrice|suggestedPrice|test-only-secret|batchEvidence/);
});

test("chave ausente reproduz 503 antes de qualquer chamada à Gemini", async (t) => {
  let calls = 0;
  const provider = createAiFormProvider(getAiAssistantConfig({}), { fetchImpl: async () => { calls += 1; throw new Error("não deve executar"); } });
  const records = [];
  const request = await serverFor(t, provider, {}, { logger: { warn: (...args) => records.push(args) } });
  const result = await request();
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "GEMINI_NOT_CONFIGURED");
  assert.equal(calls, 0);
  assert.deepEqual(records, [["[AI] Analysis failed", { provider: "gemini", code: "GEMINI_NOT_CONFIGURED", status: 503, upstreamStatus: null }]]);
});

test("rota preserva null/ausência como não alterar e mantém zero explícito", async (t) => {
  const request = await serverFor(t, { extract: async () => ({ entries: [
    { field: "deliveryCost", value: 0, evidence: "frete de 0 reais", batchUnits: null, batchEvidence: null },
    { field: "packagingCost", value: null, evidence: "", batchUnits: null, batchEvidence: null },
  ] }) });
  const result = await request({ message: "Coloque frete de 0 reais." });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.fields, { deliveryCost: 0 });
  assert.equal(result.body.summary.length, 1);
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
  const records = [];
  t.mock.method(console, "warn", (...args) => records.push(args));
  const request = await serverFor(t, { extract: async () => { calls += 1; return extraction; } });
  for (const [body, status] of [["{PRIVATE_USER_CONTENT", 400], [JSON.stringify({ message: "PRIVATE_USER_CONTENT".repeat(10000) }), 413]]) {
    const result = await request(body, {}, true);
    assert.equal(result.status, status);
    assert.equal(result.body.code, "INVALID_AI_REQUEST");
    assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_USER_CONTENT/);
    assert.equal(result.headers.get("cache-control"), "no-store");
  }
  assert.equal(calls, 0);
  assert.deepEqual(records.map((record) => record[1]), [
    { provider: "gemini", code: "INVALID_AI_REQUEST", status: 400, upstreamStatus: null },
    { provider: "gemini", code: "INVALID_AI_REQUEST", status: 413, upstreamStatus: null },
  ]);
  assert.doesNotMatch(JSON.stringify(records), /PRIVATE_USER_CONTENT/);
});

test("rota HTTP distingue API indisponível, resposta inválida e insuficiente", async (t) => {
  for (const [provider, status, code] of [
    [null, 503, "GEMINI_NOT_CONFIGURED"],
    [{ extract: async () => { throw new Error("test-only-secret + private prompt"); } }, 500, "AI_INTERNAL_ERROR"],
    [{ extract: async () => ({ fields: { finalPrice: 100 } }) }, 502, "GEMINI_INVALID_RESPONSE"],
    [{ extract: async () => ({ entries: [] }) }, 422, "AI_INSUFFICIENT_INFORMATION"],
  ]) {
    const request = await serverFor(t, provider);
    const result = await request();
    assert.equal(result.status, status);
    assert.equal(result.body.code, code);
    assert.doesNotMatch(JSON.stringify(result.body), /test-only-secret|private prompt/);
  }
});

test("401 da Gemini permanece erro de integração, sem SESSION_REQUIRED nem dados privados", async (t) => {
  const records = [];
  const secret = "test-only-secret";
  const provider = createGeminiFormProvider({ apiKey: secret, model: "gemini-3.5-flash-lite", timeoutMs: 5000 }, {
    fetchImpl: async () => Response.json({
      error: { code: 401, status: "UNAUTHENTICATED", message: `${secret} PRIVATE_PROMPT Authorization PRIVATE_USER_CONTENT` },
    }, { status: 401, headers: { "x-request-id": "PRIVATE_REQUEST_ID" } }),
  });
  const request = await serverFor(t, provider, {}, { logger: { warn: (...args) => records.push(args) } });
  const result = await request();
  assert.equal(result.status, 502);
  assert.equal(result.body.code, "GEMINI_UNAUTHORIZED");
  assert.deepEqual(Object.keys(result.body), ["error", "code"]);
  assert.deepEqual(records, [["[AI] Analysis failed", { provider: "gemini", code: "GEMINI_UNAUTHORIZED", status: 502, upstreamStatus: 401 }]]);
  assert.doesNotMatch(JSON.stringify([result.body, records]), /SESSION_REQUIRED|test-only-secret|PRIVATE_|Authorization|stack/);
});

test("rota diferencia rate limit do provedor de quota e de falha temporária", async (t) => {
  for (const [upstreamStatus, upstreamCode, status, code] of [
    [429, "rate_limit_exceeded", 429, "GEMINI_RATE_LIMITED"],
    [429, "insufficient_quota", 503, "GEMINI_QUOTA_EXCEEDED"],
    [503, "server_error", 503, "GEMINI_UNAVAILABLE"],
  ]) {
    const records = [];
    const provider = createGeminiFormProvider({ apiKey: "test-only-secret", model: "gemini-3.5-flash-lite", timeoutMs: 5000 }, {
      fetchImpl: async () => Response.json({ error: { code: upstreamStatus, status: "RESOURCE_EXHAUSTED", details: upstreamCode === "insufficient_quota" ? [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel" }] }] : [], message: "PRIVATE_DETAIL" } }, { status: upstreamStatus }),
    });
    const request = await serverFor(t, provider, {}, { logger: { warn: (...args) => records.push(args) } });
    const result = await request();
    assert.equal(result.status, status);
    assert.equal(result.body.code, code);
    assert.notEqual(result.body.code, "AI_RATE_LIMITED");
    assert.deepEqual(records[0][1], { provider: "gemini", code, status, upstreamStatus });
    assert.doesNotMatch(JSON.stringify([result.body, records]), /PRIVATE_DETAIL|test-only-secret/);
  }
});

test("falha inesperada anterior ao provider retorna 500 seguro, sem fingir indisponibilidade externa", async (t) => {
  const records = [];
  t.mock.method(console, "warn", (...args) => records.push(args));
  let calls = 0;
  const request = await serverFor(t, { extract: async () => { calls += 1; return extraction; } }, {}, {
    sessionError: new Error("PRIVATE_DATABASE_URL PRIVATE_SESSION_SECRET PRIVATE_USER_CONTENT"),
  });
  const result = await request();
  assert.equal(result.status, 500);
  assert.equal(result.body.code, "AI_INTERNAL_ERROR");
  assert.equal(calls, 0);
  assert.deepEqual(records, [["[AI] Analysis failed", { provider: "gemini", code: "AI_INTERNAL_ERROR", status: 500, upstreamStatus: null }]]);
  assert.doesNotMatch(JSON.stringify([result.body, records]), /PRIVATE_|stack/);
});

test("timeout retorna 504 e libera a conta para uma nova análise", async (t) => {
  let calls = 0;
  let firstSignal;
  const provider = createGeminiFormProvider({ apiKey: "test-only-secret", model: "gemini-3.5-flash-lite", timeoutMs: 20 }, {
    fetchImpl: async (_url, options) => {
      calls += 1;
      if (calls === 1) {
        firstSignal = options.signal;
        return new Promise(() => {});
      }
      return Response.json({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: JSON.stringify(extraction) }] } }] });
    },
  });
  const request = await serverFor(t, provider);
  const timedOut = await request();
  assert.equal(timedOut.status, 504);
  assert.equal(timedOut.body.code, "GEMINI_TIMEOUT");
  assert.equal(firstSignal.aborted, true);
  assert.equal((await request()).status, 200);
  assert.equal(calls, 2);
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
  assert.equal((await request()).status, 500);
  assert.equal((await request()).status, 200);
});
