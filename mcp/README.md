# MCP TOTVS FMP — servidor MCP (Streamable HTTP + OAuth 2.1) com SOAP direto

Servidor **MCP (Model Context Protocol)** que permite a um agente conversacional
(OpenClaw, Claude, ou qualquer cliente MCP) **gerenciar o TOTVS RM da FMP** —
pessoas, alunos, inscrições, matrículas, cupons, contratos e financeiro.

**Este servidor É a integração**: fala SOAP direto com o RM (wsDataServer,
wsProcess, wsReport, wsConsultaSQL), sem API intermediária. Toda a lógica de
negócio da antiga api-totvs (`www/api`, PHP) foi portada para cá — a pasta
`www/api` permanece no repositório como referência do porte.

```
cliente MCP (OpenClaw, Claude…)
        │  MCP Streamable HTTP + OAuth 2.1
        ▼
  este servidor (mcp/)  ────────── SOAP (basic auth) ──────────▶  TOTVS RM
   Node 22 / TypeScript        wsDataServer · wsProcess
                               wsReport · wsConsultaSQL
```

Diferença técnica importante em relação ao PHP: **não carregamos o WSDL** (o
ext-soap baixava o WSDL gigante do RM só para descobrir contratos fixos). Os
envelopes SOAP 1.1 são montados à mão — mesmos elementos, mesmo namespace —
o que elimina o estouro de memória/segfault do WSDL.

## Fidelidade do porte

- Os XMLs de **processos** (matrícula no PL, enturmação, gerar lançamento)
  foram **extraídos dos heredocs do PHP** para `resources/edu/*.template.xml`
  pelo script `scripts/extrair-templates-edu.php` — estrutura byte a byte
  idêntica à validada em produção.
- Os templates de **baixa** (`resources/fin/`) são cópias dos da API
  (o TBC é o caminho validado em homologação em 13/07/2026).
- `npm run diff-xml` compara os 9 builders TS contra os builders PHP com
  entradas idênticas — **byte a byte iguais** (sessão neutralizada).
- Envelope de resposta, mensagens, validações (CPF, RNM, telefone…),
  idempotência e rastreamento de etapas (`etapas`/`etapas_concluidas`)
  são os mesmos da API.

## Endpoints

| Endpoint | Função |
|---|---|
| `POST /mcp` | Transporte MCP Streamable HTTP (Bearer obrigatório) |
| `/.well-known/oauth-protected-resource/mcp` | Metadados do resource (RFC 9728 — descoberta automática) |
| `/.well-known/oauth-authorization-server` | Metadados do authorization server (RFC 8414) |
| `GET /authorize`, `POST /token`, `POST /register` | OAuth 2.1: autorização, tokens, Dynamic Client Registration |
| `POST /oauth/consent` | Envio da senha da tela de autorização |
| `GET /sso/{token}` | Auto-login do Portal Educacional (HTML; consumido pelo navegador do aluno) |
| `GET /healthz` | Health check (sem auth) |

Transporte **stateless**: cada `POST /mcp` é independente, com resposta JSON
direta — funciona atrás de qualquer proxy, sem sticky session, e um restart
não derruba clientes.

## Autenticação (duas formas)

**1. OAuth 2.1 (padrão MCP)** — o cliente descobre tudo pelos `/.well-known`,
se registra (DCR), abre o navegador na tela de autorização, onde o operador
digita a **`MCP_ACCESS_PASSWORD`** uma única vez. PKCE S256 obrigatório;
access token de 1 h + refresh de 30 d com rotação. Tokens JWT auto-contidos:
**restart do container não derruba sessões**.

**2. Token estático (fallback headless)** — para clientes sem navegador
(OpenClaw em servidor, n8n, scripts): defina `MCP_STATIC_BEARER_TOKENS` e
configure o cliente com `Authorization: Bearer <token>`. Vazio = somente OAuth.

## Variáveis de ambiente

Referência completa em [`.env.example`](.env.example). As envs do TOTVS usam
**os mesmos nomes da antiga API PHP** — migração 1:1 do painel:

| Env | Uso |
|---|---|
| `MCP_PUBLIC_URL` | URL pública deste serviço, ex.: `https://mcp-totvs.fmp.edu.br` |
| `TOTVS_WS_URL` | Base SOAP do RM (produção `...114384...:8051`, homolog `...114385...:8051`) |
| `TOTVS_WS_USER` / `TOTVS_WS_PASSWORD` | Credenciais do usuário de integração |
| `APP_CRYPTO_KEY` | Chave de 32 bytes do SSO (a mesma da API PHP mantém tokens válidos) |
| `MCP_OAUTH_SIGNING_KEY` | Segredo HS256 dos tokens (`openssl rand -hex 32`) |
| `MCP_ACCESS_PASSWORD` | Senha da tela de autorização |
| `FIN_BAIXA_PROCESSO` etc. | Mesmos ajustes finos do financeiro da API |

## Rodando

```bash
cd mcp
npm ci
npm run build
npm start            # dev local: gera senha/chave efêmeras se faltarem envs

npm test             # build + smoke E2E (mock SOAP do RM + OAuth + MCP) + diff PHP×TS
```

**Docker / EasyPanel:** use o [`Dockerfile`](Dockerfile) (contexto de build =
`mcp/`). Exponha a porta `3300` num domínio próprio, preencha as envs na aba
Environment e, opcionalmente, monte um volume em `/app/data` (persiste os
clients OAuth registrados).

## Conectando o OpenClaw

O OpenClaw consome servidores MCP remotos via **mcporter**:

```bash
npx mcporter config add totvs --url https://mcp-totvs.fmp.edu.br/mcp
npx mcporter auth totvs        # abre o navegador → digite a MCP_ACCESS_PASSWORD
npx mcporter list totvs        # deve listar as ~29 tools
```

Ou por configuração, usando **token estático** quando o gateway roda sem
navegador (ex.: `~/.config/mcporter/config.json`):

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

*A forma de plugar MCP no OpenClaw evolui rápido — confira a doc da sua versão
(docs.openclaw.ai) se os comandos divergirem.*

**Outros clientes:**

```bash
# Claude Code
claude mcp add --transport http totvs https://mcp-totvs.fmp.edu.br/mcp

# MCP Inspector (debug interativo)
npx @modelcontextprotocol/inspector    # transport: Streamable HTTP → URL /mcp
```

No **Claude.ai**: Settings → Connectors → *Add custom connector* → URL
`https://mcp-totvs.fmp.edu.br/mcp` (o fluxo OAuth roda sozinho).

## Tools expostas (29)

| Domínio | Tools |
|---|---|
| Diagnóstico | `totvs_status`, `totvs_teste_rm`, `rm_schema`, `rm_sql`, `rm_read`, `rm_view`, `rm_save` |
| Pessoa | `pessoa_buscar`, `pessoa_salvar` |
| Aluno | `aluno_buscar`, `aluno_criar`, `aluno_vincular_clifor`, `aluno_gerar_sso` |
| Cliente/Fornecedor | `clifor_buscar`, `clifor_criar` |
| Inscrição | `inscricao_criar` (fluxo completo orquestrado, idempotente) |
| Matrícula | `matricula_curso`, `matricula_periodo_letivo`, `matricula_disciplinas` |
| Contrato | `contrato_gerar` (PDF omitido por padrão — `retornar_conteudo=true` devolve) |
| Financeiro | `financeiro_baixar`, `financeiro_gerar_lancamentos` |
| Consultas | `oferta_consultar`, `oferta_planos_pagamento`, `enderecos_estados`, `enderecos_cidades`, `enderecos_bairros`, `enderecos_cep`, `cupom_consultar`, `cupom_aplicar` |

### Trava de segurança do financeiro

`financeiro_baixar` executa uma **baixa real** no RM (processo
`FinTBCBaixaDataProcess`, validado em homologação). Nesta tool, **`DRY_RUN` é
`true` por padrão**: a chamada devolve o XML que seria enviado, sem efetivar.
O agente só executa a baixa de verdade passando `DRY_RUN=false`
explicitamente — a descrição da tool o instrui a confirmar com o usuário.

**Nunca teste nomes de processo de baixa em produção**: nome errado é
inofensivo, mas o nome certo executa uma baixa real (ver histórico em
`www/api/API.md`, seção Financeiro).

## Estrutura

```
mcp/
├── src/
│   ├── server.ts            ← bootstrap: express + OAuth + POST /mcp + GET /sso
│   ├── oauth.ts             ← OAuth 2.1: provider, DCR, tela de senha, JWTs
│   ├── jwt.ts               ← JWT HS256 com crypto nativo
│   ├── config.ts            ← envs (mesmos nomes da API PHP p/ o TOTVS)
│   ├── tools.ts             ← as 29 tools (envelope idêntico ao da API)
│   ├── rm/
│   │   ├── soap-client.ts   ← ÚNICO ponto de contato SOAP (sem WSDL)
│   │   └── errors.ts        ← RMError, FluxoError, ValidationError
│   ├── services/            ← regra de negócio (1 domínio por classe, porte 1:1)
│   ├── support/             ← process-xml, report-xml, schema-parser, sso-crypto
│   └── helpers/validation.ts
├── resources/
│   ├── edu/*.template.xml   ← processos Edu EXTRAÍDOS do PHP (regeráveis)
│   └── fin/*.template.xml   ← baixa (TBC validado em homolog)
├── scripts/
│   ├── smoke.mjs                 ← E2E: mock SOAP do RM + OAuth + MCP (38 checks)
│   ├── diff-xml.mjs              ← prova de fidelidade: XMLs PHP × TS
│   ├── dump-xml.php              ← lado PHP do diff
│   └── extrair-templates-edu.php ← regenera resources/edu a partir do PHP
├── Dockerfile
└── .env.example
```

**Fluxo de dependência** (igual ao da API): `tool → service → RMSoapClient →
TOTVS RM`. Tools nunca tocam SOAP; services nunca montam envelope de resposta.
