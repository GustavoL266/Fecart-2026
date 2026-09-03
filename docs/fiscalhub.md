# FiscalHub no Assistente de Precificação

Contrato consultado na [documentação oficial da FiscalHub](https://fiscalhub.com.br/Home/Docs).

## Responsabilidades

- `MarketProvider`: a SearchAPI continua responsável exclusivamente pela pesquisa Google Shopping.
- `NcmProvider`: a FiscalHub pode sugerir códigos com `GET /api/v1/ncm/buscar?q=...`; a sugestão não é aceita automaticamente. A Focus NFe confirma o código exato informado pelo usuário.
- `TaxProvider`: a FiscalHub calcula os tributos com `POST /api/v1/tributario/calcular`.

O request contém somente os campos documentados para esse cálculo:

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

## Total e transição tributária

O detalhamento normaliza apenas campos presentes, como ICMS, IPI, PIS, COFINS, DIFAL, ICMS-ST, FCP, IBS-UF, IBS-Mun e CBS. Para evitar dupla contagem durante a transição, `Maior + tributos` usa um total final explícito (`valorTotalNota`, `totalComTributos` ou `valorFinal`). Quando a resposta fornece um total agregado de tributos explícito, ele é somado ao preço. Campos granulares nunca são somados automaticamente.

Se o provedor não retornar nenhum desses totais, a API local responde `FISCALHUB_TOTAL_NOT_PROVIDED` e mantém o valor final indisponível.

## Configuração e diagnóstico

```text
FISCALHUB_API_KEY=
FISCALHUB_EMPRESA_ID=
FISCALHUB_TIMEOUT_MS=10000
```

O `empresaId` é obrigatório e corresponde ao UUID da empresa cadastrada no portal FiscalHub. `GET /health` informa apenas os booleanos `tax.configured` e `tax.companyConfigured`, nunca os valores.

Os erros externos preservam 400, 401, 403, 404, 422, 429 e 500. Falha de rede usa 503, timeout usa 504 e contrato de resposta inválido usa 502. Os logs registram NCM, UFs e status HTTP, mas nunca a API Key, o cabeçalho ou o `empresaId`.

## Teste após deploy

1. Confira no `/health` se `tax.configured` e `tax.companyConfigured` estão `true`.
2. Faça uma Consulta de Mercado.
3. Informe um NCM exato e valide-o pela Focus NFe.
4. Informe UF de origem e destino.
5. Clique em **Calcular tributos** no cartão **Maior + tributos**.
6. Abra **Ver tributos** e confira os valores com o retorno/painel da FiscalHub.
