import { currency, escapeHtml, percent } from "../utils/formatters.js";

function money(value) { return value === null || value === undefined ? "—" : currency.format(value); }

export function priceCompositionFrom(result) {
  return [
    { label: "Custo direto", value: result.directCost },
    { label: "Custo indireto", value: result.indirectCost },
    { label: "Custo financeiro", value: result.financialCost },
    { label: "Tributos, taxa e comissão", value: result.taxAmount + result.paymentFeeAmount + result.commissionAmount },
    { label: "Lucro líquido", value: result.profitAmount },
  ].filter((item) => item.value > 0);
}

function renderComposition(document, result) {
  const components = priceCompositionFrom(result);
  const total = components.reduce((sum, item) => sum + item.value, 0);
  document.querySelector("#priceDonutSegments").innerHTML = components.reduce(({ markup, cursor }, item, index) => {
    const share = total ? item.value / total : 0;
    const size = share * 100;
    return { cursor: cursor + size, markup: `${markup}<circle class="donut-segment donut-segment-${index + 1}" cx="60" cy="60" r="48" pathLength="100" stroke-dasharray="${size.toFixed(4)} ${(100 - size).toFixed(4)}" stroke-dashoffset="${(-cursor).toFixed(4)}"></circle>` };
  }, { markup: "", cursor: 0 }).markup;
  document.querySelector("#priceCompositionLegend").innerHTML = components.map((item, index) => `<li><span class="chart-legend-color chart-legend-color-${index + 1}"></span><span>${escapeHtml(item.label)}</span><strong>${money(item.value)}</strong><small>${percent(total ? item.value / total : 0)}</small></li>`).join("");
}

export function renderPriceDetails(document, result, alertCount) {
  document.querySelector("#detailSuggestedPrice").textContent = money(result.technicalPrice);
  document.querySelector("#detailDonutPrice").textContent = money(result.technicalPrice);
  document.querySelector("#detailBaseCost").textContent = money(result.totalUnitCost);
  document.querySelector("#detailSalesRate").textContent = percent(result.saleExpenseRate);
  document.querySelector("#detailProfit").textContent = money(result.profitAmount);
  document.querySelector("#detailMargin").textContent = percent(result.actualNetMargin);
  document.querySelector("#detailMarketPrice").textContent = money(result.market.price);
  document.querySelector("#detailMarketCostLimit").textContent = result.market.difference === null ? "—" : money(result.market.difference);
  document.querySelector("#detailAlertCount").textContent = `${alertCount} ${alertCount === 1 ? "ponto de atenção" : "pontos de atenção"}`;
  document.querySelector("#detailMarketNarrative").textContent = result.market.price
    ? `Referência ${result.market.rule}: ${money(result.market.price)}. Diferença para o preço técnico: ${money(result.market.difference)} (${percent(result.market.differenceRate)}).`
    : "Não há referência de mercado. Isso não bloqueia o preço técnico.";
  document.querySelector("#priceComparisonBars").innerHTML = [
    ["Custo total", result.totalUnitCost], ["Preço técnico", result.technicalPrice], ["Mercado", result.market.price],
  ].filter(([, value]) => value !== null).map(([label, value]) => `<li><div><span>${label}</span><strong>${money(value)}</strong></div></li>`).join("");
  renderComposition(document, result);
}

export function renderPriceDetailsUnavailable(document, invalidCount) {
  ["detailSuggestedPrice", "detailDonutPrice", "detailBaseCost", "detailSalesRate", "detailProfit", "detailMargin", "detailMarketPrice", "detailMarketCostLimit"].forEach((id) => { document.querySelector(`#${id}`).textContent = "—"; });
  document.querySelector("#detailAlertCount").textContent = `${invalidCount} ${invalidCount === 1 ? "campo pendente" : "campos pendentes"}`;
  document.querySelector("#priceDonutSegments").innerHTML = "";
  document.querySelector("#priceCompositionLegend").innerHTML = "<li>Preencha os campos obrigatórios.</li>";
  document.querySelector("#priceComparisonBars").innerHTML = "";
  document.querySelector("#detailMarketNarrative").textContent = "A comparação é opcional e será mostrada quando houver uma referência válida.";
}
