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

O `empresaId` é obrigatório e corresponde ao UUID da empresa cadastrada no portal FiscalHub. `GET /health` informa apenas os booleanos `tax.configured` e `tax.companyConfigured`, nunca os valores. Sem chave ou empresa, o endpoint retorna o código específico sem chamar a FiscalHub. Sem uma confirmação de NCM feita pela Focus NFe na mesma sessão, o endpoint retorna `FOCUS_NFE_NCM_CONFIRMATION_REQUIRED` sem chamar a FiscalHub.

Antes da chamada, o backend valida todos os campos e informa as pendências sem enviar dados inválidos. NCM exige string com exatamente oito dígitos, correspondente à confirmação da sessão. UFs são normalizadas para maiúsculas e validadas entre as 27 siglas brasileiras. Quantidade é 1 e o maior preço deve ser numérico, finito e positivo. API Key e empresa são lidas com `trim()`.

Os erros externos preservam 400, 401, 403, 404, 422, 429 e 500+. Falha de rede usa 503, timeout usa 504 e contrato de resposta inválido usa 502. Os logs `[Tax]` registram `requested`, `configured`, `companyConfigured`, `ncmConfirmed`, `origin`, `destination`, `price` e o `upstreamStatus` efetivamente recebido pelo cliente. Pré-requisito ausente registra `not_called`; cache não fabrica um status HTTP. Nunca são registrados API Key, cabeçalho ou `empresaId`.

O card diferencia NCM necessário, empresa/chave ausente, autenticação, permissão, recurso inexistente, dados inválidos (400/422), erro do provider e resposta sem total. Mudanças de NCM, confirmação, UFs ou maior preço invalidam resultados e respostas pendentes, inclusive se o usuário voltar aos valores anteriores. O cache inclui o preço exato, sem arredondamento na chave.

## Diagnóstico observado em 08/09/2026

`GET https://fecart-2026.onrender.com/health` respondeu HTTP 200 com:

```json
{"tax":{"provider":"FiscalHub","configured":true,"companyConfigured":false}}
```

Isso comprova chave presente e `FISCALHUB_EMPRESA_ID` ausente ou vazio no processo publicado. O card antigo usava a mensagem genérica e bloqueava a ação nesse estado. Nenhum payload de cálculo era enviado por esse caminho; não há status nem resposta real da FiscalHub para inspecionar nessa tentativa. Uma chamada direta à rota com dados válidos também seria interrompida com `FISCALHUB_EMPRESA_NOT_CONFIGURED` (503 local).

É necessário preencher `FISCALHUB_EMPRESA_ID` no ambiente do serviço Render com o ID real da empresa FiscalHub e reiniciar/reimplantar o serviço. Esta cópia local não contém `.env`, credenciais ou diretório `.git`. A correção de código não configura nem publica o serviço automaticamente. Os testes 200/400/401/403/404/422/500+ usam transporte simulado e não constituem resposta autenticada do provider.

## Teste após deploy

1. Confira no `/health` se `tax.configured` e `tax.companyConfigured` estão `true`.
2. Faça uma Consulta de Mercado.
3. Informe um NCM exato e valide-o pela Focus NFe.
4. Informe UF de origem e destino.
5. Clique em **Calcular tributos** no cartão **Maior + tributos**.
6. Abra **Ver tributos** e confira os valores com o retorno/painel da FiscalHub.
