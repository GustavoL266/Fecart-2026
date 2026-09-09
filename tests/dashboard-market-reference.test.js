import assert from "node:assert/strict";
import test from "node:test";
import { calculatePricing } from "../js/domain/pricing-calculator.js";
import { ConfiguredTaxRuleEngine } from "../js/domain/tax-rule-engine.js";
import { renderDashboard } from "../js/ui/dashboard.js";

function documentStub() {
  const nodes = new Map();
  return { nodes, querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, { classList: { toggle() {} }, hidden: false, innerHTML: "", textContent: "", value: 0, setAttribute() {} }); return nodes.get(selector); } };
}
const inputs = { materialCost: 10, wasteRate: 0, packagingCost: 1, deliveryCost: 1, monthlyPayroll: 100, monthlyFixedCosts: 100, expectedMonthlyUnits: 100, taxRate: 0.06, paymentFeeRate: 0.02, commissionRate: 0.03, desiredNetMargin: 0.2, inventoryDays: 0, receivingDays: 0, paymentDays: 0, monthlyCapitalRate: 0, fiscalContext: {} };

test("dashboard lê o resultado canônico e distingue produto individual", () => {
  const selectedProduct = { id: "produto-1", title: "Produto principal", price: 30, source: "Loja Exemplo", seller: "Loja Exemplo", currency: "BRL", image: "https://example.com/image.jpg", url: "https://example.com/product", rating: 4.7, reviews: 120, consultedAt: "2026-09-02T12:00:00.000Z" };
  const otherProduct = { ...selectedProduct, id: "produto-2", title: "Produto alternativo", price: 32, source: "Outra Loja", seller: "Outra Loja" };
  const reference = { price: 30, source: "Loja Exemplo", rule: "selected-product", selectedProduct };
  const result = calculatePricing(inputs, reference);
  const document = documentStub();
  renderDashboard(document, result, {
    status: "success",
    query: "Produto principal",
    items: [selectedProduct, otherProduct],
    stats: { count: 2, average: 31, median: 31, min: 30, max: 32 },
    selectedItem: selectedProduct,
    marketplace: "Google Shopping",
  }, new ConfiguredTaxRuleEngine().assess(inputs));
  assert.match(document.nodes.get("#suggestedPrice").textContent, /R\$/);
  assert.equal(document.nodes.get("#marketTitle").textContent, "Produto individual selecionado");
  assert.match(document.nodes.get("#marketStatus").textContent, /Diferença/);
  assert.equal(document.nodes.get("#marketPanel").hidden, false);
  assert.match(document.nodes.get("#marketDashboardStatus").textContent, /2 referências encontradas/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /Média/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /Maior \+ tributos/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /NCM necessário/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /Produto alternativo/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /Preço de mercado: R\$\s32,00/);
  assert.doesNotMatch(document.nodes.get("#marketStats").innerHTML, /Fonte fiscal: Focus NFe/);
  assert.match(document.nodes.get("#marketResults").innerHTML, /Produto principal/);
  assert.match(document.nodes.get("#marketResults").innerHTML, /Referência selecionada/);
  assert.match(document.nodes.get("#marketResults").innerHTML, /Usar como referência/);
  assert.equal(document.nodes.get("#primaryMarketValue").hidden, false);
  assert.match(document.nodes.get("#primaryMarketSource").textContent, /Produto principal.*Loja Exemplo.*Google Shopping/);
});

test("dashboard atualiza Maior + tributos estimados com os componentes IBPT", () => {
  const maximum = { id: "produto-maximo", title: "Produto máximo", price: 100, source: "Loja", seller: "Loja", currency: "BRL", url: "https://example.com/max" };
  const result = calculatePricing(inputs, null);
  const document = documentStub();
  renderDashboard(document, result, {
    status: "success",
    query: "Produto máximo",
    items: [maximum],
    stats: { count: 1, average: 100, median: 100, min: 100, max: 100 },
    marketplace: "Google Shopping",
    taxContext: { ncm: "09012100", ncmConfirmed: true, productOrigin: "nacional", originState: "SP", destinationState: "RJ" },
    taxAvailability: { provider: "IBPT", configured: true, version: "26.2.A" },
    tax: {
      status: "success",
      expanded: true,
      result: {
        marketPrice: 100,
        total: 131.45,
        estimatedTaxes: 31.45,
        ncm: "09012100",
        productOrigin: "nacional",
        source: "IBPT / Empresômetro",
        version: "26.2.A",
        validFrom: "20/08/2026",
        validTo: "30/09/2026",
        rates: { federal: 13.45, state: 18, municipal: 0, total: 31.45 },
      },
    },
  }, new ConfiguredTaxRuleEngine().assess(inputs));

  assert.match(document.nodes.get("#marketStats").innerHTML, /R\$\s131,45/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /IBPT \/ Empresômetro/);
  assert.match(document.nodes.get("#marketTaxDetails").innerHTML, /Maior/);
  assert.match(document.nodes.get("#marketTaxDetails").innerHTML, /Carga tributária estimada/);
  assert.match(document.nodes.get("#marketTaxDetails").innerHTML, /Tributos estimados/);
  assert.match(document.nodes.get("#marketTaxDetails").innerHTML, /Versão: 26\.2\.A/);
  assert.match(document.nodes.get("#marketTaxDetails").innerHTML, /Vigência: 20\/08\/2026 a 30\/09\/2026/);
  assert.match(document.nodes.get("#marketTaxDetails").innerHTML, /Origem do produto<\/dt><dd>Nacional/);
  assert.match(document.nodes.get("#marketTaxDetails").innerHTML, /UF de origem<\/dt><dd>SP/);
  assert.match(document.nodes.get("#marketTaxDetails").innerHTML, /UF de destino<\/dt><dd>RJ/);
  assert.match(document.nodes.get("#marketTaxDetails").innerHTML, /NCM 09012100 · Origem: Nacional · UF origem: SP · UF destino: RJ/);
});

test("detalhamento importado mostra país sem alterar a origem tributária do IBPT", () => {
  const maximum = { id: "produto-importado", title: "Produto importado", price: 100, source: "Loja", seller: "Loja", currency: "BRL", url: "https://example.com/importado" };
  const result = calculatePricing(inputs, null);
  const document = documentStub();
  renderDashboard(document, result, {
    status: "success",
    query: "Produto importado",
    items: [maximum],
    stats: { count: 1, average: 100, median: 100, min: 100, max: 100 },
    marketplace: "Google Shopping",
    taxContext: { ncm: "09012100", ncmConfirmed: true, productOrigin: "importado", countryOfOrigin: "China", destinationState: "RJ" },
    taxAvailability: { provider: "IBPT", configured: true, version: "26.2.A" },
    tax: {
      status: "success",
      expanded: true,
      result: {
        marketPrice: 100,
        total: 142.57,
        estimatedTaxes: 42.57,
        ncm: "09012100",
        productOrigin: "importado",
        source: "IBPT / Empresômetro",
        version: "26.2.A",
        validFrom: "20/08/2026",
        validTo: "30/09/2026",
        rates: { federal: 24.57, state: 18, municipal: 0, total: 42.57 },
      },
    },
  }, new ConfiguredTaxRuleEngine().assess(inputs));

  const details = document.nodes.get("#marketTaxDetails").innerHTML;
  assert.match(details, /Origem do produto<\/dt><dd>Importado \(Fora do País\)/);
  assert.match(details, /País de origem<\/dt><dd>China/);
  assert.match(details, /UF de destino<\/dt><dd>RJ/);
  assert.match(details, /Fonte<\/dt><dd>IBPT \/ Empresômetro/);
  assert.match(details, /NCM 09012100 · Origem: Importado \(Fora do País\) · País: China · UF destino: RJ/);
});
