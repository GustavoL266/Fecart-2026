import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, css] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
]);

const aboutView = html.match(/<section id="aboutView"[\s\S]*?<dialog id="aiAssistantDialog"/)?.[0] || "";

test("a página Sobre apresenta o conteúdo resumido definido para a experiência", () => {
  assert.ok(aboutView, "A seção #aboutView deve existir");
  assert.match(aboutView, /Preço sustentável começa com contexto\./);
  assert.match(aboutView, /Decida com mais clareza/);
  assert.match(aboutView, /O Assistente de Precificação reúne custos, despesas, impostos, margem e referências de mercado/);
  assert.match(aboutView, /Cada etapa organiza uma parte da formação do preço\./);
  assert.match(aboutView, /Detalhes adicionais, alertas e memória de cálculo ficam disponíveis dentro do simulador\./);
  assert.match(aboutView, /Os resultados são estimativas de apoio à decisão\./);
  assert.match(aboutView, /Voltar ao simulador/);
});

test("a página Sobre limita o fluxo e os resultados aos quatro itens principais", () => {
  const flow = aboutView.match(/<ol class="about-flow">([\s\S]*?)<\/ol>/)?.[1] || "";
  const results = aboutView.match(/<div class="about-results-grid">([\s\S]*?)<\/div>/)?.[1] || "";

  assert.equal((flow.match(/<li\b/g) || []).length, 4);
  assert.match(flow, /<strong>Produto<\/strong>/);
  assert.match(flow, /<strong>Custos<\/strong>/);
  assert.match(flow, /<strong>Impostos e margem<\/strong>/);
  assert.match(flow, /<strong>Resultado<\/strong>/);

  assert.equal((results.match(/<article>/g) || []).length, 4);
  assert.match(results, /Preço com margem desejada/);
  assert.match(results, /Preço de equilíbrio/);
  assert.match(results, /Custo por unidade/);
  assert.match(results, /Comparação com o mercado/);

  assert.doesNotMatch(aboutView, /<details|about-accordions|about-feature-grid/);
  assert.doesNotMatch(aboutView, /Mercado Livre|Histórico e reutilização|Preço mínimo sustentável/);
  assert.match(css, /\.about-flow\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /\.about-flow,\.about-results-grid\{grid-template-columns:1fr\}/);
});
