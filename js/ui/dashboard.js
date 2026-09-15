import { currency, escapeHtml, financialValueSize, percent, setFinancialValue } from "../utils/formatters.js";
import { renderPriceDetails, renderPriceDetailsUnavailable } from "./detail-pages.js";
import { marketTaxPrerequisiteError } from "../services/tax-service.js";

function dashboardMoney(value) { return value === null || value === undefined ? "—" : currency.format(value); }
function taxPercent(value) { return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`; }

function marketLabel(market) {
  if (!market?.price) return "Sem referência de mercado";
  if (market.rule === "selected-product") return "Produto individual selecionado";
  if (market.rule === "market-average") return "Média da pesquisa Google Shopping";
  if (market.rule === "market-median") return "Mediana da pesquisa Google Shopping";
  return "Média informada manualmente";
}

function renderExplanation(document, result) {
  const explanations = [
    `Insumos: ${dashboardMoney(result.inputs.materialCost)}; perdas e desperdício: ${dashboardMoney(result.wasteCost)} (${percent(result.inputs.wasteRate)}).`,
    `Frete da empresa por unidade: ${dashboardMoney(result.freightCostPerUnit)}; mão de obra direta: ${dashboardMoney(result.directLaborCost)}; taxa fixa por unidade: ${dashboardMoney(result.fixedSaleFeePerUnit)}.`,
    `Custo direto: ${dashboardMoney(result.directCost)}; custos mensais rateados: ${dashboardMoney(result.indirectCost)} pelo método ${result.inputs.allocationMethod}.`,
    `Ciclo financeiro: ${result.financedDays.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} dia(s); base financiada: ${dashboardMoney(result.financedBase)}; taxa do período: ${percent(result.periodCapitalRate)}; custo financeiro: ${dashboardMoney(result.financialCost)}.`,
    `Preço de equilíbrio: ${dashboardMoney(result.breakEvenPrice)}. Despesas percentuais: ${percent(result.saleExpenseRate)}; margem desejada: ${percent(result.desiredNetMargin)}; preço recomendado: ${dashboardMoney(result.technicalPrice)}. Fórmula: custo completo ÷ (1 − despesas − margem).`,
  ];
  if (result.minimumMarginPrice !== null) explanations.push(`Margem mínima: ${percent(result.minimumMargin)}; preço mínimo comercial: ${dashboardMoney(result.minimumMarginPrice)}. Este valor não é o preço de equilíbrio.`);
  if (result.market.price) explanations.push(`${marketLabel(result.market)}: ${dashboardMoney(result.market.price)}; diferença para o preço recomendado: ${dashboardMoney(result.market.difference)} (${percent(result.market.differenceRate)}). Essa referência não alterou o cálculo.`);
  if (result.discount.type !== "none") explanations.push(`Estratégia de desconto ${result.discount.type === "percentage" ? "percentual" : "fixo"}: preço anunciado ${dashboardMoney(result.discount.advertisedPrice)}, desconto ${dashboardMoney(result.discount.discountAmount)} e preço após desconto ${dashboardMoney(result.discount.postDiscountPrice)}.`);
  document.querySelector("#explanationList").innerHTML = explanations.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderCostTable(document, result) {
  document.querySelector("#costRows").innerHTML = result.breakdown.map((item) => `
    <tr><td><small>${escapeHtml(item.group)}</small><br>${escapeHtml(item.label)}</td><td>${dashboardMoney(item.value)}</td><td>${escapeHtml(item.basis)}</td><td>${escapeHtml(item.fiscalSource || item.source)}</td></tr>`).join("");
}

function renderAlerts(document, result, assessment) {
  const alerts = [];
  if (result.financedDays > 0) alerts.push(["warning", `O ciclo financeiro acrescenta ${dashboardMoney(result.financialCost)} por unidade.`]);
  if (result.inputs.capitalRateSource === "estimated") alerts.push(["warning", "O custo mensal do capital foi informado como estimativa. Revise-o quando tiver um valor validado."]);
  if (result.inputs.capitalRateSource === "zero") alerts.push(["warning", "O custo mensal do capital está em 0% porque você informou que não sabe o percentual."]);
  if (result.market.price && result.market.difference < 0) alerts.push(["risk", `O preço recomendado está ${dashboardMoney(Math.abs(result.market.difference))} acima da referência de mercado. A referência não altera o cálculo.`]);
  if (assessment.focusUnavailable) alerts.push(["warning", "A Focus NFe está indisponível; a carga tributária continua manual e não foi alterada."]);
  alerts.push(["warning", "O percentual efetivo de impostos foi informado manualmente. A Focus NFe valida NCM, mas não calcula essa alíquota."]);
  document.querySelector("#alerts").innerHTML = alerts.map(([type, text]) => `<div class="${type}">${escapeHtml(text)}</div>`).join("");
  document.querySelector("#alertCount").textContent = `${alerts.length} ${alerts.length === 1 ? "ponto de atenção" : "pontos de atenção"}`;
  document.querySelector("#alertSummary").textContent = alerts[0][1];
  return alerts.length;
}

function renderFiscalSummary(document, assessment) {
  const ncm = assessment.ncm?.codigo || "não informado";
  const status = assessment.ncmValidation.status === "success" ? `validado pela Focus NFe em ${assessment.ncmValidation.environment}` : "não validado nesta simulação";
  document.querySelector("#fiscalSummary").innerHTML = `<p><strong>NCM:</strong> ${escapeHtml(ncm)} (${escapeHtml(status)})</p><p><strong>Percentual efetivo usado:</strong> informado manualmente, sem alteração silenciosa. A Focus NFe não calculou qualquer alíquota.</p><p><strong>Tributos ainda dependentes de regra externa:</strong> ${escapeHtml(assessment.unresolvedTaxes.join(", "))}.</p>`;
}

function maximumMarketItemForDisplay(marketState) {
  return marketState.items.reduce((current, item) => {
    if (!Number.isFinite(item.price)) return current;
    return !current || item.price > current.price ? item : current;
  }, null);
}

function minimumMarketItemForDisplay(marketState) {
  return marketState.items.reduce((current, item) => {
    if (!Number.isFinite(item.price)) return current;
    return !current || item.price < current.price ? item : current;
  }, null);
}

function marketTaxDisplayMode(marketState) {
  return marketState.selectedItem ? "selected" : "extremes";
}

function marketTaxBasePrice(marketState) {
  return marketState.selectedItem?.price ?? maximumMarketItemForDisplay(marketState)?.price ?? marketState.stats?.max;
}

function marketTaxModeHeading(mode) {
  const selected = mode === "selected";
  return `<div class="market-tax-mode-heading"><div><span>Estimativa tributária</span><strong>${selected ? "Baseado no produto selecionado" : "Baseado nos extremos da pesquisa"}</strong></div><span class="market-tax-mode-badge">${selected ? "Produto selecionado" : "Menor e maior valor"}</span></div>`;
}

function taxMoneyMetric(label, value, total = false) {
  const formatted = dashboardMoney(value);
  return `<div class="market-tax-summary-metric${total ? " is-total" : ""}"><span>${label}</span><strong class="financial-value" data-financial-size="${financialValueSize(formatted)}">${formatted}</strong></div>`;
}

function selectedTaxSummary(marketState, calculation) {
  return `<p class="market-tax-selected-title"><span>Produto selecionado</span><strong>${escapeHtml(marketState.selectedItem?.title || "Produto atual")}</strong></p><div class="market-tax-summary-grid">${taxMoneyMetric("Preço base", calculation.marketPrice)}<div class="market-tax-summary-metric"><span>Carga tributária</span><strong>${taxPercent(calculation.rates.total)}</strong></div>${taxMoneyMetric("Tributos estimados", calculation.estimatedTaxes)}${taxMoneyMetric("Total com tributos", calculation.total, true)}</div>`;
}

function extremeTaxScenario(label, item, calculation) {
  const base = dashboardMoney(calculation.marketPrice);
  const taxes = dashboardMoney(calculation.estimatedTaxes);
  const total = dashboardMoney(calculation.total);
  return `<article class="market-tax-scenario-card"><div><span>${label}</span><strong>${escapeHtml(item?.title || "Referência da pesquisa")}</strong></div><dl><div><dt>Preço base</dt><dd class="financial-value" data-financial-size="${financialValueSize(base)}">${base}</dd></div><div><dt>Tributos estimados</dt><dd class="financial-value" data-financial-size="${financialValueSize(taxes)}">${taxes}</dd></div><div class="is-total"><dt>Total com tributos</dt><dd class="financial-value" data-financial-size="${financialValueSize(total)}">${total}</dd></div></dl></article>`;
}

function taxAction(label, attribute, secondary = false) {
  return `<button type="button" class="market-tax-action${secondary ? " secondary" : ""}" ${attribute}>${label}</button>`;
}

function renderMarketTaxStat(marketState) {
  const mode = marketTaxDisplayMode(marketState);
  const minimumItem = minimumMarketItemForDisplay(marketState);
  const maximumItem = maximumMarketItemForDisplay(marketState);
  const basePrice = marketTaxBasePrice(marketState);
  const tax = marketState.tax || { status: "idle" };
  const context = marketState.taxContext || {};
  const taxAvailability = marketState.taxAvailability;
  const marketDetails = mode === "selected"
    ? [`Produto selecionado: ${marketState.selectedItem?.title || "não informado"}`, `Preço base: ${dashboardMoney(basePrice)}`]
    : [`Menor preço: ${dashboardMoney(minimumItem?.price ?? marketState.stats?.min)}`, `Maior preço: ${dashboardMoney(maximumItem?.price ?? marketState.stats?.max)}`];
  const heading = marketTaxModeHeading(mode);

  const prerequisiteError = marketTaxPrerequisiteError(context, basePrice, taxAvailability);
  if (prerequisiteError) {
    const needsNcm = prerequisiteError.code === "NCM_REQUIRED";
    return `<div class="market-tax-stat is-error" title="${escapeHtml(`${marketDetails.join(" · ")} · ${prerequisiteError.message}`)}">${heading}<p class="market-tax-state-message"><strong>Estimativa indisponível</strong><small>${escapeHtml(prerequisiteError.shortMessage)}</small></p>${needsNcm ? taxAction("Classificar produto", "data-confirm-market-ncm", true) : ""}</div>`;
  }
  if (tax.status === "loading") {
    return `<div class="market-tax-stat is-loading">${heading}<p class="market-tax-state-message"><strong>Calculando estimativa...</strong><small>${mode === "selected" ? "Aplicando as alíquotas ao produto selecionado." : "Calculando os cenários de menor e maior valor."}</small></p></div>`;
  }
  if (tax.status === "success") {
    const calculations = tax.calculations || {};
    const primary = calculations.selected || calculations.maximum || calculations.minimum || tax.result;
    const content = mode === "selected" && calculations.selected
      ? selectedTaxSummary(marketState, calculations.selected)
      : calculations.minimum && calculations.maximum
        ? `<div class="market-tax-extremes-summary"><div class="market-tax-shared-rate"><span>Carga tributária aplicada aos dois cenários</span><strong>${taxPercent(calculations.maximum.rates.total)}</strong></div><div class="market-tax-scenarios">${extremeTaxScenario("Menor preço + tributos", minimumItem, calculations.minimum)}${extremeTaxScenario("Maior preço + tributos", maximumItem, calculations.maximum)}</div></div>`
        : primary ? selectedTaxSummary(marketState, primary) : "";
    return `<div class="market-tax-stat is-success">${heading}${content}<small class="market-tax-source">Fonte: ${escapeHtml(primary.source)} · Versão: ${escapeHtml(primary.version)}</small>${taxAction(tax.expanded ? "Ocultar detalhes" : "Ver detalhes", "data-toggle-market-taxes")}</div>`;
  }
  if (tax.status === "error") {
    const tableUnavailable = ["IBPT_NOT_CONFIGURED", "IBPT_INVALID_FILE"].includes(tax.code);
    return `<div class="market-tax-stat is-error">${heading}<p class="market-tax-state-message"><strong>Não foi possível estimar</strong><small>${escapeHtml(tax.shortMessage || "Tente novamente em instantes.")}</small></p>${tableUnavailable ? "" : taxAction("Tentar novamente", "data-calculate-market-taxes", true)}</div>`;
  }
  return `<div class="market-tax-stat">${heading}<p class="market-tax-state-message"><strong>Estimativa pronta para calcular</strong><small>${mode === "selected" ? "O produto selecionado será usado como preço base." : "O menor e o maior preço serão comparados."}</small></p>${taxAction("Calcular estimativa", "data-calculate-market-taxes")}</div>`;
}

function taxOriginDetails(context, result) {
  const isNational = result.productOrigin === "nacional";
  const origin = isNational ? "Nacional" : "Importado (Fora do País)";
  const originLabel = isNational ? "UF de origem" : "País de origem";
  const originValue = isNational ? context.originState : context.countryOfOrigin;
  const destinationState = context.destinationState || "Não informada";
  const originSummary = isNational ? `UF origem: ${context.originState || "Não informada"}` : `País: ${context.countryOfOrigin || "Não informado"}`;
  return {
    markup: `<div class="market-tax-origin-section"><h4>Origem da mercadoria</h4><dl class="market-tax-origin-details"><div><dt>Origem do produto</dt><dd>${escapeHtml(origin)}</dd></div><div><dt>${originLabel}</dt><dd>${escapeHtml(originValue || "Não informada")}</dd></div><div><dt>UF de destino</dt><dd>${escapeHtml(destinationState)}</dd></div><div><dt>Fonte</dt><dd>${escapeHtml(result.source)}</dd></div></dl></div>`,
    summary: `NCM ${escapeHtml(result.ncm)} · Origem: ${escapeHtml(origin)} · ${escapeHtml(originSummary)} · UF destino: ${escapeHtml(destinationState)} · Versão: ${escapeHtml(result.version)} · Vigência: ${escapeHtml(result.validFrom)} a ${escapeHtml(result.validTo)}`,
  };
}

function taxRateDetails(result) {
  return `<dl class="market-tax-rate-details"><div><dt>Alíquota federal</dt><dd>${taxPercent(result.rates.federal)}</dd></div><div><dt>Alíquota estadual</dt><dd>${taxPercent(result.rates.state)}</dd></div><div><dt>Alíquota municipal</dt><dd>${taxPercent(result.rates.municipal)}</dd></div><div><dt>Carga tributária estimada</dt><dd>${taxPercent(result.rates.total)}</dd></div></dl>`;
}

function renderTaxDetails(marketState) {
  const context = marketState.taxContext || {};
  const prerequisiteError = marketTaxPrerequisiteError(context, marketTaxBasePrice(marketState), marketState.taxAvailability);
  if (prerequisiteError) return `<div class="market-tax-notice is-error" role="alert"><strong>${escapeHtml(prerequisiteError.message)}</strong></div>`;
  const tax = marketState.tax || { status: "idle" };
  if (tax.status === "ncm-error" || tax.status === "error") {
    return `<div class="market-tax-notice is-error" role="alert"><strong>${escapeHtml(tax.message || "Não foi possível concluir a estimativa tributária.")}</strong></div>`;
  }
  if (tax.status !== "success" || !tax.expanded) return "";
  const calculations = tax.calculations || {};
  const mode = marketTaxDisplayMode(marketState);
  const primary = calculations.selected || calculations.maximum || calculations.minimum || tax.result;
  const origin = taxOriginDetails(context, primary);
  if (mode === "selected" && calculations.selected) {
    const result = calculations.selected;
    const selectedTitle = escapeHtml(marketState.selectedItem?.title || "Produto atual");
    return `<section class="market-tax-breakdown" aria-labelledby="market-tax-breakdown-title"><div><p class="eyebrow">Baseado no produto selecionado</p><h3 id="market-tax-breakdown-title">${selectedTitle}</h3></div><div class="market-tax-detail-selected">${taxMoneyMetric("Preço base", result.marketPrice)}${taxMoneyMetric("Tributos estimados", result.estimatedTaxes)}${taxMoneyMetric("Total com tributos", result.total, true)}</div>${taxRateDetails(result)}${origin.markup}<p>${origin.summary}</p></section>`;
  }
  const minimum = calculations.minimum;
  const maximum = calculations.maximum;
  return `<section class="market-tax-breakdown" aria-labelledby="market-tax-breakdown-title"><div><p class="eyebrow">Baseado nos extremos da pesquisa</p><h3 id="market-tax-breakdown-title">Comparação tributária: menor e maior valor</h3></div>${taxRateDetails(primary)}<div class="market-tax-detail-scenarios">${extremeTaxScenario("Menor preço + tributos", minimumMarketItemForDisplay(marketState), minimum)}${extremeTaxScenario("Maior preço + tributos", maximumMarketItemForDisplay(marketState), maximum)}</div>${origin.markup}<p>${origin.summary}</p></section>`;
}

function renderMarketPanel(document, marketState) {
  const panel = document.querySelector("#marketPanel");
  const stats = document.querySelector("#marketStats");
  const results = document.querySelector("#marketResults");
  const sidebarStatus = document.querySelector("#marketSearchStatus");
  const dashboardStatus = document.querySelector("#marketDashboardStatus");
  const taxDetails = document.querySelector("#marketTaxDetails");
  const selected = document.querySelector("#selectedMarketProduct");
  const searchButton = document.querySelector("#marketSearchButton");
  panel.hidden = marketState.status === "idle";
  searchButton.disabled = marketState.status === "loading";
  searchButton.textContent = marketState.status === "loading" ? "Buscando produtos..." : "Pesquisar produto";
  selected.hidden = !marketState.selectedItem;
  const selectedItem = marketState.selectedItem;
  const selectedRating = Number.isFinite(selectedItem?.rating)
    ? ` · Nota ${selectedItem.rating.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${Number.isInteger(selectedItem.reviews) ? ` (${selectedItem.reviews.toLocaleString("pt-BR")} avaliações)` : ""}`
    : "";
  selected.innerHTML = selectedItem ? `<p class="eyebrow">Produto individual selecionado</p><h3>${escapeHtml(selectedItem.title)}</h3><strong class="financial-value" data-financial-size="${financialValueSize(dashboardMoney(selectedItem.price))}">${dashboardMoney(selectedItem.price)}</strong><small>Loja: ${escapeHtml(selectedItem.seller || selectedItem.source)}${escapeHtml(selectedRating)}</small><small>Google Shopping · consulta de ${escapeHtml(selectedItem.consultedAt ? new Date(selectedItem.consultedAt).toLocaleString("pt-BR") : "agora")}</small><button type="button" class="secondary-button" data-change-market-reference>Remover seleção</button>` : "";
  taxDetails.innerHTML = "";
  if (marketState.status === "loading") {
    sidebarStatus.textContent = "Buscando produtos no mercado…";
    dashboardStatus.textContent = "Buscando produtos no mercado…";
    stats.innerHTML = "";
    results.innerHTML = '<div class="market-loading market-state-wide"><span aria-hidden="true"></span><p>Buscando produtos no mercado...</p></div>';
    return;
  }
  if (marketState.status === "error") {
    sidebarStatus.textContent = "Não foi possível consultar o mercado. A alternativa manual continua disponível.";
    dashboardStatus.textContent = "";
    stats.innerHTML = "";
    results.innerHTML = `<div class="market-error-alert market-state-wide" role="alert"><span class="market-error-icon" aria-hidden="true">!</span><div><strong>Não foi possível consultar o mercado agora.</strong><p>${escapeHtml(marketState.error)}</p></div><button type="button" class="secondary-button" data-market-retry>Tentar novamente</button></div>`;
    return;
  }
  if (marketState.status === "empty") {
    sidebarStatus.textContent = "Nenhum produto compatível foi encontrado.";
    dashboardStatus.textContent = "";
    stats.innerHTML = "";
    results.innerHTML = '<div class="market-empty-state market-state-wide"><strong>Nenhum produto compatível foi encontrado.</strong><p>Experimente pesquisar usando nome, marca e modelo.</p></div>';
    return;
  }
  if (!marketState.stats) {
    sidebarStatus.textContent = "A pesquisa de mercado é opcional.";
    dashboardStatus.textContent = "";
    stats.innerHTML = "";
    results.innerHTML = "";
    return;
  }
  const resultCount = marketState.items.length;
  sidebarStatus.textContent = `${resultCount} ${resultCount === 1 ? "produto encontrado" : "produtos encontrados"}.`;
  dashboardStatus.textContent = `${resultCount} ${resultCount === 1 ? "referência encontrada" : "referências encontradas"} para “${marketState.query}”.`;
  const standardStats = [
    ["Média", marketState.stats.average],
    ["Mediana", marketState.stats.median],
    ["Menor", marketState.stats.min],
    ["Maior", marketState.stats.max],
  ].map(([label, value]) => `<div><span>${label}</span><strong class="financial-value" data-financial-size="${financialValueSize(dashboardMoney(value))}">${dashboardMoney(value)}</strong></div>`).join("");
  stats.innerHTML = `${standardStats}${renderMarketTaxStat(marketState)}`;
  taxDetails.innerHTML = renderTaxDetails(marketState);
  results.innerHTML = marketState.items.map((item) => {
    const isSelected = marketState.selectedItem?.id === item.id;
    const rating = Number.isFinite(item.rating)
      ? `<span class="market-rating" aria-label="Nota ${escapeHtml(item.rating)} de 5">★ ${escapeHtml(item.rating.toLocaleString("pt-BR", { maximumFractionDigits: 1 }))}${Number.isInteger(item.reviews) ? ` <small>(${escapeHtml(item.reviews.toLocaleString("pt-BR"))})</small>` : ""}</span>`
      : "";
    const image = item.image
      ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
      : '<div class="market-image-placeholder" aria-hidden="true">Sem imagem</div>';
    const selection = isSelected
      ? '<span class="market-selected-badge">✓ Referência selecionada</span>'
      : "";
    const action = isSelected
      ? '<button type="button" disabled aria-current="true">Referência selecionada</button>'
      : `<button type="button" data-market-select="${escapeHtml(item.id)}">Usar como referência</button>`;
    return `<article class="market-result${isSelected ? " selected" : ""}">${image}${selection}<div class="market-result-content"><h4>${escapeHtml(item.title)}</h4><div class="market-result-price"><strong class="financial-value" data-financial-size="${financialValueSize(dashboardMoney(item.price))}">${dashboardMoney(item.price)}</strong>${rating}</div><p>Loja: ${escapeHtml(item.seller || item.source)}</p></div><div class="market-actions">${action}<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Ver no Google Shopping</a></div></article>`;
  }).join("");
}

export function renderIncompleteDashboard(document, marketState, errors) {
  const count = Object.keys(errors).length;
  ["baseCost", "marketReferencePrice", "suggestedPrice", "profitPerSale", "estimatedMargin", "breakEvenPrice", "minimumMarginPrice", "desiredMarginPrice", "advertisedPrice", "postDiscountPrice", "detailSuggestedPrice", "detailBreakEvenPrice", "detailMinimumMarginPrice", "detailDesiredMarginPrice", "detailAdvertisedPrice", "detailPostDiscountPrice", "detailBaseCost", "detailSalesRate", "detailProfit", "detailMargin"].forEach((id) => { const node = document.querySelector(`#${id}`); if (node) node.textContent = "—"; });
  ["minimumMarginPriceRow", "advertisedPriceRow", "postDiscountPriceRow", "detailMinimumMarginCard", "detailAdvertisedPriceCard", "detailPostDiscountPriceCard"].forEach((id) => { const node = document.querySelector(`#${id}`); if (node) node.hidden = true; });
  document.querySelector("#priceStatus").textContent = "Aguardando dados válidos";
  document.querySelector("#recommendationText").textContent = "Corrija os campos indicados para calcular e salvar.";
  document.querySelector("#marketStatus").textContent = "Mercado é opcional e será comparado quando houver referência válida.";
  document.querySelector("#alertCount").textContent = `${count} ${count === 1 ? "campo pendente" : "campos pendentes"}`;
  document.querySelector("#alertSummary").textContent = "O cálculo e o salvamento estão bloqueados.";
  document.querySelector("#explanationList").innerHTML = "<li>Preencha os campos obrigatórios sem corrigir valores silenciosamente.</li>";
  document.querySelector("#costRows").innerHTML = '<tr><td colspan="4">O detalhamento usa o resultado canônico após a validação.</td></tr>';
  document.querySelector("#alerts").innerHTML = "<div class=\"warning\">Corrija os campos indicados.</div>";
  document.querySelector("#fiscalSummary").innerHTML = "<p>O contexto fiscal será preservado sem inventar alíquotas.</p>";
  document.querySelector("#primaryMarketValue").hidden = true;
  document.querySelector("#primaryPriceCard").classList.toggle("has-market-reference", false);
  renderMarketPanel(document, marketState);
  renderPriceDetailsUnavailable(document, count);
}

export function renderDashboard(document, result, marketState, fiscalAssessment) {
  const market = result.market;
  setFinancialValue(document.querySelector("#baseCost"), dashboardMoney(result.totalUnitCost));
  setFinancialValue(document.querySelector("#marketReferencePrice"), dashboardMoney(market.price));
  document.querySelector("#marketTitle").textContent = marketLabel(market);
  const selectedReference = market.reference?.selectedProduct;
  document.querySelector("#marketReferenceDetails").textContent = market.price
    ? selectedReference
      ? `${selectedReference.title} · Loja: ${selectedReference.seller || selectedReference.source} · Fonte: Google Shopping · ${selectedReference.consultedAt ? new Date(selectedReference.consultedAt).toLocaleDateString("pt-BR") : "consulta atual"}`
      : `Fonte: ${market.source || "não informada"}`
    : "Referência opcional não informada";
  document.querySelector("#marketPriceLabel").textContent = marketLabel(market);
  setFinancialValue(document.querySelector("#suggestedPrice"), dashboardMoney(result.technicalPrice));
  setFinancialValue(document.querySelector("#breakEvenPrice"), dashboardMoney(result.breakEvenPrice));
  setFinancialValue(document.querySelector("#desiredMarginPrice"), dashboardMoney(result.technicalPrice));
  const minimumRow = document.querySelector("#minimumMarginPriceRow");
  minimumRow.hidden = result.minimumMarginPrice === null;
  setFinancialValue(document.querySelector("#minimumMarginPrice"), dashboardMoney(result.minimumMarginPrice));
  const hasDiscount = result.discount.type !== "none";
  document.querySelector("#advertisedPriceRow").hidden = !hasDiscount;
  document.querySelector("#postDiscountPriceRow").hidden = !hasDiscount;
  setFinancialValue(document.querySelector("#advertisedPrice"), dashboardMoney(result.discount.advertisedPrice));
  setFinancialValue(document.querySelector("#postDiscountPrice"), dashboardMoney(result.discount.postDiscountPrice));
  setFinancialValue(document.querySelector("#profitPerSale"), dashboardMoney(result.profitAmount));
  document.querySelector("#estimatedMargin").textContent = percent(result.actualNetMargin);
  const primaryMarketValue = document.querySelector("#primaryMarketValue");
  primaryMarketValue.hidden = !market.price;
  document.querySelector("#primaryPriceCard").classList.toggle("has-market-reference", Boolean(market.price));
  setFinancialValue(document.querySelector("#primaryMarketPrice"), dashboardMoney(market.price));
  document.querySelector("#primaryMarketSource").textContent = market.price
    ? selectedReference
      ? `${selectedReference.title} · Loja: ${selectedReference.seller || selectedReference.source} · Google Shopping`
      : `${marketLabel(market)} · ${market.source || "Google Shopping"}`
    : "Sem referência de mercado";
  document.querySelector("#priceStatus").textContent = "Preço recomendado";
  document.querySelector("#recommendationText").textContent = "Margem tratada como percentual do preço de venda. Mercado e desconto não entram como custo.";
  document.querySelector("#marketStatus").textContent = market.price ? `Diferença: ${dashboardMoney(market.difference)} (${percent(market.differenceRate)}).` : "Sem referência de mercado; o cálculo técnico não é bloqueado.";
  const meter = document.querySelector("#marketMeter");
  meter.value = market.price ? Math.min((result.technicalPrice / market.price) * 100, 100) : 0;
  const count = renderAlerts(document, result, fiscalAssessment);
  renderExplanation(document, result);
  renderCostTable(document, result);
  renderFiscalSummary(document, fiscalAssessment);
  renderMarketPanel(document, marketState);
  renderPriceDetails(document, result, count);
}
