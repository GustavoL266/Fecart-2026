import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { IbptTaxProvider } from "../lib/ibpt-tax-provider.js";
import { TaxService, marketTaxError, marketTaxPrerequisiteError } from "../js/services/tax-service.js";

const tablePath = fileURLToPath(new URL("../data/ibpt/TabelaIBPTaxSP26.2.A.csv", import.meta.url));
const silentLogger = { info() {}, error() {} };

test("carrega a tabela CP1252 uma vez e expõe metadados sem o conteúdo", async () => {
  const bytes = await readFile(tablePath);
  let reads = 0;
  const provider = new IbptTaxProvider({ filePath: tablePath, readFile() { reads += 1; return bytes; }, logger: silentLogger });

  assert.deepEqual(provider.health(), { provider: "IBPT", configured: true, version: "26.2.A" });
  assert.equal(provider.metadata.encoding, "windows-1252");
  assert.equal(provider.metadata.recordCount, 12_162);
  assert.equal(provider.metadata.indexedNcmCount, 10_518);
  assert.equal(provider.metadata.validFrom, "20/08/2026");
  assert.equal(provider.metadata.validTo, "30/09/2026");
  assert.equal(provider.metadata.source, "IBPT / Empresômetro");
  provider.findByNcm("85171300");
  provider.findByNcm("09012100");
  assert.equal(reads, 1);
});

test("usa os componentes IBPT separados para produto nacional", () => {
  const provider = new IbptTaxProvider({ filePath: tablePath, logger: silentLogger });
  const result = provider.calculate({ ncm: "85171300", productOrigin: "nacional", unitValue: 8_899 });

  assert.deepEqual(result.rates, { federal: 17.88, state: 12, municipal: 0, total: 29.88 });
  assert.equal(result.estimatedTaxes, 2_659.02);
  assert.equal(result.total, 11_558.02);
  assert.equal(result.marketPrice, 8_899);
  assert.equal(result.productOrigin, "nacional");
});

test("usa importadosfederal somente quando a origem é importada", () => {
  const provider = new IbptTaxProvider({ filePath: tablePath, logger: silentLogger });
  const result = provider.calculate({ ncm: "85171300", productOrigin: "importado", unitValue: 8_899 });

  assert.deepEqual(result.rates, { federal: 24.57, state: 12, municipal: 0, total: 36.57 });
  assert.equal(result.estimatedTaxes, 3_254.36);
  assert.equal(result.total, 12_153.36);
});

test("busca somente o NCM exato e exige origem e maior preço válidos", () => {
  const provider = new IbptTaxProvider({ filePath: tablePath, logger: silentLogger });
  assert.throws(() => provider.findByNcm("8517"), { code: "NCM_REQUIRED" });
  assert.throws(() => provider.findByNcm("99999999"), { code: "IBPT_NCM_NOT_FOUND" });
  assert.throws(() => provider.calculate({ ncm: "85171300", productOrigin: "", unitValue: 100 }), { code: "PRODUCT_ORIGIN_REQUIRED" });
  assert.throws(() => provider.calculate({ ncm: "85171300", productOrigin: "nacional", unitValue: 0 }), { code: "INVALID_TAX_CONTEXT" });
});

test("distingue arquivo ausente de CSV malformado", () => {
  const missing = new IbptTaxProvider({ filePath: "missing.csv", logger: silentLogger, readFile() { const error = new Error("missing"); error.code = "ENOENT"; throw error; } });
  const malformed = new IbptTaxProvider({ filePath: "bad.csv", logger: silentLogger, readFile() { return Buffer.from("codigo;descricao\n85171300;incompleto", "latin1"); } });

  assert.deepEqual(missing.health(), { provider: "IBPT", configured: false, version: null, errorCode: "IBPT_NOT_CONFIGURED" });
  assert.deepEqual(malformed.health(), { provider: "IBPT", configured: false, version: null, errorCode: "IBPT_INVALID_FILE" });
  assert.throws(() => missing.findByNcm("85171300"), { code: "IBPT_NOT_CONFIGURED" });
  assert.throws(() => malformed.findByNcm("85171300"), { code: "IBPT_INVALID_FILE" });
});

test("decodifica conteúdo Windows-1252 sem exigir UTF-8", () => {
  const csv = [
    "codigo;ex;tipo;descricao;nacionalfederal;importadosfederal;estadual;municipal;vigenciainicio;vigenciafim;chave;versao;fonte",
    '17019900;;0;"Açúcar";10.00;20.00;5.00;1.00;20/08/2026;30/09/2026;ABC;26.2.A;IBPT/empresometro.com.br',
  ].join("\r\n");
  const provider = new IbptTaxProvider({ filePath: "fixture.csv", logger: silentLogger, readFile() { return Buffer.from(csv, "latin1"); } });
  assert.equal(provider.findByNcm("17019900").description, "Açúcar");
});

test("serviço do navegador envia somente os dados da estimativa local", async () => {
  let request;
  const service = new TaxService({ apiClient: { async post(path, body) { request = { path, body }; return {}; } } });
  await service.calculateMaximum({ ncm: "85171300", productOrigin: "nacional", unitValue: 100, classificationId: "proof", originalQuery: "iPhone", normalizedQuery: "telefone celular smartphone" });
  assert.deepEqual(request, { path: "/tax/estimate", body: { ncm: "85171300", productOrigin: "nacional", unitValue: 100, classificationId: "proof", originalQuery: "iPhone", normalizedQuery: "telefone celular smartphone" } });
});

test("pré-requisitos e mensagens cobrem NCM, origem, país, tabela e NCM ausente", () => {
  assert.equal(marketTaxPrerequisiteError({}, 100, { configured: true }).code, "NCM_REQUIRED");
  assert.equal(marketTaxPrerequisiteError({ ncm: "85171300", ncmConfirmed: true }, 100, { configured: true }).code, "PRODUCT_ORIGIN_REQUIRED");
  assert.equal(marketTaxPrerequisiteError({ ncm: "85171300", ncmConfirmed: true, productOrigin: "importado" }, 100, { configured: true }).code, "COUNTRY_OF_ORIGIN_REQUIRED");
  assert.equal(marketTaxPrerequisiteError({ ncm: "85171300", ncmConfirmed: true, productOrigin: "importado", countryOfOrigin: "China" }, 100, { configured: true }), null);
  assert.equal(marketTaxPrerequisiteError({ ncm: "85171300", ncmConfirmed: true, productOrigin: "nacional" }, 100, { configured: false, errorCode: "IBPT_INVALID_FILE" }).code, "IBPT_INVALID_FILE");
  assert.equal(marketTaxError({ code: "IBPT_NCM_NOT_FOUND" }).shortMessage, "NCM não encontrado na tabela IBPT");
});
