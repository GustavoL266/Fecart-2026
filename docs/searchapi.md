# Integração de mercado com SearchAPI.io

O backend consulta o Google Shopping pela SearchAPI.io. O navegador acessa somente a rota autenticada `GET /market/search?q=...`; a chave nunca é enviada ao frontend.

## Contrato externo

- Método e endpoint: `GET https://www.searchapi.io/api/v1/search`
- Autenticação: `Authorization: Bearer <SEARCHAPI_API_KEY>`
- Parâmetros: `engine=google_shopping`, `q=<consulta>`, `gl=br` e `hl=pt-br`
- Resposta usada: `shopping_results[]`

O backend normaliza apenas resultados com identificador, título, vendedor, URL HTTPS e preço BRL positivo. Os campos internos são `id`, `title`, `price`, `currency`, `source`/`seller`, `image`, `url`, `consultedAt` e, quando presentes, `rating` e `reviews`. Valores ausentes não são inventados.

## Consumo e segurança

Pesquisas iguais ficam em cache na memória por cinco minutos e requisições simultâneas idênticas são deduplicadas. A aplicação não faz retry automático, evitando consumo duplicado de créditos. O rate limit interno permanece em 30 consultas por minuto por cliente.

Os logs registram consulta, provedor, status HTTP, quantidade de resultados, cache e duração. A chave e o cabeçalho de autorização nunca são registrados. Os erros distinguem consulta inválida (400), credencial inválida (401), permissão (403), limite (429), falha externa (5xx), indisponibilidade (503) e timeout (504).

## Configuração e verificação

Defina apenas no ambiente do backend:

```text
SEARCHAPI_API_KEY=sua-chave-real
SEARCHAPI_TIMEOUT_MS=15000
```

Para uma consulta real e econômica:

```bash
npm run searchapi:check -- "iPhone 15 Pro Max"
```

Sem argumento, o script executa as cinco consultas de homologação solicitadas e portanto consome até cinco chamadas. A interface continua permitindo preço manual caso a integração esteja ausente ou indisponível.
