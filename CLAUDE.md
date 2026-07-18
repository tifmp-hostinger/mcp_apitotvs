# Convenções do projeto (mcp_apitotvs)

Servidor **MCP** (Streamable HTTP + OAuth 2.1) em **Node 22/TypeScript**
(`mcp/`) que integra agentes de IA ao **TOTVS RM via SOAP direto** (sem WSDL).
A antiga API REST PHP (`www/api/`) foi portada para dentro do MCP e permanece
no repositório **como referência** — o serviço ativo é o `mcp/`.

## Ao criar/alterar uma tool do MCP, atualize SEMPRE (mesma alteração):

1. **`mcp/src/tools.ts`** — a tool em si (envelope `{sucesso, mensagem, dados}`
   nos moldes da API; consultas com `readOnlyHint`, gravações com
   `destructiveHint`).
2. **`mcp/src/services/*`** — regra de negócio (1 domínio por classe).
   Fluxo: `tool → service → RMSoapClient → RM`. Tools nunca tocam SOAP.
3. **`mcp/README.md`** — tabela de tools.
4. **`mcp/scripts/smoke.mjs`** — cobertura no smoke (mock SOAP do RM).

## XMLs de processo do RM (wsProcess)

Templates em `mcp/resources/{edu,fin}/*.template.xml` (placeholders `{{...}}`,
builders em `mcp/src/support/process-xml.ts`):

- `edu/` é **EXTRAÍDO dos heredocs do PHP** por
  `mcp/scripts/extrair-templates-edu.php` — se mudar
  `www/api/src/Support/ProcessXml.php`, regenere e rode `npm run diff-xml`
  (compara os builders PHP × TS byte a byte; deve dar 9/9 iguais).
- Baixa financeira: caminho validado em homolog = `FinTBCBaixaDataProcess`.
  **NUNCA teste nomes de processo de baixa em produção** (nome certo executa
  baixa real). Na tool `financeiro_baixar`, `DRY_RUN` é `true` por padrão —
  mantenha assim.

## Testes

`cd mcp && npm test` = build + smoke E2E (38 checks: OAuth 2.1 completo,
protocolo MCP, tools contra mock SOAP, travas) + diff PHP×TS. Sem rede externa
e sem RM real; a execução real confirma-se no deploy. Os testes PHP continuam
em `www/api` (`php tests/run.php`).

## Envs / deploy

Envs do TOTVS com os **mesmos nomes da API PHP** (`TOTVS_WS_URL/USER/PASSWORD`,
`APP_CRYPTO_KEY`, `FIN_*`, `TOTVS_PORTAL_*`) — referência em
`mcp/.env.example`. Deploy EasyPanel com `mcp/Dockerfile` (contexto `mcp/`).
Produção RM = base `114384`; homolog = `114385`.

## Legado (www/api — só referência)

`www/api/API.md` segue sendo a documentação de domínio mais completa
(sentenças INT.EDUVEM.*, DataServers, histórico da investigação da baixa).
Se alterar algo lá, siga as convenções antigas (routes.php + docs.html +
API.md + dependencies.php em sincronia — teste guarda-corpo:
`RotasDocumentadasTest`).
