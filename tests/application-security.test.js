import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import vm from "node:vm";
import express from "express";

import { createSecurityHeaders, requireSameOriginForWrites } from "../lib/request-security.js";
import { productCreateSchema, productIdSchema, productMetadataSchema, validate } from "../lib/validation.js";

const [serverSource, mainSource] = await Promise.all(["../server.js", "../js/main.js"].map(async (path) => (
  await readFile(new URL(path, import.meta.url), "utf8")
).replace(/\r\n/g, "\n")));

function between(source, start, end) {
  const offset = source.indexOf(start);
  const limit = source.indexOf(end, offset + start.length);
  assert.ok(offset >= 0 && limit > offset, `Bloco não encontrado: ${start}`);
  return source.slice(offset, limit);
}

function responseRecorder() {
  const response = { status: 200, body: null, ended: false };
  const res = {
    status(status) { response.status = status; return res; },
    json(body) { response.body = body; return res; },
    end() { response.ended = true; return res; },
  };
  return { res, response };
}

function productRouteFixture() {
  const routes = new Map();
  const middleware = () => {};
  const products = [
    { id: "00000000-0000-4000-8000-00000000000a", user_id: "user-a", name: "Produto A", description: "", category: "A" },
    { id: "00000000-0000-4000-8000-00000000000b", user_id: "user-b", name: "Produto B", description: "privado", category: "B" },
  ];
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.startsWith("SELECT") && sql.includes("ORDER BY")) {
        const rows = sql.includes("WHERE user_id = $1") ? products.filter((item) => item.user_id === values[0]) : [...products];
        return { rows };
      }
      if (sql.startsWith("SELECT")) {
        const rows = products.filter((item) => item.id === values[0]
          && (!sql.includes("user_id = $2") || item.user_id === values[1]));
        return { rows };
      }
      if (sql.startsWith("UPDATE")) {
        const item = products.find((product) => product.id === values[0]
          && (!sql.includes("user_id = $2") || product.user_id === values[1]));
        if (item) Object.assign(item, { name: values[2], description: values[3], category: values[4] });
        return { rows: item ? [item] : [] };
      }
      if (sql.startsWith("DELETE")) {
        const index = products.findIndex((item) => item.id === values[0]
          && (!sql.includes("user_id = $2") || item.user_id === values[1]));
        if (index >= 0) products.splice(index, 1);
        return { rowCount: index >= 0 ? 1 : 0 };
      }
      return { rows: [] };
    },
  };
  const app = Object.fromEntries(["get", "post", "patch", "delete"].map((method) => [method, (path, ...handlers) => {
    if (typeof path === "string" && path.startsWith("/products")) {
      assert.equal(handlers[0], middleware, `${method.toUpperCase()} ${path} deve exigir autenticação`);
      routes.set(`${method.toUpperCase()} ${path}`, handlers.at(-1));
    }
  }]));
  const context = vm.createContext({
    app,
    requireAuth: middleware,
    pool,
    productColumns: () => "id, user_id, name, description, category",
    productForClient: (row) => ({ ...row }),
    validate: (_schema, input) => input,
    productListSchema: {}, productIdSchema: {}, productCreateSchema: {}, productMetadataSchema: {},
    authoritativeProductSnapshot: (value) => value,
    randomUUID: () => "00000000-0000-4000-8000-000000000099",
  });
  vm.runInContext(between(serverSource, 'app.get("/products"', 'app.get(["/", "/index.html"]'), context);

  async function request(method, path, { body = {}, params = {}, query = {}, user = { id: "user-a" } } = {}) {
    const { res, response } = responseRecorder();
    let error;
    await routes.get(`${method} ${path}`)({ body, params, query, user }, res, (caught) => { error = caught; });
    if (error) throw error;
    return response;
  }
  return { products, queries, request };
}

test("autorização de produtos impede A de acessar, alterar, excluir ou listar o histórico de B", async () => {
  const fixture = productRouteFixture();
  const idB = "00000000-0000-4000-8000-00000000000b";

  const history = await fixture.request("GET", "/products", { query: { search: "", sort: "desc", limit: 100 } });
  assert.deepEqual(history.body.products.map(({ id }) => id), ["00000000-0000-4000-8000-00000000000a"]);

  const read = await fixture.request("GET", "/products/:id", { params: { id: idB } });
  assert.equal(read.status, 404);

  const update = await fixture.request("PATCH", "/products/:id", {
    params: { id: idB },
    body: { name: "Adulterado", description: "", category: "X", userId: "user-a" },
  });
  assert.equal(update.status, 404);
  assert.equal(fixture.products.find(({ id }) => id === idB).name, "Produto B");

  const deletion = await fixture.request("DELETE", "/products/:id", { params: { id: idB } });
  assert.equal(deletion.status, 404);
  assert.ok(fixture.products.some(({ id }) => id === idB));

  for (const { sql, values } of fixture.queries) {
    assert.match(sql, /user_id = \$[12]/);
    assert.ok(values.includes("user-a"));
  }
});

test("busca e identificadores hostis não entram no SQL e payload não controla identidade nem derivados", async () => {
  const fixture = productRouteFixture();
  const injection = "%' OR 1=1 --";
  await fixture.request("GET", "/products", { query: { search: injection, sort: "desc", limit: 100 } });
  const query = fixture.queries.at(-1);
  assert.doesNotMatch(query.sql, /OR 1=1/);
  assert.deepEqual(Array.from(query.values), ["user-a", `%${injection}%`, 100]);
  assert.equal(productIdSchema.safeParse({ id: "' OR TRUE --" }).success, false);

  const parsed = validate(productCreateSchema, {
    name: "Produto",
    category: "Outros",
    userId: "user-b",
    suggestedPrice: 0.01,
    pricing: { inputs: {}, market: {} },
  });
  assert.equal("userId" in parsed, false);
  assert.equal("suggestedPrice" in parsed, false);
  assert.deepEqual(validate(productMetadataSchema, {
    name: "Produto",
    description: "",
    category: "Outros",
    userId: "user-b",
    calculationData: { forged: true },
  }), { name: "Produto", description: "", category: "Outros" });

  const loginRoute = between(serverSource, 'app.post("/auth/login"', 'app.post("/auth/logout"');
  assert.match(loginRoute, /WHERE email = \$1/);
  assert.doesNotMatch(loginRoute, /WHERE email = ['"`]\$\{/);
});

test("rota protegida nega sessão ausente e sessão que não corresponde a usuário válido", async () => {
  const pool = { query: async (_sql, values) => ({ rows: values[0] === "valid-user" ? [{ id: "valid-user" }] : [] }) };
  const context = vm.createContext({ pool, console: { info() {} } });
  vm.runInContext(between(serverSource, "async function currentUser(", "function productColumns("), context);

  for (const session of [{}, { userId: "invalid-user" }]) {
    const { res, response } = responseRecorder();
    let nextCalled = false;
    await context.requireAuth({ session, path: "/products", method: "GET" }, res, () => { nextCalled = true; });
    assert.equal(response.status, 401);
    assert.equal(response.body.code, "SESSION_REQUIRED");
    assert.equal(nextCalled, false);
  }
});

test("cadastro não revela se o e-mail já existe e não autentica antes do login", async () => {
  let registerRoute;
  let isDuplicate = false;
  const context = vm.createContext({
    Object,
    app: { post: (path, _limiter, handler) => { if (path === "/auth/register") registerRoute = handler; } },
    authLimiter() {},
    validate: (_schema, body) => body,
    registerSchema: {},
    hashPassword: async () => "bcrypt-hash",
    randomUUID: () => "00000000-0000-4000-8000-000000000001",
    pool: { query: async () => {
      if (isDuplicate) throw Object.assign(new Error("duplicate"), { code: "23505" });
      return { rows: [{ id: "new-user" }] };
    } },
    console: { info() {} },
  });
  vm.runInContext(between(serverSource, "const registrationAcceptedPayload", 'app.post("/auth/login"'), context);
  const accepted = async (duplicate) => {
    isDuplicate = duplicate;
    const { res, response } = responseRecorder();
    let error;
    await registerRoute({ body: { name: "Ana", email: "ana@example.com", password: "x" } }, res, (caught) => { error = caught; });
    assert.equal(error, undefined);
    return response;
  };
  assert.deepEqual(await accepted(false), await accepted(true));
  assert.equal((await accepted(false)).status, 202);
  const routeSource = between(serverSource, 'app.post("/auth/register"', 'app.post("/auth/login"');
  assert.doesNotMatch(routeSource, /authenticateSession|Já existe uma conta/);
  const clientSource = between(mainSource, "async function submitRegistration(", "\n [...PRICING_FIELD_IDS]");
  assert.match(clientSource, /const email = .*registerEmail.*toLowerCase/);
  assert.match(clientSource, /showAuth\("login", response\.message\)/);
  assert.doesNotMatch(clientSource, /setAuthenticatedUser|error\.status === 409/);
});

test("headers defensivos e proteção CSRF rejeitam escrita cross-site sem afetar mesma origem", async (t) => {
  const app = express();
  app.disable("x-powered-by");
  app.use(createSecurityHeaders());
  app.use(requireSameOriginForWrites);
  app.get("/probe", (_req, res) => res.json({ ok: true }));
  app.post("/probe", (_req, res) => res.status(204).end());
  const server = http.createServer(app).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;

  const headers = await fetch(`${origin}/probe`);
  assert.match(headers.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(headers.headers.get("x-frame-options"), "DENY");
  assert.equal(headers.headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.headers.get("referrer-policy"), "no-referrer");

  const denied = await fetch(`${origin}/probe`, { method: "POST", headers: { Origin: "https://evil.example" } });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, "CSRF_ORIGIN_MISMATCH");

  const accepted = await fetch(`${origin}/probe`, { method: "POST", headers: { Origin: origin } });
  assert.equal(accepted.status, 204);
});

test("sessão usa cookie defensivo, autenticação regenera SID e arquivos privados não são publicados", () => {
  assert.match(serverSource, /name: "pricing\.sid"/);
  assert.match(serverSource, /httpOnly: true/);
  assert.match(serverSource, /sameSite: "lax"/);
  assert.match(serverSource, /secure: config\.secureCookie/);
  assert.match(serverSource, /await sessionRegenerate\(req\)/);
  assert.match(serverSource, /req\.session\.destroy/);
  assert.doesNotMatch(serverSource, /express\.static/);

  const publicFiles = between(serverSource, 'app.get(["/", "/index.html"]', "function isDatabaseError(");
  for (const path of [".env", ".git", "render.yaml", "package.json", "README.md"]) {
    assert.equal(publicFiles.includes(path), false);
  }
});
