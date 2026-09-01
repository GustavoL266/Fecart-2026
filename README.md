# Assistente de Precificação

Aplicação web para calcular preço de venda sustentável, comparar referências de mercado e salvar um histórico privado por usuário.

## Stack

- Frontend: JavaScript puro, HTML e CSS, preservando os módulos de cálculo existentes.
- Backend: Node.js + Express.
- Banco: PostgreSQL, com SQL parametrizado e migrações versionadas.
- Autenticação: sessões persistidas no PostgreSQL, cookies `HttpOnly`/`SameSite=Lax` e senhas com hash bcrypt (12 rounds).

## Recursos implementados

- Cadastro, login, logout e recuperação da sessão em `/auth/me`.
- Rotas protegidas para criar, listar, consultar, editar e excluir produtos.
- Todos os acessos a produto verificam `user_id` junto ao ID do produto. Um produto de outra conta retorna `404` e nunca é exposto.
- Histórico com busca por nome, ordenação por data, visualização, edição, exclusão e reutilização de uma precificação anterior.
- Salvamento de todos os campos relevantes da consulta (entradas, memória do cálculo e referência de mercado) em `calculation_data`.
- Consulta de NCM pela Focus NFe exclusivamente no backend, com memória de cálculo, origem dos dados e aviso explícito de pendências fiscais.
- Consulta opcional de produtos e preços na Amazon Brasil pela Amazon Creators API, sempre através do backend.
- Cálculos monetários internos em centavos, incluindo frete, seguro, desconto e despesas adicionais.
- Validação no navegador e no servidor, limitação de tentativas de autenticação, cabeçalhos de segurança e respostas sem hashes/senhas.

## Pré-requisitos

- Node.js 20 ou superior.
- PostgreSQL 14 ou superior, ou Docker Desktop com Docker Compose.

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

O assistente usa a Focus NFe apenas para consultar e validar a descrição de um NCM exato. A documentação não oferece um endpoint de cálculo tributário automático: a carga tributária continua sendo um dado informado/regra configurada e o resultado aparece como estimativa fiscal pendente. Consulte [docs/focus-nfe.md](docs/focus-nfe.md) para limites, dados exigidos do contador e avaliação de NF-e recebidas.

### Amazon Creators API

A busca de mercado usa a operação `SearchItems` da Amazon Creators API no marketplace `www.amazon.com.br`. O navegador chama apenas `GET /amazon/search`; OAuth 2.0, cache do access token, cache de pesquisa por cinco minutos, retry limitado e normalização de até cinco produtos ficam no backend. Cada resultado contém somente ASIN, título, preço BRL, categoria, imagem, URL e fonte permitidos pela resposta da API.

Configure somente no ambiente do servidor:

```text
AMAZON_CREATORS_CREDENTIAL_ID
AMAZON_CREATORS_CREDENTIAL_SECRET
AMAZON_CREATORS_CREDENTIAL_VERSION=3.1
AMAZON_PARTNER_TAG
AMAZON_MARKETPLACE=www.amazon.com.br
AMAZON_CREATORS_TIMEOUT_MS=5000
```

As três primeiras variáveis sem valor padrão (`AMAZON_CREATORS_CREDENTIAL_ID`, `AMAZON_CREATORS_CREDENTIAL_SECRET` e `AMAZON_PARTNER_TAG`) são obrigatórias e devem vir da mesma conta Amazon Associates/Creators API aprovada para o Brasil. O Partner Tag precisa estar associado à credencial e à loja brasileira. Nunca coloque esses valores no frontend. Sem essas variáveis, o `/health` informa os nomes ausentes e a pesquisa fica indisponível; o simulador continua funcionando com o campo manual **Preço médio local dos concorrentes (R$)**.

O endpoint diferencia configuração ausente (`503`), consulta inválida (`400`), credencial recusada (`401`), conta sem permissão (`403`), limite da Amazon (`429`), resposta externa inválida/erro do provedor (`502`), indisponibilidade (`503`) e timeout (`504`). Os logs registram apenas consulta, provedor, status, contagem e uso de cache — nunca credenciais, token ou cabeçalho de autorização.

## Publicação a partir do GitHub

**Não publique este projeto no GitHub Pages.** Ele serve apenas HTML, CSS e JavaScript estáticos: não executa `server.js`, não mantém sessões nem conecta ao PostgreSQL. Por isso as chamadas `GET /auth/me` retornam `404` e os `POST /auth/login` e `POST /auth/register` retornam `405` no Pages. Além disso, o GitHub não recomenda o Pages para sites que recebem senhas.

O repositório contém [`render.yaml`](render.yaml), que publica a aplicação completa — interface, API e banco — no mesmo domínio. Isso preserva a autenticação por cookie seguro e dispensa CORS.

1. Envie todos os arquivos para um repositório GitHub, incluindo `render.yaml`, mas excluindo `.env`.
2. No Render, escolha **New → Blueprint**, conecte o repositório e confirme os recursos propostos.
3. O serviço cria o PostgreSQL, injeta `DATABASE_URL`, gera `SESSION_SECRET`, executa `npm run migrate` antes de cada publicação e inicia `npm start`.
4. Configure no Web Service um `FOCUS_NFE_TOKEN` de produção. O Blueprint já seleciona `https://api.focusnfe.com.br` e o backend registra apenas `configured=true/false`, nunca o token.
5. Para habilitar a pesquisa Amazon, preencha manualmente no Web Service as variáveis marcadas como `sync: false`: `AMAZON_CREATORS_CREDENTIAL_ID`, `AMAZON_CREATORS_CREDENTIAL_SECRET` e `AMAZON_PARTNER_TAG`. A existência delas no `render.yaml` não preenche os segredos. O Blueprint já define `AMAZON_CREATORS_CREDENTIAL_VERSION=3.1`, `AMAZON_MARKETPLACE=www.amazon.com.br` e `AMAZON_CREATORS_TIMEOUT_MS=5000`.
6. Abra a URL `https://…onrender.com` fornecida pelo Render. Essa é a URL que deve ser compartilhada e usada para criar contas.

Não é preciso (nem correto) colocar credenciais no GitHub, no código ou no GitHub Pages. Se o Pages já estiver ativo no repositório, desative-o em **Settings → Pages** para evitar que usuários cheguem à cópia estática sem API.

## Diagnóstico de inicialização

O frontend e a API são servidos pelo mesmo processo; não há um segundo servidor para iniciar. Use `npm run start` (ou `pnpm start`) e abra `http://localhost:3000`. Não abra `index.html` diretamente pelo Explorador de Arquivos: isso usa `file:///`, e o navegador bloqueia as chamadas de autenticação por segurança. Caso ocorra, o projeto redireciona automaticamente para a URL correta.

- `SESSION_SECRET não foi definida`: copie `.env.example` para `.env` e informe uma chave aleatória de pelo menos 32 caracteres.
- `DATABASE_URL não foi definida` ou falha de conexão: inicie o PostgreSQL e confira host, porta, usuário, senha e nome do banco no `.env`.
- `MIGRATIONS_PENDING`: execute `npm run migrate` (ou `pnpm migrate`) antes de iniciar a aplicação.
- `amazon.configured: false` no `/health`: confira `amazon.missingEnvironmentVariables`; os valores continuam ocultos. Se estiver `true`, mas a busca responder `401`/`403`, confirme se a credencial Creators API está ativa, se a conta está elegível para a API e se o Partner Tag pertence à conta/marketplace brasileiro.

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
pnpm build       # gera app.js a partir dos módulos em js/
pnpm test        # executa os testes
pnpm focus:check # consulta não destrutiva de NCM somente em homologação
```

`app.js` é gerado. Edite os módulos de `js/` e rode `pnpm build` antes de publicar alterações do frontend.

## Banco de dados

`migrations/001_initial.sql` cria:

- `users`: usuário, e-mail único, `password_hash` e timestamps;
- `products`: dados de precificação, `user_id`, cálculo completo e timestamps;
- `user_sessions`: sessões do Express armazenadas no PostgreSQL.

O relacionamento `products.user_id → users.id` usa chave estrangeira com `ON DELETE CASCADE`. Os índices `products(user_id, consultation_date DESC)` e `products(user_id, name)` deixam rápidas as consultas privadas do histórico.

## Endpoints

| Método | Rota | Autenticação |
| --- | --- | --- |
| POST | `/auth/register` | Pública |
| POST | `/auth/login` | Pública |
| POST | `/auth/logout` | Sessão atual |
| GET | `/auth/me` | Sessão atual |
| GET | `/products` | Obrigatória |
| GET | `/products/:id` | Obrigatória + dono |
| GET | `/fiscal/ncms/:codigo` | Obrigatória; proxy backend para Focus NFe |
| GET | `/amazon/search?q=termos` | Obrigatória; proxy backend para Amazon Creators API |
| POST | `/products` | Obrigatória |
| PATCH | `/products/:id` | Obrigatória + dono |
| DELETE | `/products/:id` | Obrigatória + dono |

O frontend sempre envia cookies com `credentials: "same-origin"`. A API nunca retorna `password_hash` e utiliza parâmetros do PostgreSQL em todas as queries.

## Verificação manual do fluxo

1. Inicie banco, migrações e servidor.
2. Acesse `http://localhost:3000` e crie uma conta.
3. Informe o preço médio local dos concorrentes manualmente, gere a precificação e confirme que o fluxo funciona sem pesquisar na Amazon.
4. Opcionalmente, pesquise um produto na Amazon, confira os resultados e clique em **Usar este produto**; o preço individual selecionado passa a ser a referência de mercado, sem apagar a referência manual anterior.
5. Clique em **Salvar produto**.
6. Abra **Meus produtos**, pesquise, visualize, edite, reutilize e exclua um registro.
7. Faça logout e login novamente: os produtos permanecem no banco.
8. Para validar isolamento, crie outra conta e tente abrir o ID de um produto da primeira: a API responderá `Produto não encontrado`.

Para confirmar o usuário diretamente no banco sem revelar dados sensíveis, use uma consulta como:

```sql
SELECT id, name, email, created_at, password_hash LIKE '$2%' AS senha_com_hash_bcrypt
FROM users
WHERE email = 'seu@email.com';
```
