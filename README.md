# Assistente de Precificação

Aplicação web para calcular preço de venda sustentável, comparar referências de mercado e salvar um histórico privado por usuário.

## Stack

- Frontend: JavaScript puro, HTML e CSS, preservando os módulos de cálculo existentes.
- Backend: Node.js + Express.
- Banco: PostgreSQL, com SQL parametrizado e migrações versionadas.
- Autenticação: sessões persistidas no PostgreSQL, cookies `HttpOnly`/`SameSite=Lax`, senhas com hash bcrypt (12 rounds) e código de login enviado pelo Resend.

## Recursos implementados

- Cadastro, login em duas etapas por e-mail, logout, recuperação de senha e recuperação da sessão em `/auth/me`.
- Código de login criptograficamente seguro, com hash HMAC no banco, validade de 5 minutos, limite de 5 tentativas e uso único.
- Link de redefinição com 256 bits de entropia, hash HMAC no banco, validade de 20 minutos e uso único.
- Rotas protegidas para criar, listar, consultar, editar e excluir produtos.
- Todos os acessos a produto verificam `user_id` junto ao ID do produto. Um produto de outra conta retorna `404` e nunca é exposto.
- Histórico com busca por nome, ordenação por data, visualização, edição, exclusão e reutilização de uma precificação anterior.
- Salvamento de todos os campos relevantes da consulta (entradas, memória do cálculo e referência de mercado) em `calculation_data`.
- Validação no navegador e no servidor, limitação de tentativas de autenticação, cabeçalhos de segurança e respostas sem hashes/senhas.

## Pré-requisitos

- Node.js 20 ou superior.
- PostgreSQL 14 ou superior, ou Docker Desktop com Docker Compose.

## Configuração local com Docker (recomendada)

No diretório do projeto:

```powershell
Copy-Item .env.example .env
# Edite .env: defina banco, SESSION_SECRET, RESEND_API_KEY, EMAIL_FROM e APP_URL.
docker compose up -d database
pnpm install
pnpm migrate
pnpm start
```

Abra [http://localhost:3000](http://localhost:3000). O `docker-compose.yml` inicia um PostgreSQL local em `localhost:5432`; os dados ficam em `.postgres-data/`, que é ignorado pelo Git. Ele lê as credenciais do `.env`, sem gravar senha de banco no repositório.

Antes de publicar, troque obrigatoriamente `SESSION_SECRET`, a senha de banco, configure o Resend e use `SESSION_COOKIE_SECURE=true` atrás de HTTPS.

## E-mail transacional com Resend

1. No Resend, verifique um domínio de envio e crie uma API key com permissão para enviar e-mails.
2. Defina `RESEND_API_KEY` com a chave, sem colocá-la no código ou no GitHub.
3. Defina `EMAIL_FROM` com um remetente do domínio verificado, por exemplo `Assistente de Precificação <acesso@seudominio.com>`.
4. Defina `APP_URL` como a origem pública da aplicação, sem barra final. Localmente, use `http://localhost:3000`.
5. Opcionalmente, defina `EMAIL_TEST_TO` e execute `npm run email:test` para confirmar um envio real.

Sem as credenciais de e-mail, o ambiente de desenvolvimento inicia para permitir testes locais que não enviam mensagens, mas o login retorna uma indisponibilidade segura. Em produção, o servidor exige `RESEND_API_KEY` e `EMAIL_FROM` na inicialização.

## Publicação a partir do GitHub

**Não publique este projeto no GitHub Pages.** Ele serve apenas HTML, CSS e JavaScript estáticos: não executa `server.js`, não mantém sessões nem conecta ao PostgreSQL. Por isso as chamadas `GET /auth/me` retornam `404` e os `POST /auth/login` e `POST /auth/register` retornam `405` no Pages. Além disso, o GitHub não recomenda o Pages para sites que recebem senhas.

O repositório contém [`render.yaml`](render.yaml), que publica a aplicação completa — interface, API e banco — no mesmo domínio. Isso preserva a autenticação por cookie seguro e dispensa CORS.

1. Envie todos os arquivos para um repositório GitHub, incluindo `render.yaml`, mas excluindo `.env`.
2. No Render, escolha **New → Blueprint**, conecte o repositório e confirme os recursos propostos.
3. Ao criar o Blueprint, informe os valores secretos solicitados para `RESEND_API_KEY`, `EMAIL_FROM` e `APP_URL`. Em `APP_URL`, use a URL final `https://…onrender.com`, sem barra no final.
4. O serviço cria o PostgreSQL, injeta `DATABASE_URL`, gera `SESSION_SECRET`, executa `npm run migrate` antes de cada publicação e inicia `npm start`.
5. Se o serviço já existir, abra **Environment** no Render, adicione/atualize essas três variáveis e faça um novo deploy.

Não é preciso (nem correto) colocar credenciais no GitHub, no código ou no GitHub Pages. Se o Pages já estiver ativo no repositório, desative-o em **Settings → Pages** para evitar que usuários cheguem à cópia estática sem API.

## Diagnóstico de inicialização

O frontend e a API são servidos pelo mesmo processo; não há um segundo servidor para iniciar. Use `npm run start` (ou `pnpm start`) e abra `http://localhost:3000`. Não abra `index.html` diretamente pelo Explorador de Arquivos: isso usa `file:///`, e o navegador bloqueia as chamadas de autenticação por segurança. Caso ocorra, o projeto redireciona automaticamente para a URL correta.

- `SESSION_SECRET não foi definida`: copie `.env.example` para `.env` e informe uma chave aleatória de pelo menos 32 caracteres.
- `DATABASE_URL não foi definida` ou falha de conexão: inicie o PostgreSQL e confira host, porta, usuário, senha e nome do banco no `.env`.
- `MIGRATIONS_PENDING`: execute `npm run migrate` (ou `pnpm migrate`) antes de iniciar a aplicação.

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
pnpm lint        # valida a sintaxe de todos os arquivos JavaScript
pnpm test        # executa os testes
pnpm email:test  # envia um código de teste ao EMAIL_TEST_TO
```

`app.js` é gerado. Edite os módulos de `js/` e rode `pnpm build` antes de publicar alterações do frontend.

## Banco de dados

`migrations/001_initial.sql` cria:

- `users`: usuário, e-mail único, `password_hash` e timestamps;
- `products`: dados de precificação, `user_id`, cálculo completo e timestamps;
- `user_sessions`: sessões do Express armazenadas no PostgreSQL.

`migrations/002_auth_verification_and_password_reset.sql` cria:

- `login_verifications`: hash, expiração, uso e tentativas de cada código de login;
- `password_reset_tokens`: hash, expiração e uso dos links de recuperação;
- `auth_rate_limits`: contadores com identificadores protegidos por HMAC para limitar solicitações repetidas.

O relacionamento `products.user_id → users.id` usa chave estrangeira com `ON DELETE CASCADE`. Os índices `products(user_id, consultation_date DESC)` e `products(user_id, name)` deixam rápidas as consultas privadas do histórico.

## Endpoints

| Método | Rota | Autenticação |
| --- | --- | --- |
| POST | `/auth/register` | Pública |
| POST | `/auth/login` | Pública; valida senha e envia código |
| POST | `/auth/verify-login` | Desafio de login pendente; cria a sessão |
| POST | `/auth/resend-login-code` | Desafio de login pendente |
| POST | `/auth/forgot-password` | Pública; sempre retorna mensagem genérica |
| POST | `/auth/validate-reset-token` | Pública; valida o link temporário |
| POST | `/auth/reset-password` | Pública; exige token temporário válido |
| POST | `/auth/logout` | Sessão atual |
| GET | `/auth/me` | Sessão atual |
| GET | `/products` | Obrigatória |
| GET | `/products/:id` | Obrigatória + dono |
| POST | `/products` | Obrigatória |
| PATCH | `/products/:id` | Obrigatória + dono |
| DELETE | `/products/:id` | Obrigatória + dono |

O frontend sempre envia cookies com `credentials: "same-origin"`. A API nunca retorna `password_hash` e utiliza parâmetros do PostgreSQL em todas as queries.

## Verificação manual do fluxo

1. Inicie banco, migrações e servidor e confirme o envio com `npm run email:test`.
2. Crie uma conta: o cadastro continua entrando diretamente, sem solicitar código.
3. Saia, informe e-mail e senha corretos e confirme que a sessão ainda não existe antes do código.
4. Teste um código incorreto; depois use o código recebido. Atualize a página e navegue entre simulador, perfil e produtos sem receber outro código.
5. Saia e entre novamente: um novo código deve ser enviado e o anterior deve falhar. Confirme também expiração, limite de 5 tentativas e reenvio após 45 segundos.
6. Em **Esqueceu sua senha?**, solicite o link com um e-mail existente e com um inexistente; a mensagem deve ser idêntica.
7. Abra o link, defina uma senha com 8 ou mais caracteres, letra e número, e confirme que o link não pode ser reutilizado.
8. Confirme que a senha antiga falha, a nova senha inicia o fluxo de código e todas as sessões anteriores foram encerradas.
9. Informe o nome de um produto, gere a precificação e clique em **Salvar produto**. Abra **Meus produtos**, pesquise, visualize, edite, reutilize e exclua um registro.
10. Para validar isolamento, crie outra conta e tente abrir o ID de um produto da primeira: a API responderá `Produto não encontrado`.

Para confirmar o usuário diretamente no banco sem revelar dados sensíveis, use uma consulta como:

```sql
SELECT id, name, email, created_at, password_hash LIKE '$2%' AS senha_com_hash_bcrypt
FROM users
WHERE email = 'seu@email.com';
```
