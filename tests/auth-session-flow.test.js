import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { ApiError } from "../js/services/api-client.js";

const [mainSource, apiSource, serverSource] = await Promise.all([
  "../js/main.js", "../js/services/api-client.js", "../server.js",
].map(async (path) => (await readFile(new URL(path, import.meta.url), "utf8")).replace(/\r\n/g, "\n")));

function between(source, start, end) {
  const offset = source.indexOf(start);
  const limit = source.indexOf(end, offset + start.length);
  assert.ok(offset >= 0 && limit > offset, `Bloco não encontrado: ${start}`);
  return source.slice(offset, limit);
}

function pending() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

// Execute the production functions with isolated browser dependencies. No global
// fetch/window replacement is needed, so the complete test suite remains isolated.
function bootstrapFixture(get) {
  const requests = [];
  const timers = [];
  const authViews = [];
  const nodes = new Map();
  const context = vm.createContext({
    state: { user: null, products: [], selectedProduct: null, taxAvailability: null },
    authenticationRevision: 0,
    ApiError,
    api: { get: async (path, options) => { requests.push({ path, options }); return get(); } },
    aiAssistant: { invalidate() {} },
    clearMarketReference() {},
    syncRoute() {},
    showAuth: (mode, message) => authViews.push({ mode, message }),
    $: (selector) => {
      if (!nodes.has(selector)) nodes.set(selector, { textContent: "Conta", replaceChildren() {} });
      return nodes.get(selector);
    },
    window: {
      setTimeout: (callback, delay) => { timers.push({ callback, delay }); },
      history: { replaceState() {} },
      location: { pathname: "/" },
      sessionStorage: {},
    },
  });
  vm.runInContext(between(mainSource, "function setAuthenticatedUser(", "function setMarketError("), context);
  vm.runInContext(between(mainSource, "async function bootstrap(", "\nupdatePasswordRequirements();"), context);
  return { context, requests, timers, authViews, nodes };
}

test("bootstrap faz uma checagem inicial com cookies e recupera o usuário da sessão", async () => {
  const user = { id: "user-a", name: "Usuário de teste" };
  const fixture = bootstrapFixture(async () => ({ user, taxEstimate: { configured: true } }));
  await fixture.context.bootstrap();
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.requests[0].path, "/auth/me");
  assert.equal(fixture.requests[0].options.handleUnauthorized, false);
  assert.equal(fixture.context.state.user, user);
  assert.equal(fixture.nodes.get("#currentUserName").textContent, user.name);
  assert.equal(fixture.timers.length, 0);
  assert.equal(fixture.authViews.length, 0);
});

test("401 inicial com SESSION_REQUIRED abre login uma vez e não agenda novas checagens", async () => {
  const fixture = bootstrapFixture(async () => { throw new ApiError("Sessão necessária", 401, "SESSION_REQUIRED"); });
  await fixture.context.bootstrap();
  assert.equal(fixture.context.state.user, null);
  assert.equal(fixture.authViews.length, 1);
  assert.match(fixture.authViews[0].message, /sessão expirou/);
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.timers.length, 0);
});

test("bootstrap não interpreta um HTTP 401 sem SESSION_REQUIRED como sessão expirada", async () => {
  const fixture = bootstrapFixture(async () => { throw new ApiError("Falha externa", 401, "AI_PROVIDER_AUTH_ERROR"); });
  await fixture.context.bootstrap();
  assert.equal(fixture.authViews.length, 0);
  assert.equal(fixture.timers.length, 1);
  assert.equal(fixture.timers[0].delay, 800);
});

test("resposta SESSION_REQUIRED antiga do bootstrap não apaga um login mais recente", async () => {
  const request = pending();
  const fixture = bootstrapFixture(() => request.promise);
  const boot = fixture.context.bootstrap();
  const user = { id: "new-user", name: "Usuário autenticado" };
  fixture.context.setAuthenticatedUser(user);
  request.reject(new ApiError("Sessão necessária", 401, "SESSION_REQUIRED"));
  await boot;
  assert.equal(fixture.context.state.user, user);
  assert.equal(fixture.nodes.get("#currentUserName").textContent, user.name);
  assert.equal(fixture.authViews.length, 0);
  assert.equal(fixture.timers.length, 0);
});

test("resposta de sessão antiga não restaura usuário após encerrar a sessão", async () => {
  const request = pending();
  const fixture = bootstrapFixture(() => request.promise);
  const boot = fixture.context.bootstrap();
  fixture.context.endSession();
  request.resolve({ user: { id: "old-user", name: "Usuário antigo" } });
  await boot;
  assert.equal(fixture.context.state.user, null);
  assert.equal(fixture.nodes.get("#currentUserName").textContent, "Conta");
  assert.equal(fixture.authViews.length, 1);
});

test("retry do bootstrap agendado antes do login não inicia nova requisição depois dele", async () => {
  const fixture = bootstrapFixture(async () => { throw new ApiError("Sem conexão", 503); });
  await fixture.context.bootstrap();
  assert.equal(fixture.timers.length, 1);
  const user = { id: "new-user", name: "Usuário autenticado" };
  fixture.context.setAuthenticatedUser(user);
  fixture.timers[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.context.state.user, user);
  assert.equal(fixture.authViews.length, 0);
});

function apiFixture(status, code) {
  const calls = [];
  const events = [];
  const context = vm.createContext({
    fetch: async (path, options) => {
      calls.push({ path, options });
      return { status, ok: status >= 200 && status < 300, json: async () => ({ error: "Mensagem pública", code }) };
    },
    window: { location: { hostname: "fecart-2026.onrender.com" }, dispatchEvent: (event) => events.push(event.type) },
    CustomEvent: class { constructor(type) { this.type = type; } },
    console: { error() {} },
  });
  vm.runInContext(`${apiSource.replace(/^export /gm, "")}\nglobalThis.client = api;`, context);
  return { client: context.client, calls, events };
}

test("api-client envia cookies na rota IA e preserva sessão em erros de integração", async () => {
  for (const [status, code] of [[401, "AI_PROVIDER_AUTH_ERROR"], [401, "SEARCHAPI_UNAUTHORIZED"], [401, ""], [503, "AI_UNAVAILABLE"]]) {
    const fixture = apiFixture(status, code);
    await assert.rejects(fixture.client.post("/ai/parse-pricing", { message: "Mude margem para 20%." }), (error) => error.status === status && error.code === code);
    assert.equal(fixture.calls[0].options.credentials, "include");
    assert.equal(fixture.calls[0].options.method, "POST");
    assert.deepEqual(fixture.events, []);
  }
});

test("api-client só notifica sessão expirada pelo código interno e respeita bootstrap", async () => {
  const fixture = apiFixture(401, "SESSION_REQUIRED");
  await assert.rejects(fixture.client.get("/auth/me", { handleUnauthorized: false }));
  assert.deepEqual(fixture.events, []);
  assert.equal(fixture.calls[0].options.credentials, "include");
  await assert.rejects(fixture.client.post("/ai/parse-pricing", { message: "Margem 20%." }));
  assert.deepEqual(fixture.events, ["app:session-expired"]);
});

function authMeFixture(query) {
  let route;
  const context = vm.createContext({
    pool: { query },
    console: { info() {} },
    app: { get: (_path, handler) => { route = handler; } },
    authenticatedPayload: (user) => ({ user }),
  });
  vm.runInContext(between(serverSource, "async function currentUser(", "function sessionRequired("), context);
  vm.runInContext(between(serverSource, 'app.get("/auth/me"', 'app.get("/health"'), context);
  return async (session) => {
    const response = { status: 200, body: null, error: null };
    const res = { status: (status) => { response.status = status; return res; }, json: (body) => { response.body = body; } };
    await route({ session }, res, (error) => { response.error = error; });
    return response;
  };
}

test("/auth/me consulta o usuário da sessão e separa ausência de sessão de falha no PostgreSQL", async () => {
  const queries = [];
  const user = { id: "user-a", name: "Usuário de teste" };
  const request = authMeFixture(async (sql, values) => { queries.push({ sql, values }); return { rows: [user] }; });
  const absent = await request({});
  assert.equal(absent.status, 401);
  assert.equal(absent.body.code, "SESSION_REQUIRED");
  assert.equal(queries.length, 0);
  const active = await request({ userId: user.id });
  assert.equal(active.status, 200);
  assert.equal(active.body.user, user);
  assert.equal(queries.length, 1);
  assert.equal(queries[0].values[0], user.id);
  assert.match(queries[0].sql, /WHERE id = \$1/);
  const failed = new Error("Database temporarily unavailable");
  const broken = await authMeFixture(async () => { throw failed; })({ userId: user.id });
  assert.equal(broken.error, failed);
  assert.equal(broken.body, null);
});

test("autenticação aguarda regeneração e persistência da sessão antes de concluir", async () => {
  const context = vm.createContext({});
  vm.runInContext(between(serverSource, "function sessionRegenerate(", "function authenticatedPayload("), context);
  const steps = [];
  let finishRegenerate;
  let finishSave;
  const req = { session: { regenerate: (callback) => { steps.push("regenerate"); finishRegenerate = callback; } } };
  let complete = false;
  const authentication = context.authenticateSession(req, { id: "user-a" }).then(() => { complete = true; });
  assert.deepEqual(steps, ["regenerate"]);
  req.session = { save: (callback) => { steps.push("save"); finishSave = callback; } };
  finishRegenerate();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(steps, ["regenerate", "save"]);
  assert.equal(req.session.userId, "user-a");
  assert.equal(complete, false);
  finishSave();
  await authentication;
  assert.equal(complete, true);
});
