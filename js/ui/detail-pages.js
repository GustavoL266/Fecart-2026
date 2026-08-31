import { clamp, currency, escapeHtml, percent } from "../utils/formatters.js";

export function priceCompositionFrom(result) {
  if (!result.isValid || !result.minimumPriceCents) return [];

  const components = [
    { label: "Custos diretos líquidos", valueCents: result.costs.directCashCostCents },
    { label: "Capital de giro", valueCents: result.costs.workingCapitalCostCents },
    { label: "Rateio de custos fixos", valueCents: result.costs.fixedCostAllocationCents },
    { label: "Impostos, taxas e comissão", valueCents: result.salesExpensesCents },
    { label: "Lucro líquido", valueCents: result.profitPerSaleCents },
  ].filter((item) => item.valueCents > 0);

  const representedTotalCents = components.reduce((total, item) => total + item.valueCents, 0);
  return components.map((item) => ({
    ...item,
    share: representedTotalCents > 0 ? item.valueCents / representedTotalCents : 0,
  }));
}

export function priceComparisonFrom(inputs, result) {
  const values = [
    { label: "Custo-base", value: result.costs.baseCost },
    { label: "Preço recomendado", value: result.minimumPrice || 0 },
    { label: "Média do mercado", value: inputs.competitorAverage },
  ];
  const maximum = Math.max(...values.map((item) => item.value), 1);

  return values.map((item) => ({
    ...item,
    width: clamp((item.value / maximum) * 100, 0, 100),
  }));
}

function renderComposition(document, result) {
  const donut = document.querySelector("#priceDonut");
  const segments = document.querySelector("#priceDonutSegments");
  const legend = document.querySelector("#priceCompositionLegend");
  const components = priceCompositionFrom(result);

  if (components.length === 0) {
    segments.innerHTML = "";
    donut.setAttribute("aria-label", "Composição indisponível enquanto o cálculo estiver inválido.");
    legend.innerHTML = '<li class="chart-empty">Revise os percentuais para visualizar a composição.</li>';
    return;
  }

  let cursor = 0;
  segments.innerHTML = components
    .map((item, index) => {
      const segmentSize = item.share * 100;
      const offset = -cursor;
      cursor += segmentSize;
      return `<circle class="donut-segment donut-segment-${index + 1}" cx="60" cy="60" r="48" pathLength="100" stroke-dasharray="${segmentSize.toFixed(4)} ${(100 - segmentSize).toFixed(4)}" stroke-dashoffset="${offset.toFixed(4)}"></circle>`;
    })
    .join("");
  donut.setAttribute(
    "aria-label",
    components.map((item) => `${item.label}: ${percent(item.share)}`).join(". "),
  );
  legend.innerHTML = components
    .map(
      (item, index) => `
        <li>
          <span class="chart-legend-color chart-legend-color-${index + 1}" aria-hidden="true"></span>
          <span>${escapeHtml(item.label)}</span>
          <strong>${currency.format(item.valueCents / 100)}</strong>
          <small>${percent(item.share)}</small>
        </li>`,
    )
    .join("");
}

function renderComparison(document, inputs, result, marketText) {
  const comparison = priceComparisonFrom(inputs, result);
  document.querySelector("#priceComparisonBars").innerHTML = comparison
    .map(
      (item, index) => `
        <li>
          <div><span>${escapeHtml(item.label)}</span><strong>${currency.format(item.value)}</strong></div>
          <progress class="comparison-track comparison-fill-${index + 1}" max="100" value="${item.width.toFixed(2)}" aria-label="${escapeHtml(item.label)}: ${percent(item.width / 100)} da maior referência"></progress>
        </li>`,
    )
    .join("");
  document.querySelector("#detailMarketNarrative").textContent = marketText;
}

export function renderPriceDetails(document, inputs, result, marketText, alertCount) {
  const validPrice = result.isValid ? currency.format(result.minimumPrice) : "Revise percentuais";
  const validMargin = result.isValid ? percent(result.actualMargin) : "-";

  document.querySelector("#detailSuggestedPrice").textContent = validPrice;
  document.querySelector("#detailDonutPrice").textContent = result.isValid ? currency.format(result.minimumPrice) : "-";
  document.querySelector("#detailBaseCost").textContent = currency.format(result.costs.baseCost);
  document.querySelector("#detailSalesRate").textContent = percent(result.costs.salesRate);
  document.querySelector("#detailProfit").textContent = result.isValid ? currency.format(result.profitPerSale) : "-";
  document.querySelector("#detailMargin").textContent = validMargin;
  document.querySelector("#detailMarketPrice").textContent = currency.format(inputs.competitorAverage);
  document.querySelector("#detailMarketCostLimit").textContent = currency.format(result.marketCostLimit);
  document.querySelector("#detailAlertCount").textContent = `${alertCount} ${alertCount === 1 ? "ponto de atenção" : "pontos de atenção"}`;

  renderComposition(document, result);
  renderComparison(document, inputs, result, marketText);
}
