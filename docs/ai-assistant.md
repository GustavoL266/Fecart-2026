# Preenchimento assistido por IA

O assistente interpreta uma mensagem, completa os inputs necessários com hipóteses identificadas, apresenta uma prévia e preenche apenas os campos confirmados. Ele não calcula nem recomenda o preço final. O módulo financeiro `js/domain/pricing-calculator.js` permanece intacto, compartilhado pelo navegador e pelo servidor.

## Configuração

| Variável | Uso | Padrão |
| --- | --- | --- |
| `GEMINI_API_KEY` | Credencial Gemini, somente no processo do backend | Vazia; recurso indisponível |
| `AI_PROVIDER` | Implementação do provedor | `gemini` |
| `AI_MODEL` | Modelo Gemini compatível com saída estruturada | `gemini-3.5-flash-lite` |
| `AI_FILL_MODE` | `complete` sugere todos os inputs obrigatórios; `partial` somente extrai | `complete` |
| `AI_TIMEOUT_MS` | Tempo máximo da chamada, inteiro de 100 a 60000 ms | `25000` |

Localmente, configure no `.env`, que já é ignorado pelo Git. No Render, abra o Web Service do projeto, **Environment → Add Environment Variable**, cadastre `GEMINI_API_KEY` com sua chave real e salve. Em serviços existentes, substitua os valores antigos de `AI_PROVIDER` e `AI_MODEL` pelos da tabela. Depois faça **Manual Deploy → Deploy latest commit**. Nunca grave a chave no frontend, no GitHub ou neste documento. Uma configuração ausente ou inválida desabilita apenas o assistente.

O provedor usa REST nativo via `fetch` do Node, sem SDK ou camada de compatibilidade OpenAI. A chamada é `POST https://generativelanguage.googleapis.com/v1beta/models/{AI_MODEL}:generateContent`. A chave vai somente no cabeçalho `x-goog-api-key`, nunca na URL. O contrato usa `systemInstruction`, uma mensagem em `contents`, `generationConfig.responseMimeType: "application/json"` e `generationConfig.responseJsonSchema`. A extração usa `temperature: 0`, um candidato e limite de 3000 tokens. O schema exige `source` em cada entry, com `user_provided`, `inferred` ou `estimated`. A primeira análise não envia histórico nem os inputs atuais à Gemini; um esclarecimento envia somente contexto efêmero, campos/origens anteriores validados e pendências, sem ferramentas, formulário completo ou dados da conta.

O modelo estável [Gemini 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) foi confirmado novamente na documentação em 11/09/2026: o identificador é `gemini-3.5-flash-lite`, ele é voltado a baixa latência, baixo custo e extração simples, aceita `generateContent` e suporta saída estruturada. O modelo também consta nas [tabelas atuais de limites da API](https://ai.google.dev/gemini-api/docs/rate-limits). A [referência generateContent](https://ai.google.dev/api/generate-content) documenta `responseMimeType` e `responseJsonSchema`, enquanto o [guia de migração](https://ai.google.dev/gemini-api/docs/migrate-to-interactions#structured-output) mantém esses controles dentro de `generationConfig` para `generateContent`. Esta integração não envia junto `responseFormat` nem `responseSchema`. O modelo fica configurável por ambiente; o nome precisa começar com `gemini-`, sem barras, query string ou caracteres de controle.

O schema externo usa somente recursos documentados: `object`, `array`, `string`, `number`, `integer`, `null`, união de tipos para nulabilidade, `required`, `enum`, `items` e `additionalProperties: false`. Ele omite deliberadamente `maxItems`: a chamada real retornou 400 quando `maxItems: 35` era combinado com o enum de 35 campos. A validação Zod rigorosa do backend limita o array a 100 entradas — permitindo componentes do mesmo campo sem deixar a resposta ilimitada — e continua sendo a autoridade para evidências, normalização, limites e campos aceitos.

Esta funcionalidade agora depende exclusivamente de `GEMINI_API_KEY`. `OPENAI_API_KEY`, `AI_PROVIDER=openai` e o modelo anterior não são usados. Em um serviço Render existente, **troque também AI_PROVIDER e AI_MODEL**, pois variáveis antigas explícitas prevalecem sobre os novos padrões. Depois de migrar, a antiga chave OpenAI pode ser removida do ambiente deste projeto.

### Diagnóstico no Render

Sem `GEMINI_API_KEY`, `getAiAssistantConfig().isConfigured` é falso, `createAiFormProvider` retorna `null` e a rota autenticada retorna `503 GEMINI_NOT_CONFIGURED` **antes de chamar a Gemini**. O antigo incidente de configuração envolvia o provedor OpenAI anterior à migração; não é evidência sobre a configuração atual da Gemini no Render.

Para habilitar a análise, configure no **Render → fecart-2026 → Environment**:

```text
GEMINI_API_KEY=<informar o segredo somente no painel>
AI_PROVIDER=gemini
AI_MODEL=gemini-3.5-flash-lite
AI_FILL_MODE=complete
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
    "fillMode": "complete",
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

Quando as variáveis forem aceitas, `configured` será `true` e `configurationErrors` será `[]`. Compare `model`, `fillMode`, `timeoutMs` e `deployment.commit` com o valor esperado e o commit enviado ao GitHub. Isso confirma somente presença/formato de configuração e o processo publicado; não valida chave, saldo, permissão nem disponibilidade do modelo para a conta. `/health` não faz chamadas pagas e não muda o estado geral do servidor por indisponibilidade desse recurso opcional. Os outros motivos possíveis são `AI_PROVIDER_UNSUPPORTED`, `AI_MODEL_INVALID`, `AI_FILL_MODE_INVALID` e `AI_TIMEOUT_INVALID`. Não são exibidos valores de variáveis, credenciais ou mensagens do usuário.

O log de inicialização `[AI] Configuration` mostra o mesmo diagnóstico seguro e `[Deploy] Configuration` mostra somente o SHA validado. Em falha HTTP da Gemini são registrados somente `[AI] upstreamStatus`, `[AI] upstreamErrorCode` e `[AI] upstreamErrorStatus`. O fluxo também registra os booleanos seguros `clarification`, `previousAnalysisPresent`, `responseParsed`, `mergeSucceeded` e `validationSucceeded`. Uma validação recusada inclui somente caminho do campo, tipo e código interno. Mensagens livres do provedor são descartadas. Análises válidas registram `provider=gemini` e `status=200`. Nunca são registrados o objeto de erro original, stack, cabeçalhos, prompt, resposta bruta ou texto do usuário.

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
| 422 | `AI_CLARIFICATION_MERGE_FAILED` | O contexto anterior é inválido ou a resposta tentou alterar um campo que não estava pendente; a prévia anterior é preservada. |
| 422 | `AI_VALIDATION_FAILED` | O resultado combinado ficou inválido após o merge; a prévia anterior é preservada. |
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

1. `js/ui/ai-assistant.js` abre o modal e envia a mensagem, os percentuais atuais e um `currentFields` estrito com inputs válidos já presentes. O backend usa esse conjunto somente para impedir que uma estimativa substitua valor manual; ele não é enviado à Gemini. Em follow-up, envia separadamente a resposta curta, o contexto efêmero e apenas `fields`, `sources`, códigos e campos pendentes da análise anterior. Não envia dados da conta.
2. `lib/ai-pricing-route.js` exige a mesma autenticação do site e aplica limites por conta e IP.
3. `lib/ai-form-assistant.js` seleciona o provedor e orquestra a validação. Novos provedores devem implementar `extract(message)`; o restante do fluxo pode ser reutilizado.
4. `lib/gemini-form-provider.js` recebe a mensagem inicial ou, no esclarecimento, a resposta com o contexto anterior. Cada componente tem campo, valor, origem, evidência, base (`unit`, `batch-total`, `monthly-total`, `not-applicable` ou `unknown`), certeza, quantidade/evidência do lote e evidência de correção. O schema do segundo turno limita `field` aos campos pendentes; inputs atuais e percentuais nunca são enviados à Gemini.
5. `lib/ai-pricing-schema.js` valida o retorno, normaliza cada componente antes da soma, impõe limites extras a estimativas e gera rótulos, valores e pendências controladas. No modo completo, faz merge com inputs manuais, converte percentuais para frações e chama `validatePricingInputs`, o mesmo validador do motor financeiro. `calculationReady` só é verdadeiro quando esse conjunto passa. No follow-up, combina apenas campos esclarecidos com os anteriores. A extração bruta e o prompt não são enviados ao navegador.
6. A prévia agrupa valores informados, inferidos e estimados e exibe o aviso de revisão. Somente **Aplicar ao simulador** chama `applyAssistantFields` e o controlador existente em `js/main.js`, que revalida, renderiza e executa a fórmula normal. **Ajustar dados** volta à descrição sem aplicar. Não há cálculo financeiro pelo modelo.
7. Uma pendência pode ser respondida no próprio modal. O navegador mantém a descrição original apenas em memória e solicita uma extração parcial. Se a chamada ou o merge falhar, conserva a prévia anterior e o texto digitado; em sucesso, substitui a pendência pela prévia combinada. Esse conteúdo não é salvo no banco nem em histórico local.

### Contrato público

`POST /ai/parse-pricing`, com cookie de sessão e `Content-Type: application/json`:

```json
{
  "message": "Coloque matéria-prima como R$ 20 e margem em 30%.",
  "currentRates": { "taxRate": 6, "paymentFeeRate": 2.8, "commissionRate": 0 },
  "currentFields": { "deliveryCost": 5, "taxRate": 6, "paymentFeeRate": 2.8 }
}
```

Resposta:

```json
{
  "fields": { "materialCost": 20, "desiredNetMargin": 30 },
  "sources": { "materialCost": "user_provided", "desiredNetMargin": "user_provided" },
  "summary": [
    { "field": "materialCost", "label": "Matéria-prima por unidade", "value": "R$ 20,00", "source": "user_provided" },
    { "field": "desiredNetMargin", "label": "Margem líquida desejada", "value": "30%", "source": "user_provided" }
  ],
  "pending": [],
  "needsClarification": false,
  "calculationReady": false
}
```

Um esclarecimento usa o mesmo endpoint, mas não concatena a resposta como uma nova descrição completa:

```json
{
  "message": "por unidade",
  "clarification": {
    "context": "Quero vender um bolo, usei 15 reais para fazer, e quero lucro de 10%",
    "previousAnalysis": {
      "fields": { "productName": "bolo", "desiredNetMargin": 10 },
      "sources": { "productName": "user_provided", "desiredNetMargin": "user_provided" },
      "pending": [{ "code": "AI_COST_BASIS_UNKNOWN", "field": "materialCost" }],
      "needsClarification": true
    }
  }
}
```

A Gemini pode retornar somente a entry de `materialCost`. O backend valida essa entry contra o contexto e a resposta, mescla `materialCost: 15` com produto e margem anteriores e devolve `needsClarification: false`. O objeto `previousAnalysis` é estrito, não aceita campos pendentes como resolvidos nem permite que o follow-up altere outro campo.

`currentRates` continua compatível e limitado aos quatro campos do denominador. `currentFields` aceita apenas produto e inputs financeiros permitidos; valores inválidos ou mercado/capacidade não entram. As porcentagens são pontos percentuais (`30` significa `30%`). Campos ausentes e `null` não apagam valores; zero explícito é aplicado. Uma nova informação do usuário prevalece sobre o formulário, e um input manual válido prevalece sobre uma estimativa.

Uma resposta estruturalmente malformada, sem evidência literal ou com campos desconhecidos continua sendo rejeitada integralmente. Um valor reconhecido, mas semanticamente incompleto — base de custo desconhecida, lote sem quantidade, ambiguidade, negativo ou fora dos limites — não vira dado fictício nem 502 genérico: o campo afetado é omitido de `fields` e aparece em `pending` com código e pergunta controlados pelo backend. Campos independentes válidos continuam disponíveis para prévia e confirmação.

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

O formulário atual não tem campos de alíquotas individuais de ICMS, IPI, PIS/COFINS, DIFAL ou IBS/CBS. Esses dados não são convertidos em carga tributária total. O NCM é uma confirmação da integração Focus NFe e continua sendo escolhido pelo fluxo fiscal existente. O modo completo não estima códigos fiscais nem capacidade produtiva. Quando escala mensal, carga manual, taxas, prazos ou capital não foram informados, usa cenário neutro identificado: quantidade mensal `1` e os parâmetros dependentes do negócio em `0`. Esses valores servem apenas para liberar uma simulação revisável, não descrevem a operação real.

“R$ 40 em ingredientes para produzir 100 unidades, R$ 10 em embalagens” resulta em matéria-prima `0,40` e embalagem `0,10` por unidade, com a divisão identificada na prévia. O backend faz apenas essa normalização de entrada; o lote não vira produção mensal. Se `expectedMonthlyUnits=1` aparecer sem escala informada, sua origem é `estimated`, nunca uma cópia do lote ou uma inferência de faturamento. Vários componentes são normalizados separadamente e depois somados no campo correspondente. Se os dados não identificarem claramente um custo unitário ou de lote, o campo vira pendência visível e não é aplicado silenciosamente.

“Adicione R$ 4 de frete” define frete como `4`; não soma a valores desconhecidos do formulário. “Retire o desconto” zera as duas modalidades. No modo completo, o provedor tenta preencher cada obrigatório não crítico; se ainda faltar algum, o backend cria `AI_REQUIRED_FIELD_MISSING`. Produto, custo principal, margem ou base de lote realmente ambíguos continuam exigindo decisão da pessoa.

“Pesquise iPhone 15 Pro Max no mercado” prepara `marketQuery` e oferece **Pesquisar no mercado** após a aplicação. A pesquisa real permanece na integração atual SearchAPI / Google Shopping; seus providers e o fluxo fiscal não foram substituídos.

## Validação e proteção

- Zod estrito bloqueia campos desconhecidos, strings em campos numéricos, não finitos e saídas com preço final. Entradas repetidas de custos representam componentes; cada uma mantém sua própria base e evidência antes da soma.
- Percentuais são de zero até menos de 100%; a soma de tributos totais, taxas, comissão e margem, combinando a extração com os percentuais atuais informados pelo navegador, deve ser menor que 100%. O validador financeiro existente verifica novamente o conjunto completo do formulário.
- Valores negativos, limites impossíveis, divisor zero, base ausente e ambiguidades reconhecidas geram pendências por campo. Eles nunca são corrigidos, tornados positivos ou aplicados parcialmente como componente de um total.
- Valores monetários são limitados a R$ 1 bilhão; quantidade mensal deve ser positiva; funcionários são inteiros até 1 milhão; horas por funcionário/mês até 744; prazos até 3650 dias. Textos, selects e UFs também têm limites e listas de opções.
- Valores `user_provided` exigem evidência literal com número, unidade e significado; `inferred` exige trecho literal que sustente a consequência; `estimated` exige evidência vazia e não pode se apresentar como dado do usuário. Quantidade do lote continua literal e conferida antes da normalização.
- Estimativas respeitam os limites do formulário e limites mais estreitos: perda até 30%, carga manual até 35%, taxa de pagamento até 15%, comissão até 40%, margem estimada até 60%, prazos até 365 dias e embalagem/frete proporcionais ao custo principal. Por exemplo, embalagem estimada de R$ 500 para material de R$ 15 é recusada como `AI_VALUE_OUT_OF_RANGE`.
- O modelo não recebe ferramentas, arquivos, variáveis de ambiente ou segredos no prompt. A chave é enviada somente no cabeçalho HTTP do backend. Instruções dentro da mensagem são tratadas como dados de extração.
- O backend retorna erros próprios, sem propagar corpos de erro, prompts ou cabeçalhos da API externa. Limita a mensagem a 4000 caracteres e o corpo da resposta externa a 100 kB.
- O rate limit é oito chamadas por minuto por usuário e por IP, além de uma solicitação simultânea por usuário. Os contadores estão em memória por processo: ao escalar para várias instâncias, configure um store compartilhado para manter o orçamento global.
- A rota responde `Cache-Control: no-store`. A aplicação não salva conversas no banco e não registra a mensagem em logs. A chamada generateContent não envia histórico nem cria armazenamento explícito de conversa. Isso não substitui as políticas de uso e retenção da Gemini para o plano contratado.
- Cancelar, editar a mensagem, reutilizar/resetar um produto e encerrar a sessão invalidam a prévia e as respostas atrasadas. O formulário manual continua disponível durante indisponibilidade da IA.

## Testes

Execute `pnpm lint`, `pnpm test` e `pnpm build`. Os testes de provider e da rota usam respostas simuladas; não consomem créditos nem dependem de banco ou chave real. Cobrem componentes, linguagem informal, decimal/R$/números por extenso, bases unitária/lote/desconhecida, correções, ausência, zero, limites, ambiguidade, JSON inválido, prompt injection, timeout, autenticação, rate limit, concorrência, prévia, esclarecimento, confirmação e cancelamento.

`pnpm gemini:evaluate` executa dez prompts fixos contra a conta configurada: caso mínimo, brigadeiros, múltiplos componentes, total sem quantidade, bases mistas, números por extenso, correção, ambiguidade, negativo e preço de venda sem custo. A saída contém somente status, campos já validados, códigos de pendência e aderência esperada; não imprime prompt, evidência, resposta bruta ou chave. IDs podem ser passados após `--` para limitar as chamadas.

Na correção do HTTP 502 de 11/09/2026 passaram 252 testes, lint de 76 arquivos JavaScript e build. Os contratos cobrem endpoint nativo, cabeçalho da chave, JSON Schema externo compatível, limite posterior no backend, preflight de modelo/método, multipartes, bloqueio de conteúdo e distinção entre quota e limite temporário. Houve chamada autenticada real com `gemini-3.5-flash-lite`: os dois controles incompatíveis retornaram 400, o payload final retornou 200 e `pnpm gemini:check` validou os casos de bolo e brigadeiros de ponta a ponta. A chave permaneceu somente no `.env` ignorado pelo Git.

Na evolução da interpretação do mesmo dia, a suíte passou a cobrir 272 testes e o lint 77 arquivos JavaScript. `pnpm gemini:check` passou novamente, e `pnpm gemini:evaluate` validou os dez casos fixos contra a API real: todos os `generateContent` aceitos retornaram HTTP 200; campos inequívocos corresponderam ao esperado, totais sem quantidade e valores negativos viraram pendências, e preço de venda não virou custo. Essa chamada comprova o contrato e o acesso da conta local utilizada, não a configuração do serviço Render.

Na correção do follow-up em 12/09/2026, a suíte passou a cobrir 280 testes. Foram adicionados casos de “por unidade”, lote sem quantidade, “pelo lote, rende 100 unidades”, resposta parcial, resposta vazia, merge sem apagar valores, validação posterior e preservação da prévia em erro. A avaliação real do caso `clarification-unit` com `gemini-3.5-flash-lite` retornou HTTP 200 tanto para a análise inicial quanto para o segundo `generateContent`; o resultado combinado foi produto `bolo`, matéria-prima `15`, margem `10`, `pending: []` e `needsClarification: false`. Em uma matriz real executada em sequência houve timeouts e um 503 transitórios; os quatro casos afetados passaram com HTTP 200 ao serem repetidos isoladamente.

Na ativação do modo completo em 12/09/2026, passaram 291 testes. A chamada real final retornou HTTP 200 nos casos `clarification-unit`, `brigadeiros-lote`, `camiseta-complete` e `marmita-complete`; todos terminaram com `pending: []`, `calculationReady: true`, formulário válido após aplicação e preço técnico finito. O bolo preservou matéria-prima `15` e margem `10` como `user_provided`, estimou perda `5`, embalagem `0,50`, quantidade mensal mínima `1` e parâmetros neutros restantes, e produziu R$ 18,10 pela fórmula canônica. Duas tentativas intermediárias do bolo receberam 503 transitório da Gemini e foram classificadas como `GEMINI_UNAVAILABLE`; a repetição final passou sem alteração do contrato.

- “Quero vender bolo, meu custo de ingredientes por unidade é R$ 15 e quero margem de 10%”: prévia de produto, matéria-prima `15` e margem `10`.
- “Faço brigadeiro. Ingredientes por unidade custam R$ 20, embalagem por unidade R$ 5 e quero margem de 30%.”: prévia de produto, matéria-prima `20`, embalagem `5` e margem `30`.
- “Quero mudar minha margem para 20%.”: apenas margem `20`; demais campos preservados.

Após configurar a chave no Render, entre na aplicação e abra **Preencher com IA**. Teste:

Com `AI_FILL_MODE=complete`, reproduza: “Faço brigadeiros, gasto R$ 40 por lote de 100 unidades e quero margem de 30%.” Antes de confirmar, o formulário deve continuar intacto. A prévia deve conter produto, matéria-prima `0,40`, margem `30%` e as hipóteses restantes em **Estimado pela IA**. `calculationReady` deve ser verdadeiro e **Aplicar ao simulador** deve produzir o preço técnico pela fórmula existente. Um frete manual válido já presente prevalece sobre frete estimado.

O fluxo crítico é: “Quero vender um bolo, usei 15 reais para fazer e quero lucro de 10%”; responda “por unidade” à dúvida de base. O segundo turno deve preservar produto, margem e estimativas, adicionar matéria-prima `15`, eliminar as pendências e deixar o formulário válido. Execute também `pnpm gemini:evaluate -- clarification-unit brigadeiros-lote camiseta-complete marmita-complete` para validar os prompts fixos contra a conta configurada. O script aplica os campos a controles equivalentes aos do formulário, chama `validatePricingForm` e só marca aderência quando consegue calcular `technicalPrice`.

1. “Vendo bolo de chocolate. Gasto 18 reais de ingredientes por unidade, 3 reais de embalagem por unidade e tenho perda de 10%. Quero margem de 25%.” Confira os cinco campos e aplique.
2. Preencha frete `5` manualmente e peça “Mude minha margem para 20%.” Somente a margem deve mudar após confirmação.
3. “Coloque frete de 7 reais.” e “Minha comissão é 5%.” devem modificar apenas o campo correspondente.
4. “Tenho 4 funcionários e cada um produz 10 unidades por hora.” não deve inventar horas mensais nem quantidade mensal.
5. “Pesquise iPhone 15 Pro Max no mercado.” deve oferecer a busca real, sem criar preço de mercado.
6. Cancele uma prévia; os campos devem permanecer intactos. Teste uma mensagem vaga e, em ambiente de teste sem chave, confirme a mensagem de indisponibilidade e o funcionamento manual.

A validação visual anterior à migração cobriu os sete valores de R$ 32,00 a R$ 9.999.999,99 nas larguras 1920, 1440, 1366, 1024, 768 e 390 px. Foram conferidos o painel desktop/mobile, os cards de mercado/tributos e a ausência de quebra, corte ou rolagem horizontal por valores monetários. Esse registro não representa um teste real da Gemini; a chamada ao modelo deve ser validada após configurar a credencial.
