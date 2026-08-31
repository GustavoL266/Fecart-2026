import { MELI_CONFIG, PRODUCTIVE_HOURS_PER_WORKER_MONTH } from "../config/pricing.js";
import { marketBadgeForGap } from "../domain/market-analysis.js";
import { clamp, currency, escapeHtml, percent } from "../utils/formatters.js";
import { renderPriceDetails } from "./detail-pages.js";

function marketComparisonText(inputs, result, marketStats, marketSource) {
  const difference = Math.abs(inputs.competitorAverage - result.minimumPrice);
  const source =
    marketSource === "meli-median"
      ? "mediana dos anúncios comparáveis do Mercado Livre"
      : marketSource === "meli-listing"
        ? "anúncio selecionado no Mercado Livre"
        : "média informada";
  const relativeGap = Math.abs(result.marketGap);
  const confidenceNote = marketStats && marketStats.count < MELI_CONFIG.minComparableResults ? " A amostra é pequena, então use como sinal preliminar." : "";

  if (relativeGap <= 0.08) return `O preço calculado está próximo da ${source}, com diferença de ${percent(relativeGap)}.${confidenceNote}`;
  if (result.marketGap >= 0) return `O preço calculado fica ${currency.format(difference)} (${percent(relativeGap)}) abaixo da ${source}.${confidenceNote}`;

  return `O preço calculado fica ${currency.format(difference)} (${percent(relativeGap)}) acima da ${source}.${confidenceNote}`;
}

function renderExplanation(document, inputs, result, fiscalAssessment) {
  const { costs } = result;
  const items = [
    `Insumos e matéria-prima, já com ${percent(inputs.waste)} de perda: ${currency.format(costs.materialsWithWaste)}.`,
    `Mão de obra direta: ${currency.format(costs.directLabor)} por unidade, usando ${inputs.workerCount} trabalhador(es), folha total de ${currency.format(inputs.totalPayroll)} e ${inputs.outputPerWorkerHour.toLocaleString("pt-BR")} unidade(s) por trabalhador/hora.`,
    `Capacidade mensal de produção: ${costs.monthlyProductionCapacity.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} unidades, considerando ${PRODUCTIVE_HOURS_PER_WORKER_MONTH} horas produtivas por trabalhador no mês.`,
    `Rateio de custos fixos: ${currency.format(costs.fixedCostAllocation)} por venda, usando ${inputs.monthlyVolume.toLocaleString("pt-BR")} operações previstas no mês.`,
    `A carga tributária agregada informada, a taxa de pagamento e a comissão somam ${percent(costs.salesRate)} e incidem sobre o preço final.`,
    "Fórmula aplicada: custo-base ÷ (1 − despesas sobre a venda − margem líquida).",
    "A Focus NFe é usada para validar o NCM, não para calcular impostos. A composição tributária precisa de regras fiscais externas.",
  ];

  if (fiscalAssessment.missingFields.length > 0) {
    items.push(`Contexto fiscal ainda incompleto: ${fiscalAssessment.missingFields.join(", ")}.`);
  }

  document.querySelector("#explanationList").innerHTML = items.map((item) => `<li>${item}</li>`).join("");
}

function renderCostTable(document, memory) {
  document.querySelector("#costRows").innerHTML = memory
    .map(
      (item) => `
        <tr>
          <td><small>${escapeHtml(item.group)}</small><br>${escapeHtml(item.label)}</td>
          <td>${currency.format(item.valueCents / 100)}</td>
          <td>${escapeHtml(item.basis)}</td>
          <td>${escapeHtml(item.source)}</td>
        </tr>`,
    )
    .join("");
}

function dashboardAlerts(inputs, result, fiscalAssessment) {
  const alerts = [];
  const { costs } = result;

  if (!result.isValid) alerts.push(["risk", "A soma de impostos, taxas, comissão e margem não pode chegar a 100% do preço."]);
  if (result.isValid && result.marketGap < 0) alerts.push(["risk", `Para caber na média do mercado mantendo as taxas e a margem, o custo-base precisa cair ${currency.format(result.requiredCostReduction)} por venda.`]);
  if (costs.cashGapDays > 0) alerts.push(["warning", `Você recebe ${costs.cashGapDays} dia(s) depois de pagar. O custo do capital acrescentou ${currency.format(costs.workingCapitalCost)} por venda.`]);
  if (costs.salesRate > 0.2) alerts.push(["warning", `Impostos, taxas e comissão consomem ${percent(costs.salesRate)} do preço final.`]);
  if (fiscalAssessment.focusUnavailable) alerts.push(["warning", "A Focus NFe está indisponível. O cálculo financeiro foi preservado, mas o NCM não está validado."]);
  alerts.push(["warning", "Estimativa fiscal pendente: a carga tributária agregada não substitui o cálculo de ICMS, ICMS-ST, DIFAL, FCP, IPI, PIS/COFINS ou IBS/CBS/IS."]);
  if (alerts.length === 0) alerts.push(["ok", "Preço sustentável: custos, despesas sobre a venda e margem foram cobertos sem ultrapassar a média informada."]);

  return alerts;
}

function renderAlerts(document, alerts) {
  document.querySelector("#alerts").innerHTML = alerts.map(([type, text]) => `<div class="${type}">${text}</div>`).join("");
}

function renderFiscalSummary(document, assessment) {
  const ncmDescription = assessment.ncm?.descricao_completa ? ` — ${assessment.ncm.descricao_completa}` : "";
  const contextStatus = assessment.missingFields.length === 0
    ? "Contexto básico preenchido; ainda requer regra tributária especializada."
    : `Faltam: ${assessment.missingFields.join(", ")}.`;

  document.querySelector("#fiscalSummary").innerHTML = `
    <p><strong>NCM:</strong> ${escapeHtml(assessment.ncm?.codigo || "não informado")}${escapeHtml(ncmDescription)} <small>(${escapeHtml(assessment.ncmSource)})</small></p>
    <p><strong>Status:</strong> ${escapeHtml(contextStatus)}</p>
    <p><strong>Tributos não determinados pela Focus NFe:</strong> ${escapeHtml(assessment.unresolvedTaxes.join(", "))}.</p>
    <p><strong>Resultado:</strong> estimativa financeira; não é uma validação fiscal da operação.</p>`;
}

function renderMeliPanel(document, result, meliState) {
  const panel = document.querySelector("#meliPanel");
  const summary = document.querySelector("#meliSummary");
  const statsContainer = document.querySelector("#meliStats");
  const resultsContainer = document.querySelector("#meliResults");
  const applyButton = document.querySelector("#applyMeliMarket");
  const searchStatus = document.querySelector("#meliSearchStatus");

  panel.hidden = meliState.status === "idle";
  summary.hidden = !meliState.stats;
  applyButton.disabled = !meliState.stats;

  if (meliState.status === "loading") {
    searchStatus.textContent = "Consultando anúncios reais no Mercado Livre...";
    statsContainer.innerHTML = '<p class="helper-text">Buscando produtos ativos no Mercado Livre.</p>';
    resultsContainer.innerHTML = "";
    return;
  }

  if (meliState.status === "error") {
    searchStatus.textContent = meliState.error;
    statsContainer.innerHTML = `
      <div class="meli-fallback">
        <p class="error-text">${escapeHtml(meliState.error)}</p>
        <p class="helper-text">Você ainda pode abrir a busca, comparar alguns anúncios e preencher a média manualmente no campo de concorrentes.</p>
        ${meliState.searchUrl ? `<a class="secondary-link" href="${escapeHtml(meliState.searchUrl)}" target="_blank" rel="noopener">Abrir busca no Mercado Livre</a>` : ""}
      </div>`;
    resultsContainer.innerHTML = "";
    return;
  }

  if (meliState.status === "empty") {
    searchStatus.textContent = "Nenhum anúncio comparável foi encontrado para essa busca.";
    statsContainer.innerHTML = '<p class="helper-text">Tente informar marca, modelo, capacidade, tamanho ou voltagem com mais precisão.</p>';
    resultsContainer.innerHTML = "";
    return;
  }

  if (!meliState.stats) {
    searchStatus.textContent = "Use a consulta para substituir a média manual por dados reais quando desejar.";
    statsContainer.innerHTML = "";
    resultsContainer.innerHTML = "";
    return;
  }

  const { stats } = meliState;
  const reliabilityText = stats.count < MELI_CONFIG.minComparableResults ? "Amostra pequena: referência preliminar." : "Amostra suficiente para referência inicial.";
  const marketGap = result.isValid ? (stats.median - result.minimumPrice) / stats.median : 0;
  const [badgeType, badgeText] = result.isValid ? marketBadgeForGap(marketGap) : ["risk", "Revise percentuais"];

  searchStatus.textContent = `${stats.count} anúncio(s) comparável(is) analisado(s).`;
  summary.innerHTML = `<span>Referência Mercado Livre</span><strong>${currency.format(stats.median)}</strong><small>Mediana de ${stats.count} anúncio(s)</small>`;
  statsContainer.innerHTML = `
    <div><span>Menor preço</span><strong>${currency.format(stats.min)}</strong></div>
    <div><span>Preço médio</span><strong>${currency.format(stats.average)}</strong></div>
    <div><span>Preço mediano</span><strong>${currency.format(stats.median)}</strong></div>
    <div><span>Maior preço</span><strong>${currency.format(stats.max)}</strong></div>
    <div><span>Análise</span><strong class="${badgeType}">${badgeText}</strong></div>
    <div><span>Confiança</span><strong>${reliabilityText}</strong></div>`;
  resultsContainer.innerHTML = meliState.comparableListings
    .map((listing) => {
      const isSelected = listing.id === meliState.selectedId;
      const attributes = listing.attributes
        .filter((attribute) => ["BRAND", "MODEL", "LINE", "VOLTAGE", "CAPACITY"].includes(attribute.id) && attribute.value_name)
        .slice(0, 3)
        .map((attribute) => attribute.value_name)
        .join(" | ");

      return `
        <article class="meli-result ${isSelected ? "selected" : ""}">
          ${listing.image ? `<img src="${escapeHtml(listing.image)}" alt="">` : '<div class="meli-image-placeholder"></div>'}
          <div>
            <h4>${escapeHtml(listing.title)}</h4>
            <p>${[listing.condition, listing.category, attributes].filter(Boolean).map(escapeHtml).join(" | ")}</p>
            <strong>${currency.format(listing.price)}</strong>
          </div>
          <div class="meli-actions">
            <button type="button" data-meli-select="${escapeHtml(listing.id)}">${isSelected ? "Selecionado" : "Selecionar"}</button>
            <a href="${escapeHtml(listing.link)}" target="_blank" rel="noopener">Abrir anúncio</a>
          </div>
        </article>`;
    })
    .join("");
}

export function renderDashboard(document, inputs, result, meliState, marketSource, fiscalAssessment, memory) {
  const { costs } = result;
  const activeMarketStats = marketSource === "meli-median" ? meliState.stats : null;
  const alerts = dashboardAlerts(inputs, result, fiscalAssessment);

  document.querySelector("#baseCost").textContent = currency.format(costs.baseCost);
  document.querySelector("#marketPrice").textContent = currency.format(inputs.competitorAverage);
  document.querySelector("#marketTitle").textContent = inputs.productType;

  const suggestedPrice = document.querySelector("#suggestedPrice");
  const profitPerSale = document.querySelector("#profitPerSale");
  const estimatedMargin = document.querySelector("#estimatedMargin");
  const priceStatus = document.querySelector("#priceStatus");
  const recommendationText = document.querySelector("#recommendationText");
  const marketStatus = document.querySelector("#marketStatus");
  const marketMeter = document.querySelector("#marketMeter");
  let marketText;

  if (result.isValid) {
    suggestedPrice.textContent = currency.format(result.minimumPrice);
    profitPerSale.textContent = currency.format(result.profitPerSale);
    estimatedMargin.textContent = percent(result.actualMargin);
    priceStatus.textContent = "Estimativa fiscal pendente";
    priceStatus.classList.remove("risk-badge");
    priceStatus.classList.add("warning-badge");
    recommendationText.textContent = "Preço mínimo financeiro para cobrir custos, despesas de venda e margem. Valide a composição tributária com seu contador antes de usar como preço fiscal.";
    marketText = marketComparisonText(inputs, result, activeMarketStats, marketSource);
    marketStatus.textContent = marketText;
    marketMeter.style.width = `${clamp((result.minimumPrice / inputs.competitorAverage) * 100, 0, 100)}%`;
    marketMeter.classList.toggle("over", result.marketGap < 0);
  } else {
    suggestedPrice.textContent = "Revise percentuais";
    profitPerSale.textContent = "-";
    estimatedMargin.textContent = "-";
    priceStatus.textContent = "Cálculo inviável";
    priceStatus.classList.add("risk-badge");
    priceStatus.classList.remove("warning-badge");
    recommendationText.textContent = "Impostos, taxas, comissão e margem somam 100% ou mais do preço. Reduza algum percentual para calcular.";
    marketText = "Não é possível validar o mercado enquanto os percentuais consumirem todo o preço.";
    marketStatus.textContent = marketText;
    marketMeter.style.width = "100%";
    marketMeter.classList.add("over");
  }

  document.querySelector("#alertCount").textContent = `${alerts.length} ${alerts.length === 1 ? "alerta importante" : "alertas importantes"}`;
  document.querySelector("#alertSummary").textContent = alerts[0][1];

  renderExplanation(document, inputs, result, fiscalAssessment);
  renderCostTable(document, memory);
  renderAlerts(document, alerts);
  renderFiscalSummary(document, fiscalAssessment);
  renderMeliPanel(document, result, meliState);
  renderPriceDetails(document, inputs, result, marketText, alerts.length);
}
