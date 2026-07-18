# MCP TOTVS FMP — servidor MCP (Streamable HTTP + OAuth 2.1)

Servidor **MCP (Model Context Protocol)** que permite a um agente conversacional
(OpenClaw, Claude, ou qualquer cliente MCP) **gerenciar a API de integração
TOTVS RM da FMP** — pessoas, alunos, inscrições, matrículas, cupons, contratos
e financeiro.

```
cliente MCP (OpenClaw, Claude…)
        │  MCP Streamable HTTP + OAuth 2.1
        ▼
  este servidor (mcp/)  ──── X-API-Key ────▶  api-totvs (www/api)  ──── SOAP ────▶  TOTVS RM
```

O servidor **não fala SOAP nem guarda regra de negócio**: cada tool é um espelho
fino de uma rota da API REST (ver `www/api/API.md`), devolvendo o envelope JSON
da API (`sucesso`, `mensagem`, `dados`, `retorno_rm`, `etapas`…) para o agente
interpretar.

## Endpoints

| Endpoint | Função |
|---|---|
| `POST /mcp` | Transporte MCP Streamable HTTP (Bearer obrigatório) |
| `/.well-known/oauth-protected-resource/mcp` | Metadados do resource (RFC 9728 — descoberta automática) |
| `/.well-known/oauth-authorization-server` | Metadados do authorization server (RFC 8414) |
| `GET /authorize`, `POST /token`, `POST /register` | OAuth 2.1: autorização, tokens, Dynamic Client Registration |
| `POST /oauth/consent` | Envio da senha da tela de autorização |
| `GET /healthz` | Health check (sem auth) |

Transporte **stateless**: cada `POST /mcp` é independente (sem sessão), com
resposta JSON direta — funciona atrás de qualquer proxy, sem sticky session, e
um restart não derruba clientes.

## Autenticação (duas formas)

**1. OAuth 2.1 (padrão MCP)** — o cliente descobre tudo sozinho pelos
`/.well-known`, se registra (DCR), abre o navegador na tela de autorização,
onde o operador digita a **`MCP_ACCESS_PASSWORD`** uma única vez. PKCE S256
obrigatório; access token de 1 h + refresh token de 30 d com rotação. Os tokens
são JWT auto-contidos: **restart do container não derruba sessões**.

**2. Token estático (fallback headless)** — para clientes sem navegador
(OpenClaw rodando em servidor, n8n, scripts): defina
`MCP_STATIC_BEARER_TOKENS` e configure o cliente com o header
`Authorization: Bearer <token>`. Vazio = somente OAuth.

## Variáveis de ambiente

Referência completa em [`.env.example`](.env.example). As obrigatórias em produção:

| Env | Uso |
|---|---|
| `MCP_PUBLIC_URL` | URL pública deste serviço (issuer OAuth), ex.: `https://mcp-totvs.fmp.edu.br` |
| `MCP_OAUTH_SIGNING_KEY` | Segredo HS256 dos tokens (`openssl rand -hex 32`) |
| `MCP_ACCESS_PASSWORD` | Senha da tela de autorização |
| `TOTVS_API_BASE_URL` | Base da API gerenciada (default `https://api-totvs.fmp.edu.br`) |
| `TOTVS_API_KEY` | Chave `X-API-Key` da API (a env `API_KEY` da API PHP) |

## Rodando

```bash
cd mcp
npm ci
npm run build
npm start            # dev local: gera senha/chave efêmeras se faltarem envs

npm test             # build + smoke test E2E (OAuth completo + MCP, sem rede externa)
```

**Docker / EasyPanel:** use o [`Dockerfile`](Dockerfile) deste diretório
(contexto de build = `mcp/`). Exponha a porta `3300` num domínio próprio
(ex.: `mcp-totvs.fmp.edu.br`), preencha as envs acima na aba Environment e,
opcionalmente, monte um volume em `/app/data` (persiste os clients OAuth
registrados — sem ele, clientes apenas se registram de novo após restart).

## Conectando o OpenClaw

O OpenClaw consome servidores MCP remotos via **mcporter**. Registre o servidor:

```bash
npx mcporter config add totvs --url https://mcp-totvs.fmp.edu.br/mcp
npx mcporter auth totvs        # abre o navegador → digite a MCP_ACCESS_PASSWORD
npx mcporter list totvs        # deve listar as ~28 tools
```

Ou por configuração (ex.: `~/.config/mcporter/config.json`), usando **token
estático** quando o gateway roda sem navegador:

```json
{
  "mcpServers": {
    "totvs": {
      "url": "https://mcp-totvs.fmp.edu.br/mcp",
      "headers": { "Authorization": "Bearer <valor de MCP_STATIC_BEARER_TOKENS>" }
    }
  }
}
```

A partir daí o agente do OpenClaw enxerga as tools (`totvs_status`,
`inscricao_criar`, `financeiro_baixar`…) e gerencia a API conversando.
*A forma de plugar MCP no OpenClaw evolui rápido — confira a doc da sua versão
(docs.openclaw.ai) se os comandos acima divergirem.*

**Outros clientes:**

```bash
# Claude Code
claude mcp add --transport http totvs https://mcp-totvs.fmp.edu.br/mcp

# MCP Inspector (debug interativo)
npx @modelcontextprotocol/inspector    # transport: Streamable HTTP → URL /mcp
```

No **Claude.ai** (web/desktop): Settings → Connectors → *Add custom connector*
→ URL `https://mcp-totvs.fmp.edu.br/mcp` (o fluxo OAuth roda sozinho).

## Tools expostas (28)

| Domínio | Tools |
|---|---|
| Diagnóstico | `totvs_status`, `totvs_teste_rm`, `rm_schema`, `rm_sql`, `rm_read`, `rm_view`, `rm_save` |
| Pessoa | `pessoa_buscar`, `pessoa_salvar` |
| Aluno | `aluno_buscar`, `aluno_criar`, `aluno_vincular_clifor` |
| Cliente/Fornecedor | `clifor_buscar`, `clifor_criar` |
| Inscrição | `inscricao_criar` (fluxo completo orquestrado, idempotente) |
| Matrícula | `matricula_curso`, `matricula_periodo_letivo`, `matricula_disciplinas` |
| Contrato | `contrato_gerar` (PDF omitido por padrão — `retornar_conteudo=true` devolve) |
| Financeiro | `financeiro_baixar`, `financeiro_gerar_lancamentos` |
| Consultas | `oferta_consultar`, `oferta_planos_pagamento`, `enderecos_estados`, `enderecos_cidades`, `enderecos_bairros`, `enderecos_cep`, `cupom_consultar`, `cupom_aplicar` |

### Trava de segurança do financeiro

`financeiro_baixar` executa uma **baixa real** no RM. Nesta tool, **`DRY_RUN`
é `true` por padrão** (diferente da API): a chamada devolve o XML que seria
enviado, sem efetivar. O agente só executa a baixa de verdade passando
`DRY_RUN=false` explicitamente — a descrição da tool o instrui a confirmar com
o usuário antes.

## Estrutura

```
mcp/
├── src/
│   ├── server.ts      ← bootstrap: express + auth router + POST /mcp (stateless)
│   ├── oauth.ts       ← OAuth 2.1: provider, DCR, tela de senha, tokens JWT
│   ├── jwt.ts         ← JWT HS256 com crypto nativo (sem dependência)
│   ├── tools.ts       ← as 28 tools (espelho 1:1 das rotas da API)
│   ├── api-client.ts  ← único ponto de contato com a API REST (X-API-Key)
│   └── config.ts      ← envs com validação de produção
├── scripts/smoke.mjs  ← teste E2E: OAuth completo + protocolo MCP + travas
├── Dockerfile
└── .env.example
```

Ao **criar/alterar rota na API PHP**, espelhe aqui (`src/tools.ts`) além dos
locais listados no `CLAUDE.md` da raiz.
