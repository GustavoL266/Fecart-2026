import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import http from "node:http";
import test from "node:test";
import vm from "node:vm";
import express from "express";

import { marketRequestPayload } from "../js/services/market-reference-store.js";
import { productForClient } from "../lib/models.js";
import { authoritativeProductSnapshot } from "../lib/pricing-persistence.js";
import { productCreateSchema, validate } from "../lib/validation.js";

const serverSource = (await readFile(new URL("../server.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const inputs = {
  materialCost: 18.5,
  wasteRate: 0.05,
  packagingCost: 3.5,
  deliveryCost: 4,
  insuranceCost: 0.5,
  otherDirectExpenses: 1.5,
  monthlyPayroll: 12_000,
  monthlyFixedCosts: 8_000,
  expectedMonthlyUnits: 2_000,
  taxRate: 0.06,
  paymentFeeRate: 0.028,
  commissionRate: 0.05,
  desiredNetMargin: 0.1,
  inventoryDays: 10,
  receivingDays: 7,
  paymentDays: 30,
  monthlyCapitalRate: 0.02,
  fiscalContext: { ncmCode: "18061000" },
};

function productPayload({ market = {}, inputOverrides = {} } = {}) {
  return {
    name: "Bolo",
    description: "",
    category: "Alimentos",
    pricing: { inputs: { ...inputs, ...inputOverrides }, market, emptyOptionalFields: [] },
  };
}

function between(source, start, end) {
  const offset = source.indexOf(start);
  const limit = source.indexOf(end, offset + start.length);
  assert.ok(offset >= 0 && limit > offset, `Bloco não encontrado: ${start}`);
  return source.slice(offset, limit);
}

function productCreateHandler() {
  let handler;
  const context = vm.createContext({
    app: {
      post(path, _requireAuth, routeHandler) {
        if (path === "/products") handler = routeHandler;
      },
    },
    requireAuth() {},
    validate,
    productCreateSchema,
    authoritativeProductSnapshot,
    productForClient,
    productColumns: () => "id, name, description, category, cost_price, additional_costs, profit_margin, suggested_price, marketplace, consultation_date, created_at, updated_at, calculation_data",
    randomUUID: () => "00000000-0000-4000-8000-000000000099",
    pool: {
      async query(_sql, values) {
        const now = "2026-09-17T12:00:00.000Z";
        return {
          rows: [{
            id: values[0],
            name: values[2],
            description: values[3],
            category: values[4],
            cost_price: values[5],
            additional_costs: values[6],
            profit_margin: values[7],
            suggested_price: values[8],
            marketplace: values[9],
            consultation_date: now,
            created_at: now,
            updated_at: now,
            calculation_data: JSON.parse(values[11]),
          }],
        };
      },
    },
  });
  vm.runInContext(between(serverSource, 'app.post("/products"', 'app.patch("/products/:id"'), context);
  assert.equal(typeof handler, "function");
  return handler;
}

async function listen(app) {
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

test("POST /products salva cálculo com margem de 10% e sem referência de mercado", async (t) => {
  const handler = productCreateHandler();
  const app = express();
  app.use(express.json());
  app.post("/products", (req, res, next) => {
    req.user = { id: "00000000-0000-4000-8000-000000000001" };
    return handler(req, res, next);
  });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message, code: error.code }));
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/products`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(productPayload({ market: marketRequestPayload(null) })),
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.product.profitMargin, 10);
  assert.equal(body.product.marketplace, "Sem referência de mercado");
  assert.equal(body.product.calculationData.pricingResult.market.price, null);
});

test("backend preserva todos os modos válidos de referência de mercado", () => {
  const stats = { min: 40, max: 100, average: 70, median: 65, count: 4 };
  const selectedProduct = { id: "bolo-1", title: "Bolo artesanal", price: 72, source: "Loja Exemplo" };
  const cases = [
    { name: "sem referência", market: marketRequestPayload(null), expectedRule: "none", expectedPrice: null, marketplace: "Sem referência de mercado" },
    { name: "manual", market: marketRequestPayload({ rule: "manual" }), inputOverrides: { marketPrice: 80 }, expectedRule: "manual", expectedPrice: 80 },
    { name: "selected-product", market: marketRequestPayload({ rule: "selected-product", selectedProduct, stats }), expectedRule: "selected-product", expectedPrice: 72 },
    { name: "market-average", market: marketRequestPayload({ rule: "market-average", marketplace: "Google Shopping", stats }), expectedRule: "market-average", expectedPrice: 70 },
    { name: "market-median", market: marketRequestPayload({ rule: "market-median", marketplace: "Google Shopping", stats }), expectedRule: "market-median", expectedPrice: 65 },
  ];

  for (const scenario of cases) {
    const request = validate(productCreateSchema, productPayload(scenario));
    const snapshot = authoritativeProductSnapshot(request);
    assert.equal(snapshot.calculationData.market.rule, scenario.expectedRule, scenario.name);
    assert.equal(snapshot.calculationData.market.priceUsed, scenario.expectedPrice, scenario.name);
    if (scenario.marketplace) assert.equal(snapshot.marketplace, scenario.marketplace, scenario.name);
  }
});

test("API rejeita regra vazia ou arbitrária sem enfraquecer a enumeração", () => {
  for (const rule of ["", "valor-invalido", "admin", "hack"]) {
    assert.throws(
      () => validate(productCreateSchema, productPayload({ market: { rule } })),
      (error) => error.status === 400 && error.code === "VALIDATION_ERROR",
      rule || "string vazia",
    );
  }
});
