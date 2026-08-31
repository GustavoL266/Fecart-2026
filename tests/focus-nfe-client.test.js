import assert from "node:assert/strict";
import test from "node:test";
import { FOCUS_NFE_ENVIRONMENTS, getFocusNfeConfig } from "../lib/config.js";
import { focusNFeErrorForClient, FocusNFeClient, FocusNFeError, redactFocusNFeSensitiveData } from "../lib/focus-nfe-client.js";

const validNcm = {
  codigo: "90049090",
  descricao_completa: "Óculos para correção, proteção ou outros fins",
  capitulo: "90",
  posicao: "04",
  subposicao1: "9",
  subposicao2: "0",
  item1: "9",
  item2: "0",
};

function response(status, body = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

function clientWith(fetchImpl, options = {}) {
  return new FocusNFeClient({
    token: "token-ficticio-de-teste",
    baseUrl: FOCUS_NFE_ENVIRONMENTS.homologation,
    fetchImpl,
    maxRetries: 0,
    sleep: async () => {},
    logger: { warn() {} },
    ...options,
  });
}

test("seleciona homologação por padrão e aceita somente os dois ambientes oficiais", () => {
  assert.equal(getFocusNfeConfig({ FOCUS_NFE_TOKEN: "teste" }).baseUrl, FOCUS_NFE_ENVIRONMENTS.homologation);
  assert.equal(getFocusNfeConfig({ FOCUS_NFE_TOKEN: "teste", FOCUS_NFE_BASE_URL: FOCUS_NFE_ENVIRONMENTS.production }).environment, "production");
  assert.throws(
    () => getFocusNfeConfig({ FOCUS_NFE_TOKEN: "teste", FOCUS_NFE_BASE_URL: "https://exemplo.invalid" }),
    /FOCUS_NFE_BASE_URL/,
  );
});

test("envia HTTP Basic com token como usuário e senha vazia", async () => {
  let captured;
  const client = clientWith(async (url, options) => {
    captured = { url, options };
    return response(200, validNcm);
  });

  await client.getNcm("90049090");
  const encoded = captured.options.headers.Authorization.replace(/^Basic /, "");
  assert.equal(Buffer.from(encoded, "base64").toString("utf8"), "token-ficticio-de-teste:");
  assert.equal(captured.url, "https://homologacao.focusnfe.com.br/v2/ncms/90049090");
  assert.equal(captured.options.method, "GET");
});

test("consulta e valida um NCM existente", async () => {
  const client = clientWith(async () => response(200, validNcm));
  assert.deepEqual(await client.getNcm("9004.90.90"), validNcm);
});

test("rejeita NCM inválido localmente sem chamar a API", async () => {
  let calls = 0;
  const client = clientWith(async () => {
    calls += 1;
    return response(200, validNcm);
  });

  await assert.rejects(() => client.getNcm("123"), { code: "INVALID_NCM_CODE", status: 400 });
  assert.equal(calls, 0);
});

test("normaliza respostas 401 e 404 sem expor o corpo externo", async (context) => {
  await context.test("401", async () => {
    const client = clientWith(async () => response(401, "HTTP Basic: Access denied"));
    await assert.rejects(() => client.getNcm("90049090"), { code: "FOCUS_NFE_UNAUTHORIZED", status: 503 });
  });
  await context.test("404", async () => {
    const client = clientWith(async () => response(404, { codigo: "nao_encontrado", mensagem: "Código NCM não encontrado" }));
    await assert.rejects(() => client.getNcm("90049090"), { code: "FOCUS_NFE_NCM_NOT_FOUND", status: 404 });
  });
});

test("repete limite de requisições e falhas temporárias de forma limitada", async (context) => {
  await context.test("429 seguido de sucesso", async () => {
    let calls = 0;
    const client = clientWith(async () => {
      calls += 1;
      return calls === 1 ? response(429, {}, { "retry-after": "0" }) : response(200, validNcm);
    }, { maxRetries: 1 });
    assert.equal((await client.getNcm("90049090")).codigo, "90049090");
    assert.equal(calls, 2);
  });
  await context.test("503 persistente", async () => {
    let calls = 0;
    const client = clientWith(async () => {
      calls += 1;
      return response(503);
    }, { maxRetries: 2 });
    await assert.rejects(() => client.getNcm("90049090"), { code: "FOCUS_NFE_UNAVAILABLE", status: 503 });
    assert.equal(calls, 3);
  });
});

test("trata timeout e indisponibilidade", async (context) => {
  await context.test("timeout", async () => {
    const client = clientWith((url, options) => new Promise((resolvePromise, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }), { timeoutMs: 10 });
    await assert.rejects(() => client.getNcm("90049090"), { code: "FOCUS_NFE_TIMEOUT", status: 503 });
  });
  await context.test("falha de rede", async () => {
    const client = clientWith(async () => { throw new TypeError("network down"); });
    await assert.rejects(() => client.getNcm("90049090"), { code: "FOCUS_NFE_UNAVAILABLE", status: 503 });
  });
});

test("não inclui token em logs nem em erros públicos", async () => {
  const token = "segredo-ficticio-que-nao-pode-vazar";
  const logged = [];
  const client = new FocusNFeClient({
    token,
    baseUrl: FOCUS_NFE_ENVIRONMENTS.homologation,
    fetchImpl: async () => response(503, { mensagem: token }),
    maxRetries: 0,
    logger: { warn: (...args) => logged.push(args) },
  });

  let thrown;
  try {
    await client.getNcm("90049090");
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof FocusNFeError);
  assert.equal(JSON.stringify(logged).includes(token), false);
  assert.equal(JSON.stringify(focusNFeErrorForClient(thrown, [token])).includes(token), false);
  assert.equal(redactFocusNFeSensitiveData(`Basic abc123 ${token}`, [token]), "Basic [REDACTED] [REDACTED]");
});

test("rejeita resposta 200 com contrato inválido", async () => {
  const client = clientWith(async () => response(200, { codigo: "90049090" }));
  await assert.rejects(() => client.getNcm("90049090"), { code: "FOCUS_NFE_INVALID_RESPONSE", status: 503 });
});
