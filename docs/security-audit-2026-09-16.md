# Auditoria de segurança — 16/09/2026

## Escopo e método

A revisão cobriu autenticação, sessão, autorização de produtos, SQL, renderização HTML, CSRF, rate limits, enumeração de contas, senhas, segredos e histórico Git, headers, CORS, redirecionamentos, SSRF, integrações externas, validação, mass assignment, disponibilidade, PostgreSQL, logs, dependências e arquivos públicos.

Os testes foram não destrutivos e locais. O ambiente desta rodada não tinha `DATABASE_URL` nem `SESSION_SECRET` carregados, portanto não houve conexão com banco real, contas de produção ou alteração de dados remotos. Os cenários obrigatórios de autorização executaram os handlers reais de `server.js` com um banco isolado em memória. Não houve teste contra a aplicação publicada.

## Resultado executivo

Foram confirmados oito pontos: quatro de severidade média e quatro de severidade baixa. Seis foram corrigidos nesta rodada. Dois dependem de decisão ou infraestrutura e permanecem documentados como ação manual. Não foi encontrada falha crítica ou alta.

| Severidade | Confirmadas | Corrigidas | Ação manual |
| --- | ---: | ---: | ---: |
| Crítica | 0 | 0 | 0 |
| Alta | 0 | 0 | 0 |
| Média | 4 | 3 | 1 |
| Baixa | 4 | 3 | 1 |

## Achados confirmados

### MEDIUM — HTML e URI não confiáveis em referência persistida — corrigido

`market.source` era interpolado sem escape na lista do histórico. A reprodução local confirmou que uma fonte contendo markup criava um elemento HTML real. Além disso, o snapshot e o armazenamento de sessão preservavam esquemas de URL fornecidos diretamente pelo cliente.

Correção: a fonte é escapada no contexto HTML, URLs de imagem/link são normalizadas e somente HTTPS é preservado no backend e no armazenamento do navegador. CSP continua ativa como camada adicional. Há regressões em `market-history.test.js`, `pricing-persistence.test.js` e `market-reference-store.test.js`.

### MEDIUM — sessões antigas sobreviviam à troca de senha — corrigido

A senha era atualizada sem remover registros anteriores de `user_sessions`. Uma sessão obtida antes da alteração continuaria válida.

Correção: atualização do hash e remoção das sessões do usuário agora ocorrem na mesma transação PostgreSQL; somente depois do commit a requisição atual recebe um SID novo. Falha de qualquer etapa provoca rollback. Há teste da ordem `BEGIN → SELECT/UPDATE → DELETE sessions → COMMIT` e da renovação da sessão atual.

### MEDIUM — ausência de verificação explícita de origem em escritas — corrigido

`SameSite=Lax`, ausência de CORS e JSON obrigatório já reduziam CSRF, mas as rotas mutáveis não validavam `Origin`/Fetch Metadata. Isso deixava a proteção dependente apenas do comportamento do navegador.

Correção: requisições `POST`, `PUT`, `PATCH` e `DELETE` com origem cruzada são recusadas com `403/CSRF_ORIGIN_MISMATCH`; mesma origem e clientes não navegador sem esses headers continuam suportados. O teste HTTP cobre origem aceita e recusada.

### MEDIUM — validação TLS do PostgreSQL desativada — ação manual

Em produção, `lib/database.js` usa TLS com `rejectUnauthorized: false`. A conexão fica criptografada, mas não autentica o certificado do servidor. A correção segura depende do certificado/CA e do modo de conexão oficialmente suportado pelo banco usado no Render; alterar esse valor sem esses dados pode indisponibilizar a aplicação.

Ação: obter a CA do provedor, testar uma conexão com verificação habilitada em ambiente de homologação e só então tornar a verificação obrigatória. Não versionar a CA se ela contiver material privado.

### LOW — enumeração de contas e diferença de custo no login — corrigido

Cadastro novo retornava `201` e duplicidade retornava `409` com mensagem explícita. Login sem usuário pulava bcrypt.

Correção: cadastro novo e duplicado retornam a mesma resposta `202`, sem autenticar; o usuário entra depois. O login usa um hash sentinela quando o e-mail não existe, mantendo o custo de bcrypt antes da resposta genérica.

### LOW — respostas de provedores sem limite em Focus/SearchAPI — corrigido

Gemini já limitava 100 KB, mas Focus NFe e SearchAPI podiam materializar um corpo sem limite antes de validar JSON.

Correção: os três provedores agora têm limite de 100 KB e timeout. Corpos com `Content-Length` excessivo são recusados antes da leitura; streaming é interrompido ao ultrapassar o teto.

### LOW — conteúdo de negócio e detalhes de erro nos logs — corrigido

Consultas completas de mercado/NCM, preço, UUID de conta e mensagens arbitrárias podiam aparecer nos logs.

Correção: os logs usam somente comprimento, booleanos, contagens, status e códigos conhecidos. Mensagens inesperadas de aplicação e de banco não são registradas integralmente. Segredos, headers, cookies, prompts e respostas externas brutas continuam fora dos logs.

### LOW — limites em memória não são globais entre instâncias — ação manual

O rate limit da IA combina conta e IP e os demais endpoints possuem limites por IP, mas os contadores residem no processo. Em uma implantação com várias instâncias, cada processo teria sua própria janela.

Ação: antes de escalar horizontalmente, mover rate limits que protegem custo/credenciais para um store compartilhado. No serviço atual de uma instância, os limites existentes permanecem ativos.

## Controles verificados sem falha reproduzível

- IDOR: usuário A não consegue listar, ler, alterar ou excluir produto de B; todas as operações usam o ID da sessão e `user_id` no SQL.
- Sessão ausente ou inválida recebe `401/SESSION_REQUIRED`. Login regenera SID; logout destrói a sessão.
- SQL injection: consultas usam placeholders; a única direção dinâmica de ordenação vem de enum fechado. Payload hostil permaneceu em `values`, fora do SQL.
- Mass assignment: ID do usuário vem de `req.user.id`; campos extras são descartados e preço/snapshot são recalculados no backend.
- XSS: demais sinks HTML usam escape ou valores numéricos/constantes; URLs recebidas dos provedores são HTTPS.
- Clickjacking e headers: CSP com `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff` e política de referenciador foram confirmados por HTTP.
- CORS: não é habilitado; frontend e backend operam na mesma origem.
- SSRF/redirecionamento: URLs dos provedores são fixas ou pertencem a allowlist; fetch usa `redirect: "error"`; redirecionamentos do frontend têm destinos constantes.
- IA: prompt é tratado como dado não confiável, não há ferramentas, o schema e as evidências são validados novamente no backend e a prévia exige confirmação.
- Segredos: `.env` e arquivos de chave são ignorados. A varredura do histórico por padrões de chaves Google/OpenAI/GitHub e private keys não encontrou credencial de alta confiança; somente `.env.example` apareceu para URLs/senhas ilustrativas.
- Arquivos públicos: não há `express.static`; apenas HTML, CSS, ícone e bundles explicitamente listados são servidos.
- Recuperação de senha/Resend: não existe endpoint, token, tabela ou dependência desse fluxo; portanto não havia implementação para testar como recuperação segura.

## Testes adicionados

- A não lista o histórico de B.
- A não lê, altera nem exclui produto de B.
- Rota protegida recusa sessão ausente e inválida.
- SQLi permanece em parâmetros e IDs inválidos são recusados.
- Mass assignment não controla proprietário, cálculo ou snapshot.
- Cadastro novo e duplicado têm resposta indistinguível.
- Login inexistente executa bcrypt sentinela.
- Escrita cross-site é recusada e mesma origem é aceita.
- Headers defensivos são verificados em resposta HTTP.
- Troca de senha revoga sessões atomicamente.
- HTML e URLs maliciosas de referência não sobrevivem à renderização/reuso.
- Focus NFe e SearchAPI recusam corpos excessivos.
- Arquivos privados não aparecem na lista pública do servidor.

## Limitações e ações pós-deploy

1. Reexecutar `pnpm audit --prod` em uma máquina cujo trust store valide `registry.npmjs.org`; nesta rodada o comando falhou com `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. Não foi desativada a verificação TLS.
2. Validar no Render, sem registrar cookies, um cadastro novo e outro já existente, login, troca de senha com duas sessões e bloqueio de `Origin` externo.
3. Configurar e testar validação do certificado PostgreSQL antes de mudar `rejectUnauthorized`.
4. Se o serviço ganhar múltiplas instâncias, usar um store compartilhado para rate limits.
5. Conferir `pnpm test`, `pnpm lint`, `pnpm build`, o bundle gerado e o commit efetivamente publicado.
