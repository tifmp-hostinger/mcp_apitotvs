# Deploy no EasyPanel — FMP RM-API

Guia de operação: variáveis de ambiente, build (Dockerfile), tuning de runtime,
diagnóstico e troubleshooting. Escrito a partir dos problemas reais enfrentados
ao subir a API no EasyPanel.

---

## 1. Como a aplicação lê configuração

A app **não usa** nenhuma biblioteca de `.env` pesada. A configuração vem de
**variáveis de ambiente** lidas por `src/Support/Env.php`, nesta ordem de
precedência:

1. Ambiente real do container (`getenv`, `$_ENV`, `$_SERVER`) — **EasyPanel/Docker**;
2. Arquivo `.env` na raiz de `www/api/` (carregado por `Env::load()` em `public/index.php`), **sem sobrescrever** o que já veio do ambiente real.

> **Implicação prática:** no EasyPanel, prefira definir tudo na aba **Environment**
> (variáveis reais). Um arquivo `.env` só é lido se existir dentro da imagem, e o
> `.gitignore` ignora `www/api/.env` — ou seja, em deploy via Git o `.env` **não vai
> junto**. Por isso a fonte de verdade é a aba Environment.

### Variáveis de ambiente

| Variável | Obrigatória | Exemplo / observação |
|---|---|---|
| `TOTVS_WS_URL` | **sim** | `https://fundacaoescola114384.rm.cloudtotvs.com.br:8051` = produção; `...114385...` = homolog. Define a BASE que a API inteira consulta/grava (SOAP) |
| `TOTVS_WS_USER` | **sim** | usuário de integração do RM |
| `TOTVS_WS_PASSWORD` | **sim** | senha do usuário de integração |
| `TOTVS_PORTAL_LOGIN_URL` | não | URL de login do portal do aluno. Default = produção (114384); em homolog aponte para 114385. Só afeta links do portal, não o SOAP |
| `TOTVS_PORTAL_AUTOLOGIN_URL` | não | URL de autologin do portal. Mesma regra acima |
| `TOTVS_PORTAL_ALIAS` | não | alias do banco no portal. Default `CorporeRM` (confirme se difere na homolog) |
| `FIN_RELATORIO_CONTRATO_ID` | não | ID do relatório de contrato. Default `1664` (pode variar entre bases) |
| `FIN_BAIXA_PROCESSO` | não | ProcessServerName da baixa. Default `FinLanBaixaData` |
| `FIN_BAIXA_OPERACAO` | não | Default `ExecuteWithXMLParams` |
| `FIN_CODCXA_PADRAO` | não | conta/caixa default da baixa quando não vier no corpo |
| `API_KEY` | **sim** (produção) | Liga a autenticação (header `X-API-Key` ou `Authorization: Bearer`). **Com `APP_DEBUG=false` e `API_KEY` vazia, as rotas não isentas respondem 503** — para rodar deliberadamente sem autenticação, defina `API_KEY_OPCIONAL=true` |
| `API_KEY_OPCIONAL` | não | `true` = permite produção SEM `API_KEY` (volta ao comportamento antigo: aberto, com aviso no log). Use com consciência |
| `CORS_ALLOWED_ORIGINS` | não | Origens permitidas no CORS, separadas por vírgula. Default `*` (aberto). Ex.: `https://app.fmp.edu.br,https://admin.fmp.edu.br` |
| `APP_DEBUG` | não | `true` para expor `xml_enviado`/`xml_retornado`/`soap_fault` nos erros. Padrão `false` |
| `APP_BASE` | não | base path lógico. **Hoje ignorado** — `index.php` usa `setBasePath('')` (rotas na raiz) |
| `APP_CRYPTO_KEY` | só p/ SSO | chave de **32 bytes exatos** (AES-256-GCM do `/sso/{token}`) |
| `APP_CRYPTO_METHOD` | não | padrão `aes-256-gcm` |

> Se `TOTVS_WS_URL` vier **vazia**, o SOAP monta a URL como `/wsDataServer/MEX?wsdl`
> (sem host) e estoura: `Couldn't load from '/wsDataServer/MEX?wsdl' : failed to load
> external entity`. **Esse erro = variável de ambiente faltando/não aplicada.**

---

## 2. Base path: a app roda na raiz

`public/index.php` faz `setBasePath('')`. As rotas são `/pessoas`, `/rm/test`,
`/inscricoes`… **sem** o prefixo `/api`. Use a URL do serviço direto:

```
https://SEU-SERVIDOR/rm/test
https://SEU-SERVIDOR/pessoas
```

(O `.env.example` traz `APP_BASE="/api"`, mas essa linha está desativada no bootstrap.)

---

## 3. Build (Dockerfile) e tuning de runtime

A imagem base é `php:8.3-apache` com as extensões `curl` e `soap`. Além do build
padrão, o `Dockerfile` aplica um **perfil de produção** — e o motivo de cada item
importa:

### PHP (`$PHP_INI_DIR/conf.d/zz-app.ini`)

| Diretiva | Valor | Por quê |
|---|---|---|
| `memory_limit` | `256M` | O WSDL do `wsDataServer` do RM é grande; serializar `SaveRecord` consome memória. É um **teto por requisição**, não memória reservada |
| `max_execution_time` | `300` | Processos do RM (matrícula, contrato) podem demorar |
| `max_input_time` | `300` | idem, na entrada |
| `default_socket_timeout` | `300` | **quanto o PHP espera o RM responder** no SOAP. Era 60s por padrão e cortava processos lentos |
| `post_max_size` / `upload_max_filesize` | `20M` | folga para payloads maiores |
| `log_errors` + `error_log=/dev/stderr` | on | **faz qualquer fatal/segfault aparecer nos Logs do EasyPanel** |
| `display_errors` | off | não vaza erro na resposta |

### Apache

| Item | Valor | Por quê |
|---|---|---|
| `Timeout` / `ProxyTimeout` | `300` | acompanha os processos lentos do RM |
| `MaxRequestWorkers` (prefork) | `8` | **regra de ouro:** `workers × memory_limit ≤ RAM do container`. Com 256M × 8 ≈ 2 GB de pico |
| `MaxConnectionsPerChild` | `500` | recicla workers, evita vazamento de memória ao longo do tempo |

### SOAP (`src/Clients/RMSoapClient.php`)

`connection_timeout=30` (conexão), `cache_wsdl=WSDL_CACHE_BOTH` (cacheia o WSDL
grande) e `keep_alive=false`. Assim um RM lento/indisponível vira **exceção
tratável** (502 JSON do app) em vez de derrubar o processo.

---

## 4. Dimensionamento (RAM × workers × timeout)

- `MaxRequestWorkers × memory_limit` precisa **caber na RAM do container**, com folga.
  Se a RAM do container for menor que isso, o Linux mata o processo (OOM) e o EasyPanel
  mostra o 502 "Service is not reachable".
- Defina a RAM em **EasyPanel → serviço → Resources**. Recomendado: **2 GB** (pode subir
  numa VPS folgada). Se aumentar a RAM e quiser mais concorrência, suba `MaxRequestWorkers`
  na mesma proporção no `Dockerfile`.
- **Timeout infinito é perigoso:** cada requisição lenta segura um worker; requisições
  travadas o suficiente esgotam todos os workers e derrubam a API inteira. Use um teto
  finito e generoso (300s). Para jobs realmente longos, o caminho certo é **assíncrono**
  (responder com um id de job e processar em segundo plano), não aumentar o timeout.

---

## 5. Diagnóstico rápido

| Endpoint | Para quê |
|---|---|
| `GET /teste.php` | Mostra (sem vazar segredo) se `TOTVS_WS_URL/USER/PASSWORD` chegam ao PHP, versão, ext_soap, etc. |
| `GET /status` | A app sobe e responde |
| `GET /rm/test` | Conexão + credenciais SOAP com o RM (sentença `INT.EDUVEM.00001`) |

Exemplo de POST (note o `Content-Type: application/json`; sem ele o corpo não é lido):

```bash
curl -i -X POST "https://SEU-SERVIDOR/pessoas" \
  -H "Content-Type: application/json" \
  -d '{"CODIGO":0,"NOME":"Teste","CPF":"00000000000","EMAIL":"teste@fmp.com.br"}'
```

---

## 6. Troubleshooting — tabela de sintomas

| Sintoma | Causa provável | Ação |
|---|---|---|
| JSON `Couldn't load from '/wsDataServer/MEX?wsdl'` | `TOTVS_WS_URL` vazia/não aplicada | Definir variáveis na aba Environment e **redeploy** (variável só vale após reiniciar) |
| HTML do EasyPanel **"Service is not reachable"** (502) num POST | O processo PHP **morreu** na requisição (OOM/segfault) — não é erro do app (erros do app são JSON) | Ver **Logs**; subir RAM do container e/ou `memory_limit`; conferir `workers × memory_limit ≤ RAM` |
| 502 só em processos **lentos** do RM | Timeout curto sendo cortado (PHP socket / Apache / proxy) | Timeouts já em 300s no build; conferir também timeout do proxy do EasyPanel |
| POST "funciona" mas a pessoa vem **vazia** | n8n sem `Content-Type: application/json` | No nó HTTP Request: **Send Body → JSON** |
| `GET` funciona e `POST` falha com erro **antigo** | Execução **stale** no n8n / cache | Reexecutar do zero; comparar com `curl` direto |
| Erro de gravação com mensagem do RM em `retorno_rm` | Validação/contexto do RM (ex.: falta `CODCOLIGADA`) | Ligar `APP_DEBUG=true` e ler `xml_enviado`/`xml_retornado` |

### Onde ler os logs
EasyPanel → seu serviço → aba **Logs**. Com `error_log=/dev/stderr`, fatais do PHP e
linhas do Apache (inclusive `child pid ... Segmentation fault`) aparecem ali.

---

## 6.1. Autenticação por API key

A API aceita uma chave única definida na env **`API_KEY`**.

- Defina `API_KEY` no EasyPanel (Environment) com um valor longo e aleatório.
  Exemplo de geração: `openssl rand -hex 32`.
- A partir daí, **toda** requisição precisa enviar o header:

  ```
  X-API-Key: SUA_CHAVE
  ```

  (Também é aceito `Authorization: Bearer SUA_CHAVE`.)

- **Rotas isentas** (não exigem chave): `GET /status` (health check) e
  `GET /sso/{token}` (aberto no navegador do aluno, já tem token criptografado).
  Os arquivos estáticos `/{docs.html}` e `/teste.php` são servidos pelo Apache,
  fora do app — não passam pela checagem.
- **Importante:** a autenticação só fica ativa **quando `API_KEY` está definida**.
  Se a variável estiver vazia/ausente, a API libera tudo e registra um aviso no log
  (`[RMAPI] AVISO: API_KEY nao definida`). Ou seja: definir a chave = proteger; e
  você não fica trancado pra fora antes de configurá-la.

Sem a chave, a resposta é **401**:

```json
{ "sucesso": false, "mensagem": "Não autorizado. Envie o header X-API-Key com a chave da API.", "detalhe": "API key ausente ou inválida." }
```

No **n8n**, adicione um header `X-API-Key` no nó HTTP Request (ou use uma credencial
do tipo *Header Auth* com nome `X-API-Key`).

## 7. Erros: como ver, e o modo `APP_DEBUG`

### O que SEMPRE volta na resposta (com debug ligado ou não)
Erro do RM retorna **HTTP 502** com um JSON assim — e o `retorno_rm` já traz a
**mensagem real do RM**. Você **não precisa** do debug pra ver isso:

```json
{
  "sucesso": false,
  "mensagem": "O RM rejeitou a gravação da pessoa",
  "operacao": "SaveRecord",
  "dataserver": "RhuPessoaData",
  "retorno_rm": "String or binary data would be truncated ... column 'CPF'."
}
```

Status usados: **422** (validação/fluxo), **502** (erro do RM), **404** (rota), **500** (interno).

### O que o `APP_DEBUG=true` ADICIONA
- No **JSON da resposta**: bloco `debug` com `xml_enviado`, `xml_retornado` e `soap_fault`
  (e, em erro 500, o stack trace). É o detalhe fino pra ajustar a integração.
- Nos **Logs** (stderr → aba Logs do EasyPanel): os XMLs e os marcadores de SOAP
  (`>> SOAP SaveRecord` / `>> SOAP SaveRecord OK`).

`APP_DEBUG=false` deixa só o essencial (`mensagem` + `operacao` + `dataserver` +
`retorno_rm`). **Use `true` enquanto integra; volte pra `false` em produção** —
os XMLs e o stack trace contêm dados pessoais e detalhes internos.

> Resumo: o **motivo** do erro (`retorno_rm`) aparece sempre; o **debug** só liga/desliga
> o detalhe extra (XMLs/stack) na resposta e nos logs.

### "Crashou" (HTML do EasyPanel) ≠ erro do app
- Página HTML **"Service is not reachable"** = o **proxy** do EasyPanel não achou o
  container (infra: container fora do ar / reiniciando / sem RAM). **Não é** regra de negócio.
- Erro do app sempre vem em **JSON**. Se você vê JSON, a aplicação está de pé e te
  dizendo o que houve.
- Erro fatal de PHP (ex.: estouro de memória) agora é convertido em **JSON 500** legível
  (via `register_shutdown_function`), em vez do 502 opaco — quando o processo não morre de vez.

### Logs server-side (à prova de resposta perdida)
Mesmo que o n8n/proxy esconda o corpo, o erro vai pros **Logs** (linhas começando com
`[RMAPI]`):
- `[RMAPI] >> SOAP {op} ({dataserver})` e `>> SOAP {op} OK` delimitam a chamada SOAP.
  Se entrar (`>>`) e **não** sair (`OK`) nem logar erro → o processo morreu **dentro** do
  SOAP (segfault/memória).
- `[RMAPI] RM operacao=... retorno_rm=...` = a rejeição do RM (sempre logada).
- `xml_enviado`/`xml_retornado` só são logados com `APP_DEBUG=true`.

### Como VER o erro no n8n
Por padrão o nó **HTTP Request** trata 4xx/5xx como falha e mostra só "Bad gateway",
escondendo o corpo. Para ver o JSON do erro:
- nas **Settings** do nó: **On Error → Continue (using error output)**;
- e/ou a opção **Full Response**; o corpo aparece em `errorDetails`/`rawErrorMessage`.
- Alternativa rápida: testar por `curl -i` ou Insomnia, que sempre mostram o corpo.

## 8. Checklist de deploy

1. Variáveis na aba **Environment** (`TOTVS_WS_URL`, `TOTVS_WS_USER`, `TOTVS_WS_PASSWORD`; opcional `APP_DEBUG`, `APP_CRYPTO_KEY`).
2. **Resources**: RAM ≥ 2 GB; porta do serviço = **80** (a imagem `php:apache` escuta na 80).
3. Deploy/rebuild (o tuning está no `Dockerfile` — exige novo build).
4. Validar nesta ordem: `/teste.php` → `/status` → `/rm/test` → `POST /pessoas`.
5. Em produção, voltar `APP_DEBUG` para `false`.
