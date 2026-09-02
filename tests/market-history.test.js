import assert from "node:assert/strict";
import test from "node:test";

import { productForClient } from "../lib/models.js";
import { renderProductDetails, renderProductsList } from "../js/ui/history.js";

const product = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Produto próprio",
  description: "Descrição",
  category: "Eletrônicos",
  costPrice: 20,
  additionalCosts: 5,
  profitMargin: 18,
  suggestedPrice: 80,
  marketplace: "Google Shopping",
  consultationDate: "2026-09-01T12:00:00.000Z",
  createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
  calculationData: {
    market: {
      source: "market-product",
      selectedProduct: { id: "B001", title: "Produto Google Shopping", price: 100, source: "Loja Exemplo" },
      marketPrice: 100,
    },
  },
};

test("histórico mostra preço próprio, mercado na data, diferença e fonte sem refazer consulta", () => {
  const list = { innerHTML: "" };
  const details = { innerHTML: "" };

  renderProductsList(list, [product]);
  renderProductDetails(details, product);

  for (const html of [list.innerHTML, details.innerHTML]) {
    assert.match(html, /R\$\s*80,00/);
    assert.match(html, /R\$\s*100,00/);
    assert.match(html, /20% abaixo/);
    assert.match(html, /Google Shopping|Loja Exemplo/);
  }
});

test("modelo preserva consulta market-product e neutraliza fonte antiga não reconhecida", () => {
  const row = {
    id: product.id,
    name: product.name,
    description: product.description,
    category: product.category,
    cost_price: "20",
    additional_costs: "5",
    profit_margin: "18",
    suggested_price: "80",
    marketplace: "Google Shopping",
    consultation_date: product.consultationDate,
    created_at: product.createdAt,
    updated_at: product.updatedAt,
    calculation_data: product.calculationData,
  };

  assert.equal(productForClient(row).calculationData.market.source, "market-product");
  const legacy = { ...row, calculation_data: { market: { source: "provedor-desativado" } } };
  assert.equal(productForClient(legacy).calculationData.market.source, "manual");
  assert.doesNotThrow(() => renderProductsList({ innerHTML: "" }, [{ ...product, calculationData: {} }]));
});
