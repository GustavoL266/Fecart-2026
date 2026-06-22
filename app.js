const products = {
  cafe: {
    name: "Café especial 500g",
    category: "supermercado",
    cost: 18.4,
    baseDemand: 120,
    referencePrice: 31.9,
    elasticity: 1.15,
  },
  remedio: {
    name: "Analgésico 20 comprimidos",
    category: "farmácia",
    cost: 7.8,
    baseDemand: 210,
    referencePrice: 13.5,
    elasticity: 0.75,
  },
  hamburguer: {
    name: "Combo artesanal",
    category: "restaurante",
    cost: 21.2,
    baseDemand: 88,
    referencePrice: 38.9,
    elasticity: 1.05,
  },
  gasolina: {
    name: "Gasolina comum 1L",
    category: "posto",
    cost: 4.92,
    baseDemand: 1600,
    referencePrice: 5.89,
    elasticity: 0.55,
  },
};

const regions = {
  centro: {
    name: "Centro urbano",
    income: 1.14,
    density: 1.18,
    logistics: 1.04,
    competitorPressure: 1.08,
    labels: ["Renda: alta", "Densidade: intensa", "Logística: média"],
  },
  bairro: {
    name: "Bairro residencial",
    income: 1.02,
    density: 0.96,
    logistics: 1,
    competitorPressure: 0.92,
    labels: ["Renda: estável", "Densidade: média", "Logística: boa"],
  },
  turistica: {
    name: "Área turística",
    income: 1.22,
    density: 1.08,
    logistics: 1.1,
    competitorPressure: 0.98,
    labels: ["Renda: variável", "Densidade: sazonal", "Logística: elevada"],
  },
  periferia: {
    name: "Região sensível a preço",
    income: 0.86,
    density: 1.05,
    logistics: 1.07,
    competitorPressure: 1.18,
    labels: ["Renda: sensível", "Densidade: alta", "Logística: elevada"],
  },
};

const strategyWeight = {
  balance: 1,
  profit: 1.08,
  volume: 0.94,
};

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const state = {
  strategy: "balance",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getInputs() {
  return {
    product: products[$("#product").value],
    region: regions[$("#region").value],
    regionKey: $("#region").value,
    margin: Number($("#margin").value) / 100,
    competitors: Number($("#competitors").value),
    seasonality: Number($("#seasonality").value) / 100,
    strategy: state.strategy,
  };
}

function estimateScenario(price, inputs) {
  const competitorIndex = clamp(inputs.competitors / 8, 0, 1.6);
  const competitorPrice = inputs.product.referencePrice * (1 - competitorIndex * 0.035) * inputs.region.competitorPressure;
  const relativePrice = price / competitorPrice;
  const demandImpact = 1 - (relativePrice - 1) * inputs.product.elasticity;
  const demand = Math.max(
    1,
    Math.round(inputs.product.baseDemand * inputs.region.density * (1 + inputs.seasonality) * demandImpact)
  );
  const unitCost = inputs.product.cost * inputs.region.logistics;
  const profit = (price - unitCost) * demand;
  const margin = (price - unitCost) / price;
  const competitiveness = clamp(100 - Math.max(0, relativePrice - 0.96) * 180, 12, 100);

  return { competitorPrice, demand, profit, margin, competitiveness, unitCost };
}

function calculateRecommendation(inputs) {
  const minimumPrice = inputs.product.cost * inputs.region.logistics * (1 + inputs.margin);
  const marketAnchor = inputs.product.referencePrice * inputs.region.income;
  const competitionDiscount = 1 - clamp(inputs.competitors, 0, 12) * 0.012;
  const seasonalLift = 1 + inputs.seasonality * 0.34;
  const strategy = strategyWeight[inputs.strategy];
  const rawPrice = marketAnchor * competitionDiscount * seasonalLift * strategy;
  const suggestedPrice = Math.max(minimumPrice, rawPrice);
  const scenario = estimateScenario(suggestedPrice, inputs);
  const confidence = clamp(
    92 - inputs.competitors * 2.3 - Math.abs(inputs.seasonality) * 42 + (inputs.region.density - 1) * 12,
    52,
    96
  );

  return { suggestedPrice, minimumPrice, scenario, confidence };
}

function render() {
  const inputs = getInputs();
  const result = calculateRecommendation(inputs);
  const { scenario } = result;

  $("#marginValue").textContent = `${Math.round(inputs.margin * 100)}%`;
  $("#competitorsValue").textContent = inputs.competitors;
  $("#seasonalityValue").textContent = `${inputs.seasonality >= 0 ? "+" : ""}${Math.round(inputs.seasonality * 100)}%`;

  $("#suggestedPrice").textContent = currency.format(result.suggestedPrice);
  $("#profit").textContent = currency.format(scenario.profit);
  $("#demand").textContent = `${scenario.demand.toLocaleString("pt-BR")} un.`;
  $("#competitiveness").textContent = `${Math.round(scenario.competitiveness)}%`;
  $("#estimatedMargin").textContent = `${Math.round(scenario.margin * 100)}%`;
  $("#regionTitle").textContent = inputs.region.name;
  $("#incomeFactor").textContent = inputs.region.labels[0];
  $("#densityFactor").textContent = inputs.region.labels[1];
  $("#logisticsFactor").textContent = inputs.region.labels[2];

  const confidenceLabel = result.confidence >= 80 ? "Alta confiança" : result.confidence >= 65 ? "Confiança média" : "Revisar dados";
  $("#confidenceBadge").textContent = `${confidenceLabel} · ${Math.round(result.confidence)}%`;

  $("#recommendationText").textContent =
    `Para ${inputs.product.name.toLowerCase()} em ${inputs.region.name.toLowerCase()}, o sistema equilibra custo local, renda da região, concorrência e sazonalidade antes de sugerir o preço.`;

  renderExplanation(inputs, result);
  renderScenarios(inputs, result.suggestedPrice);
  renderAlerts(inputs, result);
  updateActiveControls(inputs.regionKey);
}

function renderExplanation(inputs, result) {
  const items = [
    `O custo local estimado é ${currency.format(result.scenario.unitCost)}, já com impacto logístico da região.`,
    `A margem mínima exige preço acima de ${currency.format(result.minimumPrice)}.`,
    `A referência dos concorrentes ficou em ${currency.format(result.scenario.competitorPrice)} para esta localidade.`,
    `A estratégia atual prioriza ${state.strategy === "profit" ? "lucro" : state.strategy === "volume" ? "volume de vendas" : "equilíbrio entre lucro e competitividade"}.`,
  ];

  $("#explanationList").innerHTML = items.map((item) => `<li>${item}</li>`).join("");
}

function renderScenarios(inputs, basePrice) {
  const scenarios = [
    ["-10%", basePrice * 0.9],
    ["Sugerido", basePrice],
    ["+5%", basePrice * 1.05],
    ["+10%", basePrice * 1.1],
  ];

  $("#scenarioRows").innerHTML = scenarios
    .map(([label, price]) => {
      const data = estimateScenario(price, inputs);
      return `
        <tr>
          <td>${label}</td>
          <td>${currency.format(price)}</td>
          <td>${data.demand.toLocaleString("pt-BR")}</td>
          <td>${currency.format(data.profit)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderAlerts(inputs, result) {
  const alerts = [];

  if (inputs.competitors >= 8) {
    alerts.push(["risk", "Concorrência alta: acompanhe alterações de preço com maior frequência."]);
  }

  if (inputs.seasonality >= 0.18) {
    alerts.push(["warning", "Demanda sazonal em alta: há espaço para capturar valor sem perder muito volume."]);
  }

  if (result.scenario.margin < inputs.margin) {
    alerts.push(["risk", "Margem abaixo do piso desejado: revise custo, logística ou estratégia de volume."]);
  }

  if (alerts.length === 0) {
    alerts.push(["ok", "Cenário estável: preço sugerido mantém margem, demanda e competitividade em zona saudável."]);
  }

  $("#alerts").innerHTML = alerts.map(([type, text]) => `<div class="${type}">${text}</div>`).join("");
}

function updateActiveControls(regionKey) {
  $$(".strategy").forEach((button) => {
    button.classList.toggle("active", button.dataset.strategy === state.strategy);
  });

  $$(".map-node").forEach((node) => {
    node.classList.toggle("active", node.dataset.region === regionKey);
  });
}

["#product", "#region", "#margin", "#competitors", "#seasonality"].forEach((selector) => {
  $(selector).addEventListener("input", render);
});

$$(".strategy").forEach((button) => {
  button.addEventListener("click", () => {
    state.strategy = button.dataset.strategy;
    render();
  });
});

$$(".map-node").forEach((node) => {
  node.addEventListener("click", () => {
    $("#region").value = node.dataset.region;
    render();
  });

  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      $("#region").value = node.dataset.region;
      render();
    }
  });
});

render();
