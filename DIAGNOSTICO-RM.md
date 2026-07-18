# Diagnóstico Completo — Checkout/Inscrições FMP → API TOTVS RM

> Etapa 1 (somente análise). Nenhum arquivo foi alterado.
> Base analisada: 100% do código PHP (`www/api`, ~5.400 linhas) + frontend (`www/`) + infra (Docker).

---

## 1. Estrutura Geral

```
Checkout/
├── Dockerfile / docker-compose.yml / up.sh    → infra (PHP 8.3 + Apache + ext soap, Docker Swarm)
└── www/
    ├── index.html, css/, js/, assets/         → FRONTEND (formulário de inscrição/checkout)
    └── api/
        ├── .env                               → credenciais TOTVS, Eduvem, chave crypto
        ├── public/index.php                   → bootstrap Slim 4 + PHP-DI + CORS + session_start()
        └── src/
            ├── Configs/    (settings, dependencies, routes)
            ├── Connections/RM/                → camada SOAP (a joia do projeto)
            │   ├── RMConnection.php           → fachada via TRAITS
            │   ├── SoapConnection.php         → wrapper do SoapClient nativo
            │   ├── Enums/RMWSType.php         → 15 endpoints WSDL do RM
            │   ├── Methods/  (10 traits)      → 1 trait por operação SOAP
            │   ├── Models/RMCredential.php
            │   ├── Exceptions/ (11 classes)
            │   └── Utils/SchemaParser.php     → parser de XSD do GetSchema
            ├── Controllers/ (7)               → HTTP + regra de negócio + SOAP misturados
            ├── Exceptions/  (2)               → SubscriptionException, ValidationException
            └── Utils/       (7)               → Crypto, Eduvem, Format, Log, Request, Response, Validation
```

**Stack:** Slim 4, PHP-DI 7, slim/psr7, PHP 8.1+ (enums). Não há camada Service — toda regra de negócio vive nos Controllers.

**Responsabilidade das camadas hoje:**

| Camada | Responsabilidade real |
|---|---|
| `public/index.php` | Bootstrap, DI, CORS, base path |
| `Configs/` | Settings (.env via `parse_ini_file`), container, rotas |
| `Connections/RM/` | Conexão SOAP, 1 trait por operação, cache de conexões por endpoint |
| `Controllers/` | HTTP **+ validação + regra de negócio + montagem de XML + orquestração SOAP** (tudo junto) |
| `Utils/` | Validação, crypto SSO, logger (grava no próprio RM), cliente HTTP Eduvem, formatação de resposta |

---

## 2. Inventário RM (seção crítica)

### 2.1 Endpoints SOAP (WSDL) — `RMWSType`

| Tipo | Sufixo WSDL | Usado? |
|---|---|---|
| DataServer | `/wsDataServer/MEX?wsdl` | ✅ SaveRecord, ReadRecord, AutenticaAcesso |
| SQLConsult | `/wsConsultaSQL/MEX?wsdl` | ✅ RealizarConsultaSQL |
| Process | `/wsProcess/MEX?wsdl` | ✅ ExecuteWithXMLParams |
| Report | `/wsReport/MEX?wsdl` | ✅ GenerateReport, GetGeneratedReportSize, GetFileChunk |
| Educational, Projects, CRM, Concept, Movement, Finance, Health, Incorporation, VisualFormula, TMessage, Message | — | ❌ nunca usados (11 de 15) |

### 2.2 Operações SOAP implementadas

| Operação | Trait | Usada por | Status |
|---|---|---|---|
| `RealizarConsultaSQL` | Methods/RealizarConsultaSQL | todos os controllers | ✅ núcleo de leitura |
| `SaveRecord` | Methods/SaveRecord | SubscriptionController, LogUtils | ✅ núcleo de escrita |
| `ReadRecord` | Methods/ReadRecord | SubscriptionController::getExistentPerson | ✅ |
| `ExecuteWithXMLParams` | Methods/ExecuteWithXMLParams | SubscriptionController (matrícula, lançamento) | ✅ |
| `AutenticaAcesso` | Methods/AutenticaAcesso | SubscriptionController (testa senha padrão) | ✅ |
| `GenerateReport` + `GetGeneratedReportSize` + `GetFileChunk` | Methods/* | ContractController (PDF do contrato, relatório id **1664**) | ✅ |
| `ReadView` | Methods/ReadView | **ninguém** | ⚠️ código morto (mas útil para a futura API) |
| `getSchema` + `SchemaParser` | Methods/GetSchema | **ninguém** | ⚠️ código morto (mas útil para a futura API) |
| `DeleteRecord` | — | — | ❌ não existe no projeto |

### 2.3 DataServers utilizados

| DataServer | Operação | Onde | Finalidade |
|---|---|---|---|
| `RhuPessoaData` | SaveRecord, ReadRecord | SubscriptionController | Upsert/consulta de Pessoa (`<RhuPessoa><PPessoa>…`) |
| `EduAlunoData` | SaveRecord | SubscriptionController | Upsert de Aluno (`<EduAluno><SAluno>…`) |
| `EduUsuarioFilialData` | SaveRecord | SubscriptionController | Vínculo usuário × filial (`<EduUsuarioFilial>…`) |
| `GlbUsuarioData` | SaveRecord | SubscriptionController | Reativa usuário + senha padrão p/ SSO (`<GlbUsuario><GUSUARIO>…`) |
| `EduHabilitacaoAlunoData` | SaveRecord | SubscriptionController | Pré-matrícula no curso, `CODSTATUS=23` |
| `EduBolsaAlunoData` | SaveRecord | SubscriptionController | Aplica bolsa/cupom (`<EduBolsaAluno><SBolsaAluno>…`) |
| `RMSPRJ5495296Server` | SaveRecord | LogUtils | Log de integração (tabela custom `ZMDLOGINTEGEDUVEM`) |
| `EduMatriculaProcData` | ExecuteWithXMLParams | SubscriptionController | Processo "Matricular aluno" (PL) e "Matricular aluno nas disciplinas" |
| `EduGerarLancFromContratoSliceableData` | ExecuteWithXMLParams | SubscriptionController | Processo "Gerar lançamento" financeiro |

### 2.4 Consultas SQL cadastradas no RM (`RealizarConsultaSQL`, sempre com `codColigada='0'`, `codSistema='G'`)

| Sentença | Parâmetros | Finalidade |
|---|---|---|
| INT.EDUVEM.00001 | — | Health check / status |
| INT.EDUVEM.00002 | — | Estados (UF) |
| INT.EDUVEM.00003 | CODESTADO_S | Cidades por UF |
| INT.EDUVEM.00004 | CODCIDADE_S | Bairros por cidade |
| INT.EDUVEM.00005 | CEP_S | Endereço por CEP |
| INT.EDUVEM.00006 | CODOFERTA_S | Detalhes da oferta (coligada, curso, habilitação, grade, filial, turno, turma, perlet, tipo curso) |
| INT.EDUVEM.00007 | CPF_S, RNM_S | Pessoa por CPF/RNM → CODIGO |
| INT.EDUVEM.00008 | CODPESSOA_N, CODCOLIGADA_N | Aluno (RA, CODUSUARIO, SENHAPADRAO, EXISTESUSUARIOFILIAL, DATAULTIMOACESSOVALIDO) |
| INT.EDUVEM.00009 | CPF_S, RNM_S | Cliente/Fornecedor (CODCOLCFO, CODCFO) |
| INT.EDUVEM.00010 | CODCIDADE_S | Cidade (NOME, CODMUNICIPIO, ESTADO) — residência e naturalidade |
| INT.EDUVEM.00011 | CODOFERTA_S, RA_S | Matrícula no curso existente? |
| INT.EDUVEM.00013 | CODOFERTA_S | Planos de pagamento da oferta |
| INT.EDUVEM.00014 | CODOFERTA_S, RA_S | Matrícula no período letivo (retorna CODCONTRATO) |
| INT.EDUVEM.00016 | CODOFERTA_S, CODPLANOPGTO_S, CUPOM_S | Cupom → bolsa (CODBOLSA, CODSERVICO, VALOR, TIPODESCONTO, PARCINICIAL/FINAL) |
| INT.EDUVEM.00017 | CODCOLIGADA_N, IDPERLET_N, CODCONTRATO_S, RA_S, CODBOLSA_N | Bolsa já aplicada? |
| INT.EDUVEM.00018 | CODCOLIGADA_N, IDPERLET_N, CODCONTRATO_S, RA_S | Lançamentos existentes? |
| INT.EDUVEM.00019 | CODOFERTA_S, IDPERLET_N, CODTURMA_S | Turmas/disciplinas para enturmação |
| INT.EDUVEM.00020 | CODBAIRRO_S | Bairro (NOME) |

(00012 e 00015 não aparecem no código.)

### 2.5 Contextos utilizados

**Contexto de SaveRecord** (Edu*): `CODCOLIGADA={dinâmico}; CODTIPOCURSO={dinâmico}; CODFILIAL={dinâmico}; CODSISTEMA=S; CODUSUARIO=integra.eduvem`
**SaveRecord sem contexto:** RhuPessoaData, GlbUsuarioData, RMSPRJ5495296Server (contexto vazio).
**Contexto dos processos (XML `_params`):** `$CODCOLIGADA, $CODFILIAL, $CODSISTEMA=S, $CODUSUARIO=integra.eduvem, $CODTIPOCURSO, $EXERCICIOFISCAL=1, $CODLOCPRT=-1, $EDUTIPOUSR=-1, $CODUNIDADEBIB=-1, $RHTIPOUSR=-1, $CODIGOEXTERNO=-1, $IDPRJ=-1, $CHAPAFUNCIONARIO=-1`
**Valores fixos relevantes:** usuário de serviço `integra.eduvem`; status pré-matrícula `CODSTATUS=23`; `CODTIPOMAT=7`; nacionalidade `10` (BR) / `50` (estrangeiro); `IDPAIS=1` (Brasil) / `27` (Outro); relatório de contrato id `1664`; portal TOTVS hardcoded `fundacaoescola114384.rm.cloudtotvs.com.br`.

---

## 3. Fluxos de Negócio

### 3.1 Fluxo principal — `POST /subscription` (SubscriptionController::submitSubscription, 2.300 linhas)

```
1. Log "INSCRIÇÃO RECEBIDA"                       → SaveRecord RMSPRJ5495296Server
2. Validação de entrada (CPF ou RNM, nome, nascimento, sexo, email, telefone…)  → ValidationUtils
3. Busca oferta                                   → SQL 00006 (falha = aborta)
4. UPSERT PESSOA
   a. Pessoa existe?                              → SQL 00007 (CODIGO ou 0)
   b. Endereço BR? valida cidade/bairro           → SQL 00010 / 00020
   c. Naturalidade (se BR)                        → SQL 00010
   d. SaveRecord RhuPessoaData (XML PPessoa+VPCompl) → retorna CODPESSOA
5. UPSERT ALUNO
   a. Aluno existe?                               → SQL 00008 (RA ou 0)
   b. Vincula CliFor se existir                   → SQL 00009
   c. SaveRecord EduAlunoData (contexto completo) → retorna "COLIGADA;RA"
   d. Relê aluno                                  → SQL 00008 (CODUSUARIO, SENHAPADRAO…)
   e. Se EXISTESUSUARIOFILIAL=N → SaveRecord EduUsuarioFilialData
   f. AutenticaAcesso(CODUSUARIO, SENHAPADRAO)    → tem senha padrão?
   g. Se nunca acessou OU senha padrão:
      SaveRecord GlbUsuarioData (STATUS=1, OBRIGAALTERARSENHA=F)
      + gera token SSO (CryptoUtils AES-GCM)       → nextUrl /sso/{token}
      senão → nextUrl = portal TOTVS (login manual)
6. MATRÍCULA NO CURSO (se não existe — SQL 00011)
   → SaveRecord EduHabilitacaoAlunoData (CODSTATUS=23) + reconsulta 00011
7. MATRÍCULA NO PERÍODO LETIVO (se não existe — SQL 00014)
   → ExecuteWithXMLParams EduMatriculaProcData ("Matricular aluno", CadastrarContrato=true)
   → reconsulta 00014 → obtém CODCONTRATO
8. ENTURMAÇÃO (para cada turma/disciplina — SQL 00019)
   → ExecuteWithXMLParams EduMatriculaProcData ("Matricular aluno nas disciplinas")
   → trata erros por substring ("débitos anteriores", "já está cursando")
9. CUPOM (opcional)
   → SQL 00016 valida; SQL 00017 já aplicado?; SaveRecord EduBolsaAlunoData
10. LANÇAMENTO FINANCEIRO (se não existe — SQL 00018)
   → ExecuteWithXMLParams EduGerarLancFromContratoSliceableData ("Gerar lançamento")
11. Log sucesso → retorna {autoLogin, nextUrl}
```

Cada etapa grava log no RM. Erros → `SubscriptionException(entity, userFeedback, logMessage, payload)` → log + JSON.

### 3.2 Demais fluxos

| Rota | Controller | Fluxo |
|---|---|---|
| `POST /subscription/existentPerson` | Subscription | SQL 00007 → ReadRecord RhuPessoaData → devolve dados da pessoa |
| `POST /subscription/callback` | Subscription | **Eduvem**: getUser → createUser → enrolUser (REST, Bearer token) |
| `GET /address/*` | Address | SQLs 00002/00003/00004/00005 (consulta pura) |
| `POST /contract` | Contract | Resolve cidade/bairro (00010/00020) → monta XML de parâmetros → GenerateReport(1664) → GetGeneratedReportSize → GetFileChunk → PDF base64 |
| `GET /cupom/{...}` | Cupom | SQL 00016 (consulta pura) |
| `GET /offer/{...}` | Offer | SQLs 00006/00013 (consulta pura) |
| `GET /sso/{token}` | SSO | Decripta token → **emite página HTML** com form auto-submit para o portal TOTVS (`echo` + `die()`) |
| `GET /status` | Status | SQL 00001 (health check) |

**Escrevem no RM:** submitSubscription (7 SaveRecord + 3 processos) e LogUtils.
**Só consultam:** Address, Cupom, Offer, Status, existentPerson, Contract (gera relatório).

---

## 4. Integrações Externas

| Integração | Tipo | Uso |
|---|---|---|
| **TOTVS RM** | SOAP (4 endpoints) | Núcleo de tudo |
| **Eduvem** | REST (`fmp.eduvem.com/api/integrations`) | callback pós-checkout: cria usuário e matricula no AVA. ⚠️ URL hardcoded no código, ignora o `EDUVEM_API_URL` do .env |
| **Eduzz** | — | **Não existe nenhuma referência no código** (citada no briefing, mas ausente) |
| Portal TOTVS Cloud | HTTP form post | SSO auto-login (URL hardcoded) |

---

## 5. Mapeamento Técnico (arquivo → responsabilidade)

| Arquivo | Classe | Responsabilidade | RM | Observações |
|---|---|---|---|---|
| Controllers/SubscriptionController.php | SubscriptionController | Fluxo completo de inscrição (2.470 linhas) | 13 SQLs, 6 DataServers, 2 processos, AutenticaAcesso | God class; XMLs gigantes inline |
| Controllers/AddressController.php | AddressController | Consultas de endereço | 4 SQLs | OK, mas erros engolidos |
| Controllers/ContractController.php | ContractController | Gera PDF de contrato | GenerateReport 1664 | XML de relatório inline |
| Controllers/CupomController.php | CupomController | Consulta cupom | SQL 00016 | duplica lógica do Subscription |
| Controllers/OfferController.php | OfferController | Oferta + planos | SQLs 00006/00013 | método vazio `getOfferSubscriptionUrl` |
| Controllers/SSOController.php | SSOController | Auto-login portal | — | HTML inline, `echo`/`die()` |
| Controllers/StatusController.php | StatusController | Health check | SQL 00001 | OK |
| Connections/RM/* | RMConnection + 10 traits | Camada SOAP | — | Base sólida; ver problemas §7 |
| Utils/LogUtils.php | LogUtils | Log no RM | SaveRecord RMSPRJ5495296Server | log síncrono via SOAP a cada passo |
| Utils/ValidationUtils.php | ValidationUtils | Validações BR (CPF, RNM, CEP, fone, nome, datas) | — | valiosa, manter |
| Utils/CryptoUtils.php | CryptoUtils | AES-GCM p/ token SSO | — | só serve ao SSO |
| Utils/EduvemUtils.php | EduvemUtils | REST Eduvem (curl manual) | — | URLs hardcoded |
| Utils/ResponseUtils.php | ResponseUtils | Envelope JSON | — | ignora Response do Slim; erro de negócio = HTTP 500 |
| Utils/RequestUtils.php | RequestUtils | Base URL + getParameter | — | `getParameter` sem uso |
| Utils/FormatUtils.php | FormatUtils | Máscara CPF | — | **bug**: `InvalidArgumentException` sem `use` (fatal se CPF inválido) |

---

## 6. Código Morto / Inutilizado

- `RMWSType`: 11 de 15 endpoints nunca usados (manter o enum, é barato e útil).
- `Methods/ReadView.php` e `Methods/GetSchema.php` + `SchemaParser`: sem chamadas — **mas são exatamente o que a futura API vai querer; classificar como MANTER**.
- `GetSchema.php`: `die()` + `return` inacessíveis após o `return` do parser; métodos `parseXsdString`/`parseComplexType` duplicam o SchemaParser.
- `OfferController::getOfferSubscriptionUrl()`: método vazio.
- `RequestUtils::getParameter()`: sem uso.
- Imports de `GetReportInfoException` (classe inexistente) em AutenticaAcesso, ExecuteWithXMLParams e GenerateReport.
- Bloco comentado de consulta CEP (00005) dentro do submitSubscription.
- `composer.json`: `guzzlehttp/guzzle` e `vlucas/phpdotenv` declarados e **nunca usados** (curl manual e `parse_ini_file`).
- `session_start()` no index.php: nada usa sessão.
- Frontend inteiro (`www/index.html`, js, css, assets) — vivo hoje, mas REMOVER no novo escopo.

---

## 7. Problemas Arquiteturais

**Estruturais**
1. **Não existe camada Service.** Controllers fazem HTTP + validação + negócio + XML + SOAP. SubscriptionController é uma god class de 2.470 linhas com um método de ~2.300.
2. **XMLs de processo capturados de sessões reais** colados inline: contêm `HostName=malia-notebook`, `Ip=10.0.1.6`, `JobID=900472`, `ExecutionId` fixo, `NetworkUser=henri`, datas de 2025. Funciona, mas é frágil e irreproduzível — precisa virar template parametrizado limpo.
3. **Duplicação**: `buildContext()` copiado em 5 traits (`key=value;` join); validação de cupom duplicada (Cupom × Subscription); resolução cidade/bairro duplicada (Contract × Subscription); parser XSD em dobro (GetSchema × SchemaParser).
4. **Bug real (linha ~1460)**: após matricular no período letivo, o código reconsulta `00014` mas valida `count($existentCourseEnrollment)` (variável errada — deveria ser `$existentLetivePeriodEnrollment`). A falha de matrícula no PL passa despercebida e estoura depois com erro obscuro em `[0]`.
5. **Bug**: `FormatUtils` lança `InvalidArgumentException` sem importar → fatal error mascarado.
6. **ReadView chama `$this->buildReadRecordContext`** (método de outro trait) — funciona só porque tudo é colado na mesma classe; acoplamento invisível entre traits.

**Tratamento de erros (seu ponto prioritário)**
7. Todos os traits fazem `catch (\Throwable $e) → throw new XException($e->getMessage())` — **perdem o SoapFault completo** (detail, faultcode), o XML enviado, o DataServer e o contexto. Exatamente o oposto da política de transparência que você quer.
8. `SoapConnection` cria o client com `trace => false` → impossível capturar `__getLastRequest()/__getLastResponse()` para o modo debug desejado.
9. Erros de processo detectados por substring (`str_contains($result, 'error')`, `'Existem débitos anteriores'`) — frágil.
10. `ResponseUtils::withData` força HTTP 500 para qualquer `sucesso=false` (até "cupom não encontrado") e ignora o objeto Response do Slim.
11. Vários controllers engolem a exceção e devolvem mensagem genérica ("Houve um erro ao gerar o contrato.") sem o retorno do RM.

**Segurança/operacional**
12. `.env` com credenciais reais do TOTVS versionado na pasta.
13. `POST /subscription/existentPerson` devolve o cadastro completo da pessoa (endereço, telefone, email) para quem souber um CPF — sem autenticação. A API nova precisa de auth.
14. SSO embute usuário/senha em HTML auto-submit; token AES sem expiração.
15. CORS `*` global; `Slim displayErrorDetails` via .env.
16. Log síncrono no RM a cada passo: cada inscrição gera ~8 SaveRecords extras; se o log falhar, a inscrição inteira falha.

---

## 8. Classificação: MANTER / REFATORAR / REMOVER

### MANTER (núcleo da futura API)
| Item | Justificativa |
|---|---|
| `Connections/RM/*` (SoapConnection, RMConnection, RMWSType, RMCredential, traits, SchemaParser) | É o cliente SOAP funcional e validado. Vira o `RMSoapClient` + `RMService` |
| Todo o conhecimento de DataServers, XMLs, sentenças SQL e contextos (§2) | Ativo mais valioso do projeto — meses de engenharia reversa do RM |
| `ValidationUtils` | Validações BR completas e testadas |
| `LogUtils` (conceito) | Observabilidade no RM; refatorar para assíncrono/tolerante a falha |
| `CryptoUtils` | Se SSO continuar existindo como endpoint da API |
| Dockerfile / docker-compose | Infra adequada (php:8.3-apache + soap) |

### REFATORAR
| Item | Para |
|---|---|
| SubscriptionController | Quebrar em `PessoaService`, `AlunoService`, `MatriculaService`, `BolsaService`, `LancamentoService` + controllers finos |
| XMLs inline (pessoa, aluno, processos) | Templates/Builders parametrizados, sem lixo de sessão capturada (JobID, HostName, IP…) |
| Traits Methods/* | Métodos de um `RMSoapClient` único, com `buildContext()` centralizado, `trace=true` e captura de request/response |
| Exceptions RM (11 classes) | Uma `RMException` rica: dataserver, operação, contexto, XML enviado, XML retornado, SoapFault completo |
| ResponseUtils | Envelope JSON com status HTTP correto + `retorno_rm` + modo debug |
| ContractController, Address, Cupom, Offer, Status | Mover SOAP/SQL para services; controllers só HTTP |
| EduvemUtils | Usar Guzzle (já no composer) + URL do .env — ou remover se Eduvem sair do escopo |
| composer.json | Remover guzzle OU dotenv conforme decisão; adicionar autoload novo namespace |

### REMOVER
| Item | Justificativa |
|---|---|
| `www/index.html`, `www/js/*`, `www/css/*`, `www/assets/*`, favicon, robots.txt | Frontend do checkout — fora do novo escopo |
| HTML inline do SSOController | Renderização de tela dentro da API (se SSO ficar, devolver JSON/redirect) |
| `session_start()`, CORS amplo no index.php | Sem uso / reavaliar |
| `getOfferSubscriptionUrl`, `RequestUtils::getParameter`, código morto do GetSchema, bloco comentado do CEP, imports de `GetReportInfoException` | Código morto |
| Dependências não usadas do composer | guzzle e phpdotenv hoje são peso morto |
| `.env` do repositório | Substituir por `.env.example`; rotacionar credenciais expostas |

---

## 9. Plano de Refatoração Recomendado (para aprovação)

**Arquitetura alvo** (conforme seu briefing):

```
project/
├── config/rm.php                  ← URL, credenciais, contextos padrão (CODSISTEMA=S, CODUSUARIO…)
├── public/index.php
├── src/
│   ├── Clients/RMSoapClient.php   ← SoapClient + auth + trace + readRecord/saveRecord/readView/
│   │                                getSchema/executeProcess/realizarConsultaSQL/generateReport
│   ├── Services/
│   │   ├── RMService.php          ← getSchema, testConnection, readRecord, saveRecord genéricos
│   │   ├── PessoaService.php      ← criarPessoa, buscarPessoa, atualizarPessoa (RhuPessoaData)
│   │   ├── AlunoService.php       ← EduAlunoData, EduUsuarioFilialData, GlbUsuarioData
│   │   ├── MatriculaService.php   ← EduHabilitacaoAlunoData + processos EduMatriculaProcData
│   │   ├── BolsaService.php       ← EduBolsaAlunoData + cupom
│   │   ├── LancamentoService.php  ← EduGerarLancFromContratoSliceableData
│   │   ├── ContratoService.php    ← GenerateReport 1664 + chunks
│   │   ├── ConsultaService.php    ← sentenças INT.EDUVEM.* (endereço, oferta, status)
│   │   └── LogService.php         ← RMSPRJ5495296Server, tolerante a falha
│   ├── Controllers/               ← Pessoa, Aluno, Matricula, Contrato, Oferta, Endereco, Cupom, Status, RM (schema/debug)
│   ├── Exceptions/RMException.php ← dataserver + operação + contexto + XML enviado/recebido + retorno_rm
│   ├── Support/XmlBuilder/        ← templates limpos dos XMLs de DataServer e processos
│   └── Helpers/
└── composer.json
```

**Erros (política de transparência):** `trace=true` no SoapClient; toda exceção carrega `dataserver`, `operacao`, `contexto`, `xml_enviado`, `retorno_rm` (SoapFault->getMessage + detail, ou SaveRecordResult bruto); resposta de erro JSON expõe `retorno_rm`; modo debug (`APP_DEBUG` ou header `X-Debug`) adiciona XML request/response completos.

**Etapas de execução:**
1. Esqueleto novo (config, public, composer, container, error handler central, logger).
2. `RMSoapClient` + `RMException` + modo debug (fundação de observabilidade).
3. `RMService` + rotas utilitárias (`GET /rm/status`, `GET /rm/schema/{dataserver}`, `POST /rm/sql/{sentenca}`).
4. Migrar consultas puras (endereço, oferta, cupom, status).
5. Migrar Pessoa (criar/buscar/atualizar) — XML `RhuPessoa` limpo.
6. Migrar Aluno + usuário/filial + acesso.
7. Migrar Matrícula (curso, PL, enturmação) — processos com XML template parametrizado e correção do bug §7.4.
8. Migrar Bolsa/Cupom e Lançamento.
9. Migrar Contrato (relatório 1664).
10. Decidir/migrar SSO e callback Eduvem (manter, isolar ou remover).
11. Remover frontend e código morto; `.env.example`; documentação final (rotas, payloads, retornos, DataServers, XMLs de exemplo).

**Perguntas antes de eu começar a refatoração:**
1. O endpoint orquestrador `POST /subscription` (fluxo completo) deve continuar existindo na nova API, além dos endpoints granulares (`/pessoas`, `/alunos`, `/matriculas`)? Recomendo manter ambos.
2. SSO e callback Eduvem permanecem no escopo ou saem?
3. A nova API terá autenticação (ex.: API key)? Recomendo fortemente, dado o ponto §7.13.
4. Posso renomear o namespace `FMP\Inscricoes` → `FMP\RMApi` (ou similar)?
