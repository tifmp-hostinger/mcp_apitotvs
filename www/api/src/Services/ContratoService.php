<?php

declare(strict_types=1);

namespace FMP\RMApi\Services;

use FMP\RMApi\Clients\RMSoapClient;
use FMP\RMApi\Helpers\Format;
use FMP\RMApi\Support\ReportXml;
use Throwable;

/**
 * Geração do PDF do contrato de matrícula
 * (wsReport: GenerateReport → GetGeneratedReportSize → GetFileChunk).
 */
class ContratoService
{
    public function __construct(
        private readonly RMSoapClient $rm,
        private readonly ConsultaService $consulta,
        private readonly array $rmConfig
    ) {
    }

    /**
     * Gera o contrato e devolve o conteúdo do PDF (base64, como o RM retorna).
     *
     * $dados: NOME, CPF, ESTADO, CIDADE (código), BAIRRO (código), RUA,
     *         NUMERO, COMPLEMENTO, NACIONALIDADE, NASCIMENTO (Y-m-d)
     */
    public function gerar(array $dados): mixed
    {
        $nome         = $dados['NOME'] ?? '';
        $cpf          = $dados['CPF'] ?? '';
        $estado       = $dados['ESTADO'] ?? '';
        $cidade       = $dados['CIDADE'] ?? '';
        $bairro       = $dados['BAIRRO'] ?? '';
        $rua          = $dados['RUA'] ?? '';
        $numero       = $dados['NUMERO'] ?? '';
        $complemento  = $dados['COMPLEMENTO'] ?? '';
        $nacionalidade = $dados['NACIONALIDADE'] ?? '';
        $nascimento   = $dados['NASCIMENTO'] ?? '';

        // Y-m-d → d/m/Y
        $partes = explode('-', $nascimento, 3);
        $nascimento = count($partes) === 3
            ? "{$partes[2]}/{$partes[1]}/{$partes[0]}"
            : '';

        if (!empty($cpf)) {
            try {
                $cpf = Format::cpf($cpf);
            } catch (Throwable) {
                $cpf = '';
            }
        }

        // Os códigos de cidade/bairro viram nomes no contrato
        if (!empty($cidade)) {
            $row = $this->consulta->cidadePorCodigo((string) $cidade);
            $cidade = $row['NOME'] ?? '';
        }

        if (!empty($bairro)) {
            $row = $this->consulta->bairroPorCodigo((string) $bairro);
            $bairro = $row['NOME'] ?? '';
        }

        $parameters = ReportXml::parameters([
            'NOME_S'           => $nome,
            'CPF_S'            => $cpf,
            'ESTADO_S'         => $estado,
            'CIDADE_S'         => $cidade,
            'BAIRRO_S'         => $bairro,
            'RUA_S'            => $rua,
            'NUMERO_S'         => $numero,
            'COMPLEMENTO_S'    => $complemento,
            'NACIONALIDADE_S'  => $nacionalidade,
            'DATANASCIMENTO_S' => $nascimento,
        ]);

        $report = $this->rmConfig['relatorio_contrato'];

        $guid = $this->rm->generateReport(
            (string) $report['codcoligada'],
            (string) $report['id'],
            '',
            $parameters
        );

        $size = $this->rm->getGeneratedReportSize($guid);

        return $this->rm->getFileChunk($guid, 0, $size);
    }
}
