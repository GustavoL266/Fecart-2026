import assert from "node:assert/strict";
import test from "node:test";
import { calculatePricing } from "../js/domain/pricing-calculator.js";
import { ConfiguredTaxRuleEngine } from "../js/domain/tax-rule-engine.js";
import { renderDashboard, renderIncompleteDashboard } from "../js/ui/dashboard.js";

function documentStub() {
  const nodes = new Map();
  return { nodes, querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, { classList: { toggle() {} }, hidden: false, innerHTML: "", textContent: "", value: 0, setAttribute() {} }); return nodes.get(selector); } };
}
const inputs = { materialCost: 10, wasteRate: 0, packagingCost: 1, deliveryCost: 1, monthlyPayroll: 100, monthlyFixedCosts: 100, expectedMonthlyUnits: 100, taxRate: 0.06, paymentFeeRate: 0.02, commissionRate: 0.03, desiredNetMargin: 0.2, inventoryDays: 0, receivingDays: 0, paymentDays: 0, monthlyCapitalRate: 0, fiscalContext: {} };

test("dashboard lista as pendências reais em vez de mensagem genérica", () => {
  const document = documentStub();
  renderIncompleteDashboard(document, { status: "idle", items: [], tax: { status: "idle" } }, {
    materialCost: "Informe o custo dos insumos e da matéria-prima.",
    desiredNetMargin: "Informe a margem de lucro desejada.",
  });
  assert.match(document.nodes.get("#recommendationText").textContent, /custo dos insumos/);
  assert.match(document.nodes.get("#recommendationText").textContent, /margem de lucro desejada/);
  assert.match(document.nodes.get("#alerts").innerHTML, /<li>Informe o custo dos insumos/);
  assert.match(document.nodes.get("#alerts").innerHTML, /<li>Informe a margem de lucro desejada/);
  assert.match(document.nodes.get("#marketStatus").textContent, /opcional/);
});

test("consulta mostra horário real e permite atualizar sem perder resultados após uma falha", () => {
  const document = documentStub();
  renderIncompleteDashboard(document, {
    status: "success",
    query: "iPhone 18 Pro Max",
    items: [{ id: "phone", title: "iPhone 18 Pro Max", price: 5000, currency: "BRL", source: "Loja", seller: "Loja", url: "https://example.com/phone" }],
    stats: { count: 1, average: 5000, median: 5000, min: 5000, max: 5000 },
    consultedAt: "2026-09-23T12:00:00.000Z",
    refreshError: "Não foi possível atualizar os preços agora. Tente novamente.",
    tax: { status: "idle" },
  }, {});
  assert.equal(document.nodes.get("#marketRefreshButton").hidden, false);
  assert.match(document.nodes.get("#marketConsultedAt").textContent, /Consulta realizada em:/);
  assert.equal(document.nodes.get("#marketRefreshStatus").hidden, false);
  assert.match(document.nodes.get("#marketRefreshStatus").textContent, /Não foi possível atualizar/);
  assert.match(document.nodes.get("#marketResults").innerHTML, /iPhone 18 Pro Max/);
});

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
  assert.match(document.nodes.get("#marketStats").innerHTML, /Baseado no produto selecionado/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /NCM necessário/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /Produto principal/);
  assert.doesNotMatch(document.nodes.get("#marketStats").innerHTML, /Fonte fiscal: Focus NFe/);
  assert.match(document.nodes.get("#marketResults").innerHTML, /Produto principal/);
  assert.match(document.nodes.get("#marketResults").innerHTML, /Referência selecionada/);
  assert.match(document.nodes.get("#marketResults").innerHTML, /Usar como referência/);
  assert.equal(document.nodes.get("#primaryMarketValue").hidden, false);
  assert.match(document.nodes.get("#primaryMarketSource").textContent, /Produto principal.*Loja Exemplo.*Google Shopping/);
});

test("sem seleção, dashboard compara menor e maior preço com os componentes IBPT", () => {
  const minimum = { id: "produto-minimo", title: "Produto mínimo", price: 100, source: "Loja", seller: "Loja", currency: "BRL", url: "https://example.com/min" };
  const maximum = { id: "produto-maximo", title: "Produto máximo", price: 100, source: "Loja", seller: "Loja", currency: "BRL", url: "https://example.com/max" };
  maximum.price = 200;
  const result = calculatePricing(inputs, null);
  const document = documentStub();
  renderDashboard(document, result, {
    status: "success",
    query: "Produto máximo",
    items: [minimum, maximum],
    stats: { count: 2, average: 150, median: 150, min: 100, max: 200 },
    marketplace: "Google Shopping",
    taxContext: { ncm: "09012100", ncmConfirmed: true, productOrigin: "nacional", originState: "SP", destinationState: "RJ" },
    taxAvailability: { provider: "IBPT", configured: true, version: "26.2.A" },
    tax: {
      status: "success",
      mode: "extremes",
      expanded: true,
      calculations: {
        minimum: {
        marketPrice: 100,
        estimatedTaxes: 31.45,
        ncm: "09012100",
        productOrigin: "nacional",
        source: "IBPT / Empresômetro",
        version: "26.2.A",
        validFrom: "20/08/2026",
        validTo: "30/09/2026",
        rates: { federal: 13.45, state: 18, municipal: 0, total: 31.45 },
        },
        maximum: {
          marketPrice: 200,
          estimatedTaxes: 62.9,
          ncm: "09012100",
          productOrigin: "nacional",
          source: "IBPT / Empresômetro",
          version: "26.2.A",
          validFrom: "20/08/2026",
          validTo: "30/09/2026",
          rates: { federal: 13.45, state: 18, municipal: 0, total: 31.45 },
        },
      },
    },
  }, new ConfiguredTaxRuleEngine().assess(inputs));

  assert.match(document.nodes.get("#marketStats").innerHTML, /Baseado nos extremos da pesquisa/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /Menor preço/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /Maior preço/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /R\$\s100,00/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /R\$\s200,00/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /R\$\s31,45/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /R\$\s62,90/);
  for (const markup of [document.nodes.get("#marketStats").innerHTML, document.nodes.get("#marketTaxDetails").innerHTML]) {
    assert.match(markup, /<div class="is-total"><dt>Valor final com tributos<\/dt><dd[^>]*>R\$\s131,45<\/dd>/);
    assert.match(markup, /<div class="is-total"><dt>Valor final com tributos<\/dt><dd[^>]*>R\$\s262,90<\/dd>/);
  }
  assert.match(document.nodes.get("#marketStats").innerHTML, /Tributos estimados/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /Valor final com tributos<\/dt><dd[^>]*>R\$\s131,45/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /Valor final com tributos<\/dt><dd[^>]*>R\$\s262,90/);
  assert.doesNotMatch(document.nodes.get("#marketStats").innerHTML, /tributos contidos/i);
  assert.match(document.nodes.get("#marketStats").innerHTML, /IBPT \/ Empresômetro/);
  assert.match(document.nodes.get("#marketTaxDetails").innerHTML, /Comparação tributária/);
  assert.match(document.nodes.get("#marketTaxDetails").innerHTML, /Menor preço/);
  assert.match(document.nodes.get("#marketTaxDetails").innerHTML, /Maior preço/);
  assert.match(document.nodes.get("#marketTaxDetails").innerHTML, /Carga tributária estimada/);
  assert.match(document.nodes.get("#marketTaxDetails").innerHTML, /Tributos estimados/);
  assert.match(document.nodes.get("#marketTaxDetails").innerHTML, /Valor final com tributos<\/dt><dd[^>]*>R\$\s131,45/);
  assert.match(document.nodes.get("#marketTaxDetails").innerHTML, /Valor final com tributos<\/dt><dd[^>]*>R\$\s262,90/);
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
    selectedItem: maximum,
    marketplace: "Google Shopping",
    taxContext: { ncm: "09012100", ncmConfirmed: true, productOrigin: "importado", countryOfOrigin: "China", destinationState: "RJ" },
    taxAvailability: { provider: "IBPT", configured: true, version: "26.2.A" },
    tax: {
      status: "success",
      mode: "selected",
      expanded: true,
      calculations: { selected: {
        marketPrice: 100,
        estimatedTaxes: 42.57,
        ncm: "09012100",
        productOrigin: "importado",
        source: "IBPT / Empresômetro",
        version: "26.2.A",
        validFrom: "20/08/2026",
        validTo: "30/09/2026",
        rates: { federal: 24.57, state: 18, municipal: 0, total: 42.57 },
      } },
    },
  }, new ConfiguredTaxRuleEngine().assess(inputs));

  assert.match(document.nodes.get("#marketStats").innerHTML, /Baseado no produto selecionado/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /Preço de venda/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /Tributos estimados/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /Valor final com tributos/);
  assert.match(document.nodes.get("#marketStats").innerHTML, /R\$\s142,57/);
  assert.doesNotMatch(document.nodes.get("#marketStats").innerHTML, /R\$\s185,14/);
  const details = document.nodes.get("#marketTaxDetails").innerHTML;
  assert.match(details, /Valor final com tributos/);
  assert.match(details, /R\$\s142,57/);
  assert.match(details, /Origem do produto<\/dt><dd>Importado \(Fora do País\)/);
  assert.match(details, /País de origem<\/dt><dd>China/);
  assert.match(details, /UF de destino<\/dt><dd>RJ/);
  assert.match(details, /Fonte<\/dt><dd>IBPT \/ Empresômetro/);
  assert.match(details, /NCM 09012100 · Origem: Importado \(Fora do País\) · País: China · UF destino: RJ/);
});

test("total destacado soma centavos uma vez e mantém o preço quando os tributos são zero", () => {
  const item = { id: "produto", title: "Produto", price: 11_699.1, source: "Loja", seller: "Loja", currency: "BRL", url: "https://example.com/produto" };
  for (const [estimatedTaxes, formattedTaxes, finalPrice] of [[4_763.87, "4.763,87", "16.462,97"], [0, "0,00", "11.699,10"]]) {
    const document = documentStub();
    renderDashboard(document, calculatePricing(inputs, null), {
      status: "success", query: "Produto", items: [item],
      stats: { count: 1, average: item.price, median: item.price, min: item.price, max: item.price },
      selectedItem: item, marketplace: "Google Shopping",
      taxContext: { ncm: "09012100", ncmConfirmed: true, productOrigin: "nacional", originState: "SP", destinationState: "RJ" },
      taxAvailability: { provider: "IBPT", configured: true, version: "26.2.A" },
      tax: { status: "success", mode: "selected", expanded: false, calculations: { selected: {
        marketPrice: item.price, estimatedTaxes, ncm: "09012100", productOrigin: "nacional",
        source: "IBPT / Empresômetro", version: "26.2.A",
        rates: { federal: 0, state: 0, municipal: 0, total: 0 },
      } } },
    }, new ConfiguredTaxRuleEngine().assess(inputs));
    const summary = document.nodes.get("#marketStats").innerHTML;
    assert.match(summary, /Preço de venda<\/span><strong[^>]*>R\$\s11\.699,10/);
    assert.match(summary, new RegExp(`Tributos estimados<\\/span><strong[^>]*>R\\$\\s${formattedTaxes.replaceAll(".", "\\.")}`));
    assert.match(summary, new RegExp(`Valor final com tributos<\\/span><strong[^>]*>R\\$\\s${finalPrice.replaceAll(".", "\\.")}`));
    assert.match(summary, /market-tax-summary-metric is-total/);
    assert.equal((summary.match(/Valor final com tributos/g) || []).length, 1);
  }
});
