<?php

declare(strict_types=1);

namespace FMP\RMApi\Services;

use FMP\RMApi\Clients\RMSoapClient;
use FMP\RMApi\Exceptions\RMException;
use FMP\RMApi\Exceptions\ValidationException;
use FMP\RMApi\Support\ProcessXml;

/**
 * Lançamentos financeiros a partir do contrato
 * (processo EduGerarLancFromContratoSliceableData).
 */
class LancamentoService
{
    public const PROCESSO = 'EduGerarLancFromContratoSliceableData';

    public function __construct(
        private readonly RMSoapClient $rm,
        private readonly ConsultaService $consulta
    ) {
    }

    /**
     * Gera os lançamentos do contrato. Idempotente: se já existem, não regera.
     * O processo roda via JobMonitor e pode concluir de forma assíncrona,
     * então a confirmação é feita com retentativas. Em caso de falha, o log
     * completo do job (detalhes/erros/parâmetros/resumo) é anexado ao erro.
     *
     * Retorna ['gerados' => bool, 'ja_existiam' => bool].
     */
    /**
     * Geração de lançamentos a partir de RA + OFERTA (rota autônoma, fora do
     * fluxo de inscrição). Resolve a oferta (INT.EDUVEM.00006) e delega para
     * gerar(). O contrato pode vir pronto em $codContrato (do corpo) ou, se
     * vazio, é resolvido pela matrícula no período letivo (INT.EDUVEM.00014).
     *
     * @return array{gerados:bool, ja_existiam:bool, CODCONTRATO:string, RA:string, OFERTA:string}
     * @throws ValidationException oferta inexistente ou aluno sem contrato
     * @throws RMException          falha do RM ao gerar
     */
    public function gerarPorRaOferta(string $ra, string $offer, string $codContrato = ''): array
    {
        $oferta = $this->consulta->oferta($offer);
        if ($oferta === null) {
            throw new ValidationException(
                "Oferta '{$offer}' não encontrada.",
                'Geração de lançamentos: oferta inexistente',
                ['OFERTA' => $offer]
            );
        }

        $codContrato = trim($codContrato);
        if ($codContrato === '') {
            $pl = $this->consulta->matriculaPeriodoLetivo($offer, $ra);
            if ($pl === null || empty($pl['CODCONTRATO'])) {
                throw new ValidationException(
                    "Não foi possível localizar o contrato do aluno (RA {$ra}) nesta oferta. "
                        . 'Envie CODCONTRATO no corpo ou faça a matrícula no período letivo antes.',
                    'Geração de lançamentos: contrato não informado/localizado',
                    ['RA' => $ra, 'OFERTA' => $offer]
                );
            }
            $codContrato = (string) $pl['CODCONTRATO'];
        }

        $res = $this->gerar(
            $oferta['CODCOLIGADA'],
            $oferta['CODFILIAL'],
            $oferta['IDPERLET'],
            $ra,
            $codContrato
        );

        return $res + ['CODCONTRATO' => $codContrato, 'RA' => $ra, 'OFERTA' => $offer];
    }

    public function gerar(
        string|int $codColigada,
        string|int $codFilial,
        string|int $idPerlet,
        string $ra,
        string $codContrato
    ): array {
        $existentes = $this->consulta->lancamentos($codColigada, $idPerlet, $codContrato, $ra);

        if (count($existentes) > 0) {
            return ['gerados' => false, 'ja_existiam' => true];
        }

        $xml = ProcessXml::gerarLancamento(
            codColigada: $codColigada,
            codFilial: $codFilial,
            idPerlet: $idPerlet,
            ra: $ra,
            codContrato: $codContrato
        );

        $resultado = $this->rm->executeWithXmlParams(self::PROCESSO, $xml);

        // Confirma a geração com retentativas (job pode ser assíncrono)
        $gerados = [];
        for ($tentativa = 1; $tentativa <= 6; $tentativa++) {
            $gerados = $this->consulta->lancamentos($codColigada, $idPerlet, $codContrato, $ra);
            if (count($gerados) > 0) {
                break;
            }
            sleep(2);
        }

        if (count($gerados) === 0) {
            // Resultado numérico diferente de 1 = JobId: busca o log do job no RM
            $logJob = null;
            if (is_numeric($resultado) && $resultado !== '1') {
                $logJob = $this->consulta->logProcessoFormatado($resultado);
            }

            $detalheLog = $logJob !== null
                ? "\n\n{$logJob}"
                : ' Cadastre a sentença ' . ConsultaService::SQL_LOG_PROCESSO
                    . ' no RM (ver API.md) para a API anexar automaticamente o log do job'
                    . ' (detalhes, erros, parâmetros e resumo do Monitor de Jobs).';

            throw new RMException(
                'Erro ao gerar lançamento financeiro',
                operacao: 'ExecuteWithXMLParams',
                dataServer: self::PROCESSO,
                xmlEnviado: $xml,
                retornoRm: "Retorno do processo 'Gerar lançamento': {$resultado}. "
                    . 'Os lançamentos não foram localizados pela consulta '
                    . ConsultaService::SQL_LANCAMENTOS . ' após 6 tentativas (~12s).'
                    . $detalheLog
            );
        }

        return ['gerados' => true, 'ja_existiam' => false];
    }
}
