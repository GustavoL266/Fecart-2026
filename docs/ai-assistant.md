# Preenchimento assistido por IA

O assistente interpreta uma mensagem, apresenta uma prévia e preenche apenas os campos confirmados. Ele não calcula nem recomenda o preço final. O módulo financeiro `js/domain/pricing-calculator.js` permanece intacto, compartilhado pelo navegador e pelo servidor.

## Configuração

| Variável | Uso | Padrão |
| --- | --- | --- |
| `GEMINI_API_KEY` | Credencial Gemini, somente no processo do backend | Vazia; recurso indisponível |
| `AI_PROVIDER` | Implementação do provedor | `gemini` |
| `AI_MODEL` | Modelo Gemini compatível com saída estruturada | `gemini-3.5-flash-lite` |
| `AI_TIMEOUT_MS` | Tempo máximo da chamada, inteiro de 100 a 60000 ms | `25000` |

Localmente, configure no `.env`, que já é ignorado pelo Git. No Render, abra o Web Service do projeto, **Environment → Add Environment Variable**, cadastre `GEMINI_API_KEY` com sua chave real e salve. Em serviços existentes, substitua os valores antigos de `AI_PROVIDER` e `AI_MODEL` pelos da tabela. Depois faça **Manual Deploy → Deploy latest commit**. Nunca grave a chave no frontend, no GitHub ou neste documento. Uma configuração ausente ou inválida desabilita apenas o assistente.

O provedor usa REST nativo via `fetch` do Node, sem SDK ou camada de compatibilidade OpenAI. A chamada é `POST https://generativelanguage.googleapis.com/v1beta/models/{AI_MODEL}:generateContent`. A chave vai somente no cabeçalho `x-goog-api-key`, nunca na URL. O contrato usa `systemInstruction`, uma mensagem em `contents`, `generationConfig.responseMimeType: "application/json"` e `generationConfig.responseJsonSchema`. Há um candidato e limite de 3000 tokens; nenhum histórico ou ferramenta é enviado.

O modelo estável [Gemini 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) foi confirmado novamente na documentação em 11/09/2026: o identificador é `gemini-3.5-flash-lite`, ele é voltado a baixa latência, baixo custo e extração simples, aceita `generateContent` e suporta saída estruturada. O modelo também consta nas [tabelas atuais de limites da API](https://ai.google.dev/gemini-api/docs/rate-limits). A [referência generateContent](https://ai.google.dev/api/generate-content) documenta `responseMimeType` e `responseJsonSchema`, enquanto o [guia de migração](https://ai.google.dev/gemini-api/docs/migrate-to-interactions#structured-output) mantém esses controles dentro de `generationConfig` para `generateContent`. Esta integração não envia junto `responseFormat` nem `responseSchema`. O modelo fica configurável por ambiente; o nome precisa começar com `gemini-`, sem barras, query string ou caracteres de controle.

O schema externo usa somente recursos documentados: `object`, `array`, `string`, `number`, `integer`, `null`, união de tipos para nulabilidade, `required`, `enum`, `items` e `additionalProperties: false`. Ele omite deliberadamente `maxItems`: a chamada real retornou 400 quando `maxItems: 35` era combinado com o enum de 35 campos. A validação Zod rigorosa do backend continua limitando o array a 35 entradas e sendo a autoridade para evidências, duplicatas, normalização de lote, limites e campos aceitos.

Esta funcionalidade agora depende exclusivamente de `GEMINI_API_KEY`. `OPENAI_API_KEY`, `AI_PROVIDER=openai` e o modelo anterior não são usados. Em um serviço Render existente, **troque também AI_PROVIDER e AI_MODEL**, pois variáveis antigas explícitas prevalecem sobre os novos padrões. Depois de migrar, a antiga chave OpenAI pode ser removida do ambiente deste projeto.

### Diagnóstico no Render

Sem `GEMINI_API_KEY`, `getAiAssistantConfig().isConfigured` é falso, `createAiFormProvider` retorna `null` e a rota autenticada retorna `503 GEMINI_NOT_CONFIGURED` **antes de chamar a Gemini**. O antigo incidente de configuração envolvia o provedor OpenAI anterior à migração; não é evidência sobre a configuração atual da Gemini no Render.

Para habilitar a análise, configure no **Render → fecart-2026 → Environment**:

```text
GEMINI_API_KEY=<informar o segredo somente no painel>
AI_PROVIDER=gemini
AI_MODEL=gemini-3.5-flash-lite
AI_TIMEOUT_MS=25000
```

`render.yaml` já declara a chave com `sync: false`; isso não cadastra o segredo em um serviço existente. Não troque `SESSION_SECRET` nem `DATABASE_URL` para corrigir a IA. Mantenha `NODE_ENV=production` e `SESSION_COOKIE_SECURE=true`, como previsto no Blueprint. Salve a configuração e publique o commit atualizado com **Manual Deploy → Deploy latest commit**.

Depois do deploy, `GET /health` inclui:

```json
{
  "ai": {
    "provider": "gemini",
    "configured": false,
    "model": "gemini-3.5-flash-lite",
    "timeoutMs": 25000,
    "apiVersion": "v1beta",
    "method": "generateContent",
    "structuredOutput": "generationConfig.responseMimeType+responseJsonSchema",
    "configurationErrors": ["GEMINI_API_KEY_MISSING"]
  },
  "deployment": {
    "commit": "<sha de 40 caracteres ou null fora do Render>"
  }
}
```

Quando as variáveis forem aceitas, `configured` será `true` e `configurationErrors` será `[]`. Compare `model`, `timeoutMs` e `deployment.commit` com o valor esperado e o commit enviado ao GitHub. Isso confirma somente presença/formato de configuração e o processo publicado; não valida chave, saldo, permissão nem disponibilidade do modelo para a conta. `/health` não faz chamadas pagas e não muda o estado geral do servidor por indisponibilidade desse recurso opcional. Os outros motivos possíveis são `AI_PROVIDER_UNSUPPORTED`, `AI_MODEL_INVALID` e `AI_TIMEOUT_INVALID`. Não são exibidos valores de variáveis, credenciais ou mensagens do usuário.

O log de inicialização `[AI] Configuration` mostra o mesmo diagnóstico seguro e `[Deploy] Configuration` mostra somente o SHA validado. Em falha HTTP da Gemini são registrados somente `[AI] upstreamStatus`, `[AI] upstreamErrorCode` e `[AI] upstreamErrorStatus`. Mensagens livres do provedor são descartadas. Análises válidas registram `provider=gemini` e `status=200`. Nunca são registrados o objeto de erro original, stack, cabeçalhos, prompt, resposta bruta ou texto do usuário.

Para comprovar a disponibilidade na conta e o contrato real, abra o **Shell** do Web Service depois do deploy e execute:

```text
pnpm gemini:check
```

O comando faz primeiro um `GET /v1beta/models/{AI_MODEL}` sem prompt e confirma `generateContent`. Em seguida faz duas gerações estruturadas: o caso mínimo do bolo e o lote de brigadeiros, cuja normalização é validada no backend. A saída contém somente `ok`, modelo, método, contrato e, em falha, os mesmos códigos/metadados seguros. O comando não imprime chave, cabeçalhos, prompt, corpo bruto ou stack. Essas gerações podem consumir quota/créditos e não devem ser executadas em repetição automática.

`pnpm gemini:probe` é o diagnóstico incremental de desenvolvimento. Ele usa o prompt fixo de bolo, reproduz os dois payloads rejeitados, aumenta o schema por etapas e mostra somente nome da etapa, status/códigos upstream e metadados estruturais da resposta. Ele faz várias chamadas reais, inclusive controles que devem retornar 400, e não deve ser executado como monitor periódico.

### Incidente HTTP 502 de 11/09/2026

No momento da investigação, `https://fecart-2026.onrender.com/health` respondeu `200`, banco conectado e `ai.provider: "gemini"`, `ai.configured: true`, sem erros locais de configuração. O `app.js` publicado tinha o mesmo SHA-256 do bundle do commit então presente no repositório. Isso comprova o frontend publicado e que a aplicação aceitou presença/formato das variáveis, mas não comprova a chave, a conta, o modelo efetivo anterior a este diagnóstico nem o backend exato sem um SHA publicado.

A resposta real de produção confirmou `502 GEMINI_BAD_REQUEST`. O probe autenticado com `gemini-3.5-flash-lite` reproduziu duas rejeições independentes: `responseFormat.text.mimeType: "application/json"` retornou 400 `INVALID_ARGUMENT`, e o schema já migrado ainda retornou 400 enquanto continha `entries.maxItems: 35` junto do enum de 35 campos. `responseMimeType + responseJsonSchema` mínimo retornou 200; o schema completo sem `maxItems` retornou 200; adicionar `systemInstruction`, `candidateCount: 1` e `maxOutputTokens: 3000` manteve HTTP 200. O `pnpm gemini:check` real passou tanto para “Quero vender bolo e quero margem de 10%” quanto para o lote de brigadeiros. Assim, o `GEMINI_BAD_REQUEST` desapareceu sem desativar Structured Output nem relaxar a validação do backend.

### Códigos de erro

As respostas de erro continuam não sendo sucesso: `{ "error": "mensagem segura", "code": "CÓDIGO_INTERNO" }`. A interface apresenta mensagens locais e mantém os campos intactos. Consulte o [guia de diagnóstico da Gemini](https://ai.google.dev/gemini-api/docs/troubleshooting). O adapter lê somente status HTTP e detalhes estruturados Google RPC; não interpreta nem retransmite a mensagem livre do erro externo.

| HTTP da aplicação | Código | Significado e ação |
| --- | --- | --- |
| 503 | `GEMINI_NOT_CONFIGURED` | Configuração ausente ou inválida; conferir `ai.configurationErrors` e Environment. |
| 502 | `GEMINI_UNAUTHORIZED` | HTTP 401 ou `ErrorInfo.reason` igual a `API_KEY_INVALID`/`API_KEY_EXPIRED`, inclusive em HTTP 400; revisar a credencial sem encerrar a sessão do site. |
| 502 | `GEMINI_FORBIDDEN` | Gemini respondeu 403; conferir permissão ou restrição de acesso. |
| 502 | `GEMINI_MODEL_UNAVAILABLE` | Modelo inexistente ou indisponível para a conta (404). |
| 502 | `GEMINI_BAD_REQUEST` | Gemini rejeitou a requisição/configuração (400/422); logs expõem somente status/código upstream estruturados. |
| 503 | `GEMINI_QUOTA_EXCEEDED` | Créditos, orçamento ou quota da integração esgotados; repetir sem corrigir o limite não resolve. |
| 429 | `GEMINI_RATE_LIMITED` | Limite temporário do provedor; aguardar antes de tentar novamente. |
| 429 | `AI_RATE_LIMITED` | Oito análises por minuto por conta/IP na aplicação; respeitar `Retry-After`. |
| 409 | `AI_REQUEST_IN_PROGRESS` | Já existe análise pendente para a conta. |
| 504 | `GEMINI_TIMEOUT` | Prazo de análise excedido, inclusive durante a leitura da resposta. |
| 503 | `GEMINI_CONNECTION_ERROR` | Falha de rede ao conectar ao provedor. |
| 503 | `GEMINI_UNAVAILABLE` | Falha temporária do provedor, como 500/503. |
| 502 | `GEMINI_INVALID_RESPONSE` | JSON, estrutura, evidências ou valores inválidos; nenhum campo aplicado. |
| 422 | `AI_INSUFFICIENT_INFORMATION` | Texto insuficiente ou recusa do modelo. |
| 400/413 | `INVALID_AI_REQUEST` | Corpo inválido, mensagem fora do limite ou corpo excessivo. |
| 500 | `AI_INTERNAL_ERROR` | Falha inesperada, incluindo falha anterior ao provedor no processamento da rota. |
| 401 | `SESSION_REQUIRED` | Sessão do site ausente/expirada; entrar novamente. |

HTTP 401 de Gemini é convertido em erro de integração 502 com código próprio; não vira `SESSION_REQUIRED`. Nenhum erro é transformado em 200, dado fictício ou extração alternativa por regex.

Tanto quota quanto excesso de requisições podem vir como 429. O adapter diferencia cota diária/mensal/anual por `QuotaFailure.violations[].quotaId` e razões conhecidas de `ErrorInfo` para quota/faturamento. Um limite por minuto ou 429 sem detalhe suficiente retorna `GEMINI_RATE_LIMITED`: o HTTP isolado não permite afirmar que o saldo acabou. Esses detalhes nunca são gravados em logs nem enviados ao navegador. Respostas bloqueadas por segurança viram informação insuficiente; geração truncada, candidatos inesperados, ferramentas e JSON inválido são rejeitados. Partes internas marcadas `thought: true` não entram no JSON aplicado.

### Como interpretar `/auth/me` 401

`js/main.js` chama `/auth/me` no carregamento inicial, com `credentials: "include"` pelo api-client. Sem sessão, a resposta `401 SESSION_REQUIRED` leva ao login e não gera novas tentativas. O Console pode manter essa requisição depois de um login bem-sucedido. Abrir o modal e analisar uma mensagem não chama `/auth/me` novamente. Falhas transitórias de inicialização permitem até duas novas tentativas.

Apenas `SESSION_REQUIRED` significa sessão expirada, inclusive no bootstrap. Respostas e tentativas antigas são descartadas se o estado de autenticação tiver mudado. O backend mantém sessões PostgreSQL, salva a sessão antes de concluir login/cadastro e usa cookie `HttpOnly`, `SameSite=Lax`, `Secure` em produção e `trust proxy=1` para HTTPS terminado no Render.

Não foi possível comprovar a ordem do 401 da captura sem o histórico das requisições e os logs da sessão. Se ele aparecer **após** login, confira a sequência na aba Network e se o navegador envia o cookie `pricing.sid`, sem copiar seu valor. Um 401 de `/auth/me` significa ausência de usuário reconhecido naquela requisição; não é uma chamada à Gemini. Falha de banco segue o tratamento de erro do servidor e não deve ser interpretada como senha inválida ou `SESSION_REQUIRED`.

## Fluxo e arquitetura

1. `js/ui/ai-assistant.js` abre o modal e envia somente a mensagem, sem histórico, formulário completo ou dados da conta.
2. `lib/ai-pricing-route.js` exige a mesma autenticação do site e aplica limites por conta e IP.
3. `lib/ai-form-assistant.js` seleciona o provedor e orquestra a validação. Novos provedores devem implementar `extract(message)`; o restante do fluxo pode ser reutilizado.
4. `lib/gemini-form-provider.js` pede entradas estruturadas, cada uma com campo, valor e trecho literal que comprova a extração. Custos de lote incluem quantidade e evidência do lote.
5. `lib/ai-pricing-schema.js` valida o retorno e gera os rótulos e valores da prévia de forma determinística. A extração bruta e o prompt não são enviados ao navegador.
6. Somente **Aplicar ao simulador** chama `applyAssistantFields` e o controlador existente em `js/main.js`. Não há eventos sintéticos, simulação de digitação nem cálculo financeiro pelo modelo.

### Contrato público

`POST /ai/parse-pricing`, com cookie de sessão e `Content-Type: application/json`:

```json
{ "message": "Coloque matéria-prima como R$ 20 e margem em 30%." }
```

Resposta:

```json
{
  "fields": { "materialCost": 20, "desiredNetMargin": 30 },
  "summary": [
    { "field": "materialCost", "label": "Matéria-prima por unidade", "value": "R$ 20,00" },
    { "field": "desiredNetMargin", "label": "Margem líquida desejada", "value": "30%" }
  ]
}
```

As porcentagens deste contrato são pontos percentuais (`30` significa `30%`). O formulário faz sua conversão habitual para frações ao calcular. Campos ausentes são omitidos; entradas `null` são descartadas. Zero é aplicado quando informado ou quando a retirada do desconto é explícita. Se houver um campo inválido na resposta, a análise inteira é rejeitada e nenhum valor é aplicado.

## Campos atendidos

| Grupo | IDs reais do formulário |
| --- | --- |
| Produto | `productName`, `productDescription` |
| Custos diretos | `materialCost`, `wasteRate`, `packagingCost`, `deliveryCost`, `insuranceCost`, `otherDirectExpenses` |
| Estrutura mensal | `monthlyPayroll`, `monthlyFixedCosts`, `expectedMonthlyUnits` |
| Capacidade produtiva | `workerCount`, `productiveHoursPerWorkerMonth`, `unitsPerWorkerHour` |
| Despesas de venda e margem | `paymentFeeRate`, `commissionRate`, `desiredNetMargin` |
| Desconto comercial | `discountRate`, `fixedDiscountAmount` |
| Prazos e capital | `inventoryDays`, `receivingDays`, `paymentDays`, `monthlyCapitalRate` |
| Mercado | `marketQuery`, `marketPrice` somente quando o usuário fornece um valor da concorrência |
| Contexto fiscal explícito | `taxRate` (carga TOTAL manual), `cfop`, `taxSituation`, `taxRegime`, `customerType`, `operationPurpose`, `productOrigin`, `originState`, `destinationState`, `countryOfOrigin` |

O formulário atual não tem campos de alíquotas individuais de ICMS, IPI, PIS/COFINS, DIFAL ou IBS/CBS. Esses dados não são convertidos em carga tributária total. O NCM é uma confirmação da integração Focus NFe, e continua sendo escolhido pelo fluxo fiscal existente. Não se inventam códigos, taxas, horas produtivas ou volume mensal. Não há campo separado de tipo/categoria de produto nesta tela para preencher.

“R$ 40 em ingredientes para produzir 100 unidades, R$ 10 em embalagens” resulta em matéria-prima `0,40` e embalagem `0,10` por unidade, com a divisão identificada na prévia. O backend faz apenas essa normalização de entrada; o lote não vira produção mensal. Se os dados não identificarem claramente um custo unitário ou de lote, os campos ambíguos devem ser omitidos.

“Adicione R$ 4 de frete” define frete como `4`; não soma a valores desconhecidos do formulário. “Retire o desconto” zera as duas modalidades. Campos obrigatórios ainda vazios continuam pendentes e o dashboard informa que é necessário completá-los.

“Pesquise iPhone 15 Pro Max no mercado” prepara `marketQuery` e oferece **Pesquisar no mercado** após a aplicação. A pesquisa real permanece na integração atual SearchAPI / Google Shopping; seus providers e o fluxo fiscal não foram substituídos.

## Validação e proteção

- Zod estrito bloqueia campos desconhecidos, duplicados, strings em campos numéricos, valores negativos, não finitos e saídas com preço final.
- Percentuais são de zero até menos de 100%; a soma de tributos totais, taxas, comissão e margem extraídos deve ser menor que 100%. O validador financeiro existente verifica novamente o conjunto completo do formulário.
- Valores monetários são limitados a R$ 1 bilhão; quantidade mensal deve ser positiva; funcionários são inteiros até 1 milhão; horas por funcionário/mês até 744; prazos até 3650 dias. Textos, selects e UFs também têm limites e listas de opções.
- Evidências devem ser trechos da mensagem original. Números, percentuais, significado do campo e quantidade do lote são conferidos antes da normalização. Essa checagem reduz invenções, mas a confirmação humana continua necessária para resolver erros semânticos de extração.
- O modelo não recebe ferramentas, arquivos, variáveis de ambiente ou segredos no prompt. A chave é enviada somente no cabeçalho HTTP do backend. Instruções dentro da mensagem são tratadas como dados de extração.
- O backend retorna erros próprios, sem propagar corpos de erro, prompts ou cabeçalhos da API externa. Limita a mensagem a 4000 caracteres e o corpo da resposta externa a 100 kB.
- O rate limit é oito chamadas por minuto por usuário e por IP, além de uma solicitação simultânea por usuário. Os contadores estão em memória por processo: ao escalar para várias instâncias, configure um store compartilhado para manter o orçamento global.
- A rota responde `Cache-Control: no-store`. A aplicação não salva conversas no banco e não registra a mensagem em logs. A chamada generateContent não envia histórico nem cria armazenamento explícito de conversa. Isso não substitui as políticas de uso e retenção da Gemini para o plano contratado.
- Cancelar, editar a mensagem, reutilizar/resetar um produto e encerrar a sessão invalidam a prévia e as respostas atrasadas. O formulário manual continua disponível durante indisponibilidade da IA.

## Testes

Execute `pnpm lint`, `pnpm test` e `pnpm build`. Os testes de provider e da rota usam respostas simuladas; não consomem créditos nem dependem de banco ou chave real. Cobrem os exemplos do usuário, decimal/R$/porcentagem, lote, ausência, zero, limites, JSON inválido, prompt injection, timeout, autenticação, rate limit, concorrência, confirmação e cancelamento.

Na correção do HTTP 502 de 11/09/2026 passaram 252 testes, lint de 76 arquivos JavaScript e build. Os contratos cobrem endpoint nativo, cabeçalho da chave, JSON Schema externo compatível, limite posterior no backend, preflight de modelo/método, multipartes, bloqueio de conteúdo e distinção entre quota e limite temporário. Houve chamada autenticada real com `gemini-3.5-flash-lite`: os dois controles incompatíveis retornaram 400, o payload final retornou 200 e `pnpm gemini:check` validou os casos de bolo e brigadeiros de ponta a ponta. A chave permaneceu somente no `.env` ignorado pelo Git.

- “Quero vender bolo, gastei R$ 15 para fazer e quero margem de 10%”: prévia de produto, matéria-prima `15` e margem `10`.
- “Faço brigadeiro. Ingredientes custam R$ 20, embalagem R$ 5 e quero margem de 30%.”: prévia de produto, matéria-prima `20`, embalagem `5` e margem `30`.
- “Quero mudar minha margem para 20%.”: apenas margem `20`; demais campos preservados.

Após configurar a chave no Render, entre na aplicação e abra **Preencher com IA**. Teste:

Primeiro reproduza a entrada do incidente: “quero vender brigadeiros. gasto R$ 40 em ingredientes para produzir 100 unidades, R$ 10 em embalagens e quero margem de 30%”. Antes de confirmar, o formulário deve continuar intacto. A prévia deve conter produto brigadeiros, matéria-prima `0,40`, embalagem `0,10` (ambas normalizadas pelo lote de 100) e margem `30%`. Confirme em **Aplicar ao simulador**; frete já preenchido deve ser preservado e folha, volume mensal, tributos e demais obrigatórios não informados devem continuar pendentes. Os testes automatizados cobrem esse fluxo com retorno de modelo simulado; a chamada real depende da credencial no Render.

1. “Vendo bolo de chocolate. Gasto 18 reais de ingredientes, 3 reais de embalagem e tenho perda de 10%. Quero margem de 25%.” Confira os cinco campos e aplique.
2. Preencha frete `5` manualmente e peça “Mude minha margem para 20%.” Somente a margem deve mudar após confirmação.
3. “Coloque frete de 7 reais.” e “Minha comissão é 5%.” devem modificar apenas o campo correspondente.
4. “Tenho 4 funcionários e cada um produz 10 unidades por hora.” não deve inventar horas mensais nem quantidade mensal.
5. “Pesquise iPhone 15 Pro Max no mercado.” deve oferecer a busca real, sem criar preço de mercado.
6. Cancele uma prévia; os campos devem permanecer intactos. Teste uma mensagem vaga e, em ambiente de teste sem chave, confirme a mensagem de indisponibilidade e o funcionamento manual.

A validação visual anterior à migração cobriu os sete valores de R$ 32,00 a R$ 9.999.999,99 nas larguras 1920, 1440, 1366, 1024, 768 e 390 px. Foram conferidos o painel desktop/mobile, os cards de mercado/tributos e a ausência de quebra, corte ou rolagem horizontal por valores monetários. Esse registro não representa um teste real da Gemini; a chamada ao modelo deve ser validada após configurar a credencial.
