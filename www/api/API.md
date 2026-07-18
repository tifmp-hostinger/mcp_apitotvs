# FMP RM-API — Documentação Técnica

API REST de integração com o **TOTVS RM via SOAP**. Sem frontend, sem checkout, sem renderização HTML (exceção única e documentada: `/sso`).

> **Exemplos prontos:** `docs/CURLS.md` (body + cURL de cada endpoint, colável no *Import cURL* do n8n) e `docs/postman_collection.json` (coleção Postman/Insomnia com variável `baseUrl`).
>
> **Página interativa:** `public/docs.html` — servida em `https://SEU-SERVIDOR/docs.html`. Lista todos os endpoints com body editável e gera o cURL pronto pra copiar.
>
> **Deploy / EasyPanel / variáveis de ambiente / troubleshooting:** `docs/DEPLOY-EASYPANEL.md`.
>
> **Base path:** a app é servida na **raiz** (`setBasePath('')`). As rotas são `/pessoas`, `/rm/test` etc., **sem** `/api`.
>
> **Autenticação:** quando a env `API_KEY` está definida, toda requisição precisa do header `X-API-Key: <chave>` (ou `Authorization: Bearer <chave>`). Isentas: `GET /status` e `GET /sso/{token}`. Sem chave válida → **401**. **Em produção (`APP_DEBUG=false`) a `API_KEY` é obrigatória**: vazia, as rotas não isentas respondem **503** (para rodar deliberadamente sem autenticação: `API_KEY_OPCIONAL=true`). **CORS:** aberto por padrão (`*`); restrinja com `CORS_ALLOWED_ORIGINS` (origens separadas por vírgula). Detalhes em `docs/DEPLOY-EASYPANEL.md`.
>
> **Formato do corpo (POST):** a API aceita **`application/json`** e **`application/x-www-form-urlencoded`** (campos soltos). No n8n, tanto "Using JSON" quanto "Using Fields Below" funcionam. Corpos aninhados (ex.: `/rm/sql`, `/rm/read`) → use JSON.

```
www/api/
├── .env / .env.example
├── composer.json                  (namespace FMP\RMApi)
├── config/
│   ├── rm.php                     ← conexão SOAP + contextos padrão + portal
│   ├── app.php                    ← debug, base path, crypto SSO
│   ├── dependencies.php           ← container PHP-DI
│   └── routes.php
├── public/index.php               ← bootstrap + error handler central
└── src/
    ├── Clients/
    │   ├── RMSoapClient.php       ← ÚNICO ponto de contato SOAP
    │   └── RMWSType.php           ← enum dos endpoints WSDL
    ├── Services/                  ← regra de negócio (1 domínio por classe)
    ├── Controllers/               ← só HTTP (entrada/saída JSON)
    ├── Exceptions/                ← RMException, FluxoException, ValidationException
    ├── Support/                   ← ProcessXml, ReportXml, SchemaParser
    └── Helpers/                   ← Json, Validation, Crypto, Format
```

**Fluxo de dependência:** `Controller → Service → RMSoapClient → TOTVS RM`. Controllers nunca tocam SOAP; services nunca montam Response.

---

## 1. Envelope de resposta

**Sucesso (200/201):**
```json
{ "sucesso": true, "mensagem": "...", "dados": { } }
```

**Erro de validação (422) / etapa de fluxo (422):**
```json
{
  "sucesso": false,
  "mensagem": "O CPF informado (123) não parece correto...",
  "etapa": "PESSOA",
  "detalhe": "CPF inválido informado",
  "operacao": "SaveRecord",
  "dataserver": "RhuPessoaData",
  "retorno_rm": "Número de CPF inválido! ..."
}
```

**Erro do RM (502):**
```json
{
  "sucesso": false,
  "mensagem": "...",
  "operacao": "SaveRecord",
  "dataserver": "RhuPessoaData",
  "retorno_rm": "Column 'NOME' does not allow nulls."
}
```

**Rota inexistente:** 404. **Erro interno:** 500.

### Modo debug (`APP_DEBUG=true`)
Defina como **variável de ambiente** no EasyPanel (ou no `.env` — ver `docs/DEPLOY-EASYPANEL.md`). Todo erro de RM passa a incluir:
```json
"debug": {
  "contexto":      { "CODCOLIGADA": "1", "CODSISTEMA": "S", "CODUSUARIO": "integra.eduvem" },
  "xml_enviado":   "<RhuPessoa>...</RhuPessoa>",
  "xml_retornado": "<s:Envelope>...</s:Envelope>",
  "soap_fault":    { "faultcode": "...", "faultstring": "...", "detail": {} }
}
```
O `SoapClient` roda com `trace=true`; request/response brutos são sempre capturados.

---

## 2. Rotas

### Sistema / RM genérico (diagnóstico)

| Rota | Descrição |
|---|---|
| `GET /status` | Health check (sentença INT.EDUVEM.00001) |
| `GET /rm/test` | Testa conexão/credenciais com o RM |
| `GET /rm/schema/{dataserver}` | Schema parseado (tabelas, campos, chaves, FKs). `?xml=1` devolve o XSD bruto (alias antigo: `?raw=1`) |
| `POST /rm/sql/{codsentenca}` | Executa sentença SQL cadastrada. Body: `{ "parametros": {"CPF_S": "..."}, "codcoligada": "0", "codsistema": "G" }` |
| `POST /rm/read/{dataserver}` | ReadRecord. Body: `{ "chave": ["123"], "contexto": {} }` |
| `POST /rm/view/{dataserver}` | ReadView. Body: `{ "filtro": "CODCOLIGADA=1", "contexto": {} }` |
| `POST /rm/save/{dataserver}` | SaveRecord genérico. Body: `{ "xml": "<...>", "contexto": {} }` |

### Pessoa (RhuPessoaData)

| Rota | Body | Retorno |
|---|---|---|
| `POST /pessoas` | Campos da PPessoa: `CODIGO` (0/ausente = criar), `NOME`, `DTNASCIMENTO`, `SEXO`, `CPF`, `EMAIL`, `TELEFONE1`, `RUA`, `NUMERO`, `BAIRRO`, `ESTADO`, `CIDADE`, `CEP`, `CODMUNICIPIO`, `IDPAIS`, `NROREGGERAL`... (CPF/CEP/TELEFONE1 são normalizados p/ dígitos) | 201 + `{ "CODPESSOA": "12345" }` |
| `GET /pessoas/{codigo}` | — | dados completos da PPessoa |
| `GET /pessoas/busca?cpf=...` (ou `?rnm=...`) | — | PPessoa ou 404. Aceita `cpf`/`CPF` em qualquer caixa |

XML enviado ao RM (SaveRecord `RhuPessoaData`, sem contexto):
```xml
<RhuPessoa>
    <PPessoa>
        <CODIGO>0</CODIGO>
        <NOME>Fulano de Tal</NOME>
        <DTNASCIMENTO>1990-01-15</DTNASCIMENTO>
        <SEXO>M</SEXO>
        <NACIONALIDADE>10</NACIONALIDADE>
        <CPF>12345678901</CPF>
        <EMAIL>fulano@email.com</EMAIL>
        <!-- demais campos -->
    </PPessoa>
    <VPCompl><CODPESSOA>0</CODPESSOA></VPCompl>
</RhuPessoa>
```
Retorno do RM = `CODPESSOA` (numérico) ou mensagem de validação (exposta em `retorno_rm`).

### Aluno (EduAlunoData / EduUsuarioFilialData / GlbUsuarioData)

| Rota | Body | Retorno |
|---|---|---|
| `POST /alunos` | `{ "CODPESSOA": 123, "CODCOLIGADA": 1, "CODTIPOCURSO": 2, "CODFILIAL": 1, "CPF": "...", "RNM": "" }` | 201 + `{ chave, autoLogin, nextUrl, etapas }` |
| `POST /alunos/cliente-fornecedor` | `{ "RA": "...", "CODCOLIGADA": 1, "CODTIPOCURSO": 2, "CODFILIAL": 1, "CODCOLCFO": 0, "CODCFO": "..." }` | 200 + `{ chave, etapas }` |
| `GET /alunos/{codcoligada}/{codpessoa}` | — | RA, CODUSUARIO, SENHAPADRAO, EXISTESUSUARIOFILIAL, DATAULTIMOACESSOVALIDO |

**`POST /alunos` agora é orquestrado com rastreamento de etapas** (como a inscrição):
`CLIENTE/FORNECEDOR` (valida o cliFor pelo CPF/RNM via `INT.EDUVEM.00009`) → `ALUNO` (EduAlunoData) → `USUÁRIO/FILIAL` (EduUsuarioFilialData) → `ACESSO` (GlbUsuarioData + SSO). Sucesso devolve `dados.etapas`; erro de RM lança `FluxoException` (422) com `etapa` + `etapas_concluidas`.

`POST /alunos/cliente-fornecedor` faz uma gravação **direta** no EduAlunoData com `CODCOLIGADA` (do aluno), `RA`, `CODCOLCFO` e `CODCFO` — não roda o resto do fluxo. **`CODTIPOCURSO` e `CODFILIAL` são obrigatórios**: o `EduAlunoData` exige o contexto educacional completo (`CODCOLIGADA;CODTIPOCURSO;CODFILIAL;CODSISTEMA=S;CODUSUARIO`).

Contexto do SaveRecord educacional:
```
CODCOLIGADA={n};CODTIPOCURSO={n};CODFILIAL={n};CODSISTEMA=S;CODUSUARIO=integra.eduvem
```

### Cliente/Fornecedor (FinCFODataBR)

| Rota | Body / Query | Retorno |
|---|---|---|
| `GET /clientes-fornecedores/busca?cpf=...` (ou `?rnm=...`) | — | CFO (CODCOLCFO, CODCFO...) ou 404. Reusa `INT.EDUVEM.00009` |
| `POST /clientes-fornecedores` | `NOME` (obrig.), `CGCCFO` (CPF/CNPJ), `RUA`, `NUMERO`, `BAIRRO`, `CIDADE`, `CODETD`, `CEP`, `TELEFONE`, `EMAIL`... | 201 + `{ "CHAVE": "0;{CODCFO}" }` |

Regras fixas na criação: **CODCOLIGADA do registro = 0** (CFO global, vai no XML), **CODCFO=0** (o RM gera o código), **PAGREC=3**, **PESSOAFISOUJUR** derivado do documento (11 díg.=`F`, 14=`J`). **Contexto do SaveRecord: `CODCOLIGADA=1;CODSISTEMA=F;CODUSUARIO=integra.eduvem`** (a coligada 0 não permite CFO global). CGCCFO/CEP/TELEFONE são normalizados p/ dígitos. Envia `<FCFO>` + `<FCFOCOMPL>` (chaves); não envia `<FCFOMX>`.

`POST /clientes-fornecedores` é **rastreado por etapas** e **idempotente**: `VALIDAÇÃO` → `CONSULTA` (se o documento já existir, devolve `JA_EXISTIA` sem duplicar) → `GRAVAÇÃO`. Aqui "documento" = o **CPF/CNPJ** (`CGCCFO`). Resposta: `{ chave, CODCOLCFO, CODCFO, jaExistia, etapas }` (200 se já existia, 201 se criou). `CODCOLCFO`/`CODCFO` já vêm separados (use-os no `/alunos/cliente-fornecedor`).

### Inscrição (fluxo completo orquestrado)

`POST /inscricoes` — executa: pessoa → aluno → usuário/filial → acesso/SSO → matrícula no curso → matrícula no período letivo (contrato) → enturmação → cupom/bolsa → lançamento financeiro. **Idempotente** (reenvio retoma de onde parou).

Body:
```json
{
  "OFERTA": "OF2026-001",
  "PLANOPAGAMENTO": "PP01",
  "CPF": "12345678901",          // OU "RNM": "A123456-7" p/ estrangeiro
  "NOME": "Fulano de Tal",
  "NASCIMENTO": "1990-01-15",
  "SEXO": "M",
  "EMAIL": "fulano@email.com",
  "TELEFONE": "11987654321",
  "CEP": "01310100",             // endereço BR (opcional p/ estrangeiro)
  "ESTADO": "SP",
  "CIDADE": "3550308",           // código da cidade (INT.EDUVEM.00010)
  "BAIRRO": "123",               // código do bairro (INT.EDUVEM.00020)
  "RUA": "Av. Paulista",
  "NUMERO": "1000",
  "COMPLEMENTO": "",
  "NATURALIDADE": "3550308",     // obrigatório p/ brasileiro
  "CUPOM": "PROMO10"             // opcional
}
```

Retorno:
```json
{
  "sucesso": true,
  "mensagem": "Inscrição efetuada com sucesso!",
  "dados": { "autoLogin": true, "nextUrl": "https://.../api/sso/{token}" }
}
```

### Matrícula (etapas granulares)

| Rota | Body | Efeito |
|---|---|---|
| `POST /matriculas/curso` | `{ "RA": "...", "OFERTA": "..." }` | SaveRecord `EduHabilitacaoAlunoData` (CODSTATUS 23) |
| `POST /matriculas/periodo-letivo` | `{ "RA", "OFERTA", "PLANOPAGAMENTO" }` | Processo `EduMatriculaProcData` (gera contrato) |
| `POST /matriculas/disciplinas` | `{ "RA": "...", "OFERTA": "..." }` | Processo `EduMatriculaProcData` (enturmação por disciplina) |

### Contrato (PDF)

`POST /contratos` — body: `NOME, CPF, ESTADO, CIDADE (código), BAIRRO (código), RUA, NUMERO, COMPLEMENTO, NACIONALIDADE, NASCIMENTO (Y-m-d)`.
Pipeline: `GenerateReport` (relatório **1664**, coligada 0) → `GetGeneratedReportSize` → `GetFileChunk`. Retorna `{ "CONTEUDO": <conteúdo do PDF como o RM devolve> }`.

### Financeiro — Baixa de lançamento

`POST /financeiro/baixas` — **baixa (quita) um lançamento financeiro** no RM (processo `FinLanBaixaProc`, via `wsProcess`/`ExecuteWithParams`). É a contrapartida da geração de lançamentos: pega uma parcela em aberto (`IDLAN`) e registra o recebimento numa conta/caixa. **Grava movimento real no RM.**

Body:
```json
{
  "IDLAN": "123456",              // obrigatório — id do lançamento a baixar
  "VALORBAIXA": "465.00",         // obrigatório — aceita "465,00" ou "465.00"
  "CODCXA": "1",                  // obrigatório — conta/caixa (ou env FIN_CODCXA_PADRAO)
  "TIPOFORMAPAGTO": "Dinheiro",   // obrigatório — Dinheiro|Cheque|Cartao|CartaoCredito|CartaoDebito|Transferencia|DebitoConta|Boleto|Pix|Outros
  "CODCOLIGADA": 1,               // opcional (default 1)
  "CODFILIAL": 1,                 // opcional (default 1)
  "DATABAIXA": "2026-07-13",      // opcional (default hoje, Y-m-d)
  "HISTORICOBAIXA": "Baixa via API", // opcional
  "TIPOBAIXA": "Simplificada",    // opcional — "Simplificada" (default) | "Completa" | "Parcial"
  "IDFORMAPAGTO": 1,              // opcional — id da Forma de Pagamento cadastrada no RM (default 1 = Dinheiro)
  "DRY_RUN": false                // opcional — true devolve o XML gerado SEM enviar ao RM (diagnóstico)
}
```

> ✅ **Validado em homologação (13/07/2026)** — baixa efetivada no RM pelo caminho TBC.

**Processo padrão: `FinTBCBaixaDataProcess`** — o caminho OFICIAL da TOTVS para baixa via WebService (TDN "Baixa Via Web Service"). Contrato pequeno (`FinTBCBaixaParamsProc`, template em `resources/fin/`): identidade em `Lancamentos>FinTBCBaixaLancamento` (CodColigada+IdLan) + `Pagamentos` (caixa, `IdFormaPagamento`, valor); o RM carrega o lançamento da base e contabiliza por Evento Contábil. **Pré-requisito TOTVS: base no Novo Modelo de Baixa.** Já o `FinLanBaixaData` é o processo da TELA: via WS as coleções chegam vazias e ele responde *"Os lançamentos devem ser informados"* — mantido apenas como fallback (`FIN_BAIXA_PROCESSO=FinLanBaixaData`), cujo XML (`Support/ProcessXml::baixaLancamento()`) é o **replay de uma baixa real aceita pelo RM** (export "Salvar parâmetros como XML" de uma execução bem-sucedida, guardado em `resources/fin/FinLanBaixaParamsProc.real.template.xml`), trocando por placeholder apenas os campos dinâmicos: `IDLAN` (43 pontos — o `FinLancamentoBaixaResult` tem membros duplicados por herança .NET e objetos aninhados que também carregam a identidade), valores (formatos 2 e 4 casas), `CODCXA`, datas, forma/tipo de baixa, histórico, usuário, coligada/filial/chapa (Context+PrimaryKeyList) e sessão (ExecutionId/Schedule). Boleto do lançamento capturado foi neutralizado (o RM resolve pelo `IDLAN`) e o `IdBaixa` da tela virou `-1` (nova baixa). Montagens "mínimas" do payload (à mão ou via template do GetSchema) resultam em *"Os lançamentos devem ser informados"* — não repita esse caminho. Esse mesmo erro também ocorre quando o `IDLAN` **não existe/não está em aberto na base que o `TOTVS_WS_URL` aponta** (produção × homolog) ou quando o usuário de serviço não tem permissão no Financeiro: a carga por `PrimaryKeyList` volta vazia. Use `DRY_RUN` para auditar o payload da versão implantada.

**Nome do processo / operação configuráveis (env):** o `ProcessServerName` e a operação SOAP são ajustáveis sem redeploy — o RM pode expor a baixa sob outro nome/operação conforme a versão. Se o RM devolver **`Classe não encontrada: <nome>`**, o nome está errado para a sua instância: ajuste `FIN_BAIXA_PROCESSO` (e, se preciso, `FIN_BAIXA_OPERACAO=ExecuteWithXMLParams`). Retornos com assinatura de erro do RM (`classe não encontrada`, `exception`, stack trace .NET etc.) agora resultam em **502**, não em falso `sucesso`.

| Env | Default | Uso |
|---|---|---|
| `FIN_BAIXA_PROCESSO` | `FinTBCBaixaDataProcess` | `ProcessServerName` do processo de baixa (**validado em homolog**) |
| `FIN_BAIXA_OPERACAO` | `ExecuteWithXMLParams` | operação SOAP (`ExecuteWithParams` ou `ExecuteWithXMLParams`) |
| `FIN_CODCXA_PADRAO` | — | conta/caixa default quando `CODCXA` não vem no corpo |

O **builder de XML acompanha o processo** escolhido (`match` em `BaixaService::baixar()`):

| `FIN_BAIXA_PROCESSO` | Builder | Status |
|---|---|---|
| `FinTBCBaixaDataProcess` (default) | `ProcessXml::baixaLancamentoTbc()` | ✅ **validado em homolog (13/07/2026)** |
| `FinLanBaixaTBCData` | `ProcessXml::baixaLancamentoTbcLan()` | ⚠️ **nunca validado contra o RM real** — implementado como alternativa durante a investigação; valide em homolog antes de usar |
| qualquer outro (ex.: `FinLanBaixaData`) | `ProcessXml::baixaLancamento()` (replay da tela) | ⚠️ falha via WS com *"Os lançamentos devem ser informados"* — mantido só como registro/fallback |

**Histórico (resumo da investigação, para não repetir):** `FinLanBaixaProc` não existe na instância (`Classe não encontrada`); `FinLanBaixaData` é o processo **da tela** — mesmo com payload byte a byte idêntico a um export aceito, via WS as coleções chegam vazias. O caminho suportado pela TOTVS para WS é o TBC. **Nunca** teste nomes de processo em produção: nome errado é inofensivo, mas o nome **certo executa uma baixa real** — valide em homologação.

Retorno (200): `{ IDLAN, CODCOLIGADA, VALORBAIXADO, DATABAIXA, CODCXA, FORMAPAGTO, TIPOBAIXA, retorno_rm, log_job }`. Erro do RM → **502** com `retorno_rm` (e o log do job, quando o RM devolve só o JobId e a sentença `INT.EDUVEM.00021` está cadastrada).

### Financeiro — Geração de lançamentos

`POST /financeiro/lancamentos` — **gera os lançamentos financeiros do contrato do aluno** (processo `EduGerarLancFromContratoSliceableData`). É a mesma etapa que a inscrição executa no final, agora **exposta como rota autônoma** (não roda o resto do fluxo). **Idempotente**: se os lançamentos já existem, não regera.

Body: `{ "RA": "000123", "OFERTA": "OF2026-001", "CODCONTRATO": "..." }` — **`CODCONTRATO` é opcional**: se enviado, é usado direto; se vazio, a API resolve pela matrícula no período letivo (`INT.EDUVEM.00014`).

Resolve internamente a oferta (`INT.EDUVEM.00006`) para obter coligada/filial/período-letivo; dispara o processo e confirma a criação com retentativas (o job roda assíncrono). Se `CODCONTRATO` não for enviado e não houver contrato localizável → **422**. Retorno (200): `{ gerados, ja_existiam, CODCONTRATO, RA, OFERTA }`.

### Consultas

| Rota | Sentença |
|---|---|
| `GET /ofertas/{codoferta}` | INT.EDUVEM.00006 |
| `GET /ofertas/{codoferta}/planos-pagamento` | INT.EDUVEM.00013 |
| `GET /enderecos/estados` | INT.EDUVEM.00002 |
| `GET /enderecos/estados/{uf}/cidades` | INT.EDUVEM.00003 |
| `GET /enderecos/cidades/{codcidade}/bairros` | INT.EDUVEM.00004 |
| `GET /enderecos/cep/{cep}` | INT.EDUVEM.00005 |
| `GET /cupons/{codoferta}/{codplano}/{cupom}` | INT.EDUVEM.00016 |

### Cupom — Aplicação (bolsa)

`POST /cupons/aplicar` — **aplica o cupom (bolsa) ao contrato do aluno** (`EduBolsaAlunoData`). Mesma etapa da inscrição, agora **autônoma** e **idempotente** (se já aplicado, não duplica).

Body: `{ "RA": "000123", "OFERTA": "OF2026-001", "PLANOPAGAMENTO": "PP01", "CUPOM": "PROMO10", "CODCONTRATO": "..." }` — **`CODCONTRATO` é opcional** (se vazio, resolve pela matrícula no PL, `00014`).

Valida o cupom (`INT.EDUVEM.00016`) e resolve a oferta (`00006`) pelo `OFERTA`. Cupom inválido, oferta inexistente ou contrato não informado/não localizado → **422**. Retorno (200): `{ aplicada, ja_existia, CODBOLSA, CODCONTRATO, CUPOM }`.

### SSO (exceção HTML)

`GET /sso/{token}` — decripta o token (AES-GCM) e devolve página mínima com form auto-submit para o Portal Educacional TOTVS. É a única rota que retorna HTML, por exigência do mecanismo de auto-login do portal (POST de formulário no navegador do aluno).

---

## 3. Inventário RM

### DataServers (SaveRecord/ReadRecord)

| DataServer | Uso | Contexto |
|---|---|---|
| `RhuPessoaData` | Pessoa (criar/atualizar/ler) | vazio |
| `EduAlunoData` | Aluno | educacional completo |
| `EduUsuarioFilialData` | Vínculo usuário × filial | educacional completo |
| `GlbUsuarioData` | Reativação de usuário p/ SSO | vazio |
| `EduHabilitacaoAlunoData` | Pré-matrícula no curso | educacional completo |
| `EduBolsaAlunoData` | Bolsa/cupom | educacional completo |
| `RMSPRJ5495296Server` | Log de integração (ZMDLOGINTEGEDUVEM) | vazio |

### Processos (ExecuteWithXMLParams)

| Processo | Ação |
|---|---|
| `EduMatriculaProcData` | "Matricular aluno" (PL + contrato) e "Matricular aluno nas disciplinas" |
| `EduGerarLancFromContratoSliceableData` | "Gerar lançamento" financeiro |

Os XMLs ficam em `src/Support/ProcessXml.php`. São estruturalmente idênticos aos capturados do RM (compatibilidade de desserialização DataContract), com valores de sessão neutralizados: `ExecutionId` = GUID novo por chamada, `ScheduleDateTime` = agora, `HostName`/`Ip`/`NetworkUser` neutros, competência = mês corrente. Mantidos de propósito (comportamento do legado): `$CODCOLIGADA=1` e `$CODTIPOCURSO=2` no contexto dos processos, `CodStatus=23`, `CodTipoMat=7`.

### Sentenças SQL (wsConsultaSQL — codColigada `0`, codSistema `G`)

Centralizadas em `ConsultaService` (constantes `SQL_*`): 00001 status, 00002 estados, 00003 cidades, 00004 bairros, 00005 CEP, 00006 oferta, 00007 pessoa por CPF/RNM, 00008 aluno, 00009 cliente/fornecedor, 00010 cidade por código, 00011 matrícula no curso, 00013 planos de pagamento, 00014 matrícula no PL (retorna CODCONTRATO), 00016 cupom, 00017 bolsa aplicada, 00018 lançamentos, 00019 turmas/disciplinas, 00020 bairro por código.

### Operações SOAP disponíveis no RMSoapClient

`saveRecord`, `readRecord`, `readView`, `deleteRecord`, `getSchema`, `autenticaAcesso`, `realizarConsultaSQL`, `executeWithXmlParams`, `generateReport`, `getGeneratedReportSize`, `getFileChunk`.

---

## 4. Diferenças em relação ao legado

1. **Bug corrigido:** a verificação pós-matrícula no período letivo validava a variável errada (matrícula no curso); agora valida a matrícula no PL de fato (`MatriculaService::matricularNoPeriodoLetivo`).
2. **Erros transparentes:** toda falha do RM expõe `operacao`, `dataserver`, `retorno_rm` (e XMLs em debug). Nada de "erro interno" genérico.
3. **Status HTTP corretos:** 422 (validação/fluxo), 502 (RM), 404, 500 — o legado devolvia 500 para tudo.
4. **Log tolerante a falha:** gravação de log no RM nunca derruba o fluxo (fallback para error_log).
5. **Removidos:** frontend completo (www), integração Eduvem (callback), `session_start`, dependências guzzle/phpdotenv, código morto (ReadView/GetSchema agora têm endpoints), bug do `InvalidArgumentException` sem import no Format. *(Obs.: foi reintroduzido um leitor de `.env` mínimo e sem dependência — `src/Support/Env.php` — para o deploy em container; ver `docs/DEPLOY-EASYPANEL.md`.)*
6. **Escape XML:** valores de pessoa/relatório agora passam por `htmlspecialchars` (o legado interpolava cru).
7. **Eduzz:** não existia nenhuma integração no código (apenas no briefing).

## 5. Pendências recomendadas

- Rodar `composer dump-autoload` no ambiente (o autoload do vendor foi ajustado manualmente para `FMP\RMApi\` → `src/`).
- **Autenticação da API**: implementada via `API_KEY` (header `X-API-Key`) — ver `docs/DEPLOY-EASYPANEL.md`. Mantenha a chave definida em produção.
- **Rotacionar as credenciais TOTVS** e a `APP_CRYPTO_KEY` periodicamente.

## 6. Log de jobs de processo (INT.EDUVEM.00021)

Quando um processo (matrícula no PL, enturmação, gerar lançamento) falha, o RM frequentemente devolve apenas o **JobId**. O erro real (detalhes, erros, parâmetros, resumo) fica no log do job, no Monitor de Jobs.

A API tenta automaticamente buscar esse log pela sentença `INT.EDUVEM.00021` (parâmetro `JOBID_N`) e anexá-lo ao `retorno_rm` do erro. Para habilitar, cadastre a sentença no RM (Consultas SQL) retornando o texto do log do job. Modelo (confirme os nomes das tabelas do monitor de jobs na sua base com o DBA — variam por versão; procure por `SELECT name FROM sys.tables WHERE name LIKE '%JOB%'`):

```sql
/* INT.EDUVEM.00021 — texto do log de execução do job (:JOBID_N) */
SELECT L.DESCRICAO AS TEXTO
  FROM GJOBXLOG L (NOLOCK)
 WHERE L.IDJOB = :JOBID_N
 ORDER BY L.IDSEQ
```

Enquanto a sentença não existir, o erro orienta o cadastro e a consulta manual no Monitor de Jobs.

## 7. Rastreamento de etapas (/inscricoes e /alunos)

`POST /inscricoes` e `POST /alunos` devolvem a lista de etapas executadas em `dados.etapas` (sucesso) ou `etapas_concluidas` (erro), com status `OK`, `JA_EXISTIA`, `ATUALIZADA/ATUALIZADO`, `ENCONTRADO`/`NAO_ENCONTRADO`. Em erro de RM, a resposta é 422 com `etapa` (onde parou) + `etapas_concluidas` + `retorno_rm`.