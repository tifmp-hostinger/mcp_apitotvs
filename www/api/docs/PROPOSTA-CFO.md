# PROPOSTA — Cliente/Fornecedor (CFO) · consultar e criar

> **Status: IMPLEMENTADO.** Arquivos: `src/Services/CfoService.php`, `src/Controllers/CfoController.php`,
> rotas em `config/routes.php`, DI em `config/dependencies.php`.
>
> **Decisões aplicadas (confirmadas pela FMP):**
> - DataServer **`FinCFODataBR`**; contexto **`CODSISTEMA=F`**.
> - **CODCOLIGADA sempre 0**; na criação **CODCFO=0** (o RM gera o código).
> - **PAGREC sempre 3**; **PESSOAFISOUJUR** automático pelo documento (11 díg.=`F`, 14=`J`).
> - Busca por **GET** (`/clientes-fornecedores/busca?cpf=` ou `?rnm=`); criação por **POST**.
> - `CODTCF` não enviado por padrão (opcional; só vai se vier no body).
>
> O texto abaixo é o desenho original (mantido como referência).

DataServer alvo: **`FinCFODataBR`** (XML raiz `<FinCFOBR>` com `<FCFO>` + `<FCFOCOMPL>`).
Segue o mesmo padrão de `PessoaService` / `AlunoService`: Controller só fala HTTP, Service monta o XML e chama `RMSoapClient::saveRecord`.

---

## 1. Rotas propostas

| Rota | O que faz |
|---|---|
| `POST /clientes-fornecedores/busca` | Consulta o CFO por CPF/RNM **antes** de criar. Reusa `INT.EDUVEM.00009` (a mesma do Aluno). Body: `{ "CPF": "..." }` ou `{ "RNM": "..." }` |
| `POST /clientes-fornecedores` | Cria o CFO (`SaveRecord FinCFODataBR`). Retorna a chave `CODCOLIGADA;CODCFO` |

(Uso de POST na busca para o documento não trafegar na URL/logs — igual ao `/pessoas/busca`.)

---

## 2. Campos extraídos do schema (o que realmente importa)

O XSD do `FinCFOBR` tem ~180 campos; a esmagadora maioria é opcional. Os **obrigatórios** (sem `minOccurs="0"`) são poucos:

| Campo XML | Tipo / tam. | Obrigatório | Significado | Default proposto |
|---|---|:---:|---|---|
| `CODCOLIGADA` | short | **sim** | Coligada | `1` |
| `CODCFO` | str ≤25 | **sim** | Código do Cli/For | *(ver decisão 6.2)* |
| `NOMEFANTASIA` | str ≤100 | **sim** | Nome fantasia/social | = `NOME` |
| `NOME` | str ≤100 | **sim** | Nome | entrada |
| `PAGREC` | short | **sim** | Classificação (1=Cliente, 2=Fornecedor, 3=Ambos) | `1` |
| `ATIVO` | short | **sim** | Ativo | `1` |
| `PESSOAFISOUJUR` | str 1 | **sim** | Categoria (`F`=física, `J`=jurídica) | `F` |
| `IDCFO` | int | **sim** | Ref. | `0` |

Campos **opcionais** que faz sentido preencher pra um aluno (todos `minOccurs=0`):

| Campo XML | Tam. | Mapeia de |
|---|---|---|
| `CGCCFO` | ≤20 | CPF/CNPJ (só dígitos) |
| `CIDENTIDADE` | ≤20 | RG |
| `RUA` `NUMERO` `COMPLEMENTO` `BAIRRO` `CIDADE` | 100/8/60/80/32 | endereço |
| `CODETD` | 2 | UF (estado) |
| `CEP` | ≤9 | CEP (só dígitos) |
| `TELEFONE` | ≤15 | telefone fixo |
| `TELEX` | ≤15 | celular (no schema TELEX = "Celular") |
| `EMAIL` | ≤250 | e-mail |
| `CODMUNICIPIO` | ≤20 | cód. município (IBGE) |
| `DTNASCIMENTO` | dateTime | nascimento |
| `ESTADOCIVIL` | 1 | estado civil |
| `IDPAIS` | short | país |
| `CODTCF` | ≤25 | Tipo de Cli/For *(ver decisão 6.3)* |

`FCFOCOMPL` (tabela complementar) só exige `CODCOLIGADA` + `CODCFO` — vou enviar só as chaves, igual o `VPCompl` da Pessoa e o `SAlunoCompl` do Aluno. `FCFOMX` é específico do México → **não** envio.

---

## 3. XML que será gerado (exemplo)

Para `POST /clientes-fornecedores` com um aluno pessoa física:

```xml
<FinCFOBR>
  <FCFO>
    <CODCOLIGADA>1</CODCOLIGADA>
    <CODCFO>51742033008</CODCFO>
    <NOMEFANTASIA>Felipe Machado da Silva</NOMEFANTASIA>
    <NOME>Felipe Machado da Silva</NOME>
    <CGCCFO>51742033008</CGCCFO>
    <PAGREC>1</PAGREC>
    <PESSOAFISOUJUR>F</PESSOAFISOUJUR>
    <ATIVO>1</ATIVO>
    <IDCFO>0</IDCFO>
    <RUA>Av. Ipiranga</RUA>
    <NUMERO>6681</NUMERO>
    <BAIRRO>Partenon</BAIRRO>
    <CIDADE>Porto Alegre</CIDADE>
    <CODETD>RS</CODETD>
    <CEP>90619900</CEP>
    <TELEFONE>5133336565</TELEFONE>
    <EMAIL>felipe@exemplo.com</EMAIL>
  </FCFO>
  <FCFOCOMPL>
    <CODCOLIGADA>1</CODCOLIGADA>
    <CODCFO>51742033008</CODCFO>
  </FCFOCOMPL>
</FinCFOBR>
```

Contexto do SaveRecord (proposto): `CODCOLIGADA=1;CODSISTEMA=F;CODUSUARIO=integra.eduvem` *(ver decisão 6.4)*.

---

## 4. Código proposto

### 4.1 `src/Services/CfoService.php` (novo)

```php
<?php
declare(strict_types=1);
namespace FMP\RMApi\Services;

use FMP\RMApi\Clients\RMSoapClient;
use FMP\RMApi\Exceptions\RMException;

/** Cliente/Fornecedor no RM (DataServer FinCFODataBR). */
class CfoService
{
    public const DATASERVER = 'FinCFODataBR';

    public function __construct(
        private readonly RMSoapClient $rm,
        private readonly ConsultaService $consulta,
        private readonly array $rmConfig
    ) {}

    /** Consulta CFO por CPF/RNM (reusa INT.EDUVEM.00009). */
    public function buscarPorCpfRnm(string $cpf = '', string $rnm = ''): ?array
    {
        return $this->consulta->cliForPorCpfRnm($cpf, $rnm);
    }

    /** Cria o CFO. Retorna a chave CODCOLIGADA;CODCFO. */
    public function salvar(array $p): string
    {
        $p = self::sanitizar($p);
        $codColigada = (string) ($p['CODCOLIGADA'] ?? '1');

        $xml = self::buildXml($p);

        $contexto = [
            'CODCOLIGADA' => $codColigada,
            'CODSISTEMA'  => 'F',
            'CODUSUARIO'  => $this->rmConfig['usuario_servico'] ?? 'integra.eduvem',
        ];

        $result = $this->rm->saveRecord(self::DATASERVER, $xml, $contexto);

        // Esperado: "CODCOLIGADA;CODCFO"
        $parts = explode(';', $result, 2);
        if (($parts[0] ?? '') != $codColigada) {
            throw new RMException(
                'O RM rejeitou a gravação do cliente/fornecedor',
                operacao: 'SaveRecord',
                dataServer: self::DATASERVER,
                contexto: $contexto,
                xmlEnviado: $xml,
                retornoRm: $result
            );
        }
        return $result;
    }

    /** Remove máscara dos campos que o RM grava como dígitos. */
    private static function sanitizar(array $p): array
    {
        foreach (['CGCCFO', 'CEP', 'TELEFONE', 'TELEX'] as $c) {
            if (isset($p[$c]) && $p[$c] !== '') {
                $p[$c] = preg_replace('/\D/', '', (string) $p[$c]);
            }
        }
        return $p;
    }

    public static function buildXml(array $p): string
    {
        $g = fn(string $k, string $def = '') =>
            htmlspecialchars((string) ($p[$k] ?? $def), ENT_XML1, 'UTF-8');

        $codcol = $g('CODCOLIGADA', '1');
        $codcfo = $g('CODCFO');
        $nome   = $g('NOME');

        return <<<XML
        <FinCFOBR>
            <FCFO>
                <CODCOLIGADA>{$codcol}</CODCOLIGADA>
                <CODCFO>{$codcfo}</CODCFO>
                <NOMEFANTASIA>{$g('NOMEFANTASIA', $p['NOME'] ?? '')}</NOMEFANTASIA>
                <NOME>{$nome}</NOME>
                <CGCCFO>{$g('CGCCFO')}</CGCCFO>
                <PAGREC>{$g('PAGREC', '1')}</PAGREC>
                <PESSOAFISOUJUR>{$g('PESSOAFISOUJUR', 'F')}</PESSOAFISOUJUR>
                <ATIVO>{$g('ATIVO', '1')}</ATIVO>
                <IDCFO>{$g('IDCFO', '0')}</IDCFO>
                <CIDENTIDADE>{$g('CIDENTIDADE')}</CIDENTIDADE>
                <RUA>{$g('RUA')}</RUA>
                <NUMERO>{$g('NUMERO')}</NUMERO>
                <COMPLEMENTO>{$g('COMPLEMENTO')}</COMPLEMENTO>
                <BAIRRO>{$g('BAIRRO')}</BAIRRO>
                <CIDADE>{$g('CIDADE')}</CIDADE>
                <CODETD>{$g('CODETD')}</CODETD>
                <CEP>{$g('CEP')}</CEP>
                <TELEFONE>{$g('TELEFONE')}</TELEFONE>
                <TELEX>{$g('TELEX')}</TELEX>
                <EMAIL>{$g('EMAIL')}</EMAIL>
                <CODMUNICIPIO>{$g('CODMUNICIPIO')}</CODMUNICIPIO>
                <ESTADOCIVIL>{$g('ESTADOCIVIL')}</ESTADOCIVIL>
                <IDPAIS>{$g('IDPAIS')}</IDPAIS>
                <CODTCF>{$g('CODTCF')}</CODTCF>
            </FCFO>
            <FCFOCOMPL>
                <CODCOLIGADA>{$codcol}</CODCOLIGADA>
                <CODCFO>{$codcfo}</CODCFO>
            </FCFOCOMPL>
        </FinCFOBR>
        XML;
    }
}
```

### 4.2 `src/Controllers/CfoController.php` (novo)

```php
<?php
declare(strict_types=1);
namespace FMP\RMApi\Controllers;

use FMP\RMApi\Helpers\Json;
use FMP\RMApi\Helpers\Validation;
use FMP\RMApi\Services\CfoService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

final class CfoController
{
    public function __construct(private readonly CfoService $cfo) {}

    /** POST /clientes-fornecedores/busca — body: { "CPF": "..." } ou { "RNM": "..." } */
    public function buscarPorDocumento(Request $request, Response $response): Response
    {
        $data = (array) $request->getParsedBody();
        $isForeigner = !empty($data['RNM']);

        if ($isForeigner) {
            $rnm = Validation::ensureRnm(Validation::ensureHasValue($data, 'RNM'));
            $cpf = '';
        } else {
            $rnm = '';
            $cpf = Validation::ensureCpf(Validation::ensureHasValue($data, 'CPF'));
        }

        $cfo = $this->cfo->buscarPorCpfRnm($cpf, $rnm);
        if ($cfo === null) {
            return Json::notFound('Cliente/Fornecedor não encontrado');
        }
        return Json::success('Cliente/Fornecedor encontrado.', $cfo);
    }

    /** POST /clientes-fornecedores — cria o CFO. */
    public function salvar(Request $request, Response $response): Response
    {
        $data  = (array) $request->getParsedBody();
        $chave = $this->cfo->salvar($data);
        return Json::success('Cliente/Fornecedor gravado com sucesso.', ['CHAVE' => $chave], 201);
    }
}
```

### 4.3 `config/routes.php` (acrescentar)

```php
use FMP\RMApi\Controllers\CfoController;
// ...
$app->group('/clientes-fornecedores', function (RouteCollectorProxy $cfo) {
    $cfo->post('/busca', [CfoController::class, 'buscarPorDocumento']);
    $cfo->post('', [CfoController::class, 'salvar']);
});
```

### 4.4 `config/dependencies.php` (acrescentar)

```php
CfoService::class => fn(ContainerInterface $c) => new CfoService(
    $c->get(RMSoapClient::class),
    $c->get(ConsultaService::class),
    $c->get('rm')
),
```

---

## 5. Exemplos de uso

**Consultar antes de criar:**
```bash
curl -X POST "$BASE_URL/clientes-fornecedores/busca" \
  -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"CPF":"517.420.330-08"}'
# 200 -> { "sucesso": true, "dados": { "CODCOLCFO": "1", "CODCFO": "...", ... } }
# 404 -> não existe; pode criar
```

**Criar:**
```bash
curl -X POST "$BASE_URL/clientes-fornecedores" \
  -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{
    "CODCOLIGADA": 1,
    "NOME": "Felipe Machado da Silva",
    "CGCCFO": "517.420.330-08",
    "PESSOAFISOUJUR": "F",
    "PAGREC": 1,
    "RUA": "Av. Ipiranga", "NUMERO": "6681", "BAIRRO": "Partenon",
    "CIDADE": "Porto Alegre", "CODETD": "RS", "CEP": "90619-900",
    "TELEFONE": "(51) 3333-6565", "EMAIL": "felipe@exemplo.com"
  }'
# 201 -> { "sucesso": true, "dados": { "CHAVE": "1;000123" } }
```

---

## 6. Decisões que preciso confirmar antes de codar em produção

1. **DataServer**: é mesmo `FinCFODataBR`? (dá pra confirmar com `GET /rm/schema/FinCFODataBR` — se voltar o schema, está certo.)
2. **CODCFO** (obrigatório): de onde vem o código?
   - (a) usar o **CPF/CNPJ** (só dígitos) como CODCFO;
   - (b) o n8n manda um CODCFO próprio;
   - (c) o RM **gera automático** (nesse caso, mandar `CODCFO` vazio funciona aí? normalmente não — o campo é obrigatório).
3. **CODTCF** (Tipo de Cli/For): existe um tipo padrão pra aluno na FMP? Se sim, qual código?
4. **Contexto do SaveRecord**: `CODSISTEMA=F` (Financeiro) está correto, ou é outro (`G`/`S`)?
5. **PAGREC**: aluno entra como `1` (Cliente), certo?
6. **Nome da rota**: `/clientes-fornecedores` ou prefere `/cfo` (mais curto)?

Me responde essas 6 (nem que seja "não sei" — aí eu confirmo via `/rm/schema`) que eu já implemento e ligo as rotas.
