import { currency, escapeHtml, percent } from "../utils/formatters.js";
import { renderPriceDetails, renderPriceDetailsUnavailable } from "./detail-pages.js";

function dashboardMoney(value) { return value === null || value === undefined ? "—" : currency.format(value); }

function marketLabel(market) {
  if (!market?.price) return "Sem referência de mercado";
  if (market.rule === "selected-product") return "Produto individual selecionado";
  if (market.rule === "market-average") return "Média da pesquisa Google Shopping";
  if (market.rule === "market-median") return "Mediana da pesquisa Google Shopping";
  return "Média informada manualmente";
}

function renderExplanation(document, result) {
  const explanations = [
    `Matéria-prima ajustada: ${dashboardMoney(result.adjustedMaterialCost)} (${percent(result.inputs.wasteRate)} de desperdício).`,
    `Custo direto: ${dashboardMoney(result.directCost)}; custo indireto: ${dashboardMoney(result.indirectCost)}, rateado por ${result.inputs.expectedMonthlyUnits.toLocaleString("pt-BR")} unidade(s)/mês.`,
    `Ciclo financeiro: ${result.financedDays.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} dia(s); base financiada: ${dashboardMoney(result.financedBase)}; taxa do período: ${percent(result.periodCapitalRate)}; custo financeiro: ${dashboardMoney(result.financialCost)}.`,
    `Despesas percentuais: ${percent(result.saleExpenseRate)}; margem desejada: ${percent(result.desiredNetMargin)}; preço bruto: ${dashboardMoney(result.technicalPriceRaw)}; preço técnico arredondado para cima: ${dashboardMoney(result.technicalPrice)}.`,
  ];
  if (result.market.price) explanations.push(`${marketLabel(result.market)}: ${dashboardMoney(result.market.price)}; diferença para o preço técnico: ${dashboardMoney(result.market.difference)} (${percent(result.market.differenceRate)}).`);
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
  if (result.inputs.productionCapacity && result.inputs.productionCapacity.monthlyCapacity < result.inputs.expectedMonthlyUnits) alerts.push(["warning", "A capacidade produtiva informada é menor que a quantidade mensal usada no rateio. O preço não foi alterado por isso."]);
  if (result.market.price && result.market.difference < 0) alerts.push(["risk", `O preço técnico está ${dashboardMoney(Math.abs(result.market.difference))} acima da referência de mercado. A referência não altera o preço técnico.`]);
  if (assessment.focusUnavailable) alerts.push(["warning", "A Focus NFe está indisponível; a carga tributária continua manual e não foi alterada."]);
  alerts.push(["warning", "A carga tributária é estimada manualmente. A Focus NFe valida NCM, mas não calcula alíquotas."]);
  document.querySelector("#alerts").innerHTML = alerts.map(([type, text]) => `<div class="${type}">${escapeHtml(text)}</div>`).join("");
  document.querySelector("#alertCount").textContent = `${alerts.length} ${alerts.length === 1 ? "ponto de atenção" : "pontos de atenção"}`;
  document.querySelector("#alertSummary").textContent = alerts[0][1];
  return alerts.length;
}

function renderFiscalSummary(document, assessment) {
  const ncm = assessment.ncm?.codigo || "não informado";
  const status = assessment.ncmValidation.status === "success" ? `validado pela Focus NFe em ${assessment.ncmValidation.environment}` : "não validado nesta simulação";
  document.querySelector("#fiscalSummary").innerHTML = `<p><strong>NCM:</strong> ${escapeHtml(ncm)} (${escapeHtml(status)})</p><p><strong>Carga usada:</strong> estimada manualmente; a Focus NFe não calculou qualquer alíquota.</p><p><strong>Tributos ainda dependentes de regra externa:</strong> ${escapeHtml(assessment.unresolvedTaxes.join(", "))}.</p>`;
}

function renderTaxedMaximumStat(marketState) {
  const maximumItem = marketState.items.reduce((current, item) => {
    if (!Number.isFinite(item.price)) return current;
    return !current || item.price > current.price ? item : current;
  }, null);
  const maximumPrice = maximumItem?.price ?? marketState.stats.max;
  const details = [
    maximumItem ? `Produto: ${maximumItem.title}` : null,
    `Preço de mercado: ${dashboardMoney(maximumPrice)}`,
    "Tributos: não disponíveis",
    "Total: não disponível",
    "Fonte de mercado: Google Shopping",
    "Fonte fiscal: nenhum TaxProvider de cálculo configurado",
  ].filter(Boolean).join(" · ");

  return `<div class="market-tax-stat" title="${escapeHtml(details)}" aria-label="${escapeHtml(details)}" tabindex="0"><span>Maior + tributos</span><strong>—</strong><small>Tributação pendente</small></div>`;
}

function renderMarketPanel(document, marketState) {
  const panel = document.querySelector("#marketPanel");
  const stats = document.querySelector("#marketStats");
  const results = document.querySelector("#marketResults");
  const sidebarStatus = document.querySelector("#marketSearchStatus");
  const dashboardStatus = document.querySelector("#marketDashboardStatus");
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
  selected.innerHTML = selectedItem ? `<p class="eyebrow">Produto individual selecionado</p><h3>${escapeHtml(selectedItem.title)}</h3><strong>${dashboardMoney(selectedItem.price)}</strong><small>Loja: ${escapeHtml(selectedItem.seller || selectedItem.source)}${escapeHtml(selectedRating)}</small><small>Google Shopping · consulta de ${escapeHtml(selectedItem.consultedAt ? new Date(selectedItem.consultedAt).toLocaleString("pt-BR") : "agora")}</small><button type="button" class="secondary-button" data-change-market-reference>Remover seleção</button>` : "";
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
  ].map(([label, value]) => `<div><span>${label}</span><strong>${dashboardMoney(value)}</strong></div>`).join("");
  stats.innerHTML = `${standardStats}${renderTaxedMaximumStat(marketState)}`;
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
    return `<article class="market-result${isSelected ? " selected" : ""}">${image}${selection}<div class="market-result-content"><h4>${escapeHtml(item.title)}</h4><div class="market-result-price"><strong>${dashboardMoney(item.price)}</strong>${rating}</div><p>Loja: ${escapeHtml(item.seller || item.source)}</p></div><div class="market-actions">${action}<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Ver no Google Shopping</a></div></article>`;
  }).join("");
}

export function renderIncompleteDashboard(document, marketState, errors) {
  const count = Object.keys(errors).length;
  ["baseCost", "marketReferencePrice", "suggestedPrice", "profitPerSale", "estimatedMargin", "detailSuggestedPrice", "detailBaseCost", "detailSalesRate", "detailProfit", "detailMargin"].forEach((id) => { const node = document.querySelector(`#${id}`); if (node) node.textContent = "—"; });
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
  renderMarketPanel(document, marketState);
  renderPriceDetailsUnavailable(document, count);
}

export function renderDashboard(document, result, marketState, fiscalAssessment) {
  const market = result.market;
  document.querySelector("#baseCost").textContent = dashboardMoney(result.totalUnitCost);
  document.querySelector("#marketReferencePrice").textContent = dashboardMoney(market.price);
  document.querySelector("#marketTitle").textContent = marketLabel(market);
  const selectedReference = market.reference?.selectedProduct;
  document.querySelector("#marketReferenceDetails").textContent = market.price
    ? selectedReference
      ? `${selectedReference.title} · Loja: ${selectedReference.seller || selectedReference.source} · Fonte: Google Shopping · ${selectedReference.consultedAt ? new Date(selectedReference.consultedAt).toLocaleDateString("pt-BR") : "consulta atual"}`
      : `Fonte: ${market.source || "não informada"}`
    : "Referência opcional não informada";
  document.querySelector("#marketPriceLabel").textContent = marketLabel(market);
  document.querySelector("#suggestedPrice").textContent = dashboardMoney(result.technicalPrice);
  document.querySelector("#profitPerSale").textContent = dashboardMoney(result.profitAmount);
  document.querySelector("#estimatedMargin").textContent = percent(result.actualNetMargin);
  const primaryMarketValue = document.querySelector("#primaryMarketValue");
  primaryMarketValue.hidden = !market.price;
  document.querySelector("#primaryMarketPrice").textContent = dashboardMoney(market.price);
  document.querySelector("#primaryMarketSource").textContent = market.price
    ? selectedReference
      ? `${selectedReference.title} · Loja: ${selectedReference.seller || selectedReference.source} · Google Shopping`
      : `${marketLabel(market)} · ${market.source || "Google Shopping"}`
    : "Sem referência de mercado";
  document.querySelector("#priceStatus").textContent = "Preço técnico";
  document.querySelector("#recommendationText").textContent = "Preço mínimo sustentável, calculado sem usar mercado ou desconto como custo.";
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
