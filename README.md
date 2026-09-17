# Assistente de Precificação

Aplicação web para calcular preço de venda sustentável, comparar referências de mercado e salvar um histórico privado por usuário.

Este README é o documento central de contexto do projeto. Ele foi ampliado para permitir que uma pessoa ou uma nova sessão do Codex continue o desenvolvimento em outro computador sem depender do histórico de conversas. A descrição abaixo corresponde ao código revisado em **16/09/2026**. Ao modificar comportamentos importantes, atualize também este documento e o guia específico da integração afetada.

## Comece por aqui em uma nova sessão

O repositório se chama **Fecart-2026**. A aplicação aparece na interface e na documentação como **Assistente de Precificação**, **Precificação por Custos** e, em alguns elementos compactos, **Precificar**. Esses nomes se referem ao mesmo projeto.

Antes de propor uma implementação, tenha em mente:

1. O frontend é **JavaScript puro**, com HTML e CSS. Não há React, Next.js, Vite ou uma segunda aplicação frontend neste repositório.
2. O Express serve a interface e as APIs no mesmo processo. O PostgreSQL é necessário para iniciar o servidor completo, autenticar e salvar produtos.
3. O arquivo [app.js](app.js) é **gerado**. O código editável está em [js/](js/) e precisa passar por [scripts/build.mjs](scripts/build.mjs).
4. O cálculo oficial está em [js/domain/pricing-calculator.js](js/domain/pricing-calculator.js). Navegador e backend usam esse mesmo módulo; gráficos e cards apenas exibem seus resultados.
5. A IA **interpreta entradas e, no modo `complete`, sugere inputs auxiliares identificados como estimativas**. Dados essenciais do negócio, como custo principal, margem e quantidade mensal sem contexto explícito, permanecem pendentes. A IA nunca deve determinar o preço final nem substituir as fórmulas.
6. A consulta de mercado atual é **SearchAPI.io / Google Shopping**. Menções antigas a Amazon ou a outro marketplace não descrevem o provedor ativo.
7. A **Focus NFe pesquisa e confirma NCM**. A **IBPT estima a carga do card de maior preço de mercado**. Essas responsabilidades são diferentes da carga tributária manual utilizada no preço sustentável.
8. Produtos salvos pertencem ao usuário autenticado. Reutilizar um produto, editar seus metadados e recalcular uma nova simulação são operações diferentes.
9. Segredos, banco local, sessão do navegador e simulações não salvas não são transferidos por um clone do Git. A seção de continuidade entre dispositivos explica essa diferença.
10. Inspecione `git status` e os arquivos envolvidos antes de editar. Preserve alterações existentes e mantenha o escopo do pedido; uma correção visual não exige reescrever o motor financeiro ou as integrações.

### Índice

- [Visão geral do produto](#visão-geral-do-produto)
- [Experiência e jornada do usuário](#experiência-e-jornada-do-usuário)
- [Arquitetura e mapa dos arquivos](#arquitetura-e-mapa-dos-arquivos)
- [Stack](#stack)
- [Recursos implementados](#recursos-implementados)
- [Precificação transparente v7](#precificação-transparente-v7)
- [Campos e convenções de dados](#campos-e-convenções-de-dados)
- [Fluxos internos e estado da aplicação](#fluxos-internos-e-estado-da-aplicação)
- [Pré-requisitos](#pré-requisitos)
- [Configuração local com Docker](#configuração-local-com-docker-recomendada)
- [Variáveis de ambiente em um só lugar](#variáveis-de-ambiente-em-um-só-lugar)
- [Publicação a partir do GitHub](#publicação-a-partir-do-github)
- [Diagnóstico de inicialização](#diagnóstico-de-inicialização)
- [Comandos](#comandos)
- [Banco de dados](#banco-de-dados)
- [Endpoints](#endpoints)
- [Verificação manual do fluxo](#verificação-manual-do-fluxo)
- [Continuidade entre dispositivos](#continuidade-entre-dispositivos)
- [Guia de manutenção para próximas tarefas](#guia-de-manutenção-para-próximas-tarefas)
- [Testes, limitações e pontos de atenção](#testes-limitações-e-pontos-de-atenção)

## Visão geral do produto

O objetivo é ajudar o usuário a entender quanto precisa cobrar por uma unidade ou venda para cobrir seus custos, despesas de venda e margem líquida desejada. O usuário informa a estrutura de custos; a aplicação calcula preços de equilíbrio, mínimo e recomendado, mostra a composição e permite compará-los com referências reais de mercado.

O sistema organiza informações que normalmente ficam espalhadas: matéria-prima, embalagem, perdas, frete, folha salarial, custos fixos, volume mensal, taxa de pagamento, comissão, capital de giro e prazos. A partir dessas entradas, apresenta um resultado consistente e uma memória de cálculo que pode ser consultada depois.

Há quatro responsabilidades centrais:

| Responsabilidade | O que o sistema faz |
| --- | --- |
| Simular | Valida entradas e calcula preços de equilíbrio, margem mínima e margem desejada com uma regra determinística. |
| Explicar | Mostra custo-base, lucro, margem, alertas, composição e detalhamento da conta. |
| Comparar | Consulta produtos no mercado ou usa uma referência manual, sem ajustar automaticamente o preço recomendado para coincidir com concorrentes. |
| Registrar | Salva uma precificação privada, vinculada ao usuário, com entradas e resultado histórico. |

O preenchimento por IA facilita a entrada desses dados. A pesquisa de mercado oferece uma comparação externa. A consulta fiscal fornece classificação e uma estimativa separada. O funcionamento do simulador manual não depende de obter uma resposta da Gemini, da SearchAPI ou da Focus NFe.

O projeto não implementa controle de estoque, pedidos, recebimentos, emissão de nota fiscal ou uma plataforma completa de gestão empresarial. A finalidade atual é **precificação, comparação e histórico de simulações**.

## Experiência e jornada do usuário

### Entrada e identificação do produto

O usuário cria uma conta ou entra com e-mail e senha. Para não revelar se um e-mail já existe, o cadastro sempre devolve a mesma confirmação neutra e solicita o login; a restrição única do PostgreSQL continua sendo a autoridade sobre duplicidades. Em **Meu perfil**, pode atualizar o nome, alterar a senha mediante confirmação da senha atual e consultar a quantidade de produtos salvos. A troca de senha revoga as sessões anteriores e cria uma nova sessão somente para a requisição que concluiu a alteração. Na área do assistente, identifica o produto com nome e descrição opcional. O formulário começa com campos financeiros vazios; valores obrigatórios não são preenchidos automaticamente com zero.

A sidebar organiza o preenchimento em etapas: **Produto, Fiscal, Diretos, Indiretos, Produção, Despesas, Consulta e Prazos**. A troca de etapa preserva os valores. Os módulos de abas e redimensionamento cuidam da navegação por clique, toque e teclado, além da adaptação entre desktop e celular.

### Simulação e dashboard

Ao alterar um campo, o controlador revalida os dados e atualiza o dashboard. Se faltar uma informação obrigatória ou houver combinação inválida, o sistema mostra as pendências em vez de apresentar um resultado aparentemente definitivo. A confirmação de NCM e a consulta externa de mercado não são requisitos para calcular o preço recomendado com os dados manuais válidos.

Os principais indicadores são:

- **Preço recomendado:** preço que cobre a estrutura informada e preserva a margem desejada.
- **Preço de mercado:** referência manual ou selecionada na pesquisa, quando disponível.
- **Custo-base por venda:** custo unitário total utilizado na precificação.
- **Lucro líquido por unidade:** resultado líquido calculado para o preço recomendado.
- **Alertas:** pendências e observações relevantes, incluindo limites da avaliação fiscal.

Os botões de detalhes abrem a análise da simulação, incluindo composição dos custos, memória da conta, visualizações e comparação com o mercado. Essa tela reutiliza os resultados do mesmo motor financeiro.

A página **Sobre** resume a proposta do assistente sem reproduzir todo o formulário: apresenta o fluxo em quatro etapas — produto, custos, impostos e margem, resultado — e destaca preço com margem, preço de equilíbrio, custo unitário e comparação de mercado. Detalhes, alertas, memória de cálculo, histórico e consultas externas continuam disponíveis nos seus fluxos próprios do simulador.

### Mercado e classificação fiscal

O usuário pode pesquisar um produto usando nome, marca e modelo. Os resultados da SearchAPI/Google Shopping aparecem no dashboard, com preço e informações disponíveis do anúncio. O usuário escolhe se quer usar uma referência individual; essa escolha preserva a referência manual anterior para permitir sua restauração.

Após uma pesquisa de mercado bem-sucedida, o fluxo prepara uma descrição fiscal normalizada e procura sugestões de NCM. O usuário pode ajustar a categoria e precisa confirmar uma sugestão relevante. A origem nacional/importada é uma escolha explícita. Para importados, a interface também exige o país no fluxo da estimativa.

A área de mercado apresenta média, mediana, menor e maior preço. O card **Maior + tributos estimados** utiliza o maior preço e a tabela IBPT, depois dos pré-requisitos fiscais. Ele não altera os anúncios recebidos nem o preço sustentável.

### Preenchimento por IA

O botão **Preencher com IA** abre um modal integrado ao tema do site. A pessoa descreve seu produto ou pede uma alteração curta, como “Mude minha margem para 20%”. O sistema mostra uma prévia e só altera o formulário após **Aplicar ao simulador**.

Uma frase com custos de um lote explícito pode ser normalizada para custos unitários. Componentes mistos são normalizados separadamente antes da soma. Base ausente, ambiguidade, valor impossível ou lote sem quantidade aparecem como pendências no modal; a pessoa pode esclarecer sem reescrever a descrição. No modo completo, campos auxiliares não informados podem receber estimativas identificadas, valores manuais já presentes prevalecem sobre estimativas e somente a confirmação aplica tudo ao formulário. Na descrição inicial, `expectedMonthlyUnits` exige contexto mensal explícito e nunca é copiado do tamanho do lote nem estimado para liberar o cálculo. Quando a única pendência restante é a pergunta controlada de quantidade mensal, respostas literais como “10”, “é de 10” ou “10 por mês” usam o significado da própria pergunta e resolvem esse campo como dado do usuário.

### Salvamento e Meus produtos

**Salvar produto** envia entradas ao backend, que recalcula e monta o registro autoritativo. Apenas depois de uma resposta bem-sucedida o formulário é limpo para uma nova consulta. Uma falha de salvamento não deve apagar o trabalho do usuário.

Em **Meus produtos**, é possível buscar, ordenar por data, abrir detalhes, editar metadados, reutilizar e excluir um registro próprio. A edição rápida de nome, descrição e categoria não refaz a conta histórica. Reutilizar carrega dados no simulador para trabalhar em uma nova precificação.

## Arquitetura e mapa dos arquivos

### Visão das camadas

```text
Navegador: index.html + styles.css + ai-assistant.css + app.js
    |
    +-- Formulário/controlador: js/ui/form.js + js/main.js
    |       |
    |       +-- Motor puro: js/domain/pricing-calculator.js
    |       +-- Dashboard, detalhes, histórico e modal de IA
    |
    +-- Cliente HTTP: js/services/api-client.js
            |
            v
       Express: server.js
            |
            +-- Sessões, autenticação e produtos --> PostgreSQL
            +-- Salvamento --> o mesmo motor financeiro --> snapshot JSONB
            +-- /market/search --> SearchAPI / Google Shopping
            +-- /fiscal/ncms/... --> Focus NFe
            +-- /tax/estimate --> CSV IBPT local
            +-- /ai/parse-pricing --> provedor IA --> validação --> patch
```

O cálculo da simulação acontece no navegador para atualizar a interface imediatamente. O backend o repete ao salvar, sem confiar em um preço pronto enviado pelo cliente. A comunicação HTTP utiliza o mesmo domínio e a sessão existente.

### Interface e domínio

| Arquivo ou diretório | Responsabilidade |
| --- | --- |
| [index.html](index.html) | Estrutura das telas, IDs dos inputs, cards, abas, modais e elementos acessíveis. |
| [styles.css](styles.css) | Tema, componentes, grids, responsividade, sidebar e apresentação dos valores financeiros. |
| [ai-assistant.css](ai-assistant.css) | Estilos específicos do modal de preenchimento por IA. |
| [theme-init.js](theme-init.js) | Inicialização da preferência visual antes da aplicação principal. |
| [file-protocol-redirect.js](file-protocol-redirect.js) | Redireciona abertura via arquivo local e a antiga URL de GitHub Pages. |
| [js/main.js](js/main.js) | Controlador central: eventos, autenticação na interface, estado, renderização, buscas, salvamento, reset e reutilização. |
| [js/ui/form.js](js/ui/form.js) | IDs financeiros, leitura dos inputs, números brasileiros, validação, restauração e aplicação parcial da IA. |
| [js/ui/dashboard.js](js/ui/dashboard.js) | Cards principais, resultados de mercado, estatísticas, estimativa IBPT e estados de dados incompletos. |
| [js/ui/detail-pages.js](js/ui/detail-pages.js) | Detalhamento da precificação atual e suas visualizações. |
| [js/ui/history.js](js/ui/history.js) | Lista e apresentação de produtos salvos, incluindo compatibilidade histórica. |
| [js/ui/profile-settings.js](js/ui/profile-settings.js) | Modal de conta, avatar por iniciais, edição validada, troca de senha e acesso ao histórico. |
| [js/ui/pricing-tabs.js](js/ui/pricing-tabs.js) | Etapas da sidebar, navegação e indicação de preenchimento. |
| [js/ui/pricing-panel.js](js/ui/pricing-panel.js) | Redimensionamento do painel de preenchimento. |
| [js/ui/ai-assistant.js](js/ui/ai-assistant.js) | Modal, análise, prévia, confirmação, cancelamento e descarte de respostas antigas. |
| [js/domain/pricing-calculator.js](js/domain/pricing-calculator.js) | Validação e cálculo financeiro canônico, sem dependência do DOM ou do banco. |
| [js/domain/tax-rule-engine.js](js/domain/tax-rule-engine.js) | Avaliação fiscal configurada, alertas e memória ligada ao resultado financeiro. |
| [js/domain/fiscal-classification.js](js/domain/fiscal-classification.js) | Normalização do nome comercial para descrição fiscal e verificação de relevância textual. |
| [js/domain/fiscal-context.js](js/domain/fiscal-context.js) | Normalização de dados do contexto fiscal. |
| [js/domain/market-analysis.js](js/domain/market-analysis.js) | Funções de análise e normalização de mercado utilizadas pela aplicação. |
| [js/services/api-client.js](js/services/api-client.js) | Requisições HTTP, cookies, erros públicos e sinalização de sessão expirada. |
| [js/services/market-service.js](js/services/market-service.js) | Acesso do navegador à consulta interna de mercado. |
| [js/services/tax-service.js](js/services/tax-service.js) | Requisições e mensagens do fluxo de estimativa tributária. |
| [js/services/market-reference-store.js](js/services/market-reference-store.js) | Preserva no `sessionStorage` a seleção de mercado e sua referência manual anterior. |
| [js/utils/formatters.js](js/utils/formatters.js) | Formatação BRL/percentual, escape de texto e faixas de tamanho para valores financeiros. |
| [js/config/pricing.js](js/config/pricing.js) | Constantes auxiliares; a fonte principal das fórmulas é o módulo do domínio. |

### Backend, infraestrutura e suporte

| Arquivo ou diretório | Responsabilidade |
| --- | --- |
| [server.js](server.js) | Servidor Express, rotas, sessão, autenticação, rate limits, arquivos públicos e inicialização. |
| [lib/config.js](lib/config.js) | Leitura e validação das variáveis de ambiente. |
| [lib/database.js](lib/database.js) | Pool PostgreSQL e verificação da conexão e tabelas no startup. |
| [lib/validation.js](lib/validation.js) | Schemas Zod dos contratos de autenticação, produto, mercado e fiscal. |
| [lib/passwords.js](lib/passwords.js) | Hash e verificação de senhas. |
| [lib/models.js](lib/models.js) | Conversão das linhas do banco em respostas públicas. |
| [lib/profile-account.js](lib/profile-account.js) | Consultas privadas do perfil, atualização da própria conta e troca segura de senha. |
| [lib/pricing-persistence.js](lib/pricing-persistence.js) | Recalcula a partir das entradas e produz o snapshot financeiro para salvar. |
| [lib/market-search.js](lib/market-search.js) | Orquestra a pesquisa de mercado e seu contrato de resposta. |
| [lib/searchapi-market-provider.js](lib/searchapi-market-provider.js) | Cliente externo de Google Shopping, normalização, cache e tratamento de falhas. |
| [lib/focus-nfe-client.js](lib/focus-nfe-client.js) | Cliente autenticado de NCM da Focus NFe e tratamento seguro de respostas. |
| [lib/fiscal-classification.js](lib/fiscal-classification.js) | Busca de candidatos, confirmação e vínculo da classificação à sessão. |
| [lib/ibpt-tax-provider.js](lib/ibpt-tax-provider.js) | Carregamento e consulta exata da tabela IBPT local. |
| [lib/ai-pricing-route.js](lib/ai-pricing-route.js) | Rota IA, limites por usuário/IP, concorrência e erros seguros. |
| [lib/ai-form-assistant.js](lib/ai-form-assistant.js) | Seleção do provedor e orquestração da extração e validação. |
| [lib/gemini-form-provider.js](lib/gemini-form-provider.js) | Chamada estruturada à Gemini, timeout e isolamento da resposta externa. |
| [lib/ai-pricing-schema.js](lib/ai-pricing-schema.js) | Campos permitidos, evidências, limites e resumo determinístico da IA. |
| [migrations/](migrations/) | Alterações SQL versionadas do banco. |
| [scripts/](scripts/) | Build, lint, migrations e verificações explícitas das integrações. |
| [tests/](tests/) | Testes de domínio, contrato, UI, providers, persistência e fluxos. |
| [data/ibpt/](data/ibpt/) | Arquivo de referência tributária utilizado pelo provider local. |
| [docs/](docs/) | Guias específicos de IA, SearchAPI, Focus NFe e IBPT. |
| [render.yaml](render.yaml) | Blueprint do Web Service e do PostgreSQL no Render. |
| [docker-compose.yml](docker-compose.yml) | Banco PostgreSQL para desenvolvimento local; a aplicação Node é iniciada separadamente. |
| [.env.example](.env.example) | Nomes de variáveis e exemplos sem credenciais reais. |
| [pnpm-lock.yaml](pnpm-lock.yaml) | Versões resolvidas das dependências para instalações com pnpm. |

### Como o build funciona

O build atual é pequeno e próprio do projeto. `scripts/build.mjs` lê uma lista explícita de módulos de `js/`, remove as declarações de importação/exportação tratadas pelo script e concatena o resultado em `app.js`.

Isso tem consequências importantes para manutenção:

- Ao criar um módulo frontend, registre-o em `sourceFiles` na ordem de suas dependências.
- Imports de módulos do servidor, bibliotecas Node ou credenciais não podem entrar no bundle do navegador.
- Evite nomes de declarações de topo que colidam entre módulos: o bundle final compartilha esse escopo.
- Não presuma resolução automática de dependências, otimização ou transformação de sintaxe por um bundler como Vite.
- Uma alteração apenas em `app.js` será perdida no próximo build.
- O servidor possui rotas explícitas para os arquivos públicos. Um novo CSS ou script externo também precisa ser servido e referenciado corretamente.

## Stack

- Frontend: JavaScript puro, HTML e CSS, preservando os módulos de cálculo existentes.
- Backend: Node.js + Express.
- Banco: PostgreSQL, com SQL parametrizado e migrações versionadas.
- Autenticação: sessões persistidas no PostgreSQL, cookies `HttpOnly`/`SameSite=Lax` e senhas com hash bcrypt (12 rounds).

## Recursos implementados

- Preenchimento assistido por IA com prévia obrigatória agrupada por origem, modo completo, limites de estimativa e validação canônica no backend, sem substituir as fórmulas financeiras.
- Valores monetários com fonte adaptada ao comprimento e ao container, sem quebra, corte ou invasão dos cards vizinhos.
- Cadastro, login, logout e recuperação da sessão em `/auth/me`.
- Perfil completo com nome e e-mail editáveis, avatar por iniciais, contagem privada de produtos e alteração de senha com bcrypt.
- Rotas protegidas para criar, listar, consultar, editar e excluir produtos.
- Todos os acessos a produto verificam `user_id` junto ao ID do produto. Um produto de outra conta retorna `404` e nunca é exposto.
- Histórico com busca por nome, ordenação por data, visualização, edição, exclusão e reutilização de uma precificação anterior.
- Salvamento de todos os campos relevantes da consulta (entradas, memória do cálculo e referência de mercado) em `calculation_data`.
- Normalização editável do produto em categoria fiscal, com sugestões reais da Focus NFe filtradas por relevância e confirmação explícita de NCM.
- Consulta opcional de produtos e preços do Google Shopping pela SearchAPI.io, sempre através do backend.
- Estimativa local dos tributos do produto de maior preço pela tabela IBPT após confirmação do NCM e escolha explícita entre origem nacional e importada.
- Cálculo técnico canônico no mesmo módulo puro para navegador e servidor, com validação em ambos os lados e sem arredondamentos intermediários.
- Validação no navegador e no servidor, limitação de tentativas de autenticação, cabeçalhos de segurança e respostas sem hashes/senhas.

## Precificação transparente v7

O cálculo salvo usa `pricingSchemaVersion: 7` e `formulaVersion: "transparent-pricing-v3"`. O formulário separa insumos, frete, mão de obra direta, custos fixos, equipamentos, despesas da venda e capital de giro. Todos os valores obrigatórios são informados explicitamente: o sistema não inventa custos, produtividade, margens ou taxas ausentes.

O servidor recebe as entradas e recalcula o resultado, o resumo e a memória de cálculo pelo mesmo módulo puro usado no navegador. Totais ou preços derivados enviados pelo cliente são ignorados. Mercado é somente uma referência opcional e desconto é uma estratégia posterior: nenhum deles reduz o custo ou substitui a margem definida.

Snapshots v6 continuam calculáveis com a fórmula histórica. Ao reutilizar registros v5 ou v6 no novo formulário, apenas equivalências seguras são migradas; mão de obra e tempo de produção ficam pendentes para confirmação, evitando conversões silenciosas entre folha geral e mão de obra direta.

### Sequência da conta

O resumo abaixo descreve o algoritmo implementado, e não uma regra adicional a ser aplicada fora do módulo canônico:

```text
materiaPrimaAjustada = materialCost / (1 - wasteRate)

custoFreteUnitario = averageOrderFreight * parcelaPagaPelaEmpresa
                   / averageOrderUnits
custoHoraMaoDeObra = monthlyLaborCost / monthlyProductiveHours
custoMaoDeObraUnitario = custoHoraMaoDeObra * productionTimeMinutes / 60

custoDireto = materiaPrimaAjustada + packagingCost + custoFreteUnitario
            + custoMaoDeObraUnitario + otherVariableCost + otherDirectExpenses

fatorRateio = quantidade, horas de mão de obra, horas de máquina ou faturamento
custoFixoUnitario = monthlyFixedCosts * fatorRateio
custoEquipamentoUnitario = (depreciacaoMensal + manutencaoMensal) * fatorRateio

custoOperacional = custoDireto + custoFixoUnitario + custoEquipamentoUnitario
diasFinanciados = max(inventoryDays + receivingDays - paymentDays, 0)
taxaDoPeriodo = (1 + monthlyCapitalRate) ^ (diasFinanciados / 30) - 1
custoFinanceiro = custoOperacional * taxaDoPeriodo
custoTotalUnitario = custoOperacional + custoFinanceiro
                   + fixedFeePerOrder / averageOrderUnits

despesasPercentuais = taxRate + paymentFeeRate + commissionRate
                    + marketplaceFeeRate + postSaleLossRate
precoEquilibrio = custoTotalUnitario / (1 - despesasPercentuais)
precoMargemDesejada = custoTotalUnitario
                    / (1 - despesasPercentuais - desiredNetMargin)
precoRecomendado = ceil(precoMargemDesejada * 100) / 100
```

Os denominadores precisam ser positivos. Desperdício e percentuais não podem atingir 100%; quantidade mensal e unidades por pedido precisam ser maiores que zero. Campos monetários não aceitam valores negativos e as bases escolhidas para rateio precisam ser coerentes com o consumo do produto.

**Margem líquida não é markup.** O percentual desejado participa do denominador porque representa uma fração do preço de venda. Não substitua esse cálculo por `custo × (1 + margem)` em uma correção de interface ou em uma implementação da IA.

Como exemplo, para custo completo de `R$ 100,00`, sem despesas percentuais, uma margem de `20%` resulta em `R$ 125,00`; uma margem de `30%` resulta em `R$ 142,86`. Não use `custo × (1 + margem)`, pois isso é markup.

### Desconto e volume mensal

O desconto é uma estratégia comercial posterior ao preço recomendado. Com desconto percentual, o preço anunciado parte de `precoRecomendado / (1 - discountRate)`; com desconto fixo, parte de `precoRecomendado + fixedDiscountAmount`. O tipo selecionado determina qual campo participa da conta, e o preço após desconto preserva a margem desejada.

`expectedMonthlyUnits` é sempre a quantidade deste produto que o usuário espera produzir ou vender no mês. O valor não é deduzido automaticamente de funcionários, faturamento ou capacidade e nunca é substituído por uma estimativa silenciosa.

### Separação entre preço, mercado e fiscal

| Informação | Origem | Participação no sistema |
| --- | --- | --- |
| Preço de equilíbrio, mínimo e recomendado | Motor financeiro com entradas do usuário | Faixas explícitas para cobrir despesas, atingir a margem mínima opcional e atingir a margem desejada. |
| Margem desejada | Usuário, manualmente ou por patch de IA confirmado | Percentual que participa do denominador do preço. |
| Referência de mercado | Valor manual, produto selecionado, média ou mediana conforme regra escolhida | Comparação; não entra no custo nem muda o preço recomendado. |
| Percentual efetivo de impostos | `taxRate` informado pelo usuário | Despesa percentual do preço de venda; deve vir da empresa, contador ou integração fiscal. |
| NCM confirmado | Sugestão e confirmação na Focus NFe | Classificação; não é uma alíquota nem confirmação da tributação completa. |
| Maior + tributos estimados | Maior anúncio e alíquotas da tabela IBPT local | Card separado da consulta de mercado. |

## Campos e convenções de dados

### Entradas financeiras do formulário

Os nomes abaixo são os IDs reais usados pelo formulário. Ao adicionar um campo, revise leitura, validação, payload, persistência, restauração, reset, testes e, se aplicável, o schema da IA.

| Campo | Significado e unidade | Preenchimento |
| --- | --- | --- |
| `materialCost`, `wasteRate`, `packagingCost` | Insumos por unidade, perda percentual e embalagem por unidade | Obrigatórios; zero deve ser explícito |
| `averageOrderFreight`, `freightPayer`, `companyFreightShare`, `averageOrderUnits` | Frete médio do pedido, quem paga, parcela da empresa e unidades médias por pedido | Frete e unidades obrigatórios; parcela exigida no modo compartilhado |
| `otherVariableCost`, `otherDirectExpenses` | Outros custos variáveis e despesas diretas por unidade | Opcionais |
| `laborCostMode` | Escolhe cálculo automático ou custo/hora manual da mão de obra direta | Obrigatório |
| `monthlyLaborCost`, `monthlyProductiveHours` | Custo mensal da equipe produtiva e horas produtivas totais | Exigidos no modo automático |
| `laborHourlyCost`, `productionTimeMinutes` | Custo/hora manual e tempo médio por unidade | Custo/hora condicional; tempo obrigatório |
| `monthlyFixedCosts`, `expectedMonthlyUnits` | Custos fixos sem mão de obra direta e quantidade mensal deste produto | Obrigatórios; quantidade positiva |
| `allocationMethod` e bases de rateio | Quantidade, horas de mão de obra, horas de máquina ou participação no faturamento | Bases condicionais ao método escolhido |
| `equipmentValue`, `equipmentUsefulLifeMonths`, `equipmentMaintenanceMonthly` | Valor, vida útil e manutenção dos equipamentos | Opcionais; vida útil exigida quando há valor |
| `taxRate` | Percentual efetivo de impostos sobre a venda | Obrigatório |
| `paymentFeeRate`, `commissionRate`, `marketplaceFeeRate` | Taxa de pagamento, comissão e plataforma sobre a venda | Opcionais |
| `fixedFeePerOrder`, `postSaleLossRate` | Taxa fixa por pedido e perdas pós-venda | Opcionais |
| `minimumMargin`, `desiredNetMargin` | Margem mínima opcional e margem líquida desejada | Desejada obrigatória; mínima não pode superá-la |
| `inventoryDays` | Prazo de estoque/produção, em dias | Obrigatório |
| `receivingDays` | Prazo de recebimento da venda, em dias | Obrigatório |
| `paymentDays` | Prazo de pagamento ao fornecedor, em dias | Obrigatório |
| `capitalRateSource`, `monthlyCapitalRate` | Origem escolhida e custo mensal do capital | Taxa exigida, exceto quando o usuário escolhe zero |
| `discountType`, `discountRate`, `fixedDiscountAmount` | Tipo e valor da estratégia de desconto | Opcionais e mutuamente exclusivos |
| `marketPrice` | Preço médio de produtos equivalentes no mercado | Opcional; apenas comparação |

`productName` identifica o produto e é necessário para salvar; `productDescription` é opcional. Opções condicionais controlam quais campos são ativos. Valores antigos preservados em campos ocultos não participam da validação nem da conta até o usuário selecionar novamente aquela opção.

### Percentuais, vazios e serialização

- No input e no contrato de IA, `25` representa `25%`.
- No domínio financeiro e em `pricing.inputs`, esse mesmo percentual é a fração `0.25`.
- O parser do formulário aceita números brasileiros, como `1.234,56`, e diferencia campo vazio de valor inválido. Não envie strings com `R$` ou `%` diretamente para a função de cálculo.
- No preenchimento manual, um campo obrigatório vazio permanece pendente. A IA não pode estimar dados financeiros críticos; precisa perguntar ao usuário e obter confirmação explícita.
- Custos opcionais vazios são normalizados para zero no cálculo; mercado vazio permanece `null`.
- `emptyOptionalFields` acompanha o salvamento para distinguir o que estava vazio do que foi digitado explicitamente.
- No patch da IA, `null` ou ausência significa **preservar**, enquanto `0` significa aplicar zero.
- Custos unitários, totais de lote e valores mensais têm significados diferentes. A normalização de lote do assistente exige uma quantidade explícita e aparece na prévia.

## Fluxos internos e estado da aplicação

### Leitura, validação e renderização

O mapa `elements` em `js/main.js` aponta para os controles reais. `validatePricingForm` lê esses controles, normaliza percentuais e chama a validação de domínio. `render()` usa o resultado válido para atualizar o dashboard ou mostra o estado incompleto. A renderização, por si só, não deve iniciar novas consultas externas.

`touchedPricingFields` e a indicação de exibir todos os erros controlam quais mensagens de validação ficam visíveis. As abas atualizam seus indicadores de preenchimento sem criar cópias independentes dos dados financeiros.

### Estado de mercado e fiscal

`marketState` guarda o andamento da pesquisa, produtos, estatísticas, seleção e estimativa de tributos. `manualMarketValue` preserva a referência manual quando uma referência externa é selecionada. `focusState` e `ncmSearchState` representam confirmação e candidatos fiscais, respectivamente.

As revisões `marketSearchRevision`, `ncmLookupRevision` e `ncmSearchRevision` invalidam respostas de pesquisas antigas. A estimativa tributária também vincula o resultado à assinatura do contexto atual. Se produto, categoria, NCM, maior preço ou origem mudarem, uma resposta anterior não pode reaparecer como se pertencesse ao novo contexto.

O backend mantém na sessão os candidatos da busca fiscal e a confirmação vinculada a `classificationId`. A confirmação exige um candidato relevante da busca corrente. Não basta preencher um input escondido de NCM ou reaproveitar somente um código antigo para liberar a estimativa.

### Estado do assistente de IA

O modal tem seu próprio estado efêmero de análise e prévia. Ele não é um histórico de chat. Apenas a confirmação chama `applyAssistantFields` e `applyAiPricingFields`; essas funções atualizam os controles e os estados dependentes do controlador atual.

Quando existe uma pendência, o segundo envio não recomeça a análise. O navegador envia a resposta curta junto do contexto efêmero e do resultado anterior validado. O backend reconstrói a pergunta controlada a partir do código e do campo pendentes, sem confiar em texto livre do navegador, e a envia à Gemini com o contexto e a resposta. A Gemini recebe um schema reduzido aos campos pendentes; o backend valida a extração parcial, combina somente campos resolvidos com os valores anteriores e valida novamente o resultado completo. Se a pergunta única for `AI_REQUIRED_FIELD_MISSING` para `expectedMonthlyUnits`, o número literal da resposta recebe o contexto mensal dessa pergunta; a mesma resposta numérica diante de uma pergunta de rendimento resolve o lote, não o volume mensal. `null`, ausência e falhas não apagam a prévia anterior.

Cancelar, editar a mensagem, encerrar sessão, resetar a consulta ou reutilizar produto invalida a análise anterior. Uma resposta atrasada não pode preencher outro produto. O frontend bloqueia envios simultâneos e o backend mantém uma análise pendente por conta, além do rate limit.

### Persistência do usuário versus persistência do navegador

| Informação | Onde fica | O que acontece ao mudar de dispositivo |
| --- | --- | --- |
| Conta e produtos salvos | PostgreSQL do ambiente acessado | Estão disponíveis ao entrar na mesma conta no mesmo ambiente. |
| Sessão autenticada | Cookie do navegador + sessão no PostgreSQL | O novo navegador precisa autenticar; Git não copia cookies. |
| Preferência de tema | `localStorage` | É uma preferência local do navegador. |
| Referência individual de mercado em uso | Estado da tela e `sessionStorage` | Não equivale a um produto salvo nem a sincronização entre dispositivos. |
| Inputs da simulação atual | Controles e estado em memória da página | Não conte com recuperação em outro computador sem salvar o produto. |
| Mensagem e prévia da IA | Memória do modal | São descartáveis; não há histórico de conversas no banco. |
| Código e documentação | Repositório Git | São transferidos por commit/push e clone/pull. |

## Pré-requisitos

- Node.js 20 ou superior.
- PostgreSQL 14 ou superior, ou Docker Desktop com Docker Compose.

O Blueprint atualmente declara `NODE_VERSION=20`; a rodada de validação da implementação de IA usou Node `24.19.0` localmente. Confira `node --version` em um novo dispositivo: o script de testes usa `--test-isolation=none`, e o runtime escolhido precisa aceitar essa opção. Não trate a configuração declarada do deploy como prova de que todos os comandos de desenvolvimento foram executados naquela mesma versão.

## Configuração local com Docker (recomendada)

No diretório do projeto:

```powershell
Copy-Item .env.example .env
# Edite .env: defina POSTGRES_PASSWORD, DATABASE_URL com a mesma senha e SESSION_SECRET.
docker compose up -d database
pnpm install
pnpm migrate
pnpm start
```

Abra [http://localhost:3000](http://localhost:3000). O `docker-compose.yml` inicia um PostgreSQL local em `localhost:5432`; os dados ficam em `.postgres-data/`, que é ignorado pelo Git. Ele lê as credenciais do `.env`, sem gravar senha de banco no repositório.

Antes de publicar, troque obrigatoriamente `SESSION_SECRET`, a senha de banco e configure `SESSION_COOKIE_SECURE=true` atrás de HTTPS.

### Focus NFe

Defina `FOCUS_NFE_TOKEN` somente no ambiente do processo. Em desenvolvimento, a aplicação usa homologação; com `NODE_ENV=production`, usa `https://api.focusnfe.com.br` por padrão. `FOCUS_NFE_BASE_URL` é opcional e deve ser configurada apenas quando você quiser forçar um dos ambientes oficiais. O token precisa corresponder ao ambiente escolhido. Use `FOCUS_NFE_TIMEOUT_MS=5000`. O token é enviado pelo backend como usuário do HTTP Basic com senha vazia; nunca é exposto ao navegador, salvo no banco ou incluído em logs.

O assistente usa a Focus NFe apenas para consultar e validar a descrição de um NCM exato. Ela não é apresentada como origem do cálculo tributário. Consulte [docs/focus-nfe.md](docs/focus-nfe.md) para os limites dessa validação.

### SearchAPI.io / Google Shopping

A busca de mercado usa o endpoint oficial de Google Shopping da SearchAPI.io. O navegador chama apenas `GET /market/search`; autenticação Bearer, cache de pesquisa por cinco minutos, deduplicação de chamadas e normalização ficam no backend. A interface mostra até cinco resultados relevantes quando a resposta contém dados compatíveis.

Configure somente no ambiente do servidor:

```text
SEARCHAPI_API_KEY
SEARCHAPI_TIMEOUT_MS=15000
```

`SEARCHAPI_API_KEY` é a única credencial de mercado obrigatória e deve ser criada no painel da SearchAPI.io. Nunca a coloque no frontend. Sem ela, `/health` retorna apenas `market.configured: false` e a pesquisa fica indisponível; o simulador continua funcionando com o campo manual **Preço médio local dos concorrentes (R$)**.

O endpoint diferencia configuração ausente (`503`), consulta inválida (`400`), credencial recusada ou sem permissão (`401/403`), limite (`429`), resposta externa inválida (`502`), falhas externas (`5xx`) e timeout (`504`). Os logs registram apenas consulta, provedor, status, contagem e uso de cache — nunca a chave ou o cabeçalho de autorização. Consulte [docs/searchapi.md](docs/searchapi.md) para o contrato externo e o teste real.

### Estimativa IBPT

O navegador chama `POST /tax/estimate`. O backend consulta localmente `data/ibpt/TabelaIBPTaxSP26.2.A.csv`, carregada uma vez em Windows-1252 e indexada por NCM. A busca no arquivo é exata e só acontece após o usuário confirmar um NCM relevante pela Focus NFe e escolher a origem do produto.

Para origem nacional, a alíquota federal vem de `nacionalfederal`; para importada, de `importadosfederal`. A carga aproximada é `federal + estadual + municipal`, e o card soma ao maior preço apenas o valor calculado por essa alíquota. A versão, vigência e fonte acompanham o resultado. Não há chave, empresa ou chamada externa para calcular esse card. Consulte [docs/ibpt.md](docs/ibpt.md).

### Assistente de preenchimento por IA

O botão **Preencher com IA** abre uma descrição livre e mostra campos e pendências antes de **Aplicar ao simulador**. O provedor padrão é Gemini, modelo `gemini-3.5-flash-lite`, com saída estruturada por JSON Schema. Com `AI_FILL_MODE=complete`, cada valor é classificado como `user_provided`, `inferred` ou `estimated`; a prévia separa essas origens e avisa que sugestões podem ser ajustadas. A rota autenticada `POST /ai/parse-pricing` recebe `message`, percentuais atuais e um conjunto estrito de inputs válidos já presentes. Somente `message` chega à Gemini: o backend usa `currentFields` para preservar valores manuais no lugar de estimativas. No esclarecimento, recebe também contexto efêmero, origens, campos anteriores validados e pendências, sem dados da conta ou credenciais. Apenas o controlador atual aplica o patch e chama o cálculo existente. Esclarecimentos ficam em memória no modal e não são salvos no banco.

Configure `GEMINI_API_KEY` exclusivamente no backend. Os padrões são `AI_PROVIDER=gemini`, `AI_MODEL=gemini-3.5-flash-lite`, `AI_FILL_MODE=complete` e `AI_TIMEOUT_MS=25000`. No Render, abra o **Web Service → Environment → Add Environment Variable**, adicione a chave e substitua também valores antigos explícitos: variáveis do serviço prevalecem sobre os padrões novos. Depois use **Manual Deploy → Deploy latest commit**. A declaração `sync: false` no Blueprint não preenche o segredo de um serviço existente. `OPENAI_API_KEY` não é mais necessária em nenhuma funcionalidade deste projeto e pode ser removida do ambiente.

Sem configuração ou durante falhas externas, o simulador manual continua funcionando. Há limites de oito análises por minuto por conta e por IP, com uma análise simultânea por conta. A aplicação não salva conversas nem registra a mensagem em logs. Consulte [docs/ai-assistant.md](docs/ai-assistant.md) para os campos, limites, arquitetura e roteiro de teste.

O diagnóstico `ai` em `/health` informa `provider`, `configured`, modelo, timeout, versão/método REST, contrato estruturado e `configurationErrors`; `deployment.commit` expõe somente o SHA validado fornecido pelo Render. Não há segredos nem chamada paga. Configuração aceita não comprova credencial válida ou créditos disponíveis. O backend diferencia ausência de configuração, autenticação/permissão do provedor, modelo indisponível, requisição/schema rejeitado, quota, rate limit, timeout e resposta inválida. No Shell do Render, `pnpm gemini:check` confirma a disponibilidade do modelo para a conta, o suporte a `generateContent` e uma geração estruturada com o caso de lote; a geração consome quota. O roteiro completo e a tabela de erros estão em [Diagnóstico no Render](docs/ai-assistant.md#diagnóstico-no-render).

O payload validado usa `temperature: 0`, `generationConfig.responseMimeType: "application/json"` e `generationConfig.responseJsonSchema`. `responseFormat` e `responseSchema` não são enviados juntos. O schema externo não contém `maxItems`, porque a combinação do limite 35 com o enum de 35 campos foi rejeitada por complexidade pela Gemini; o backend limita a 100 entries para comportar componentes repetidos sem permitir resposta ilimitada. Cada entry declara base, certeza e evidências; a validação posterior continua rigorosa. Em follow-up, o mesmo contrato estruturado permanece ativo, mas o enum `field` contém somente os campos que ainda estão pendentes.

## Variáveis de ambiente em um só lugar

A referência editável é [.env.example](.env.example), e a interpretação efetiva está em [lib/config.js](lib/config.js). Os valores abaixo descrevem o código atual; não incluem segredos de desenvolvimento ou produção.

| Variável | Finalidade | Observação |
| --- | --- | --- |
| `DATABASE_URL` | Conexão PostgreSQL da aplicação | Obrigatória para iniciar o servidor e executar migrations. |
| `SESSION_SECRET` | Assinatura das sessões | Obrigatória, com pelo menos 32 caracteres; não versionar o valor real. |
| `PORT` | Porta HTTP | Padrão local `3000`. |
| `NODE_ENV` | Ambiente de execução | Afeta seleção padrão da Focus, cookie seguro e conexão do banco. |
| `SESSION_COOKIE_SECURE` | Cookie restrito a HTTPS | `false` no localhost HTTP; produção ativa cookie seguro. |
| `POSTGRES_DB` | Banco criado pelo Docker Compose local | Precisa corresponder à conexão local pretendida. |
| `POSTGRES_USER` | Usuário criado pelo Docker Compose local | Usado pelo serviço de banco local. |
| `POSTGRES_PASSWORD` | Senha do PostgreSQL local | Deve corresponder à credencial de `DATABASE_URL`. |
| `FOCUS_NFE_TOKEN` | Credencial de consulta NCM | Somente backend; precisa corresponder ao ambiente escolhido. |
| `FOCUS_NFE_BASE_URL` | Ambiente oficial da Focus | Opcional; a configuração aceita apenas as origens oficiais previstas no código. |
| `FOCUS_NFE_TIMEOUT_MS` | Timeout da Focus | Padrão `5000`; inteiro entre 100 e 30000. |
| `SEARCHAPI_API_KEY` | Credencial de Google Shopping | Somente backend; sem ela, a alternativa manual de mercado continua disponível. |
| `SEARCHAPI_TIMEOUT_MS` | Timeout da SearchAPI | Padrão `15000`; inteiro entre 100 e 30000. |
| `GEMINI_API_KEY` | Credencial do preenchimento IA | Somente backend; sem ela, o formulário manual continua disponível. |
| `AI_PROVIDER` | Implementação do provedor IA | Padrão e implementação atual: `gemini`. |
| `AI_MODEL` | Modelo de extração estruturada | Padrão configurado: `gemini-3.5-flash-lite`. |
| `AI_FILL_MODE` | Política de preenchimento do assistente | Padrão `complete`; `partial` conserva o comportamento de somente extrair. |
| `AI_TIMEOUT_MS` | Timeout da análise IA | Padrão `25000`; inteiro entre 100 e 60000. |

Ao copiar `.env.example`, o token fictício de Focus não se torna uma credencial válida. Configure um token real de homologação ou deixe `FOCUS_NFE_TOKEN` vazio para desenvolver sem essa consulta. Não use um teste de “variável presente” como confirmação de que a API está operacional.

O `.env` local e as variáveis do Web Service no Render são configurações independentes. Alterar uma delas não altera automaticamente a outra. A declaração `sync: false` no Blueprint indica que um segredo precisa ser fornecido; não contém nem recupera a chave por conta própria.

## Publicação a partir do GitHub

**Não publique este projeto no GitHub Pages.** Ele serve apenas HTML, CSS e JavaScript estáticos: não executa `server.js`, não mantém sessões nem conecta ao PostgreSQL. Por isso as chamadas `GET /auth/me` retornam `404` e os `POST /auth/login` e `POST /auth/register` retornam `405` no Pages. Além disso, o GitHub não recomenda o Pages para sites que recebem senhas.

O repositório contém [`render.yaml`](render.yaml), que publica a aplicação completa — interface, API e banco — no mesmo domínio. Isso preserva a autenticação por cookie seguro e dispensa CORS.

1. Envie todos os arquivos para um repositório GitHub, incluindo `render.yaml`, mas excluindo `.env`.
2. No Render, escolha **New → Blueprint**, conecte o repositório e confirme os recursos propostos.
3. O serviço cria o PostgreSQL, injeta `DATABASE_URL`, gera `SESSION_SECRET`, executa `npm run migrate` antes de cada publicação e inicia `npm start`.
4. Configure no Web Service um `FOCUS_NFE_TOKEN` de produção. O Blueprint já seleciona `https://api.focusnfe.com.br` e o backend registra apenas `configured=true/false`, nunca o token.
5. Para habilitar a pesquisa de mercado, preencha manualmente `SEARCHAPI_API_KEY` no Web Service. O Blueprint define `SEARCHAPI_TIMEOUT_MS=15000`; a existência de `sync: false` não preenche o segredo.
6. Abra a URL `https://…onrender.com` fornecida pelo Render. Essa é a URL que deve ser compartilhada e usada para criar contas.

Em um serviço Render já existente, abra **Environment**, confira `SEARCHAPI_API_KEY` e escolha **Save Changes**. Em seguida execute **Manual Deploy → Deploy latest commit**. Nunca grave o valor no GitHub ou no frontend.

O endereço configurado no redirecionamento do projeto é [fecart-2026.onrender.com](https://fecart-2026.onrender.com/), e o repositório utilizado é [GustavoL266/Fecart-2026](https://github.com/GustavoL266/Fecart-2026). Essas referências identificam a configuração do código; este README não verifica continuamente disponibilidade, credenciais, configuração de auto deploy ou status dos serviços.

O Blueprint executa `npm install && npm run build`, usa `npm run migrate` como etapa anterior ao deploy e inicia com `npm start`. O comando de migration é declarado no arquivo; ao configurar ou alterar o serviço, confira se as etapas previstas estão habilitadas no ambiente efetivamente usado. Um commit no GitHub não comprova que a nova versão terminou de subir no Render.

Não é preciso (nem correto) colocar credenciais no GitHub, no código ou no GitHub Pages. Se o Pages já estiver ativo no repositório, desative-o em **Settings → Pages** para evitar que usuários cheguem à cópia estática sem API.

## Diagnóstico de inicialização

O frontend e a API são servidos pelo mesmo processo; não há um segundo servidor para iniciar. Use `npm run start` (ou `pnpm start`) e abra `http://localhost:3000`. Não abra `index.html` diretamente pelo Explorador de Arquivos: isso usa `file:///`, e o navegador bloqueia as chamadas de autenticação por segurança. Caso ocorra, o projeto redireciona automaticamente para a URL correta.

- `SESSION_SECRET não foi definida`: copie `.env.example` para `.env` e informe uma chave aleatória de pelo menos 32 caracteres.
- `DATABASE_URL não foi definida` ou falha de conexão: inicie o PostgreSQL e confira host, porta, usuário, senha e nome do banco no `.env`.
- `MIGRATIONS_PENDING`: execute `npm run migrate` (ou `pnpm migrate`) antes de iniciar a aplicação.
- `market.configured: false` no `/health`: confira se `SEARCHAPI_API_KEY` foi configurada no backend. O endpoint nunca mostra a chave.
- `ai.configured: false` no `/health`: consulte `ai.configurationErrors`. `GEMINI_API_KEY_MISSING` significa que a chave não foi cadastrada no backend desse ambiente. Confira também `AI_PROVIDER`, `AI_MODEL`, `AI_FILL_MODE` e `AI_TIMEOUT_MS`; não altere segredos de sessão para corrigir a IA.
- IA configurada, mas análise falha: compare `ai.model`, `ai.timeoutMs` e `deployment.commit`; depois cruze o JSON seguro da rota com `[AI] upstreamStatus`, `[AI] upstreamErrorCode` e `[AI] upstreamErrorStatus`. Nenhuma mensagem, chave, cabeçalho ou corpo de resposta é registrado. Execute uma vez `pnpm gemini:check` no Shell do Render para verificar conta, método e geração estruturada. Consulte a tabela em [docs/ai-assistant.md](docs/ai-assistant.md#códigos-de-erro).
- `/auth/me` 401 no carregamento sem sessão é a checagem inicial que abre o login. Se ocorrer após autenticar, confira a ordem das requisições e o envio do cookie sem expor seu valor. Somente `SESSION_REQUIRED` encerra a sessão no frontend; 401 externo não deve deslogar. O bootstrap descarta respostas/tentativas antigas após mudança de autenticação.
- `market.configured: true` confirma somente que a variável existe. Depois de uma pesquisa, consulte os logs `[Market] Status` e `[Market] Results` para distinguir credencial inválida (`401`), falta de permissão (`403`), limite (`429`) e falha externa (`5xx`).
- `taxEstimate.configured: false` no `/health`: confira se `data/ibpt/TabelaIBPTaxSP26.2.A.csv` foi incluído sem conversão. `errorCode` distingue arquivo ausente de arquivo inválido.

Na inicialização, o servidor testa a conexão com o PostgreSQL e confirma que as tabelas exigidas existem. Assim, uma configuração incompleta aparece no terminal com a causa concreta, em vez de falhar apenas ao enviar o formulário.

## Configuração com PostgreSQL já instalado

1. Crie um banco, por exemplo `assistente_precificacao`.
2. Copie `.env.example` para `.env`.
3. Ajuste `DATABASE_URL` e gere uma `SESSION_SECRET` aleatória de pelo menos 32 caracteres.
4. Instale e execute:

```bash
pnpm install
pnpm migrate
pnpm start
```

Exemplo de geração de segredo no Node:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Comandos

```bash
pnpm start       # inicia o servidor em http://localhost:3000
pnpm dev         # reinicia o servidor ao alterar arquivos
pnpm migrate     # aplica migrations/*.sql pendentes
pnpm lint        # verifica a sintaxe dos arquivos JavaScript
pnpm build       # gera app.js a partir dos módulos em js/
pnpm test        # executa os testes
pnpm focus:check # consulta não destrutiva de NCM somente em homologação
pnpm searchapi:check -- "iPhone 15 Pro Max" # executa uma busca real de validação
```

`app.js` é gerado. Edite os módulos de `js/` e rode `pnpm build` antes de publicar alterações do frontend.

Os equivalentes via npm são `npm run lint`, `npm test`, `npm run build`, `npm run migrate` e `npm start`. Para reproduzir as versões do lockfile com pnpm, utilize `pnpm install --frozen-lockfile`. O build não inicia o servidor nem comprova conexão com PostgreSQL ou disponibilidade de uma API externa.

## Banco de dados

`migrations/001_initial.sql` cria:

- `users`: usuário, e-mail único, `password_hash` e timestamps; nome, e-mail e hash existentes atendem às configurações do perfil sem nova migration;
- `products`: dados de precificação, `user_id`, cálculo completo e timestamps;
- `user_sessions`: sessões do Express armazenadas no PostgreSQL.

O relacionamento `products.user_id → users.id` usa chave estrangeira com `ON DELETE CASCADE`. Os índices `products(user_id, consultation_date DESC)` e `products(user_id, name)` deixam rápidas as consultas privadas do histórico.

### Snapshot financeiro e compatibilidade

`products.calculation_data` é o registro JSONB detalhado da precificação. Na versão atual, ele inclui:

- `pricingSchemaVersion` e `formulaVersion`: versão estrutural e versão da fórmula.
- `inputs`: entradas financeiras normalizadas e contexto usado na conta.
- `emptyOptionalFields`: campos opcionais que estavam vazios.
- `pricingResult`: resultado canônico e sua composição.
- `fiscal`: contexto, dados de NCM, origem da validação, pendências e memória.
- `market`: referência usada e dados de comparação na consulta salva.
- `summarySemantics`: significado das colunas-resumo legadas.

As colunas `cost_price`, `additional_costs`, `profit_margin` e `suggested_price` mantêm um resumo compatível com o histórico. Não use esses nomes legados para deduzir fórmulas novas; consulte o snapshot e `lib/pricing-persistence.js`.

`PATCH /products/:id` edita somente metadados: nome, descrição e categoria. Para trabalhar com novos custos, o fluxo é reutilizar no simulador e salvar a nova precificação. O histórico não deve ser recalculado silenciosamente com uma fórmula posterior.

### Migrations e ambientes

O script de migration cria sua tabela de controle `schema_migrations`, ordena os arquivos SQL e registra os nomes aplicados. Cada arquivo pendente é executado em uma transação. Para evoluir o banco, adicione uma nova migration; alterar apenas uma migration já registrada não faz esse conteúdo executar novamente em um banco existente.

O pool da aplicação verifica conexão e presença de `users`, `products` e `user_sessions` antes de abrir a porta HTTP. A configuração atual de produção do pool utiliza TLS com `rejectUnauthorized: false`; essa é uma configuração existente a conhecer ao mudar o ambiente de banco, não uma verificação de certificado do servidor.

Um banco local recém-criado começa vazio. Dados de produção não fazem parte do repositório, e migrations criam estrutura, não copiam contas ou produtos de outro ambiente.

## Endpoints

| Método | Rota | Autenticação |
| --- | --- | --- |
| GET | `/health` | Pública; diagnóstico seguro de banco e integrações previstas no endpoint |
| POST | `/auth/register` | Pública; responde `202` de forma idêntica para e-mail novo ou existente e não inicia sessão |
| POST | `/auth/login` | Pública |
| POST | `/auth/logout` | Sessão atual |
| GET | `/auth/me` | Sessão atual; devolve dados públicos da conta e contagem de produtos próprios |
| PATCH | `/auth/me` | Obrigatória; atualiza somente o nome do usuário da sessão |
| POST | `/auth/change-password` | Obrigatória; valida a senha atual, grava o novo hash bcrypt, revoga sessões anteriores e renova a atual |
| GET | `/products` | Obrigatória |
| GET | `/products/:id` | Obrigatória + dono |
| GET | `/fiscal/ncms/:codigo` | Obrigatória; proxy backend para Focus NFe |
| GET | `/fiscal/ncms/search?q=descricao` | Obrigatória; sugestões fiscais por descrição da Focus NFe, sem confirmação automática |
| GET | `/market/search?q=termos` | Obrigatória; proxy backend para SearchAPI Google Shopping |
| POST | `/ai/parse-pricing` | Obrigatória; extrai e valida campos para prévia, sem calcular preço |
| POST | `/tax/estimate` | Obrigatória; estima localmente a carga IBPT sobre o maior preço informado pelo state |
| POST | `/products` | Obrigatória |
| PATCH | `/products/:id` | Obrigatória + dono |
| DELETE | `/products/:id` | Obrigatória + dono |

O frontend sempre envia cookies com `credentials: "include"`. Em produção, o Render usa o mesmo domínio para interface e API, cookie `Secure`, `SameSite=Lax`, `HttpOnly`, sessão no PostgreSQL e `trust proxy` para o único proxy do Render. A API nunca retorna `password_hash` e utiliza parâmetros do PostgreSQL em todas as queries.

## Verificação manual do fluxo

1. Inicie banco, migrações e servidor.
2. Acesse `http://localhost:3000`, crie uma conta e faça login depois da confirmação neutra do cadastro.
3. Informe o preço médio local dos concorrentes manualmente, gere a precificação e confirme que o fluxo funciona sem consultar o provedor externo.
4. Opcionalmente, pesquise um produto, confira os resultados e clique em **Usar como referência**; o preço individual selecionado passa a ser a referência de mercado, sem apagar a referência manual anterior.
5. Clique em **Salvar produto**.
6. Abra **Meus produtos**, pesquise, visualize, edite, reutilize e exclua um registro.
7. Faça logout e login novamente: os produtos permanecem no banco.
8. Para validar isolamento, crie outra conta e tente abrir o ID de um produto da primeira: a API responderá `Produto não encontrado`.
9. Abra **Meu perfil**, altere o nome e confirme que o cabeçalho reflete o dado atualizado; o e-mail permanece somente leitura.
10. Em **Alterar senha**, confira confirmação divergente e senha atual incorreta; depois confirme que outra sessão já aberta é recusada e que somente a sessão atual foi renovada.
11. Confirme que **Ver meus produtos** abre o histórico e que cancelar ou fechar o modal descarta alterações não salvas.

Para confirmar o usuário diretamente no banco sem revelar dados sensíveis, use uma consulta como:

```sql
SELECT id, name, email, created_at, password_hash LIKE '$2%' AS senha_com_hash_bcrypt
FROM users
WHERE email = 'seu@email.com';
```

## Continuidade entre dispositivos

### Preparar um novo computador

Use um clone Git para manter o histórico e o vínculo com o repositório. Uma pasta baixada como ZIP não contém necessariamente `.git` e não oferece a mesma continuidade para commits e atualizações.

```bash
git clone https://github.com/GustavoL266/Fecart-2026.git
cd Fecart-2026
git status
node --version
pnpm install --frozen-lockfile
```

Em seguida:

1. Leia este README e o documento em `docs/` da área em que vai trabalhar.
2. Copie `.env.example` para `.env` usando o comando do seu sistema. No PowerShell: `Copy-Item .env.example .env`; em shells Unix: `cp .env.example .env`.
3. Configure um PostgreSQL de desenvolvimento e uma `SESSION_SECRET` local. Não é necessário apontar para o banco de produção para desenvolver.
4. Preencha apenas as credenciais externas necessárias à tarefa. Campos manuais e testes com mocks permitem desenvolver várias partes sem elas.
5. Inicie o banco local, execute `pnpm migrate`, depois `pnpm build` e `pnpm start`.
6. Abra a aplicação por HTTP em `http://localhost:3000`, não diretamente pelo arquivo HTML.
7. Crie uma conta local se estiver usando um banco novo.

Para apenas inspecionar o código, editar documentação ou executar os testes isolados, não é necessário iniciar a aplicação completa. Para validar login, persistência real e o fluxo HTTP com PostgreSQL, o banco e o ambiente precisam estar configurados.

### Retomar trabalho já sincronizado

No dispositivo que concluiu uma alteração, faça o commit e o envio ao repositório conforme o fluxo de trabalho da tarefa. No outro dispositivo, confira primeiro `git status`; com o trabalho local organizado, use `git pull --ff-only` para atualizar sem criar uma mesclagem automática inesperada.

O estado compartilhado de desenvolvimento deve estar no código, nos testes e na documentação versionada. Informações importantes que existam apenas em uma conversa não acompanham o clone. Registre decisões de fórmula, mudanças de contrato, novas variáveis e limitações relevantes neste README ou em `docs/`.

Para acessar os mesmos **produtos salvos de produção**, entre na mesma aplicação hospedada com sua conta. Abrir uma aplicação local com outro `DATABASE_URL` acessa outro banco, ainda que o código seja idêntico. Simulações não salvas, tema, cookies e a prévia de IA continuam locais ao navegador.

### Mensagem sugerida para abrir uma nova tarefa

```text
Leia o README.md para entender o Assistente de Precificação e depois os
arquivos e guias relacionados ao meu pedido. Confira o estado do Git antes
de editar. Preserve as regras financeiras e os fluxos existentes que não
fazem parte da tarefa. Edite os módulos de js/, e não somente app.js.
Ao concluir, informe o que mudou, como foi validado e se há configuração
ou publicação pendente. Meu pedido é: [descreva a tarefa aqui].
```

Esse texto ajuda a solicitar a leitura do contexto explicitamente, sem depender de a sessão anterior estar disponível no novo dispositivo.

## Guia de manutenção para próximas tarefas

### Onde começar conforme o pedido

| Tipo de tarefa | Arquivos iniciais | Cuidados de integração |
| --- | --- | --- |
| Layout ou valores grandes | `styles.css`, `index.html`, `js/utils/formatters.js`, renderers de UI | Preserve números, fórmulas, valor completo e responsividade com sidebar redimensionada. |
| Campo do simulador | `js/ui/form.js`, `js/main.js`, `index.html` | Revise validação, percentuais, reset, reuso, payload e persistência. |
| Regra financeira solicitada | `js/domain/pricing-calculator.js`, `tests/pricing-calculator.test.js` | Reavalie versões, snapshot e compatibilidade histórica; não duplique a fórmula em UI ou backend. |
| Problema ao salvar | `js/main.js`, `lib/validation.js`, `lib/pricing-persistence.js`, `server.js` | Diferencie formulário inválido, sessão, erro de banco e montagem do snapshot. |
| Meus produtos | `js/ui/history.js`, `js/main.js`, rotas `/products`, `lib/models.js` | Preserve isolamento por usuário e histórico sem recálculo silencioso. |
| Busca de mercado | `js/services/market-service.js`, `lib/market-search.js`, `lib/searchapi-market-provider.js` | Preserve moeda, referência manual, seleção individual e distinção entre falha externa e sessão expirada. |
| NCM e classificação | Módulos de classificação, `lib/focus-nfe-client.js`, rotas fiscais | Preserve confirmação explícita, relevância e vínculo à consulta atual. |
| Card IBPT | `lib/ibpt-tax-provider.js`, `js/services/tax-service.js`, `js/ui/dashboard.js` | Confira origem, código exato, arquivo, vigência e invalidação do resultado anterior. |
| IA | `lib/ai-*`, `lib/gemini-form-provider.js`, `js/ui/ai-assistant.js`, `js/ui/form.js` | Valide extração, origem, estimativas e prévia; mantenha credenciais no backend e cálculo fora do modelo. |
| Autenticação/deploy | `server.js`, `lib/config.js`, `lib/database.js`, `render.yaml` | Confira ambiente real, sessão PostgreSQL, cookie e proxy sem expor credenciais. |

### Contratos que precisam continuar coerentes

**DOM e bundle.** Os seletores usados em `js/main.js` dependem dos IDs em `index.html`. Renomear ou remover um elemento exige atualizar todos os consumidores e os testes de contrato. Novos módulos frontend precisam entrar no build; novos arquivos públicos precisam de rota no servidor.

**Porcentagens.** Não misture `25` com `0.25`. O formulário e o patch IA usam a escala visível; o motor usa frações. Um ajuste aparentemente pequeno nessa conversão pode alterar todos os resultados.

**Requisições antigas.** Preserve contadores de revisão, assinaturas de contexto e cancelamento do assistente. Sem eles, uma pesquisa anterior pode sobrescrever o estado de um produto novo ou restaurar uma classificação invalidada.

**Sessão e falha externa.** O cliente encerra a sessão quando recebe o código interno `SESSION_REQUIRED`. Um `401` de um provedor externo pode significar credencial da integração inválida, e não deve desconectar o usuário automaticamente.

**Histórico.** A edição de metadados não altera os valores da precificação salva. Uma mudança de fórmula precisa considerar registros existentes e sua versão. Não substitua valores históricos por cálculos feitos na abertura da tela.

**Dados fiscais.** Não derive NCM ou alíquotas a partir de marca, nome comercial ou texto da IA. O fluxo atual possui confirmação própria e não implementa um motor tributário completo. Mantenha a indicação de origem de cada dado.

### Layout financeiro e tema

O tema possui preferência clara/escura, com verde de destaque, cards e linguagem visual financeira. O painel IA utiliza as mesmas variáveis visuais. Preserve foco visível, labels, estados de carregamento e acessibilidade dos botões/modal.

Os valores monetários são uma unidade visual: `R$ 25.287,10` não deve quebrar entre símbolo e número, invadir outro card ou ser truncado. A solução atual utiliza `.financial-value`, `white-space: nowrap`, `min-width: 0`, containers e `clamp()` combinado com `data-financial-size` gerado a partir do texto formatado.

O grid interno do preço principal reserva aproximadamente 63% para o preço sustentável e 37% para mercado quando há espaço. Em áreas estreitas, os blocos passam para coluna. Detalhes e visualizações também consideram a largura efetiva do container, pois uma sidebar larga pode deixar pouco espaço mesmo em uma janela desktop.

Duas regras antigas de `#suggestedPrice` baseadas em viewport sobrepunham a tipografia responsiva devido à maior especificidade. Elas foram removidas. Não reintroduza uma regra de fonte por ID que anule o ajuste pelo container. Evite usar `overflow: hidden` ou reticências como solução para um valor financeiro grande.

### Segurança implementada

As senhas são verificadas por bcrypt, inclusive por meio de um hash sentinela quando o login não encontra uma conta para reduzir diferenças de tempo. O cadastro retorna a mesma resposta para e-mail novo ou existente. A sessão é regenerada no login; ao trocar a senha, a alteração do hash e a revogação das sessões anteriores acontecem na mesma transação, e a requisição bem-sucedida recebe uma nova sessão. Os cookies têm `HttpOnly`, `SameSite=Lax` e configuração segura em produção. As consultas SQL utilizam parâmetros; operações de produto filtram pelo proprietário e atualizações de perfil recebem o ID exclusivamente de `req.user.id`, nunca do corpo da requisição.

Requisições mutáveis autenticadas por cookie passam por uma verificação de mesma origem baseada em `Origin` e Fetch Metadata. O Helmet configura CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options` e política de referenciador. O backend serve somente uma lista explícita de arquivos públicos; `.env`, `.git`, documentação e configuração de deploy não são publicados.

O Helmet configura CSP com scripts e estilos da própria aplicação. `style-src-attr 'none'` significa que soluções baseadas em estilos inline podem falhar em produção. Prefira classes e atributos de apresentação já tratados em CSS; os testes verificam esse contrato.

As credenciais externas ficam no ambiente do servidor. As rotas usam validação e limites de chamadas. Respostas da Gemini, SearchAPI e Focus NFe possuem limite de corpo e timeout; URLs de referências de mercado são restritas a HTTPS antes da persistência e do reuso. Logs de mercado e classificação registram comprimentos, status e contagens, não a consulta completa. No caso de IA, há também limite de mensagem/resposta, JSON estruturado, validação de evidências e tratamento seguro de erros anteriores à rota, como JSON malformado.

Não conclua que uma integração está funcional apenas porque `configured` está verdadeiro. Essa informação indica presença/configuração; uma chamada pode falhar por permissão, credencial, ambiente, quota ou disponibilidade. Os guias de cada integração descrevem os diagnósticos específicos.

## Testes, limitações e pontos de atenção

### Estratégia de validação

O projeto usa o runner nativo `node:test`. O lint atual verifica **sintaxe JavaScript** com `node --check`; não é uma configuração de ESLint nem uma análise estática de tipos. O build gera o bundle, mas não substitui os testes de comportamento ou a inspeção no navegador.

| Área | O que os testes procuram preservar |
| --- | --- |
| Precificação | Desperdício por rendimento, rateio, juros compostos, denominador, desconto e arredondamento técnico. |
| Formulário | Vazio versus inválido, decimal brasileiro, percentuais, campos obrigatórios e capacidade parcial. |
| Persistência | Resultado calculado no servidor, snapshot v6 e tratamento do histórico. |
| Autenticação | Validação, senha, sessão e separação entre erro externo e expiração da conta. |
| Mercado | Consulta, normalização, estatísticas, referências e comportamento durante falhas. |
| Fiscal | Relevância, confirmação corrente, origem, troca de contexto e estimativa IBPT. |
| IA | Schema, evidências, limites, ausência, zero, lote, prompt injection, timeout, autenticação, concorrência e confirmação. |
| Interface | IDs esperados, abas, reset, detalhes, estilos compatíveis com CSP e proteção dos valores financeiros. |

Na rodada que entregou o assistente IA e o ajuste dos valores financeiros, em 10/09/2026, passaram **208 testes**, lint e build. A verificação de navegador cobriu os sete valores de `R$ 32,00` a `R$ 9.999.999,99` nas larguras `1920`, `1440`, `1366`, `1024`, `768` e `390` px, além do modal e dos detalhes com sidebar larga. Esses números são um registro daquela rodada, não uma garantia de que alterações posteriores já foram testadas.

Na investigação posterior do 503, também em 10/09/2026, passaram **239 testes**, lint de 73 arquivos JavaScript e build. A prévia dos brigadeiros foi conferida no navegador em 1440×900 e 390×844, com provedor simulado, campos intactos antes da confirmação e obrigatórios ausentes ainda pendentes após aplicar. Também foi reproduzida a indisponibilidade por configuração ausente. Nenhuma fórmula financeira foi alterada.

Na migração para Gemini, em 10/09/2026, passaram **246 testes** com respostas externas simuladas, incluindo os exemplos de bolo, brigadeiro e alteração isolada de margem, preservação do frete e dos obrigatórios pendentes, chave inválida, quota, timeout e resposta estruturada inválida. A integração usa REST nativo e o modelo estável [Gemini 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), confirmado na documentação nessa data. A interface, a autenticação e o cálculo financeiro foram preservados.

Na correção do HTTP 502, em 11/09/2026, passaram **252 testes**, lint de 76 arquivos JavaScript e build. O teste autenticado real com `gemini-3.5-flash-lite` reproduziu 400 para `responseFormat.text` e para o schema com `maxItems: 35`. O payload final com `responseMimeType + responseJsonSchema`, sem `maxItems` externo, retornou 200 e passou pelos casos de bolo e brigadeiros, mantendo Structured Output e toda a validação posterior. A chave permaneceu somente no `.env` ignorado pelo Git.

Na evolução da interpretação, também em 11/09/2026, passaram **272 testes**, lint de 77 arquivos JavaScript e build. A avaliação real `pnpm gemini:evaluate` cobriu dez casos fixos de componentes, bases, correções, números por extenso, ambiguidades, valores inválidos e preço de venda; as chamadas aceitas pela Gemini retornaram HTTP 200 e os campos ou pendências públicas corresponderam ao esperado. O backend manteve a validação estruturada e o motor financeiro permaneceu inalterado.

Na correção do esclarecimento em 12/09/2026, passaram **280 testes**. O segundo turno passou a enviar resposta, contexto efêmero, campos anteriores e pendências separadamente; a saída Gemini fica restrita aos campos pendentes e é mesclada e validada no backend. A chamada real “por unidade” com `gemini-3.5-flash-lite` retornou HTTP 200 e preservou produto e margem ao completar matéria-prima em R$ 15,00. O bundle foi reconstruído e o motor financeiro permaneceu inalterado.

Na evolução para `AI_FILL_MODE=complete`, em 12/09/2026, passaram **291 testes**. Esse registro histórico precede a regra atual de não estimar quantidade mensal. O Structured Output ganhou `source` por entry; o backend preserva inputs manuais sobre estimativas, impõe limites mais estreitos e chama `validatePricingInputs` antes de marcar `calculationReady`. Naquela rodada, a avaliação real retornou HTTP 200 para bolo com esclarecimento “por unidade”, brigadeiros por lote, camiseta e marmita; a hipótese então usada para quantidade mensal permitiu calcular preços técnicos, mas foi removida pela revisão posterior descrita abaixo.

Na correção do botão **Analisar esclarecimento**, também em 12/09/2026, passaram **294 testes**, lint de 77 arquivos JavaScript e build. O backend passou a considerar em conjunto o contexto original validado, a pergunta pendente controlada e a resposta atual, sem aceitar troca silenciosa do valor. O caso “15 reais de um lote de 3” terminou com matéria-prima unitária `5`, produto e margem preservados, `needsClarification: false` e chamada real HTTP 200. O frontend mostra loading específico, bloqueia clique duplo e conserva prévia e texto em falhas. Logs correlacionam o turno por UUID e registram somente estados booleanos e metadados seguros.

Na segunda revisão do assistente, em 12/09/2026, passaram **315 testes**. A causa dos novos 502 foi localizada depois de respostas HTTP 200 da Gemini: a validação local rejeitava evidências literais compactas (`R$300`, `R$4,50`) e a referência `para esse lote` quando o significado ou a quantidade estavam numa oração adjacente. A validação agora usa somente janelas locais literais e contexto explícito de produção/mercado; preço próprio de venda continua sem virar custo ou referência concorrente. Margem de 250% vira pendência com o limite exato, campos independentes permanecem na prévia e `expectedMonthlyUnits` só é aceito com mês/mensal explícito. Chamadas reais com `gemini-3.5-flash-lite` retornaram HTTP 200 para margem inválida, preço concorrente, quatro variações de mercado e dois cenários de prompt injection. Uma reprodução no navegador confirmou que digitar o caractere final e enviar imediatamente serializa a mensagem completa, sem atraso artificial.

Na correção da regressão de quantidade mensal em 12/09/2026, passaram **328 testes** e o lint de 78 arquivos JavaScript. O validador deixou de descartar o contexto somente quando a única pendência é `AI_REQUIRED_FIELD_MISSING` para `expectedMonthlyUnits`: “10”, “é 10”, “é de 10”, “10 por mês” e “produzo 10 mensalmente” passam a resolver o valor literal, enquanto uma resposta numérica à pergunta de rendimento continua sendo quantidade do lote. Nas repetições reais de `clarification-monthly`, houve um 503 transitório e uma saída HTTP 200 com `wasteRate.basis` incompatível que o backend rejeitou corretamente; a execução final completou as duas gerações com HTTP 200, formulário válido e preço técnico calculável. No navegador local, “É DE 10” removeu a pergunta, habilitou a confirmação, gerou exatamente um POST de esclarecimento e, depois de aplicar, exibiu preço sustentável de R$ 19,22 com as estimativas daquela execução. O build foi executado; como nenhum módulo de `js/` mudou, o conteúdo versionado de `app.js` permaneceu idêntico.

Na evolução de **Meu perfil** em 14/09/2026, passaram **351 testes**, lint de 82 arquivos JavaScript e build sobre a `main` atualizada. Nome e e-mail passaram a ser editáveis com validação em ambas as camadas e bloqueio de duplicidade; a senha atual é verificada antes de gerar o novo hash, e todas as consultas usam o usuário autenticado da sessão. A contagem de produtos vem do PostgreSQL sem expor registros. Uma prévia local com respostas simuladas confirmou o modal e a seção de senha nas larguras 1920, 1366, 1024, 768 e 390 px, sem estouro horizontal, além de feedback de salvamento, cancelamento, ESC, retorno de foco e navegação para **Meus Produtos**. Como este ambiente não possuía PostgreSQL nem segredo de sessão configurados, a rodada não incluiu logout/login real após a troca de senha; os contratos de banco e controlador foram cobertos por testes isolados.

Na simplificação da página **Sobre** em 16/09/2026, passaram **376 testes**, lint de 84 arquivos JavaScript e build sobre a `main` atualizada. A apresentação foi condensada em hero, quatro etapas, quatro resultados principais e um aviso final; acordeões e cards promocionais redundantes foram removidos sem retirar as funcionalidades correspondentes do simulador. A prévia local confirmou grids de 4, 2 e 1 coluna em desktop, tablet e celular, respectivamente, nas larguras 1366, 768 e 390 px, sem estouro horizontal.

Na auditoria de segurança de 16/09/2026, passaram **389 testes**, lint de 87 arquivos JavaScript e build. Foram corrigidos escape e URLs de referências persistidas, revogação transacional de sessões na troca de senha, proteção de mesma origem para escritas, enumeração de cadastro/login, limites de resposta da Focus NFe/SearchAPI e minimização de logs. Os testes de autorização cobrem listagem, leitura, alteração e exclusão entre duas contas, além de sessão ausente/inválida, SQLi, mass assignment, CSRF e headers. O relatório completo está em [docs/security-audit-2026-09-16.md](docs/security-audit-2026-09-16.md). `pnpm audit --prod` foi executado, mas o registro npm não pôde ser consultado porque o trust store desta máquina retornou `UNABLE_TO_VERIFY_LEAF_SIGNATURE`; a verificação TLS não foi desativada.

Na correção do salvamento sem referência de mercado em 17/09/2026, passaram **395 testes**, lint de 88 arquivos JavaScript e build. O frontend passou a omitir `pricing.market.rule` quando não existe referência ativa e a converter o estado histórico interno `none` para o fallback visual manual, sem enviar string vazia. O backend continua aceitando somente ausência ou `manual`, `selected-product`, `market-average` e `market-median`; valores vazios ou arbitrários continuam retornando 400. Um POST HTTP local com margem de 10% confirmou status 201, preço de mercado nulo e a identificação “Sem referência de mercado”.

Os testes automatizados de APIs usam respostas simuladas e não demonstram a disponibilidade das credenciais de produção. A chamada real descrita acima usou exclusivamente o `.env` local e comprova o contrato e o acesso nessa conta, não as variáveis do serviço Render. Após o deploy, execute uma vez `pnpm gemini:check` no Shell do serviço para validar a conta de produção. Um resultado com mocks precisa ser relatado como tal. Capturas, navegadores temporários e relatórios locais de uma sessão não devem ser presumidos disponíveis em outro clone.

Para alterações de código, execute os scripts pertinentes e depois confira o bundle final. Para uma alteração somente documental, revise conteúdo, links e diff; não é necessário modificar arquivos gerados só para registrar a edição do README.

### Limites conhecidos do escopo atual

- **Tributação:** o motor configurado identifica a avaliação como incompleta; não há apuração automática completa dos tributos da venda. A integração atual não emite, cancela, manifesta nem importa documentos fiscais.
- **Tabela IBPT:** o arquivo versionado é `TabelaIBPTaxSP26.2.A.csv`, com vigência documentada de 20/08/2026 a 30/09/2026. Confira a versão e a vigência ao retomar o projeto. A origem e o hash estão em [docs/ibpt.md](docs/ibpt.md); preserve a codificação Windows-1252 e o delimitador ao trabalhar com o arquivo.
- **Geografia da estimativa:** o endpoint IBPT utiliza NCM, origem e preço; não recebe UFs para selecionar dinamicamente tabelas estaduais. Exibir dados de origem/destino não significa aplicar uma regra tributária específica de cada operação.
- **Mercado:** preços são referências externas dependentes da consulta e da disponibilidade do provider. O sistema não garante que um anúncio continue disponível depois da pesquisa.
- **IA:** há validação estrutural e de evidências, mas a interpretação semântica pode falhar. A prévia e a confirmação fazem parte do produto e não devem ser removidas por conveniência.
- **Escala:** os contadores de limite da IA e caches de providers usam memória do processo. Várias instâncias exigem reavaliar armazenamento compartilhado, limites globais e deduplicação; a sessão de autenticação já fica no PostgreSQL.
- **Build:** a concatenação atual exige cuidado com nomes globais e ordem dos módulos. Não presuma capacidades de um bundler mais completo.
- **Ambiente:** o repositório não comprova o plano ativo do Render, o sucesso do último deploy, o estado das chaves ou o conteúdo do banco remoto.
- **Documentação:** referências a decisões antigas precisam ser confrontadas com os módulos e testes atuais. Se um comportamento mudar, atualize o contexto para que o próximo dispositivo receba a decisão correta.

### Guias complementares

- [Assistente IA: contrato, campos, limites e configuração](docs/ai-assistant.md)
- [SearchAPI / Google Shopping: provedor de mercado](docs/searchapi.md)
- [Focus NFe: pesquisa e confirmação de NCM](docs/focus-nfe.md)
- [IBPT: fonte, arquivo, estimativa e limitações](docs/ibpt.md)

Ao concluir uma tarefa, registre quais arquivos e comportamentos mudaram, quais verificações foram executadas e o que depende de configuração externa. Se houver publicação pendente, diferencie claramente **alteração local**, **commit enviado ao GitHub** e **deploy concluído no Render**.
