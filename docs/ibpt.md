# Estimativa tributária IBPT

O card **Maior + tributos estimados** usa a tabela local [`data/ibpt/TabelaIBPTaxSP26.2.A.csv`](../data/ibpt/TabelaIBPTaxSP26.2.A.csv). O arquivo original foi preservado com delimitador `;`, codificação Windows-1252 e SHA-256 `898F70A73FADD0D8D36F7FB1BA844BD6FE7746A820D65DB5EBCB1BA059382983`.

A versão é `26.2.A`, com vigência de `20/08/2026` a `30/09/2026` e fonte `IBPT / Empresômetro`. O portal [De Olho no Imposto](https://deolhonoimposto.ibpt.org.br/) confirma essa versão e vigência. O download oficial exige uma conta; os bytes preservados no repositório vieram do arquivo público de mesmo nome disponível no [espelho SAT Sistemas](https://www.satsistemas.com/ftp/).

`IbptTaxProvider` lê o CSV uma vez quando o processo inicia, valida cabeçalho, colunas, percentuais e metadados, e indexa apenas códigos NCM de oito dígitos. A tabela contém 12.162 registros no total, incluindo NBS e serviços, e gera um índice de 10.518 NCMs únicos. Quando existem linhas EX para o mesmo código, a linha sem EX é priorizada porque o NCM confirmado não contém o identificador EX.

Depois da confirmação explícita do NCM pela Focus NFe, a consulta local exige igualdade exata entre o código confirmado e `row.codigo`. Não há busca textual ou aproximada dentro do CSV.

O usuário precisa escolher a origem do produto:

- `nacional`: usa `nacionalfederal`;
- `importado`: usa `importadosfederal`.

Os campos `estadual` e `municipal` são somados à alíquota federal escolhida:

```text
aliquotaTotal = aliquotaFederal + estadual + municipal
valorTributosEstimados = maiorPreco × aliquotaTotal ÷ 100
maiorComTributosEstimados = maiorPreco + valorTributosEstimados
```

Os valores monetários são arredondados ao centavo depois da multiplicação. Média, mediana, menor, maior e as fórmulas da precificação sustentável não são alterados.

Para `85171300` e maior preço de `R$ 8.899,00`, a tabela fornece `17,88%` federal nacional, `24,57%` federal importado, `12,00%` estadual e `0,00%` municipal. O resultado nacional usa `29,88%`, estima `R$ 2.659,02` em tributos e produz `R$ 11.558,02`. O resultado importado usa `36,57%`, estima `R$ 3.254,36` e produz `R$ 12.153,36`.

O endpoint interno é `POST /tax/estimate`. Ele recebe NCM, origem, maior preço e a prova da classificação atual. Não recebe UFs, chave de API ou ID de empresa e não faz requisição de rede. O resultado anterior é invalidado quando muda o NCM, a categoria, a pesquisa, o maior preço ou a origem.

Os erros públicos são específicos:

- `NCM_REQUIRED`: NCM necessário;
- `PRODUCT_ORIGIN_REQUIRED`: origem do produto necessária;
- `IBPT_NCM_NOT_FOUND`: NCM não encontrado na tabela IBPT;
- `IBPT_NOT_CONFIGURED`: tabela IBPT não configurada;
- `IBPT_INVALID_FILE`: não foi possível carregar a tabela tributária.

`GET /health` expõe somente provedor, estado de configuração e versão em `taxEstimate`. Se o arquivo não puder ser carregado, inclui apenas o código seguro da falha, sem retornar linhas ou conteúdo do CSV.
