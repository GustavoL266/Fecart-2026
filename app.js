const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const $ = (selector) => document.querySelector(selector);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function numberValue(selector, fallback = 0) {
  const value = Number($(selector).value);
  return Number.isFinite(value) ? value : fallback;
}

function percent(value) {
  return `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function getInputs() {
  return {
    materialsCost: numberValue("#materialsCost"),
    waste: numberValue("#waste") / 100,
    packagingCost: numberValue("#packagingCost"),
    deliveryCost: numberValue("#deliveryCost"),
    laborMonthlyCost: numberValue("#laborMonthlyCost"),
    productiveHours: Math.max(numberValue("#productiveHours", 1), 1),
    laborHours: numberValue("#laborHours"),
    monthlyFixedCosts: numberValue("#monthlyFixedCosts"),
    monthlyVolume: Math.max(numberValue("#monthlyVolume", 1), 1),
    taxRate: numberValue("#taxRate") / 100,
    paymentFeeRate: numberValue("#paymentFeeRate") / 100,
    commissionRate: numberValue("#commissionRate") / 100,
    margin: clamp(numberValue("#margin") / 100, 0.01, 0.6),
    competitorAverage: Math.max(numberValue("#competitorAverage", 0.01), 0.01),
    receiveDays: numberValue("#receiveDays"),
    payDays: numberValue("#payDays"),
    capitalRate: numberValue("#capitalRate") / 100,
  };
}

function calculateCosts(inputs) {
  const materialsWithWaste = inputs.materialsCost * (1 + inputs.waste);
  const laborHourlyCost = inputs.laborMonthlyCost / inputs.productiveHours;
  const directLabor = laborHourlyCost * inputs.laborHours;
  const directCashCost = materialsWithWaste + inputs.packagingCost + inputs.deliveryCost + directLabor;
  const cashGapDays = Math.max(inputs.receiveDays - inputs.payDays, 0);
  const workingCapitalCost = directCashCost * inputs.capitalRate * (cashGapDays / 30);
  const fixedCostAllocation = inputs.monthlyFixedCosts / inputs.monthlyVolume;
  const baseCost = directCashCost + workingCapitalCost + fixedCostAllocation;
  const salesRate = inputs.taxRate + inputs.paymentFeeRate + inputs.commissionRate;

  return {
    materialsWithWaste,
    laborHourlyCost,
    directLabor,
    directCashCost,
    cashGapDays,
    workingCapitalCost,
    fixedCostAllocation,
    baseCost,
    salesRate,
  };
}

function calculatePrice(inputs) {
  const costs = calculateCosts(inputs);
  const availableRate = 1 - costs.salesRate - inputs.margin;
  const isValid = availableRate > 0;
  const minimumPrice = isValid ? Math.ceil((costs.baseCost / availableRate) * 100) / 100 : null;
  const salesExpenses = isValid ? minimumPrice * costs.salesRate : 0;
  const profitPerSale = isValid ? minimumPrice - costs.baseCost - salesExpenses : 0;
  const actualMargin = isValid ? profitPerSale / minimumPrice : 0;
  const marketGap = isValid ? (inputs.competitorAverage - minimumPrice) / inputs.competitorAverage : 0;
  const marketCostLimit = Math.max(0, inputs.competitorAverage * availableRate);
  const requiredCostReduction = Math.max(0, costs.baseCost - marketCostLimit);

  return {
    costs,
    availableRate,
    isValid,
    minimumPrice,
    salesExpenses,
    profitPerSale,
    actualMargin,
    marketGap,
    marketCostLimit,
    requiredCostReduction,
  };
}

function render() {
  const inputs = getInputs();
  const result = calculatePrice(inputs);
  const { costs } = result;

  $("#wasteValue").textContent = percent(inputs.waste);
  $("#marginValue").textContent = percent(inputs.margin);
  $("#capitalRateValue").textContent = percent(inputs.capitalRate);
  $("#baseCost").textContent = currency.format(costs.baseCost);
  $("#salesRate").textContent = percent(costs.salesRate);
  $("#marketPrice").textContent = currency.format(inputs.competitorAverage);
  $("#marketCostLimit").textContent = currency.format(result.marketCostLimit);

  if (result.isValid) {
    $("#suggestedPrice").textContent = currency.format(result.minimumPrice);
    $("#profitPerSale").textContent = currency.format(result.profitPerSale);
    $("#estimatedMargin").textContent = percent(result.actualMargin);
    $("#priceStatus").textContent = result.marketGap >= 0 ? "Viável no mercado" : "Acima da média local";
    $("#priceStatus").classList.toggle("risk-badge", result.marketGap < 0);
    $("#recommendationText").textContent =
      "Preço mínimo calculado para pagar todos os custos, despesas de venda e atingir a margem líquida definida.";
    $("#marketStatus").textContent =
      result.marketGap >= 0
        ? `O preço calculado fica ${currency.format(result.marketGap * inputs.competitorAverage)} abaixo da média informada.`
        : `O preço calculado fica ${currency.format(Math.abs(result.marketGap) * inputs.competitorAverage)} acima da média informada.`;
    $("#marketMeter").style.width = `${clamp((result.minimumPrice / inputs.competitorAverage) * 100, 0, 100)}%`;
    $("#marketMeter").classList.toggle("over", result.marketGap < 0);
  } else {
    $("#suggestedPrice").textContent = "Revise percentuais";
    $("#profitPerSale").textContent = "-";
    $("#estimatedMargin").textContent = "-";
    $("#priceStatus").textContent = "Cálculo inviável";
    $("#priceStatus").classList.add("risk-badge");
    $("#recommendationText").textContent = "Impostos, taxas, comissão e margem somam 100% ou mais do preço. Reduza algum percentual para calcular.";
    $("#marketStatus").textContent = "Não é possível validar o mercado enquanto os percentuais consumirem todo o preço.";
    $("#marketMeter").style.width = "100%";
    $("#marketMeter").classList.add("over");
  }

  renderExplanation(inputs, result);
  renderCostTable(result);
  renderAlerts(inputs, result);
}

function renderExplanation(inputs, result) {
  const { costs } = result;
  const items = [
    `Insumos e matéria-prima, já com ${percent(inputs.waste)} de perda: ${currency.format(costs.materialsWithWaste)}.`,
    `Mão de obra direta: ${currency.format(costs.directLabor)} (${currency.format(costs.laborHourlyCost)} por hora produtiva).`,
    `Rateio de custos fixos: ${currency.format(costs.fixedCostAllocation)} por venda, usando ${inputs.monthlyVolume.toLocaleString("pt-BR")} operações previstas no mês.`,
    `Impostos, taxa de pagamento e comissão somam ${percent(costs.salesRate)} e incidem sobre o preço final.`,
    `Fórmula aplicada: custo-base ÷ (1 − despesas sobre a venda − margem líquida).`,
  ];

  $("#explanationList").innerHTML = items.map((item) => `<li>${item}</li>`).join("");
}

function renderCostTable(result) {
  const { costs } = result;
  const price = result.minimumPrice || 0;
  const rows = [
    ["Insumos com perda", costs.materialsWithWaste],
    ["Embalagem e entrega", 0],
    ["Mão de obra direta", costs.directLabor],
    ["Capital de giro", costs.workingCapitalCost],
    ["Rateio de custos fixos", costs.fixedCostAllocation],
    ["Impostos, taxas e comissão", result.salesExpenses],
    ["Lucro líquido", result.profitPerSale],
  ];

  rows[1][1] = numberValue("#packagingCost") + numberValue("#deliveryCost");
  $("#costRows").innerHTML = rows
    .map(([label, value]) => `
      <tr>
        <td>${label}</td>
        <td>${currency.format(value)}</td>
        <td>${price > 0 ? percent(value / price) : "-"}</td>
      </tr>
    `)
    .join("");
}

function renderAlerts(inputs, result) {
  const alerts = [];
  const { costs } = result;

  if (!result.isValid) {
    alerts.push(["risk", "A soma de impostos, taxas, comissão e margem não pode chegar a 100% do preço."]);
  }

  if (result.isValid && result.marketGap < 0) {
    alerts.push(["risk", `Para caber na média do mercado mantendo as taxas e a margem, o custo-base precisa cair ${currency.format(result.requiredCostReduction)} por venda.`]);
  }

  if (costs.cashGapDays > 0) {
    alerts.push(["warning", `Você recebe ${costs.cashGapDays} dia(s) depois de pagar. O custo do capital acrescentou ${currency.format(costs.workingCapitalCost)} por venda.`]);
  }

  if (costs.salesRate > 0.2) {
    alerts.push(["warning", `Impostos, taxas e comissão consomem ${percent(costs.salesRate)} do preço final.`]);
  }

  if (alerts.length === 0) {
    alerts.push(["ok", "Preço sustentável: custos, despesas sobre a venda e margem foram cobertos sem ultrapassar a média informada."]);
  }

  $("#alerts").innerHTML = alerts.map(([type, text]) => `<div class="${type}">${text}</div>`).join("");
}

[
  "#materialsCost",
  "#waste",
  "#packagingCost",
  "#deliveryCost",
  "#laborMonthlyCost",
  "#productiveHours",
  "#laborHours",
  "#monthlyFixedCosts",
  "#monthlyVolume",
  "#taxRate",
  "#paymentFeeRate",
  "#commissionRate",
  "#margin",
  "#competitorAverage",
  "#receiveDays",
  "#payDays",
  "#capitalRate",
].forEach((selector) => {
  $(selector).addEventListener("input", render);
});

render();
