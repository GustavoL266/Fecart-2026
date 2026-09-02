import { currency, escapeHtml } from "../utils/formatters.js";

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function detail(label, value, extraClass = "") {
  return `<div class="${extraClass}"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function savedMarket(product) {
  const canonical = product.calculationData?.pricingResult?.market;
  if (canonical?.price) {
    return {
      difference: `${Math.abs(canonical.differenceRate * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% ${canonical.difference <= 0 ? "abaixo" : "acima"}`,
      price: canonical.price,
      productTitle: canonical.reference?.selectedProduct?.title || canonical.reference?.query || canonical.rule,
      source: canonical.source || "não informada",
    };
  }
  const market = product.calculationData?.market;
  const price = Number(market?.selectedProduct?.price ?? market?.marketPrice ?? market?.stats?.median);
  if (!Number.isFinite(price) || price <= 0 || market?.source !== "market-product") return null;
  const relativeDifference = (product.suggestedPrice - price) / price;
  return {
    difference: `${Math.abs(relativeDifference * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% ${relativeDifference <= 0 ? "abaixo" : "acima"}`,
    price,
    productTitle: market.selectedProduct?.title || market.query || "Produto consultado",
    source: market.selectedProduct?.source || product.marketplace || "Marketplace",
  };
}

export function renderProductsList(container, products) {
  if (products.length === 0) {
    container.innerHTML = '<div class="empty-history">Nenhum produto encontrado. Salve uma precificação no assistente para montar seu histórico.</div>';
    return;
  }

  container.innerHTML = products
    .map((product) => {
      const market = savedMarket(product);
      return `
        <article class="product-card">
          <div>
            <p class="eyebrow">${escapeHtml(product.category)}</p>
            <h3>${escapeHtml(product.name)}</h3>
            <div class="product-meta">
              <span>Custo: <strong>${currency.format(product.costPrice)}</strong></span>
              <span>Margem: <strong>${Number(product.profitMargin).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</strong></span>
              <span>Preço sugerido: <strong>${currency.format(product.suggestedPrice)}</strong></span>
              ${market ? `<span>Mercado na data: <strong>${currency.format(market.price)}</strong></span><span>Diferença: <strong>${escapeHtml(market.difference)}</strong></span><span>Fonte: <strong>${market.source}</strong></span>` : ""}
              <span>Criado em: <strong>${escapeHtml(formatDate(product.consultationDate))}</strong></span>
            </div>
          </div>
          <div class="product-actions">
            <button type="button" class="secondary-button" data-product-action="view" data-product-id="${escapeHtml(product.id)}">Ver detalhes</button>
            <button type="button" class="secondary-button" data-product-action="reuse" data-product-id="${escapeHtml(product.id)}">Reutilizar</button>
            <button type="button" class="secondary-button" data-product-action="edit" data-product-id="${escapeHtml(product.id)}">Editar</button>
            <button type="button" class="danger-button" data-product-action="delete" data-product-id="${escapeHtml(product.id)}">Excluir</button>
          </div>
        </article>`;
    })
    .join("");
}

export function renderProductDetails(container, product) {
  const description = product.description || "Sem descrição informada.";
  const fiscal = product.calculationData?.fiscal;
  const canonical = product.calculationData?.pricingResult;
  const isLegacy = product.calculationData?.version === 5 || product.calculationData?.pricingSchemaVersion === 5;
  const market = savedMarket(product);
  const fiscalDetails = fiscal
    ? `
      ${detail("NCM", `${fiscal.ncm?.codigo || "Não informado"} (${fiscal.ncmSource || "origem desconhecida"})`)}
      ${detail("Status fiscal", fiscal.complete ? "Validado" : "Estimativa financeira pendente de validação fiscal")}
      ${detail("Tributos ainda dependentes de regra externa", (fiscal.unresolvedTaxes || []).join(", ") || "Não registrado")}`
    : detail("Status fiscal", "Consulta antiga: contexto fiscal não registrado");
  container.innerHTML = `
    <dl class="product-details">
      ${detail("Categoria", product.category)}
      ${detail("Plataforma", product.marketplace)}
      ${detail(canonical ? "Custo direto unitário" : "Preço de custo", currency.format(canonical?.directCost ?? product.costPrice))}
      ${detail(canonical ? "Custo indireto + financeiro" : "Custos adicionais", currency.format(canonical ? canonical.indirectCost + canonical.financialCost : product.additionalCosts))}
      ${detail("Margem desejada", `${Number(product.profitMargin).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`)}
      ${detail(canonical ? "Preço técnico recomendado" : "Preço sugerido", currency.format(product.suggestedPrice))}
      ${canonical ? `${detail("Custo total unitário", currency.format(canonical.totalUnitCost))}${detail("Margem efetiva", `${(canonical.actualNetMargin * 100).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`)}` : ""}
      ${isLegacy ? detail("Memória", "Cálculo legado v5 preservado; não foi recalculado.") : ""}
      ${market ? `${detail("Produto de mercado", market.productTitle)}${detail("Mercado na data", currency.format(market.price))}${detail("Diferença", market.difference)}${detail("Fonte de mercado", market.source)}` : ""}
      ${detail("Data da consulta", formatDate(product.consultationDate))}
      ${detail("Última atualização", formatDate(product.updatedAt))}
      ${fiscalDetails}
      ${detail("Descrição", description, "product-description")}
    </dl>
    <div class="dialog-detail-actions">
      <button type="button" class="secondary-button" data-dialog-product-action="reuse">Reutilizar consulta</button>
      <button type="button" class="secondary-button" data-dialog-product-action="edit">Editar</button>
      <button type="button" class="danger-button" data-dialog-product-action="delete">Excluir</button>
    </div>`;
}
