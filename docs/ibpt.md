# Estimativa tributária IBPT

A estimativa tributária usa a tabela local [`data/ibpt/TabelaIBPTaxSP26.2.A.csv`](../data/ibpt/TabelaIBPTaxSP26.2.A.csv). O arquivo original foi preservado com delimitador `;`, codificação Windows-1252 e SHA-256 `898F70A73FADD0D8D36F7FB1BA844BD6FE7746A820D65DB5EBCB1BA059382983`.

A versão é `26.2.A`, com vigência de `20/08/2026` a `30/09/2026` e fonte `IBPT / Empresômetro`. O portal [De Olho no Imposto](https://deolhonoimposto.ibpt.org.br/) confirma essa versão e vigência. O download oficial exige uma conta; os bytes preservados no repositório vieram do arquivo público de mesmo nome disponível no [espelho SAT Sistemas](https://www.satsistemas.com/ftp/).

`IbptTaxProvider` lê o CSV uma vez quando o processo inicia, valida cabeçalho, colunas, percentuais e metadados, e indexa apenas códigos NCM de oito dígitos. A tabela contém 12.162 registros no total, incluindo NBS e serviços, e gera um índice de 10.518 NCMs únicos. Quando existem linhas EX para o mesmo código, a linha sem EX é priorizada porque o NCM confirmado não contém o identificador EX.

Depois da confirmação explícita do NCM pela Focus NFe, a consulta local exige igualdade exata entre o código confirmado e `row.codigo`. Não há busca textual ou aproximada dentro do CSV.

O usuário precisa escolher a origem do produto:

- `nacional`: usa `nacionalfederal`;
- `importado`: usa `importadosfederal`.

Os campos `estadual` e `municipal` são somados à alíquota federal escolhida:

```text
aliquotaTotal = aliquotaFederal + estadual + municipal
tributosEstimados = precoVenda × aliquotaTotal ÷ 100
valorFinalComTributos = precoVenda + tributosEstimados
```

O provedor retorna `marketPrice` (preço de venda) e `estimatedTaxes` (somente o valor dos tributos) separadamente. A interface soma ambos uma única vez, para o produto selecionado ou para cada extremo da pesquisa, após arredondar os tributos ao centavo. Média, mediana, menor, maior e as fórmulas da precificação sustentável não são alterados.

Para `85171300` e maior preço de `R$ 8.899,00`, a tabela fornece `17,88%` federal nacional, `24,57%` federal importado, `12,00%` estadual e `0,00%` municipal. O resultado nacional usa `29,88%`, estima `R$ 2.659,02` em tributos e produz `R$ 11.558,02`. O resultado importado usa `36,57%`, estima `R$ 3.254,36` e produz `R$ 12.153,36`.

O endpoint interno é `POST /tax/estimate`. Ele recebe NCM, origem, país de origem, UF de origem, UF de destino, preço do cenário e a prova da classificação atual. Não recebe chave de API ou ID de empresa e não faz requisição de rede. O resultado anterior é invalidado quando muda o NCM, a categoria, a pesquisa, o maior preço ou a origem.

Os erros públicos são específicos:

- `NCM_REQUIRED`: NCM necessário;
- `PRODUCT_ORIGIN_REQUIRED`: origem do produto necessária;
- `IBPT_NCM_NOT_FOUND`: NCM não encontrado na tabela IBPT;
- `IBPT_NOT_CONFIGURED`: tabela IBPT não configurada;
- `IBPT_INVALID_FILE`: não foi possível carregar a tabela tributária.

`GET /health` expõe somente provedor, estado de configuração e versão em `taxEstimate`. Se o arquivo não puder ser carregado, inclui apenas o código seguro da falha, sem retornar linhas ou conteúdo do CSV.

## País de origem e limites da fonte

O país era armazenado em `state.countryOfOrigin`, incluído na assinatura da estimativa e exibido no frontend, mas era omitido por `TaxService` e pelo schema do endpoint. O motor recebia apenas NCM, nacional/importado e preço. A escolha entre `nacionalfederal` e `importadosfederal` era a única distinção de origem.

Agora o país normalizado e as UFs seguem do contexto do frontend ao endpoint e ao `IbptTaxProvider.calculate`. País, UF de origem e UF de destino são dimensões independentes; a alteração de qualquer uma invalida a assinatura. A edição do país recalcula automaticamente tanto menor/maior preço quanto produto selecionado. Respostas de um contexto anterior são descartadas. País vazio impede a estimativa importada no frontend e no motor. Produto nacional ignora o país.

A tabela local SP não contém país, acordos, preferências, Imposto de Importação separado ou regras de origem. Não há outra fonte dessas regras configurada no projeto. Logo China, Japão e EUA usam os mesmos componentes IBPT para um mesmo NCM/preço. Para NCM `85171300` e R$ 8.899,00, China e Japão têm 36,57%, R$ 3.254,36 de tributos e R$ 12.153,36 como valor final. A interface informa discretamente que não foi identificada diferença nas fontes disponíveis; isso não afirma inexistência de diferenças na legislação. A tabela continua sendo SP: transmitir UF de destino não cria alíquotas de outros estados.

O ponto opcional `originRuleProvider.resolve(fiscalContext, record)` é uma dependência exclusivamente do servidor e não é configurado em produção. Uma futura integração deve verificar NCM, país, destino e condições de elegibilidade/vigência, e retornar `null` quando não houver tratamento suportado. O contrato exige `source`, `reference` e `federalRate` (estimativa federal efetiva comparável à base IBPT, entre 0 e 100). A taxa federal original permanece em `baseFederalRate`; a proveniência da regra é exibida no detalhamento. Não se pode subtrair uma preferência de II diretamente de `importadosfederal`, pois este é um percentual agregado. Uma integração que exija outras bases/componentes precisará de um provedor apropriado, não de uma adaptação arbitrária deste contrato.

Nenhuma alíquota por país foi adicionada. As diferenças exercitadas nos testes são fixtures explícitas do contrato, sem validade fiscal e sem configuração na aplicação. A existência de preferências depende da regra e de sua elegibilidade, conforme as [orientações oficiais do Siscomex](https://www.gov.br/siscomex/pt-br/informacoes/perguntas-frequentes/acordos-comerciais/7-aspectos-tarifarios).