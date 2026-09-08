import { readFileSync } from "node:fs";

const REQUIRED_COLUMNS = Object.freeze([
  "codigo",
  "ex",
  "tipo",
  "descricao",
  "nacionalfederal",
  "importadosfederal",
  "estadual",
  "municipal",
  "vigenciainicio",
  "vigenciafim",
  "chave",
  "versao",
  "fonte",
]);

function rounded(value, decimalPlaces = 2) {
  const scale = 10 ** decimalPlaces;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function parseCsvLine(line) {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ";" && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("Campo CSV com aspas não finalizadas.");
  fields.push(field);
  return fields;
}

function percentage(value, fieldName, lineNumber) {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error(`Percentual ${fieldName} inválido na linha ${lineNumber}.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) throw new Error(`Percentual ${fieldName} inválido na linha ${lineNumber}.`);
  return parsed;
}

function normalizedSource(value) {
  return /empresometro/i.test(value) ? "IBPT / Empresômetro" : value;
}

export class IbptTaxError extends Error {
  constructor(message, { code = "IBPT_ERROR", status = 500, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "IbptTaxError";
    this.code = code;
    this.status = status;
  }
}

function loadError(error) {
  if (error instanceof IbptTaxError) return error;
  if (error?.code === "ENOENT") {
    return new IbptTaxError("Tabela IBPT não configurada.", { code: "IBPT_NOT_CONFIGURED", status: 503, cause: error });
  }
  return new IbptTaxError("Não foi possível carregar a tabela tributária.", { code: "IBPT_INVALID_FILE", status: 503, cause: error });
}

export class IbptTaxProvider {
  #index = new Map();
  #loadFailure = null;
  #metadata = { provider: "IBPT", configured: false, version: null, validFrom: null, validTo: null, source: null, recordCount: 0, indexedNcmCount: 0, encoding: "windows-1252" };

  constructor({ filePath, readFile = readFileSync, logger = console } = {}) {
    try {
      if (!filePath) {
        const error = new Error("Caminho da tabela ausente.");
        error.code = "ENOENT";
        throw error;
      }
      const bytes = readFile(filePath);
      const text = new TextDecoder("windows-1252", { fatal: true }).decode(bytes);
      const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
      while (lines.at(-1) === "") lines.pop();
      if (lines.length < 2) throw new Error("A tabela não contém registros.");

      const headers = parseCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
      if (headers.length !== REQUIRED_COLUMNS.length || REQUIRED_COLUMNS.some((column, index) => headers[index] !== column)) {
        throw new Error("Cabeçalho da tabela IBPT incompatível.");
      }

      let version = "";
      let validFrom = "";
      let validTo = "";
      let source = "";
      for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
        const lineNumber = lineIndex + 1;
        const values = parseCsvLine(lines[lineIndex]);
        if (values.length !== headers.length) throw new Error(`Quantidade de colunas inválida na linha ${lineNumber}.`);
        const row = Object.fromEntries(headers.map((header, index) => [header, values[index].trim()]));
        if (!/^\d{4,9}$/.test(row.codigo) || !row.descricao || !row.versao || !row.vigenciainicio || !row.vigenciafim || !row.fonte) {
          throw new Error(`Registro IBPT inválido na linha ${lineNumber}.`);
        }
        const record = Object.freeze({
          code: row.codigo,
          ex: row.ex,
          description: row.descricao,
          nationalFederalRate: percentage(row.nacionalfederal, "nacionalfederal", lineNumber),
          importedFederalRate: percentage(row.importadosfederal, "importadosfederal", lineNumber),
          stateRate: percentage(row.estadual, "estadual", lineNumber),
          municipalRate: percentage(row.municipal, "municipal", lineNumber),
          validFrom: row.vigenciainicio,
          validTo: row.vigenciafim,
          version: row.versao,
          source: normalizedSource(row.fonte),
        });
        version ||= record.version;
        validFrom ||= record.validFrom;
        validTo ||= record.validTo;
        source ||= record.source;
        if (record.version !== version || record.validFrom !== validFrom || record.validTo !== validTo || record.source !== source) {
          throw new Error(`Metadados divergentes na linha ${lineNumber}.`);
        }
        if (/^\d{8}$/.test(record.code)) {
          const indexed = this.#index.get(record.code);
          if (!indexed || (indexed.ex && !record.ex)) this.#index.set(record.code, record);
        }
      }
      this.#metadata = Object.freeze({
        provider: "IBPT",
        configured: true,
        version,
        validFrom,
        validTo,
        source,
        recordCount: lines.length - 1,
        indexedNcmCount: this.#index.size,
        encoding: "windows-1252",
      });
      logger.info?.(`[TaxEstimate] provider=IBPT configured=true version=${version} records=${this.#metadata.recordCount}`);
    } catch (error) {
      this.#index.clear();
      this.#loadFailure = loadError(error);
      logger.error?.(`[TaxEstimate] provider=IBPT configured=false code=${this.#loadFailure.code}`);
    }
  }

  get metadata() {
    return this.#metadata;
  }

  health() {
    return {
      provider: "IBPT",
      configured: this.#metadata.configured,
      version: this.#metadata.version,
      ...(this.#loadFailure ? { errorCode: this.#loadFailure.code } : {}),
    };
  }

  findByNcm(ncm) {
    if (this.#loadFailure) throw this.#loadFailure;
    if (typeof ncm !== "string" || !/^\d{8}$/.test(ncm)) {
      throw new IbptTaxError("NCM necessário.", { code: "NCM_REQUIRED", status: 400 });
    }
    const record = this.#index.get(ncm);
    if (!record) throw new IbptTaxError("NCM não encontrado na tabela IBPT.", { code: "IBPT_NCM_NOT_FOUND", status: 404 });
    return record;
  }

  calculate({ ncm, productOrigin, unitValue } = {}) {
    const record = this.findByNcm(ncm);
    if (!["nacional", "importado"].includes(productOrigin)) {
      throw new IbptTaxError("Selecione a origem do produto.", { code: "PRODUCT_ORIGIN_REQUIRED", status: 400 });
    }
    if (!Number.isFinite(unitValue) || unitValue <= 0) {
      throw new IbptTaxError("Informe um maior preço válido e positivo.", { code: "INVALID_TAX_CONTEXT", status: 400 });
    }
    const federalRate = productOrigin === "nacional" ? record.nationalFederalRate : record.importedFederalRate;
    const totalRate = rounded(federalRate + record.stateRate + record.municipalRate);
    const estimatedTaxes = rounded(unitValue * totalRate / 100);
    return Object.freeze({
      provider: "IBPT",
      source: record.source,
      version: record.version,
      validFrom: record.validFrom,
      validTo: record.validTo,
      ncm: record.code,
      description: record.description,
      productOrigin,
      marketPrice: unitValue,
      rates: Object.freeze({ federal: federalRate, state: record.stateRate, municipal: record.municipalRate, total: totalRate }),
      estimatedTaxes,
      total: rounded(unitValue + estimatedTaxes),
    });
  }
}

export function ibptErrorForClient(error) {
  return { error: error.message, code: error.code || "IBPT_ERROR" };
}

export function createIbptTaxProvider(options) {
  return new IbptTaxProvider(options);
}
