# cURLs de todos os endpoints — FMP RM-API

> **URL base** (servida na raiz, sem `/api`) e **chave da API**:
>
> ```bash
> export BASE_URL="https://fmp-api-totvs.3wmyqq.easypanel.host"
> export API_KEY="SUA_CHAVE_AQUI"
> ```
>
> **Autenticação:** quando a env `API_KEY` está definida no servidor, todo request precisa do header `X-API-Key: $API_KEY` (ou `Authorization: Bearer $API_KEY`). Isentos: `GET /status` e `GET /sso/{token}`.
>
> **Verbos:** buscas/consultas usam **GET**; criação/alteração usam **POST**. Os parâmetros de busca (`cpf`/`rnm`) são aceitos em qualquer caixa.
>
> **Dois formatos de corpo (POST):** a API aceita os dois:
> - **JSON** (`Content-Type: application/json`) → no n8n: *Body Content Type = JSON*.
> - **Campos / form-urlencoded** (`--data-urlencode`) → no n8n importa como **"Using Fields Below"**.
>
> Corpos **aninhados** (ex.: `/rm/sql`, `/rm/read`, `/rm/save`) → use **JSON**.
>
> **Página interativa:** `/docs.html`. **Coleção:** `docs/postman_collection.json`.


## Sistema

### `GET /status`

Health check do RM (INT.EDUVEM.00001). Isento de API key.

```bash
curl -X GET "$BASE_URL/status" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json"
```


## RM genérico (diagnóstico)

### `GET /rm/test`

Valida conectividade e credenciais SOAP.

```bash
curl -X GET "$BASE_URL/rm/test" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json"
```

### `GET /rm/schema/RhuPessoaData`

Schema parseado. Acrescente ?xml=1 para o XSD bruto (alias antigo: ?raw=1).

```bash
curl -X GET "$BASE_URL/rm/schema/RhuPessoaData" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json"
```

### `POST /rm/sql/INT.EDUVEM.00007`

Executa uma sentença SQL cadastrada. (Leitura, mas usa corpo com parâmetros → mantém POST.)

**JSON** (corpo aninhado — use este formato)

```bash
curl -X POST "$BASE_URL/rm/sql/INT.EDUVEM.00007" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
  "parametros": {
    "CPF_S": "12345678901",
    "RNM_S": "0"
  },
  "codcoligada": "0",
  "codsistema": "G"
}'
```

### `POST /rm/read/RhuPessoaData`

ReadRecord pela chave primária. (Corpo aninhado → POST.)

**JSON** (corpo aninhado — use este formato)

```bash
curl -X POST "$BASE_URL/rm/read/RhuPessoaData" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
  "chave": [
    "12345"
  ],
  "contexto": {}
}'
```

### `POST /rm/view/GlbColigadaData`

ReadView com filtro SQL. (Corpo aninhado → POST.)

**JSON** (corpo aninhado — use este formato)

```bash
curl -X POST "$BASE_URL/rm/view/GlbColigadaData" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
  "filtro": "CODCOLIGADA=1",
  "contexto": {}
}'
```

### `POST /rm/save/RhuPessoaData`

SaveRecord genérico (uso avançado).

**JSON** (corpo aninhado — use este formato)

```bash
curl -X POST "$BASE_URL/rm/save/RhuPessoaData" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
  "xml": "<RhuPessoa><PPessoa><CODIGO>0</CODIGO><NOME>Teste Da Silva</NOME><CPF>12345678901</CPF></PPessoa><VPCompl><CODPESSOA>0</CODPESSOA></VPCompl></RhuPessoa>",
  "contexto": {
    "CODCOLIGADA": "1",
    "CODSISTEMA": "S",
    "CODUSUARIO": "integra.eduvem"
  }
}'
```


## Pessoa

### `POST /pessoas`

CODIGO=0/ausente cria; CODIGO>0 atualiza. CPF/CEP aceitam máscara (a API remove). Retorna CODPESSOA.

**Tipo 1 — JSON**

```bash
curl -X POST "$BASE_URL/pessoas" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
  "CODIGO": 0,
  "NOME": "Fulano de Tal",
  "DTNASCIMENTO": "1990-01-15",
  "SEXO": "M",
  "CPF": "123.456.789-01",
  "CEP": "01310-100",
  "TELEFONE1": "11987654321",
  "EMAIL": "fulano@email.com"
}'
```

**Tipo 2 — Campos (form-urlencoded → n8n "Using Fields Below")**

```bash
curl -X POST "$BASE_URL/pessoas" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json" \
  --data-urlencode "CODIGO=0" \
  --data-urlencode "NOME=Fulano de Tal" \
  --data-urlencode "DTNASCIMENTO=1990-01-15" \
  --data-urlencode "SEXO=M" \
  --data-urlencode "CPF=123.456.789-01" \
  --data-urlencode "CEP=01310-100" \
  --data-urlencode "TELEFONE1=11987654321" \
  --data-urlencode "EMAIL=fulano@email.com"
```

### `GET /pessoas/12345`

ReadRecord RhuPessoaData pelo código.

```bash
curl -X GET "$BASE_URL/pessoas/12345" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json"
```

### `GET /pessoas/busca?cpf=12345678901`

Busca por CPF ou RNM (use ?cpf= OU ?rnm=). Padrão GET. Aceita cpf/CPF em qualquer caixa.

```bash
curl -X GET "$BASE_URL/pessoas/busca?cpf=12345678901" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json"
```


## Aluno

### `POST /alunos`

Cria/atualiza o aluno com etapas rastreadas (igual à inscrição): CLIENTE/FORNECEDOR → ALUNO → USUÁRIO/FILIAL → ACESSO (SSO). Resposta traz `dados.etapas` (sucesso) ou `etapas_concluidas` (erro).

**Tipo 1 — JSON**

```bash
curl -X POST "$BASE_URL/alunos" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
  "CODPESSOA": 12345,
  "CODCOLIGADA": 1,
  "CODTIPOCURSO": 2,
  "CODFILIAL": 1,
  "CPF": "12345678901",
  "RNM": ""
}'
```

**Tipo 2 — Campos (form-urlencoded → n8n "Using Fields Below")**

```bash
curl -X POST "$BASE_URL/alunos" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json" \
  --data-urlencode "CODPESSOA=12345" \
  --data-urlencode "CODCOLIGADA=1" \
  --data-urlencode "CODTIPOCURSO=2" \
  --data-urlencode "CODFILIAL=1" \
  --data-urlencode "CPF=12345678901" \
  --data-urlencode "RNM="
```

### `POST /alunos/cliente-fornecedor`

Vincula um Cliente/Fornecedor já gravado a um aluno existente (por RA). Informe `CODCFO`+`CODCOLCFO` e o `RA` junto ao seu `CODCOLIGADA`. `CODTIPOCURSO` e `CODFILIAL` são obrigatórios (contexto do EduAlunoData). Gravação direta.

```bash
curl -X POST "$BASE_URL/alunos/cliente-fornecedor" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
  "RA": "000123",
  "CODCOLIGADA": 1,
  "CODTIPOCURSO": 2,
  "CODFILIAL": 1,
  "CODCOLCFO": 0,
  "CODCFO": "12345"
}'
```

### `GET /alunos/1/12345`

Formato: /alunos/{codcoligada}/{codpessoa}.

```bash
curl -X GET "$BASE_URL/alunos/1/12345" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json"
```


## Cliente/Fornecedor

### `GET /clientes-fornecedores/busca?cpf=12345678901`

Consulta o CFO por CPF/RNM ANTES de criar (reusa INT.EDUVEM.00009). 404 = não existe, pode criar.

```bash
curl -X GET "$BASE_URL/clientes-fornecedores/busca?cpf=12345678901" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json"
```

### `POST /clientes-fornecedores`

Cria o CFO com etapas (VALIDAÇÃO → CONSULTA → GRAVAÇÃO) e idempotente (se já existir, devolve JA_EXISTIA sem duplicar). Envia CODCFO=0 → o RM gera; coligada 0, PAGREC 3, F/J automático pelo documento. CGCCFO/CEP/telefone aceitam máscara.

**Tipo 1 — JSON**

```bash
curl -X POST "$BASE_URL/clientes-fornecedores" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
  "NOME": "Felipe Machado da Silva",
  "CGCCFO": "517.420.330-08",
  "RUA": "Av. Ipiranga",
  "NUMERO": "6681",
  "BAIRRO": "Partenon",
  "CIDADE": "Porto Alegre",
  "CODETD": "RS",
  "CEP": "90619-900",
  "TELEFONE": "(51) 3333-6565",
  "EMAIL": "felipe@exemplo.com"
}'
```

**Tipo 2 — Campos (form-urlencoded → n8n "Using Fields Below")**

```bash
curl -X POST "$BASE_URL/clientes-fornecedores" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json" \
  --data-urlencode "NOME=Felipe Machado da Silva" \
  --data-urlencode "CGCCFO=517.420.330-08" \
  --data-urlencode "RUA=Av. Ipiranga" \
  --data-urlencode "NUMERO=6681" \
  --data-urlencode "BAIRRO=Partenon" \
  --data-urlencode "CIDADE=Porto Alegre" \
  --data-urlencode "CODETD=RS" \
  --data-urlencode "CEP=90619-900" \
  --data-urlencode "TELEFONE=(51) 3333-6565" \
  --data-urlencode "EMAIL=felipe@exemplo.com"
```


## Inscrição (fluxo completo)

### `POST /inscricoes`

Fluxo orquestrado (brasileiro). Idempotente.

**Tipo 1 — JSON**

```bash
curl -X POST "$BASE_URL/inscricoes" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
  "OFERTA": "OF2026-001",
  "PLANOPAGAMENTO": "PP01",
  "CPF": "12345678901",
  "NOME": "Fulano de Tal",
  "NASCIMENTO": "1990-01-15",
  "SEXO": "M",
  "EMAIL": "fulano@email.com",
  "TELEFONE": "11987654321",
  "CEP": "01310100",
  "ESTADO": "SP",
  "CIDADE": "3550308",
  "BAIRRO": "123",
  "RUA": "Av. Paulista",
  "NUMERO": "1000",
  "COMPLEMENTO": "",
  "NATURALIDADE": "3550308",
  "CUPOM": "PROMO10"
}'
```

**Tipo 2 — Campos (form-urlencoded → n8n "Using Fields Below")**

```bash
curl -X POST "$BASE_URL/inscricoes" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json" \
  --data-urlencode "OFERTA=OF2026-001" \
  --data-urlencode "PLANOPAGAMENTO=PP01" \
  --data-urlencode "CPF=12345678901" \
  --data-urlencode "NOME=Fulano de Tal" \
  --data-urlencode "NASCIMENTO=1990-01-15" \
  --data-urlencode "SEXO=M" \
  --data-urlencode "EMAIL=fulano@email.com" \
  --data-urlencode "TELEFONE=11987654321" \
  --data-urlencode "CEP=01310100" \
  --data-urlencode "ESTADO=SP" \
  --data-urlencode "CIDADE=3550308" \
  --data-urlencode "BAIRRO=123" \
  --data-urlencode "RUA=Av. Paulista" \
  --data-urlencode "NUMERO=1000" \
  --data-urlencode "COMPLEMENTO=" \
  --data-urlencode "NATURALIDADE=3550308" \
  --data-urlencode "CUPOM=PROMO10"
```

### `POST /inscricoes`

Fluxo orquestrado (estrangeiro): usa RNM.

**Tipo 1 — JSON**

```bash
curl -X POST "$BASE_URL/inscricoes" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
  "OFERTA": "OF2026-001",
  "PLANOPAGAMENTO": "PP01",
  "RNM": "A123456-7",
  "NOME": "John Doe Smith",
  "NASCIMENTO": "1985-06-20",
  "SEXO": "M",
  "EMAIL": "john@email.com",
  "TELEFONE": "11987654321"
}'
```

**Tipo 2 — Campos (form-urlencoded → n8n "Using Fields Below")**

```bash
curl -X POST "$BASE_URL/inscricoes" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json" \
  --data-urlencode "OFERTA=OF2026-001" \
  --data-urlencode "PLANOPAGAMENTO=PP01" \
  --data-urlencode "RNM=A123456-7" \
  --data-urlencode "NOME=John Doe Smith" \
  --data-urlencode "NASCIMENTO=1985-06-20" \
  --data-urlencode "SEXO=M" \
  --data-urlencode "EMAIL=john@email.com" \
  --data-urlencode "TELEFONE=11987654321"
```


## Matrícula (etapas)

### `POST /matriculas/curso`

Pré-matrícula (CODSTATUS 23).

**Tipo 1 — JSON**

```bash
curl -X POST "$BASE_URL/matriculas/curso" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
  "RA": "000123",
  "OFERTA": "OF2026-001"
}'
```

**Tipo 2 — Campos (form-urlencoded → n8n "Using Fields Below")**

```bash
curl -X POST "$BASE_URL/matriculas/curso" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json" \
  --data-urlencode "RA=000123" \
  --data-urlencode "OFERTA=OF2026-001"
```

### `POST /matriculas/periodo-letivo`

Gera o contrato. Retorna CODCONTRATO.

**Tipo 1 — JSON**

```bash
curl -X POST "$BASE_URL/matriculas/periodo-letivo" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
  "RA": "000123",
  "OFERTA": "OF2026-001",
  "PLANOPAGAMENTO": "PP01"
}'
```

**Tipo 2 — Campos (form-urlencoded → n8n "Using Fields Below")**

```bash
curl -X POST "$BASE_URL/matriculas/periodo-letivo" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json" \
  --data-urlencode "RA=000123" \
  --data-urlencode "OFERTA=OF2026-001" \
  --data-urlencode "PLANOPAGAMENTO=PP01"
```

### `POST /matriculas/disciplinas`

Enturmação por disciplina.

**Tipo 1 — JSON**

```bash
curl -X POST "$BASE_URL/matriculas/disciplinas" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
  "RA": "000123",
  "OFERTA": "OF2026-001"
}'
```

**Tipo 2 — Campos (form-urlencoded → n8n "Using Fields Below")**

```bash
curl -X POST "$BASE_URL/matriculas/disciplinas" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json" \
  --data-urlencode "RA=000123" \
  --data-urlencode "OFERTA=OF2026-001"
```


## Contrato

### `POST /contratos`

Gera o contrato em PDF (retorna CONTEUDO).

**Tipo 1 — JSON**

```bash
curl -X POST "$BASE_URL/contratos" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
  "NOME": "Fulano de Tal",
  "CPF": "12345678901",
  "ESTADO": "SP",
  "CIDADE": "3550308",
  "BAIRRO": "123",
  "RUA": "Av. Paulista",
  "NUMERO": "1000",
  "COMPLEMENTO": "",
  "NACIONALIDADE": "Brasileira",
  "NASCIMENTO": "1990-01-15"
}'
```

**Tipo 2 — Campos (form-urlencoded → n8n "Using Fields Below")**

```bash
curl -X POST "$BASE_URL/contratos" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json" \
  --data-urlencode "NOME=Fulano de Tal" \
  --data-urlencode "CPF=12345678901" \
  --data-urlencode "ESTADO=SP" \
  --data-urlencode "CIDADE=3550308" \
  --data-urlencode "BAIRRO=123" \
  --data-urlencode "RUA=Av. Paulista" \
  --data-urlencode "NUMERO=1000" \
  --data-urlencode "COMPLEMENTO=" \
  --data-urlencode "NACIONALIDADE=Brasileira" \
  --data-urlencode "NASCIMENTO=1990-01-15"
```


## Oferta

### `GET /ofertas/OF2026-001`

Dados da oferta (INT.EDUVEM.00006).

```bash
curl -X GET "$BASE_URL/ofertas/OF2026-001" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json"
```

### `GET /ofertas/OF2026-001/planos-pagamento`

Planos de pagamento (INT.EDUVEM.00013).

```bash
curl -X GET "$BASE_URL/ofertas/OF2026-001/planos-pagamento" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json"
```


## Endereço

### `GET /enderecos/estados`

Estados (INT.EDUVEM.00002).

```bash
curl -X GET "$BASE_URL/enderecos/estados" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json"
```

### `GET /enderecos/estados/SP/cidades`

Cidades do estado (INT.EDUVEM.00003).

```bash
curl -X GET "$BASE_URL/enderecos/estados/SP/cidades" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json"
```

### `GET /enderecos/cidades/3550308/bairros`

Bairros da cidade (INT.EDUVEM.00004).

```bash
curl -X GET "$BASE_URL/enderecos/cidades/3550308/bairros" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json"
```

### `GET /enderecos/cep/01310100`

Endereço por CEP (INT.EDUVEM.00005).

```bash
curl -X GET "$BASE_URL/enderecos/cep/01310100" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json"
```


## Cupom

### `GET /cupons/OF2026-001/PP01/PROMO10`

Valida cupom (INT.EDUVEM.00016).

```bash
curl -X GET "$BASE_URL/cupons/OF2026-001/PP01/PROMO10" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json"
```


### `POST /cupons/aplicar`

Aplica um cupom (bolsa) ao contrato do aluno. Autônomo e idempotente. `CODCONTRATO` é opcional.

```bash
curl -X POST "$BASE_URL/cupons/aplicar" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "RA": "24001268",
    "OFERTA": "OF2026-001",
    "PLANOPAGAMENTO": "PP01",
    "CUPOM": "PROMO10",
    "CODCONTRATO": ""
  }'
```


## Financeiro

### `POST /financeiro/baixas`

Baixa (quita) um lançamento financeiro — **grava movimento real** na conta/caixa. Processo `FinTBCBaixaDataProcess` (baixa via WS oficial da TOTVS). `IDFORMAPAGTO` = id da Forma de Pagamento no RM (default 1 = Dinheiro). `"DRY_RUN": true` devolve o XML gerado **sem enviar ao RM** (diagnóstico).

```bash
curl -X POST "$BASE_URL/financeiro/baixas" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "IDLAN": "1082893",
    "VALORBAIXA": "465,00",
    "CODCXA": "50380",
    "TIPOFORMAPAGTO": "Dinheiro",
    "HISTORICOBAIXA": "Baixa via API",
    "DRY_RUN": false
  }'
```


### `POST /financeiro/lancamentos`

Gera os lançamentos financeiros do contrato do aluno (processo `EduGerarLancFromContratoSliceableData`). Autônomo e idempotente. `CODCONTRATO` é opcional (sem ele, resolve pela matrícula no período letivo).

```bash
curl -X POST "$BASE_URL/financeiro/lancamentos" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "RA": "24001268",
    "OFERTA": "OF2026-001",
    "CODCONTRATO": ""
  }'
```


## SSO

### `GET /sso/TOKEN_GERADO_PELA_INSCRICAO`

Único endpoint HTML (auto-login). Isento de API key. O token vem em dados.nextUrl de POST /inscricoes.

```bash
curl -X GET "$BASE_URL/sso/TOKEN_GERADO_PELA_INSCRICAO" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: application/json"
```
