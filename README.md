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
pnpm test        # executa os testes
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
| POST | `/products` | Obrigatória |
| PATCH | `/products/:id` | Obrigatória + dono |
| DELETE | `/products/:id` | Obrigatória + dono |

O frontend sempre envia cookies com `credentials: "same-origin"`. A API nunca retorna `password_hash` e utiliza parâmetros do PostgreSQL em todas as queries.

## Verificação manual do fluxo

1. Inicie banco, migrações e servidor.
2. Acesse `http://localhost:3000` e crie uma conta.
3. Informe o nome de um produto, gere a precificação e clique em **Salvar produto**.
4. Abra **Meus produtos**, pesquise, visualize, edite, reutilize e exclua um registro.
5. Faça logout e login novamente: os produtos permanecem no banco.
6. Para validar isolamento, crie outra conta e tente abrir o ID de um produto da primeira: a API responderá `Produto não encontrado`.

Para confirmar o usuário diretamente no banco sem revelar dados sensíveis, use uma consulta como:

```sql
SELECT id, name, email, created_at, password_hash LIKE '$2%' AS senha_com_hash_bcrypt
FROM users
WHERE email = 'seu@email.com';
```
