import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, styles, scripts] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
  Promise.all([
    readFile(new URL("../js/main.js", import.meta.url), "utf8"),
    readFile(new URL("../js/ui/dashboard.js", import.meta.url), "utf8"),
    readFile(new URL("../js/ui/pricing-panel.js", import.meta.url), "utf8"),
  ]).then((contents) => contents.join("\n")),
]);

test("viewport permite zoom nativo e a interface nao aplica escala global", () => {
  assert.match(html, /<meta\s+name="viewport"\s+content="width=device-width, initial-scale=1\.0"\s*\/?>/);
  assert.doesNotMatch(html, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i);
  assert.doesNotMatch(styles, /(^|[;{]\s*)zoom\s*:/m);
  assert.doesNotMatch(scripts, /devicePixelRatio|visualViewport\.scale/);
});

test("identidade visual usa Assistente de Precificação nos títulos da interface", () => {
  assert.match(html, /<title>Assistente de Precificação<\/title>/);
  assert.match(html, /<p class="eyebrow">Simulador financeiro<\/p>\s*<h1>Assistente de Precificação<\/h1>/);
  assert.match(html, /id="aiAssistantTitle">Assistente de Precificação<\/h2>/);
  assert.doesNotMatch(html, /Precificação por Custos/);
});

test("login usa um container único centralizado para relacionar apresentação e formulário", () => {
  assert.match(html, /<header class="auth-header">[\s\S]*?<div class="brand">[\s\S]*?auth-theme-toggle[\s\S]*?<div class="auth-layout">/);
  assert.match(html, /<div class="auth-layout">[\s\S]*?<div class="auth-intro">[\s\S]*?<div class="auth-card">/);
  assert.match(html, /<div class="auth-intro-main">[\s\S]*?<div class="auth-copy">[\s\S]*?<div class="auth-benefits"/);
  assert.match(styles, /\.auth-layout\s*{[\s\S]*?grid-template-columns:\s*minmax\(0, 680px\) minmax\(440px, 680px\)[\s\S]*?width:\s*min\(100%, 1600px\)[\s\S]*?margin-inline:\s*auto/);
  assert.match(styles, /\.auth-view\s*{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)[\s\S]*?align-items:\s*stretch/);
  assert.match(styles, /\.auth-header\s*{[\s\S]*?display:\s*flex[\s\S]*?justify-content:\s*space-between[\s\S]*?width:\s*min\(100%, 1600px\)/);
  assert.match(styles, /\.auth-theme-toggle\s*{[\s\S]*?position:\s*static[\s\S]*?flex:\s*0 0 auto/);
  assert.doesNotMatch(styles, /\.auth-intro\s*{[\s\S]*?padding-right:\s*52px/);
  assert.match(styles, /@media \(max-width: 980px\)[\s\S]*?\.auth-layout\s*{[\s\S]*?grid-template-columns:\s*1fr/);
  const layoutRule = styles.match(/\.auth-layout\s*{[\s\S]*?\n}/)?.[0] || "";
  assert.doesNotMatch(layoutRule, /position:\s*absolute|transform:\s*scale|margin-(?:left|right):/);
});

test("shell preserva sidebar e dashboard lado a lado com um estágio desktop compacto", () => {
  assert.match(styles, /\.app-shell\s*{[\s\S]*?clamp\(20rem,[\s\S]*?38\.75rem[\s\S]*?minmax\(0, 1fr\)/);

  const comfortableStart = styles.indexOf("@media (min-width: 96.0625rem)");
  const compactStart = styles.indexOf("@media (max-width: 96rem) and (min-width: 56.3125rem)");
  const mobileStart = styles.indexOf("@media (max-width: 56.25rem)", compactStart);
  assert.ok(
    comfortableStart >= 0 && compactStart > comfortableStart && mobileStart > compactStart,
    "faixas de densidade desktop precisam continuar delimitadas",
  );
  const comfortableRules = styles.slice(comfortableStart, compactStart);
  const compactRules = styles.slice(compactStart, mobileStart);
  assert.match(comfortableRules, /\.pricing-sidebar\s*{[\s\S]*?var\(--desktop-sidebar-inline-space\)/);
  assert.match(comfortableRules, /\.workspace\s*{[\s\S]*?var\(--desktop-section-space\)/);
  assert.match(compactRules, /\.app-shell\s*{[\s\S]*?clamp\(16rem,[\s\S]*?20vw[\s\S]*?18\.25rem[\s\S]*?minmax\(0, 1fr\)/);
  assert.match(compactRules, /\.pricing-sidebar\s*{[\s\S]*?padding:\s*0 0\.8125rem 1\.1875rem/);
  assert.match(compactRules, /\.pricing-sidebar :is\([\s\S]*?min-height:\s*2\.3125rem/);
  assert.match(compactRules, /\.pricing-tab\s*{[\s\S]*?min-height:\s*2rem/);
  assert.doesNotMatch(compactRules, /grid-template-columns:\s*minmax\(0, 1fr\);/);

  assert.match(styles, /@media \(max-width: 900px\)\s*{[\s\S]*?\.app-shell\s*{\s*grid-template-columns:\s*1fr/);
  assert.match(styles, /\.pricing-sidebar\s*{[\s\S]*?height:\s*100dvh;[\s\S]*?overflow-y:\s*auto;[\s\S]*?scrollbar-gutter:\s*stable/);
});

test("grids principais respondem a largura do proprio conteudo", () => {
  assert.match(styles, /container: dashboard-summary \/ inline-size/);
  assert.match(styles, /container: market-dashboard \/ inline-size/);
  assert.match(styles, /@container market-dashboard \(max-width: 66rem\)[\s\S]*?\.market-results\s*{[\s\S]*?repeat\(2/);
  assert.match(styles, /@container market-dashboard \(max-width: 42rem\)[\s\S]*?\.market-results,[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /@container market-dashboard \(max-width: 42rem\)[\s\S]*?\.market-tax-scenarios,[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
});

test("overflow horizontal fica restrito a componentes que realmente precisam dele", () => {
  const bodyRule = styles.match(/body\s*{[\s\S]*?\n}/)?.[0] || "";
  assert.doesNotMatch(bodyRule, /overflow-x:\s*hidden/);
  assert.match(styles, /\.pricing-tabs\s*{[\s\S]*?overflow-x:\s*auto/);
  assert.match(styles, /\.detail-table-scroll\s*{[\s\S]*?overflow-x:\s*auto/);
  assert.match(styles, /\.table-panel\s*{[\s\S]*?overflow-x:\s*auto/);
});

test("campos monetarios reservam espaco reutilizavel para o prefixo em qualquer densidade", () => {
  assert.match(styles, /\.pricing-sidebar \.sidebar-input-wrap\.has-prefix input\s*{[\s\S]*?padding-inline-start:\s*2\.875rem/);
  assert.match(styles, /\.input-prefix\s*{[\s\S]*?inset-inline-start:\s*0\.8125rem/);
  assert.match(styles, /\.input-affix\s*{[\s\S]*?top:\s*50%;[\s\S]*?transform:\s*translateY\(-50%\)/);
  assert.doesNotMatch(styles, /\.sidebar-input-wrap\.has-prefix input\s*{[\s\S]*?padding-left:\s*43px/);
});

test("modais respeitam largura e altura dinamicas da viewport", () => {
  assert.match(styles, /\.modal-dialog,[\s\S]*?max-block-size: calc\(100dvh - 2rem\)/);
  assert.match(styles, /\.modal-dialog,[\s\S]*?overflow: auto/);
});
