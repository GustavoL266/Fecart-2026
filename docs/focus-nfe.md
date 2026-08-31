# Integração Focus NFe

## Configuração segura

A consulta à Focus NFe é feita exclusivamente pelo backend. O navegador chama `GET /fiscal/ncms/:codigo` com a sessão do usuário e nunca recebe o token.

Configure no ambiente do processo:

```dotenv
FOCUS_NFE_TOKEN=seu-token-configurado-fora-do-git
FOCUS_NFE_BASE_URL=https://homologacao.focusnfe.com.br
FOCUS_NFE_TIMEOUT_MS=5000
```

Use homologação no desenvolvimento e nos testes. Para produção, altere explicitamente a URL para `https://api.focusnfe.com.br` e use o token correspondente. O código aceita somente essas duas origens e acrescenta o prefixo `/v2` internamente.

O token é usado como usuário do HTTP Basic, com senha vazia. Ele não é persistido no banco, retornado em respostas ou incluído em logs. `.env`, variantes de ambiente, chaves e a pasta `secrets/` são ignorados pelo Git; `.env.example` contém apenas valor fictício.

## O que a Focus NFe fornece nesta integração

- Consulta oficial de um NCM exato em `GET /v2/ncms/{codigo}`.
- Código, descrição completa e partes estruturais da classificação NCM.
- Dados completos de NF-e recebidas, inclusive itens e valores fiscais, quando a conta/CNPJ tem acesso e a nota possui XML completo.

O fluxo atual não possui cadastro de CNPJ, vínculo seguro de empresas ou importação de notas de fornecedores. Por isso a integração de NF-e recebidas foi avaliada, mas não ativada: fazê-lo agora exigiria coletar CNPJ, controlar versões, garantir autorização da conta e definir a conciliação entre itens da nota e produtos internos. Nenhuma manifestação, emissão, cancelamento ou alteração de documento fiscal é realizada.

## O que a Focus NFe não fornece como cálculo

A documentação oficial não apresenta um endpoint de cálculo tributário automático. A consulta de NCM não devolve alíquotas. O assistente, portanto, mantém a carga tributária agregada como dado informado/regra configurada e a identifica como estimativa.

Antes de uso operacional, contador ou especialista fiscal precisa definir e manter regras que considerem, conforme o caso:

- regime tributário;
- UF de origem e destino;
- CFOP e CST/CSOSN;
- tipo de cliente e finalidade da operação;
- ICMS, ICMS-ST, DIFAL, FCP, IPI e PIS/COFINS;
- IBS, CBS, IS e transições da reforma tributária;
- benefícios, reduções de base, CEST, créditos e exceções aplicáveis.

`TaxRuleEngine` define a interface para substituir futuramente a regra agregada por um motor tributário especializado. O `ConfiguredTaxRuleEngine` atual nunca afirma que os tributos foram validados.

## Comportamento em falhas

Erros 401, 404, 429, respostas inválidas, timeouts e falhas temporárias são convertidos em mensagens públicas sem credenciais. 429 e falhas temporárias têm tentativas limitadas. Quando a Focus NFe está indisponível, o cálculo financeiro existente continua disponível, mas a interface informa que o NCM e a tributação não foram validados.

Os testes usam mocks e não chamam a API externa. Se `FOCUS_NFE_TOKEN` de homologação estiver configurado, rode `pnpm focus:check` para uma consulta não destrutiva de NCM. O script recusa execução quando a URL selecionada é a de produção.

## Fontes oficiais consultadas

- [Índice para agentes](https://doc.focusnfe.com.br/llms.txt)
- [Ambientes](https://doc.focusnfe.com.br/reference/ambiente)
- [Autenticação](https://doc.focusnfe.com.br/reference/autenticacao)
- [Consulta de NCM por código](https://doc.focusnfe.com.br/reference/consultar_ncm_especifico)
- [NF-e recebidas](https://doc.focusnfe.com.br/reference/nfe-recebidas)
- [Consulta de NF-e recebidas](https://doc.focusnfe.com.br/reference/consultar_nfes_recebidas)
