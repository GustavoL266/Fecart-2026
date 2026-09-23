# Integração de mercado com SearchAPI.io

O backend consulta o Google Shopping pela SearchAPI.io. O navegador acessa somente a rota autenticada `GET /market/search?q=...`; a chave nunca é enviada ao frontend.

## Contrato externo

- Método e endpoint: `GET https://www.searchapi.io/api/v1/search`
- Autenticação: `Authorization: Bearer <SEARCHAPI_API_KEY>`
- Parâmetros: `engine=google_shopping`, `q=<produto específico>`, `gl=br` e `hl=pt-br`. Quando necessário, a segunda consulta usa `page=2` ou uma versão simplificada do mesmo modelo.
- Não há parâmetro `num` nem `currency` documentado para esse endpoint; a aplicação só aceita preços explicitamente identificados como BRL.
- Resposta usada: `shopping_results[]` e `popular_products[]`, quando os itens têm dados válidos.

A [documentação oficial do Google Shopping na SearchAPI](https://www.searchapi.io/docs/google-shopping) confirma `page`, `gl` e `hl`. A consulta comercial preserva o modelo informado; a normalização corrige espaços e grafias como `Iphone` → `iPhone`. A classificação fiscal é independente e não substitui a busca por uma categoria genérica.

O backend normaliza apenas resultados com identificador, título, vendedor, URL HTTPS e preço BRL positivo. Os campos internos são `id`, `title`, `price`, `currency`, `source`/`seller`, `image`, `url`, `consultedAt` e, quando presentes, `rating` e `reviews`. Valores ausentes não são inventados.

## Consumo e segurança

Resultados com produtos ficam em cache na memória por cinco minutos; buscas vazias, por um minuto. Requisições simultâneas idênticas são deduplicadas. O botão “Atualizar resultados” ignora o cache daquela busca, com limite adicional de seis atualizações por minuto por cliente. O limite geral permanece em 30 consultas por minuto por cliente.

Uma busca normal usa uma chamada. Se houver menos de cinco produtos principais relevantes, pode haver uma segunda chamada: com o mesmo modelo simplificado (por exemplo, sem fabricante redundante e capacidade) ou à página 2. Nunca há mais de duas chamadas ao provider por busca; não se usa catálogo local ou preço fictício. A relevância exige correspondência de geração e variante do modelo, ordena os produtos e rebaixa acessórios não solicitados. O navegador mostra até cinco referências e calcula média, mediana e extremos somente com elas.

Os logs registram apenas tamanho da consulta, provedor, status HTTP, quantidade de resultados, cache e duração. A chave e o cabeçalho de autorização nunca são registrados. Os erros distinguem consulta inválida (400), credencial inválida (401), permissão (403), limite (429), falha externa (5xx), indisponibilidade (503) e timeout (504).

## Configuração e verificação

Defina apenas no ambiente do backend:

```text
SEARCHAPI_API_KEY=sua-chave-real
SEARCHAPI_TIMEOUT_MS=15000
```

Para uma consulta real e econômica (até duas chamadas):

```bash
pnpm searchapi:check -- "Iphone 18 Pro Max"
```

Sem argumento, o script usa `Iphone 18 Pro Max`. Para comparar as cinco grafias e variações solicitadas, execute `pnpm searchapi:check -- --variants` (até dez chamadas; ignora cache entre variantes). O script informa consultas enviadas, itens recebidos, normalizados, retidos e preços reais sem imprimir a chave. A interface continua permitindo preço manual caso a integração esteja ausente ou indisponível.
