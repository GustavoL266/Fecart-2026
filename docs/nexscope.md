# Integração de mercado com Nexscope

O backend usa a API oficial **Amazon Search** da Nexscope para obter referências da Amazon Brasil. O frontend acessa somente `GET /market/search?q=...`; a chave não sai do servidor.

## Contrato externo utilizado

- Método e endpoint: `POST https://api.nexscope.ai/api/skill-api/v1/skills/amazon-search/run`
- Autenticação: `Authorization: Bearer <NEXSCOPE_API_KEY>`
- Conteúdo: `Content-Type: application/json`
- Corpo enviado: `keyword`, `amazonDomain: "amazon.com.br"`, `language: "pt_BR"`, `page: 1` e `device: "desktop"`.
- Paginação documentada: páginas a partir de 1, com aproximadamente 20 itens por página.
- Resposta direta: `products[]`, com campos como `asin`, `title`, `brand`, `price`, `extractedPrice`, `currency`, `imageUrl`, `asinUrl` e `sourceType`.

O endpoint custa 21 créditos por chamada segundo o catálogo público consultado em 2 de setembro de 2026. A documentação pública não fixa uma quantidade universal de requisições por minuto; os limites aplicáveis devem ser conferidos no workspace da conta. A aplicação reduz consumo com cache em memória por cinco minutos, deduplicação de chamadas simultâneas e limite próprio de 30 consultas por minuto por cliente.

## Resposta interna normalizada

O backend valida a resposta e devolve `results[]` com `id`, `asin`, `title`, `price`, `currency`, `source`, `category`, `image`, `url` e `consultedAt`. Apenas preços positivos em BRL e produtos com identificador, título e URL válidos seguem para a interface. A fonte visual é `Amazon`, pois esse é o marketplace consultado pelo endpoint escolhido; `Nexscope` é o provedor técnico.

## Erros

- `400`: consulta ou parâmetros inválidos;
- `401/403`: chave inválida ou sem permissão;
- `429`: limite de requisições;
- `502/503`: falha ou indisponibilidade da Nexscope/upstream;
- `504`: timeout;
- `500`: falha interna não classificada.

Nenhum erro ou log inclui a chave ou o cabeçalho de autorização.

## Verificação real

Com `NEXSCOPE_API_KEY` definida somente no ambiente do backend, execute `npm run nexscope:check`. O script consulta `iPhone 15 Pro Max` e `Iphone` e exibe no máximo cinco resultados normalizados de cada busca, sem imprimir a chave.
