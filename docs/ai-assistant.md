# Preenchimento assistido por IA

O assistente interpreta uma mensagem, apresenta uma prévia e preenche apenas os campos confirmados. Ele não calcula nem recomenda o preço final. O módulo financeiro `js/domain/pricing-calculator.js` permanece intacto, compartilhado pelo navegador e pelo servidor.

## Configuração

| Variável | Uso | Padrão |
| --- | --- | --- |
| `OPENAI_API_KEY` | Credencial OpenAI, somente no processo do backend | Vazia; recurso indisponível |
| `AI_PROVIDER` | Implementação do provedor | `openai` |
| `AI_MODEL` | Modelo compatível com Structured Outputs na Responses API | `gpt-4.1-mini` |
| `AI_TIMEOUT_MS` | Tempo máximo da chamada, inteiro de 100 a 60000 ms | `25000` |

Localmente, configure no `.env`, que já é ignorado pelo Git. No Render, abra o Web Service do projeto, **Environment → Add Environment Variable**, cadastre `OPENAI_API_KEY` com sua chave real e salve. As outras variáveis podem ficar nos padrões. Depois faça **Manual Deploy → Deploy latest commit**. Nunca grave a chave no frontend, no GitHub ou neste documento. Uma configuração ausente ou inválida desabilita apenas o assistente.

O provedor usa `POST https://api.openai.com/v1/responses`, `text.format.type=json_schema`, `strict:true`, limite de 3000 tokens de saída e `store:false`. O contrato segue a [documentação de Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs); o modelo padrão [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini) suporta esse formato. O uso da API exige credencial e disponibilidade na conta OpenAI.

## Fluxo e arquitetura

1. `js/ui/ai-assistant.js` abre o modal e envia somente a mensagem, sem histórico, formulário completo ou dados da conta.
2. `lib/ai-pricing-route.js` exige a mesma autenticação do site e aplica limites por conta e IP.
3. `lib/ai-form-assistant.js` seleciona o provedor e orquestra a validação. Novos provedores devem implementar `extract(message)`; o restante do fluxo pode ser reutilizado.
4. `lib/openai-form-provider.js` pede entradas estruturadas, cada uma com campo, valor e trecho literal que comprova a extração. Custos de lote incluem quantidade e evidência do lote.
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
- A rota responde `Cache-Control: no-store`. A aplicação não salva conversas no banco e não registra a mensagem em logs; `store:false` também é enviado à API. Isso não substitui as políticas de retenção do provedor.
- Cancelar, editar a mensagem, reutilizar/resetar um produto e encerrar a sessão invalidam a prévia e as respostas atrasadas. O formulário manual continua disponível durante indisponibilidade da IA.

## Testes

Execute `pnpm lint`, `pnpm test` e `pnpm build`. Os testes de provider e da rota usam respostas simuladas; não consomem créditos nem dependem de banco ou chave real. Cobrem os exemplos do usuário, decimal/R$/porcentagem, lote, ausência, zero, limites, JSON inválido, prompt injection, timeout, autenticação, rate limit, concorrência, confirmação e cancelamento.

Após configurar a chave no Render, entre na aplicação e abra **Preencher com IA**. Teste:

1. “Vendo bolo de chocolate. Gasto 18 reais de ingredientes, 3 reais de embalagem e tenho perda de 10%. Quero margem de 25%.” Confira os cinco campos e aplique.
2. Preencha frete `5` manualmente e peça “Mude minha margem para 20%.” Somente a margem deve mudar após confirmação.
3. “Coloque frete de 7 reais.” e “Minha comissão é 5%.” devem modificar apenas o campo correspondente.
4. “Tenho 4 funcionários e cada um produz 10 unidades por hora.” não deve inventar horas mensais nem quantidade mensal.
5. “Pesquise iPhone 15 Pro Max no mercado.” deve oferecer a busca real, sem criar preço de mercado.
6. Cancele uma prévia; os campos devem permanecer intactos. Teste uma mensagem vaga e, em ambiente de teste sem chave, confirme a mensagem de indisponibilidade e o funcionamento manual.

A validação visual cobriu os sete valores de R$ 32,00 a R$ 9.999.999,99 nas larguras 1920, 1440, 1366, 1024, 768 e 390 px. Foram conferidos o painel desktop/mobile, os cards de mercado/tributos e a ausência de quebra, corte ou rolagem horizontal por valores monetários. A chamada real ao modelo deve ser validada após configurar a credencial.
