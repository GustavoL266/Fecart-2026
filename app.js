const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const PRODUCTIVE_HOURS_PER_WORKER_MONTH = 176;
const $ = (selector) => document.querySelector(selector);

const CATEGORY_PRESETS = {
  comestiveis: {
    materialsCost: 12,
    waste: 8,
    packagingCost: 2,
    deliveryCost: 1.5,
    totalPayroll: 12600,
    workerCount: 6,
    outputPerWorkerHour: 12,
    monthlyFixedCosts: 16000,
    monthlyVolume: 4000,
    taxRate: 6,
    paymentFeeRate: 2.8,
    commissionRate: 0,
    margin: 18,
    competitorAverage: 32,
    receiveDays: 7,
    payDays: 14,
    capitalRate: 2.5,
  },
  domesticos: {
    materialsCost: 30,
    waste: 2,
    packagingCost: 3,
    deliveryCost: 5,
    totalPayroll: 10800,
    workerCount: 4,
    outputPerWorkerHour: 6,
    monthlyFixedCosts: 18000,
    monthlyVolume: 750,
    taxRate: 6,
    paymentFeeRate: 3.2,
    commissionRate: 0,
    margin: 22,
    competitorAverage: 105,
    receiveDays: 15,
    payDays: 20,
    capitalRate: 2.5,
  },
  eletrodomesticos: {
    materialsCost: 320,
    waste: 0.5,
    packagingCost: 10,
    deliveryCost: 35,
    totalPayroll: 10000,
    workerCount: 3,
    outputPerWorkerHour: 1.5,
    monthlyFixedCosts: 22000,
    monthlyVolume: 250,
    taxRate: 6,
    paymentFeeRate: 4,
    commissionRate: 1,
    margin: 14,
    competitorAverage: 650,
    receiveDays: 30,
    payDays: 30,
    capitalRate: 2.5,
  },
  vestuario: {
    materialsCost: 35,
    waste: 2.5,
    packagingCost: 3,
    deliveryCost: 7,
    totalPayroll: 12500,
    workerCount: 5,
    outputPerWorkerHour: 4,
    monthlyFixedCosts: 20000,
    monthlyVolume: 800,
    taxRate: 6,
    paymentFeeRate: 3.5,
    commissionRate: 2,
    margin: 28,
    competitorAverage: 135,
    receiveDays: 20,
    payDays: 25,
    capitalRate: 2.5,
  },
  cosmeticos: {
    materialsCost: 20,
    waste: 1.5,
    packagingCost: 6,
    deliveryCost: 4,
    totalPayroll: 11000,
    workerCount: 4,
    outputPerWorkerHour: 5,
    monthlyFixedCosts: 16000,
    monthlyVolume: 600,
    taxRate: 6,
    paymentFeeRate: 3.5,
    commissionRate: 4,
    margin: 30,
    competitorAverage: 125,
    receiveDays: 30,
    payDays: 15,
    capitalRate: 2.5,
  },
};

const PERCENTAGE_FIELDS = new Set(["waste", "taxRate", "paymentFeeRate", "commissionRate", "margin", "capitalRate"]);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function numberValue(selector, fallback = 0) {
  const rawValue = String($(selector).value).trim();
  const normalizedValue = rawValue.includes(",") ? rawValue.replace(/\./g, "").replace(",", ".") : rawValue;
  const value = Number(normalizedValue);
  return Number.isFinite(value) ? value : fallback;
}

function percent(value) {
  return `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function getInputs() {
  return {
    productType: $("#productType").selectedOptions[0].textContent,
    materialsCost: numberValue("#materialsCost"),
    waste: clamp(numberValue("#waste"), 0, 100) / 100,
    packagingCost: numberValue("#packagingCost"),
    deliveryCost: numberValue("#deliveryCost"),
    totalPayroll: numberValue("#totalPayroll"),
    workerCount: Math.max(numberValue("#workerCount", 1), 1),
    outputPerWorkerHour: Math.max(numberValue("#outputPerWorkerHour", 0.01), 0.01),
    monthlyFixedCosts: numberValue("#monthlyFixedCosts"),
    monthlyVolume: Math.max(numberValue("#monthlyVolume", 1), 1),
    taxRate: clamp(numberValue("#taxRate"), 0, 60) / 100,
    paymentFeeRate: clamp(numberValue("#paymentFeeRate"), 0, 30) / 100,
    commissionRate: clamp(numberValue("#commissionRate"), 0, 50) / 100,
    margin: clamp(numberValue("#margin"), 0.1, 60) / 100,
    competitorAverage: clamp(numberValue("#competitorAverage", 0.01), 0.01, 1000000),
    receiveDays: numberValue("#receiveDays"),
    payDays: numberValue("#payDays"),
    capitalRate: clamp(numberValue("#capitalRate"), 0, 8) / 100,
  };
}

function averagePreset() {
  const presets = Object.values(CATEGORY_PRESETS);
  const fields = Object.keys(CATEGORY_PRESETS.comestiveis);

  return Object.fromEntries(
    fields.map((field) => {
      const average = presets.reduce((sum, preset) => sum + preset[field], 0) / presets.length;
      return [field, field === "workerCount" ? Math.max(1, Math.round(average)) : Number(average.toFixed(2))];
    })
  );
}

function applyCategoryPreset(category) {
  const preset = category === "outros" ? averagePreset() : CATEGORY_PRESETS[category];

  Object.entries(preset).forEach(([field, value]) => {
    const input = $(`#${field}`);
    input.value = PERCENTAGE_FIELDS.has(field) ? String(value).replace(".", ",") : value;
  });
}

function calculateCosts(inputs) {
  const materialsWithWaste = inputs.materialsCost * (1 + inputs.waste);
  const laborHourlyCost = inputs.totalPayroll / (inputs.workerCount * PRODUCTIVE_HOURS_PER_WORKER_MONTH);
  const monthlyProductionCapacity = inputs.workerCount * inputs.outputPerWorkerHour * PRODUCTIVE_HOURS_PER_WORKER_MONTH;
  const directLabor = inputs.totalPayroll / monthlyProductionCapacity;
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
    monthlyProductionCapacity,
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

  $("#baseCost").textContent = currency.format(costs.baseCost);
  $("#salesRate").textContent = percent(costs.salesRate);
  $("#marketPrice").textContent = currency.format(inputs.competitorAverage);
  $("#marketCostLimit").textContent = currency.format(result.marketCostLimit);
  $("#marketTitle").textContent = inputs.productType;

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
    `Mão de obra direta: ${currency.format(costs.directLabor)} por unidade, usando ${inputs.workerCount} trabalhador(es), folha total de ${currency.format(inputs.totalPayroll)} e ${inputs.outputPerWorkerHour.toLocaleString("pt-BR")} unidade(s) por trabalhador/hora.`,
    `Capacidade mensal de produção: ${costs.monthlyProductionCapacity.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} unidades, considerando ${PRODUCTIVE_HOURS_PER_WORKER_MONTH} horas produtivas por trabalhador no mês.`,
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
  "#totalPayroll",
  "#workerCount",
  "#outputPerWorkerHour",
  "#monthlyFixedCosts",
  "#monthlyVolume",
  "#taxRate",
  "#paymentFeeRate",
  "#commissionRate",
  "#margin",
  "#receiveDays",
  "#payDays",
  "#capitalRate",
].forEach((selector) => {
  $(selector).addEventListener("input", render);
});

$("#productType").addEventListener("change", () => {
  applyCategoryPreset($("#productType").value);
  render();
});

$("#competitorAverage").addEventListener("input", () => {
  const field = $("#competitorAverage");
  if (numberValue("#competitorAverage") > 1000000) {
    field.value = "1000000";
  }
  render();
});

applyCategoryPreset($("#productType").value);
render();
