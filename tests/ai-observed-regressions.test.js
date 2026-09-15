import assert from "node:assert/strict";
import test from "node:test";

import { finalizeAiPricingAnalysis, validateAiExtraction } from "../lib/ai-pricing-schema.js";

const batchFields = new Set(["materialCost", "packagingCost", "otherVariableCost", "otherDirectExpenses"]);
const entry = (field, value, evidence, batchUnits = null, batchEvidence = null, overrides = {}) => ({
  field, value, source: "user_provided", evidence,
  basis: batchFields.has(field) ? (batchUnits === null ? "unit" : "batch-total") : "not-applicable",
  certainty: "certain", batchUnits, batchEvidence, correctionEvidence: null, ...overrides,
});
const extract = (message, entries) => validateAiExtraction({ entries }, message);

test("regressão observada: brigadeiros preservam os dois totais do lote", () => {
  const message = "Quero vender brigadeiros. Gasto R$45 com ingredientes para fazer 100 unidades, R$15 com embalagens e quero uma margem de lucro de 30%.";
  const result = extract(message, [
    entry("productName", "brigadeiros", "vender brigadeiros"),
    entry("materialCost", 45, "R$45 com ingredientes", 100, "fazer 100 unidades"),
    entry("packagingCost", 15, "R$15 com embalagens", 100, "fazer 100 unidades"),
    entry("desiredNetMargin", 30, "margem de lucro de 30%"),
  ]);
  assert.deepEqual(result.fields, { productName: "brigadeiros", materialCost: 0.45, packagingCost: 0.15, desiredNetMargin: 30 });
  assert.equal("expectedMonthlyUnits" in result.fields, false);
});

test("regressão observada: componentes adicionais usam o mesmo lote explícito", () => {
  const message = "Produzo 50 camisetas. Pago R$600 nas camisetas, R$150 de estampagem, R$80 de embalagem, R$70 de frete no pedido de 50 unidades e quero lucrar 35%.";
  const result = extract(message, [
    entry("productName", "camisetas", "Produzo 50 camisetas"),
    entry("materialCost", 600, "Pago R$600 nas camisetas", 50, "Produzo 50 camisetas"),
    entry("otherDirectExpenses", 150, "R$150 de estampagem", 50, "Produzo 50 camisetas"),
    entry("packagingCost", 80, "R$80 de embalagem", 50, "Produzo 50 camisetas"),
    entry("averageOrderFreight", 70, "R$70 de frete no pedido"),
    entry("averageOrderUnits", 50, "pedido de 50 unidades"),
    entry("desiredNetMargin", 35, "lucrar 35%"),
  ]);
  assert.deepEqual(result.fields, {
    productName: "camisetas", materialCost: 12, otherDirectExpenses: 3,
    packagingCost: 1.6, averageOrderFreight: 70, averageOrderUnits: 50, desiredNetMargin: 35,
  });
});

test("regressão observada: energia do lote é direta, mas energia mensal é fixa", () => {
  const batchMessage = "Quero margem de 25%. Faço velas artesanais. São 40 unidades por produção. Embalagem custa 32 reais, matéria-prima 180 e gasto mais 25 reais de energia.";
  assert.deepEqual(extract(batchMessage, [
    entry("productName", "velas artesanais", "Faço velas artesanais"),
    entry("packagingCost", 32, "Embalagem custa 32 reais", 40, "São 40 unidades por produção"),
    entry("materialCost", 180, "matéria-prima 180", 40, "São 40 unidades por produção"),
    entry("otherVariableCost", 25, "25 reais de energia", 40, "São 40 unidades por produção"),
    entry("desiredNetMargin", 25, "margem de 25%"),
  ]).fields, {
    productName: "velas artesanais", packagingCost: 0.8, materialCost: 4.5,
    otherVariableCost: 0.625, desiredNetMargin: 25,
  });

  const monthlyMessage = "Energia fixa mensal R$300.";
  assert.deepEqual(extract(monthlyMessage, [{
    ...entry("monthlyFixedCosts", 300, monthlyMessage), basis: "monthly-total",
  }]).fields, { monthlyFixedCosts: 300 });
});

test("regressão observada: linguagem informal e custo explicitamente unitário", () => {
  const informal = "mano eu faço brownie, gasto tipo uns 120 conto pra fazer 80, mais 20 de embalagem e queria ganhar uns 40%";
  assert.deepEqual(extract(informal, [
    entry("productName", "brownie", "faço brownie"),
    entry("materialCost", 120, "gasto tipo uns 120 conto", 80, "fazer 80"),
    entry("packagingCost", 20, "20 de embalagem", 80, "fazer 80"),
    entry("desiredNetMargin", 40, "ganhar uns 40%"),
  ]).fields, { productName: "brownie", materialCost: 1.5, packagingCost: 0.25, desiredNetMargin: 40 });

  const unit = "Quero vender bolos. Gasto R$70 para fazer cada bolo.";
  assert.deepEqual(extract(unit, [
    entry("productName", "bolos", "vender bolos"),
    entry("materialCost", 70, "Gasto R$70 para fazer cada bolo"),
  ]).fields, { productName: "bolos", materialCost: 70 });
});

test("regressão observada: margem ausente mantém custos e não cria escala mensal", () => {
  const message = "Produzo 200 salgados com R$160 de ingredientes e R$40 de embalagem.";
  const result = finalizeAiPricingAnalysis(extract(message, [
    entry("productName", "salgados", "Produzo 200 salgados"),
    entry("materialCost", 160, "R$160 de ingredientes", 200, "Produzo 200 salgados"),
    entry("packagingCost", 40, "R$40 de embalagem", 200, "Produzo 200 salgados"),
  ]), {}, "complete");
  assert.equal(result.fields.materialCost, 0.8);
  assert.equal(result.fields.packagingCost, 0.2);
  assert.equal("expectedMonthlyUnits" in result.fields, false);
  assert.equal(result.pending.some(({ code, field }) => code === "AI_REQUIRED_FIELD_MISSING" && field === "desiredNetMargin"), true);
});

test("regressão observada: moeda brasileira mantém precisão e arredonda só a prévia", () => {
  const message = "Produzo 150 unidades. Meu custo é R$1.250,75, embalagem R$184,90 e quero 27,5% de margem.";
  const result = extract(message, [
    entry("materialCost", 1250.75, "custo é R$1.250,75", 150, "Produzo 150 unidades"),
    entry("packagingCost", 184.9, "embalagem R$184,90", 150, "Produzo 150 unidades"),
    entry("desiredNetMargin", 27.5, "27,5% de margem"),
  ]);
  assert.equal(result.fields.materialCost, 8.33833333333333);
  assert.equal(result.fields.packagingCost, 1.23266666666667);
  assert.match(result.summary.find(({ field }) => field === "materialCost").value, /R\$\s*8,34/);
  assert.match(result.summary.find(({ field }) => field === "packagingCost").value, /R\$\s*1,23/);
});

test("regressão observada: correção e componentes mistos não reutilizam divisor indevido", () => {
  const corrected = "Quero vender 80 brownies. Gasto R$100 de ingredientes... esquece, na verdade gasto R$135. Embalagem R$20 e margem 35%.";
  assert.deepEqual(extract(corrected, [
    entry("productName", "brownies", "vender 80 brownies"),
    entry("materialCost", 135, "gasto R$135", 80, "80 brownies", { correctionEvidence: "esquece, na verdade gasto R$135" }),
    entry("packagingCost", 20, "Embalagem R$20", 80, "80 brownies"),
    entry("desiredNetMargin", 35, "margem 35%"),
  ]).fields, { productName: "brownies", materialCost: 1.6875, packagingCost: 0.25, desiredNetMargin: 35 });

  const mixed = "Vou fabricar 100 canecas. Cada caneca custa R$12 para comprar, a impressão das 100 custa R$350 e a embalagem custa R$2,50 por unidade. Quero margem de 30%.";
  assert.deepEqual(extract(mixed, [
    entry("productName", "canecas", "fabricar 100 canecas"),
    entry("materialCost", 12, "Cada caneca custa R$12 para comprar"),
    entry("otherDirectExpenses", 350, "impressão das 100 custa R$350", 100, "impressão das 100"),
    entry("packagingCost", 2.5, "embalagem custa R$2,50 por unidade"),
    entry("desiredNetMargin", 30, "margem de 30%"),
  ]).fields, { productName: "canecas", materialCost: 12, otherDirectExpenses: 3.5, packagingCost: 2.5, desiredNetMargin: 30 });
});

test("regressão observada: ambiguidades preservam só dados seguros", () => {
  const message = "vou vender umas garrafinhas são 120 eu acho, cada uma custa 4,50, etiqueta deu 67 reais, embalagem acho q 90, frete foi 54 mas talvez eu não queira colocar o frete, margem quero uns 30 ou 35 não sei";
  const result = extract(message, [
    entry("productName", "garrafinhas", "vender umas garrafinhas"),
    entry("materialCost", 4.5, "cada uma custa 4,50"),
    entry("otherDirectExpenses", 67, "etiqueta deu 67 reais", 120, "garrafinhas são 120"),
    entry("packagingCost", 90, "embalagem acho q 90", 120, "garrafinhas são 120", { certainty: "include-uncertain" }),
    entry("averageOrderFreight", 54, "frete foi 54 mas talvez eu não queira colocar o frete", null, null, { certainty: "include-uncertain" }),
    entry("desiredNetMargin", 30, "margem quero uns 30 ou 35 não sei", null, null, { certainty: "ambiguous-value" }),
  ]);
  assert.deepEqual(result.fields, { productName: "garrafinhas", materialCost: 4.5, otherDirectExpenses: 0.558333333333333 });
  assert.deepEqual(result.pending.map(({ code, field }) => ({ code, field })), [
    { code: "AI_CONFIRM_FIELD", field: "packagingCost" },
    { code: "AI_CONFIRM_FIELD", field: "averageOrderFreight" },
    { code: "AI_AMBIGUOUS_VALUE", field: "desiredNetMargin" },
  ]);
});
