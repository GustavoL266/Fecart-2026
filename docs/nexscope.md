# Integração de mercado com Nexscope

O backend usa a API oficial **Amazon Search** da Nexscope para obter referências da Amazon Brasil. O frontend acessa somente `GET /market/search?q=...`; a chave não sai do servidor.

## Contrato externo utilizado

- Método e endpoint: `POST https://api.nexscope.ai/api/skill-api/v1/skills/amazon-search/run`
- Autenticação: `Authorization: Bearer <NEXSCOPE_API_KEY>`
- Conteúdo: `Content-Type: application/json`
- Corpo enviado: `keyword`, `amazonDomain: "amazon.com.br"`, `language: "pt_BR"`, `page: 1` e `device: "desktop"`. Todos esses campos constam no contrato oficial; domínio e idioma tornam explícito o contexto brasileiro.
- Paginação documentada: páginas a partir de 1, com aproximadamente 20 itens por página.
- Resposta direta: `products[]`, com campos como `asin`, `title`, `brand`, `price`, `extractedPrice`, `currency`, `imageUrl`, `asinUrl` e `sourceType`.

O endpoint custa 21 créditos por chamada segundo o catálogo público consultado em 2 de setembro de 2026. A documentação pública não fixa uma quantidade universal de requisições por minuto; os limites aplicáveis devem ser conferidos no workspace da conta. A aplicação reduz consumo com cache em memória por cinco minutos, deduplicação de chamadas simultâneas e limite próprio de 30 consultas por minuto por cliente.

## Resposta interna normalizada

O backend lê o `products[]` diretamente no topo da resposta e devolve `results[]` com `id`, `asin`, `title`, `price`, `currency`, `source`, `category`, `image`, `url` e `consultedAt`. O preço usa `extractedPrice` e, quando ele não for válido, `price`. Apenas preços numéricos positivos em moeda explicitamente informada como BRL e produtos com identificador, título e URL válidos seguem para a interface. Campos ausentes, `null`, `NaN`, preço zero ou moeda ausente não são transformados em dados fictícios. A fonte visual é `Amazon`, pois esse é o marketplace consultado pelo endpoint escolhido; `Nexscope` é o provedor técnico.

## Erros

- `400`: consulta ou parâmetros inválidos;
- `401` / `NEXSCOPE_UNAUTHORIZED`: chave inválida;
- `402` / `NEXSCOPE_INSUFFICIENT_CREDITS`: créditos insuficientes;
- `403` / `NEXSCOPE_FORBIDDEN`: conta sem acesso ao Amazon Search;
- `429`: limite de requisições;
- `502`: resposta inválida ou falha HTTP `5xx` da Nexscope/upstream;
- `503`: integração não configurada, falha de conexão ou indisponibilidade `503` explicitamente informada pela Nexscope;
- `504`: timeout;
- `500`: falha interna não classificada.

Não há retry automático: isso evita repetir chamadas que consomem créditos e preserva o primeiro diagnóstico. Respostas bem-sucedidas continuam em cache por cinco minutos. Os logs registram pesquisa, operação, status HTTP, código/mensagem pública, request ID quando presente, quantidade de produtos e duração. Nenhum erro ou log inclui a chave ou o cabeçalho de autorização.

## Verificação real

Com `NEXSCOPE_API_KEY` definida somente no ambiente do backend, execute `npm run nexscope:check`. O script faz uma chamada para `iPhone 15 Pro Max` e exibe no máximo cinco resultados normalizados, sem imprimir a chave. No Render, também é possível pesquisar pela interface e procurar estas linhas: `[Nexscope] Search`, `[Nexscope] POST amazon-search`, `[Nexscope] Status`, `[Nexscope] Error` (somente em falha), `[Nexscope] Products received` e `[Nexscope] Duration`.
