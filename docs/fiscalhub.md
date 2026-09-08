# FiscalHub no Assistente de Precificação

Contrato consultado na [documentação oficial da FiscalHub](https://fiscalhub.com.br/Home/Docs).

## Responsabilidades

- `MarketProvider`: a SearchAPI continua responsável exclusivamente pela pesquisa Google Shopping.
- `TaxProvider`: a FiscalHub calcula os tributos com `POST /api/v1/tributario/calcular`.

O request da integração mantém este formato (NCM abaixo é apenas um marcador; em execução vem da confirmação do usuário):

```json
{
  "empresaId": "uuid-da-empresa",
  "ufOrigem": "SP",
  "ufDestino": "RJ",
  "itens": [
    {
      "ncm": "XXXXXXXX",
      "quantidade": 1,
      "valorUnitario": 100.0
    }
  ]
}
```

`valorUnitario` vem do item de maior preço já presente na pesquisa; nenhuma nova pesquisa de mercado é feita. A autenticação `X-Api-Key` e o `empresaId` existem apenas no backend.

A documentação pública confirma a URL base, o endpoint e `X-Api-Key`, mas não publica o schema completo do request de `/calcular`. O exemplo completo de request/total final pertence a `/simular-nfe`, outro endpoint. Portanto, o formato acima está coberto pelos testes da integração, mas a aceitação de todos os campos por `/calcular` ainda depende de uma tentativa autenticada com empresa configurada. O endpoint não foi substituído.

## Total e transição tributária

O detalhamento normaliza apenas campos presentes, como ICMS, IPI, PIS, COFINS, DIFAL, ICMS-ST, FCP, IBS-UF, IBS-Mun e CBS. `Maior + tributos` usa um total final explícito (`valorTotalNota`, ou os aliases de compatibilidade já aceitos `totalComTributos` e `valorFinal`). Totais nulos, vazios, booleanos, negativos ou não finitos são rejeitados. Um agregado como `valorTotalTributos` não comprova que seus valores sejam acréscimos: ele pode incluir tributos por dentro. Nem esse agregado nem os componentes são somados ao preço sem contrato que documente sua semântica.

Se o provedor não retornar total final, a API local responde `FISCALHUB_TOTAL_NOT_PROVIDED` e o card mostra **Total final não informado**. O exemplo público de `/calcular` contém componentes em `totais`, mas não define como compor um preço final. Não há alíquotas inventadas nem mudança nas fórmulas financeiras.

## Configuração e diagnóstico

```text
FISCALHUB_API_KEY=
FISCALHUB_EMPRESA_ID=
FISCALHUB_TIMEOUT_MS=10000
```

O `empresaId` é obrigatório e corresponde ao UUID da empresa cadastrada no portal FiscalHub. `GET /health` informa apenas os booleanos `tax.configured` e `tax.companyConfigured`, nunca os valores. Sem chave ou empresa, o endpoint retorna o código específico sem chamar a FiscalHub. A confirmação de NCM da Focus NFe precisa estar vinculada, na sessão, ao `classificationId`, `originalQuery` e `normalizedQuery` enviados ao endpoint interno. Esses campos de controle não são encaminhados à FiscalHub. O backend exige a correspondência do código e revalida a relevância da descrição em relação à categoria.

Antes da chamada, o backend valida todos os campos e informa as pendências sem enviar dados inválidos. NCM exige string com exatamente oito dígitos, correspondente à confirmação da sessão. `js/domain/fiscal-context.js` centraliza as 27 UFs e a normalização de espaços/maiúsculas, compartilhada entre navegador e backend. Os selects começam em **Selecione a UF**, sem presumir SP. Quantidade é 1 e o maior preço deve ser numérico, finito e positivo. API Key e empresa são lidas com `trim()`.

Os erros externos preservam 400, 401, 403, 404, 422, 429 e 500+. Falha de rede usa 503, timeout usa 504 e contrato de resposta inválido usa 502. Os logs `[Tax]` registram `requested`, `configured`, `companyConfigured`, `ncmConfirmed`, `ncmValid`, `origin`, `destination`, `price`, `requestStarted` e o `upstreamStatus` efetivamente recebido pelo cliente. Pré-requisito ausente registra `not_called`; cache não fabrica um status HTTP. Nunca são registrados API Key, cabeçalho ou `empresaId`.

O card diferencia classificação fiscal necessária, empresa/chave ausente, UFs pendentes, autenticação, permissão, recurso inexistente, dados inválidos (400/422), erro do provider e resposta sem total. Após confirmação explícita de NCM e preenchimento das UFs, calcula automaticamente se todos os pré-requisitos estiverem presentes. Mudanças de produto, categoria, NCM, confirmação, UFs ou maior preço invalidam resultados e respostas pendentes, inclusive se o usuário voltar aos valores anteriores. O cache inclui o preço exato, sem arredondamento na chave. Eventos `input` e `change` da mesma seleção de UF não duplicam a chamada.

## Diagnóstico observado em 08/09/2026

`GET https://fecart-2026.onrender.com/health` respondeu HTTP 200 com:

```json
{"tax":{"provider":"FiscalHub","configured":true,"companyConfigured":false}}
```

Isso comprova chave presente e `FISCALHUB_EMPRESA_ID` ausente ou vazio no processo publicado. O card antigo usava a mensagem genérica e bloqueava a ação nesse estado. Nenhum payload de cálculo era enviado por esse caminho; não há status nem resposta real da FiscalHub para inspecionar nessa tentativa. Uma chamada direta à rota com dados válidos também seria interrompida com `FISCALHUB_EMPRESA_NOT_CONFIGURED` (503 local).

É necessário preencher `FISCALHUB_EMPRESA_ID` no ambiente do serviço Render com o ID real da empresa FiscalHub e reiniciar/reimplantar o serviço. A cópia original recebida não continha `.env`, credenciais ou diretório `.git`; o trabalho passou a usar o clone do repositório indicado. A configuração de empresa não é criada pela correção de código.

No fluxo anterior, o texto `SP` dos campos era um **placeholder**, não um valor inicial: o input começava com `value=""`. Não foi encontrada uma segunda variável que descartasse a UF preenchida; `currentMarketTaxContext()` já lia o DOM. A troca por selects elimina a ambiguidade visual. Os testes verificam que as UFs selecionadas e enviadas são as mesmas, inclusive SP → SP.

`tests/fiscal-workflow.test.js` executa funções reais do navegador, rotas, normalizador e clientes, substituindo apenas os transportes externos e a sessão/banco por fixtures. Usa a Focus NFe de homologação simulada com `85171300 / Smartphones`, rejeita `19059090 / Produtos de padaria, pastelaria e confeitaria` para celular, confirma explicitamente e chama a FiscalHub com maior preço 8899 e quantidade 1. O retorno 200 simulado tem `valorTotalNota: 9100`. Também cobre 400, 401, 403 e 422, empresa/UF ausentes, categoria alterada e respostas atrasadas. Esses status simulados não constituem resposta autenticada do provider em produção.

## Teste após deploy

1. Confira no `/health` se `tax.configured` e `tax.companyConfigured` estão `true`.
2. Faça uma Consulta de Mercado.
3. Revise a categoria normalizada; se necessário, use **Alterar categoria** e **Buscar NCM**.
4. Escolha **Usar este NCM** em uma sugestão cuja descrição corresponda ao produto.
5. Selecione UF de origem e destino. O cálculo começa quando todos os pré-requisitos estão presentes; use **Calcular tributos** ou **Tentar novamente** para uma tentativa manual.
6. Abra **Ver tributos** e confira os valores com o retorno/painel da FiscalHub.
