<?php

declare(strict_types=1);

namespace FMP\RMApi\Services;

use FMP\RMApi\Clients\RMSoapClient;
use FMP\RMApi\Exceptions\FluxoException;
use FMP\RMApi\Exceptions\RMException;
use FMP\RMApi\Helpers\Validation;

/**
 * Cliente/Fornecedor no RM (DataServer FinCFODataBR).
 *
 * Regras confirmadas com a FMP:
 *  - CODCOLIGADA do registro (XML) sempre 0 (cliente/fornecedor global);
 *  - CONTEXTO do SaveRecord vai com CODCOLIGADA = 1 (a coligada 0 não permite CFO global);
 *  - na criação envia CODCFO = 0 para o RM gerar o código (igual ao RA do aluno);
 *  - PAGREC sempre 3 (cliente e fornecedor);
 *  - PESSOAFISOUJUR derivado do documento: 11 dígitos => F (CPF), 14 => J (CNPJ);
 *  - contexto do SaveRecord usa CODSISTEMA = F (financeiro).
 */

class CfoService
{
    public const DATASERVER = 'FinCFODataBR';

    /** Coligada do REGISTRO do CFO (vai no XML). 0 = cliente/fornecedor global. */
    private const CODCOLIGADA = '0';

    /** Coligada usada no CONTEXTO do SaveRecord (a coligada 0 não permite CFO global). */
    private const CODCOLIGADA_CONTEXTO = '1';

    /** Campos opcionais: só vão ao XML quando preenchidos (evita enviar tag vazia). */
    private const CAMPOS_OPCIONAIS = [
        'CGCCFO', 'CIDENTIDADE', 'RUA', 'NUMERO', 'COMPLEMENTO', 'BAIRRO',
        'CIDADE', 'CODETD', 'CEP', 'TELEFONE', 'TELEX', 'EMAIL',
        'CODMUNICIPIO', 'ESTADOCIVIL', 'IDPAIS', 'CODTCF',
    ];

    public function __construct(
        private readonly RMSoapClient $rm,
        private readonly ConsultaService $consulta,
        private readonly array $rmConfig
    ) {
    }

    /**
     * Consulta o CFO por CPF/RNM (reusa a sentença INT.EDUVEM.00009, a mesma do Aluno).
     * Retorna o registro (CODCOLCFO, CODCFO, ...) ou null.
     */
    public function buscarPorCpfRnm(string $cpf = '', string $rnm = ''): ?array
    {
        return $this->consulta->cliForPorCpfRnm($cpf, $rnm);
    }

    /**
     * Cria o CFO rastreando etapas (igual à inscrição). Idempotente:
     * se o documento já estiver cadastrado, não duplica (status JA_EXISTIA).
     *
     * @return array{chave:string, jaExistia:bool, etapas:array, cliente?:array}
     */
    public function criarFluxo(array $in): array
    {
        $etapas = [];
        $add = function (string $etapa, string $detalhe, string $status = 'OK') use (&$etapas): void {
            $etapas[] = ['etapa' => $etapa, 'status' => $status, 'detalhe' => $detalhe];
        };

        /* ---------- Validação ---------- */
        Validation::ensureHasValue($in, 'NOME');
        $doc = preg_replace('/\D/', '', (string) ($in['CGCCFO'] ?? $in['CPF'] ?? $in['CNPJ'] ?? ''));
        $rnm = (string) ($in['RNM'] ?? '');
        $add('VALIDAÇÃO', 'Dados de entrada validados');

        /* ---------- Consulta (idempotência) ---------- */
        // A sentença INT.EDUVEM.00009 é por CPF/RNM (pessoa física). Para CNPJ não
        // há consulta equivalente, então segue direto para a criação.
        $existente = null;
        if ($doc !== '' && strlen($doc) === 11) {
            $existente = $this->consulta->cliForPorCpfRnm($doc, $rnm);
        } elseif ($rnm !== '') {
            $existente = $this->consulta->cliForPorCpfRnm('', $rnm);
        }

        if ($existente !== null) {
            $codColCfo = (string) ($existente['CODCOLCFO'] ?? self::CODCOLIGADA);
            $codCfo    = (string) ($existente['CODCFO'] ?? '');
            $chave     = $codColCfo . ';' . $codCfo;
            $add('CONSULTA', "Cliente/Fornecedor já existe (CODCFO {$codCfo}); não será duplicado", 'JA_EXISTIA');
            return [
                'chave'     => $chave,
                'CODCOLCFO' => $codColCfo,
                'CODCFO'    => $codCfo,
                'jaExistia' => true,
                'cliente'   => $existente,
                'etapas'    => $etapas,
            ];
        }
        $add('CONSULTA', 'Documento não cadastrado; prosseguindo para a criação', 'NAO_ENCONTRADO');

        /* ---------- Gravação ---------- */
        try {
            $chave = $this->salvar($in);
        } catch (RMException $e) {
            $f = new FluxoException(
                'GRAVAÇÃO',
                'Houve um erro ao gravar o cliente/fornecedor.',
                "Erro ao gravar CFO: {$e->retornoRm}",
                $e->xmlEnviado,
                $e
            );
            $f->etapasConcluidas = $etapas;
            throw $f;
        }
        $add('GRAVAÇÃO', "Cliente/Fornecedor gravado. Chave: {$chave}");

        // Separa a chave "CODCOLCFO;CODCFO" para uso direto (ex.: /alunos/cliente-fornecedor).
        $parts = explode(';', $chave, 2);
        return [
            'chave'     => $chave,
            'CODCOLCFO' => $parts[0] ?? self::CODCOLIGADA,
            'CODCFO'    => $parts[1] ?? '',
            'jaExistia' => false,
            'etapas'    => $etapas,
        ];
    }

    /**
     * Cria o CFO. Como envia CODCFO = 0, o RM gera o código e devolve a chave
     * "CODCOLIGADA;CODCFO".
     */
    public function salvar(array $p): string
    {
        $p = self::sanitizar($p);

        // Coligada é sempre 0; CODCFO é 0 na criação (RM gera).
        $p['CODCOLIGADA'] = self::CODCOLIGADA;
        $p['CODCFO']      = (string) ($p['CODCFO'] ?? '0');

        $xml = self::buildXml($p);

        // O REGISTRO do CFO é coligada 0 (global), mas o CONTEXTO do SaveRecord
        // precisa rodar sob uma coligada que permita CFO global (1).
        $contexto = [
            'CODCOLIGADA' => self::CODCOLIGADA_CONTEXTO,
            'CODSISTEMA'  => 'F',
            'CODUSUARIO'  => $this->rmConfig['usuario_servico'] ?? 'integra.eduvem',
        ];

        $result = $this->rm->saveRecord(self::DATASERVER, $xml, $contexto);

        // Esperado: "CODCOLIGADA;CODCFO".
        $parts = explode(';', $result, 2);
        if (count($parts) < 2 || $parts[0] !== self::CODCOLIGADA) {
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

    /** Remove máscara dos campos que o RM grava como dígitos puros. */
    private static function sanitizar(array $p): array
    {
        foreach (['CGCCFO', 'CEP', 'TELEFONE', 'TELEX'] as $campo) {
            if (isset($p[$campo]) && $p[$campo] !== '') {
                $p[$campo] = preg_replace('/\D/', '', (string) $p[$campo]);
            }
        }
        return $p;
    }

    public static function buildXml(array $p): string
    {
        $esc = fn($v) => htmlspecialchars((string) $v, ENT_XML1, 'UTF-8');

        $codcol = (string) ($p['CODCOLIGADA'] ?? self::CODCOLIGADA);
        $codcfo = (string) ($p['CODCFO'] ?? '0');

        // Categoria automática: 14 dígitos => CNPJ (J); caso contrário CPF (F).
        // Respeita PESSOAFISOUJUR explícito se vier.
        $doc = preg_replace('/\D/', '', (string) ($p['CGCCFO'] ?? ''));
        $pessoa = $p['PESSOAFISOUJUR'] ?? (strlen($doc) === 14 ? 'J' : 'F');

        // Campos obrigatórios (sempre presentes).
        $obrig = [
            'CODCOLIGADA'    => $codcol,
            'CODCFO'         => $codcfo,
            'NOMEFANTASIA'   => $p['NOMEFANTASIA'] ?? ($p['NOME'] ?? ''),
            'NOME'           => $p['NOME'] ?? '',
            'PAGREC'         => $p['PAGREC'] ?? '3',
            'ATIVO'          => $p['ATIVO'] ?? '1',
            'PESSOAFISOUJUR' => $pessoa,
            'IDCFO'          => $p['IDCFO'] ?? '0',
        ];

        $fcfo = '';
        foreach ($obrig as $tag => $val) {
            $fcfo .= "                <{$tag}>" . $esc($val) . "</{$tag}>\n";
        }
        foreach (self::CAMPOS_OPCIONAIS as $tag) {
            if (isset($p[$tag]) && $p[$tag] !== '') {
                $fcfo .= "                <{$tag}>" . $esc($p[$tag]) . "</{$tag}>\n";
            }
        }

        return "<FinCFOBR>\n"
            . "            <FCFO>\n"
            . $fcfo
            . "            </FCFO>\n"
            . "            <FCFOCOMPL>\n"
            . "                <CODCOLIGADA>" . $esc($codcol) . "</CODCOLIGADA>\n"
            . "                <CODCFO>" . $esc($codcfo) . "</CODCFO>\n"
            . "            </FCFOCOMPL>\n"
            . "        </FinCFOBR>";
    }
}
