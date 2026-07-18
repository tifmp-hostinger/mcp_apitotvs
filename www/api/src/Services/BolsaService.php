<?php

declare(strict_types=1);

namespace FMP\RMApi\Services;

use FMP\RMApi\Clients\RMSoapClient;
use FMP\RMApi\Exceptions\RMException;
use FMP\RMApi\Exceptions\ValidationException;

/**
 * Cupons de desconto → bolsas do aluno (EduBolsaAlunoData).
 */
class BolsaService
{
    public const DATASERVER = 'EduBolsaAlunoData';

    public function __construct(
        private readonly RMSoapClient $rm,
        private readonly ConsultaService $consulta,
        private readonly array $rmConfig
    ) {
    }

    /**
     * Valida o cupom para a oferta/plano. Retorna os dados da bolsa ou null.
     */
    public function validarCupom(string $codOferta, string $codPlanoPgto, string $cupom): ?array
    {
        return $this->consulta->cupom($codOferta, $codPlanoPgto, $cupom);
    }

    /**
     * Aplica um cupom a partir de RA + OFERTA + PLANO (rota autônoma, fora do
     * fluxo de inscrição). Valida o cupom (INT.EDUVEM.00016) e resolve a oferta
     * (00006). O contrato pode vir pronto em $codContrato (do corpo) ou, se
     * vazio, é resolvido pela matrícula no PL (INT.EDUVEM.00014).
     *
     * @return array{aplicada:bool, ja_existia:bool, CODBOLSA:mixed, CODCONTRATO:string, CUPOM:string}
     * @throws ValidationException oferta/cupom inválidos ou aluno sem contrato
     * @throws RMException          falha do RM ao gravar a bolsa
     */
    public function aplicarPorRaOferta(
        string $ra,
        string $offer,
        string $codPlanoPgto,
        string $cupom,
        string $codContrato = ''
    ): array {
        $oferta = $this->consulta->oferta($offer);
        if ($oferta === null) {
            throw new ValidationException(
                "Oferta '{$offer}' não encontrada.",
                'Aplicação de cupom: oferta inexistente',
                ['OFERTA' => $offer]
            );
        }

        $cupomDetails = $this->validarCupom($offer, $codPlanoPgto, $cupom);
        if ($cupomDetails === null) {
            throw new ValidationException(
                "Cupom '{$cupom}' inválido para esta oferta e plano de pagamento.",
                'Aplicação de cupom: cupom inválido',
                ['OFERTA' => $offer, 'PLANOPAGAMENTO' => $codPlanoPgto, 'CUPOM' => $cupom]
            );
        }

        $codContrato = trim($codContrato);
        if ($codContrato === '') {
            $pl = $this->consulta->matriculaPeriodoLetivo($offer, $ra);
            if ($pl === null || empty($pl['CODCONTRATO'])) {
                throw new ValidationException(
                    "Não foi possível localizar o contrato do aluno (RA {$ra}) nesta oferta. "
                        . 'Envie CODCONTRATO no corpo ou faça a matrícula no período letivo antes.',
                    'Aplicação de cupom: contrato não informado/localizado',
                    ['RA' => $ra, 'OFERTA' => $offer]
                );
            }
            $codContrato = (string) $pl['CODCONTRATO'];
        }

        $res = $this->aplicar($cupomDetails, $ra, $codContrato, $oferta);

        return $res + [
            'CODBOLSA'    => $cupomDetails['CODBOLSA'] ?? null,
            'CODCONTRATO' => $codContrato,
            'CUPOM'       => $cupom,
        ];
    }

    /**
     * Aplica a bolsa do cupom ao contrato do aluno. Idempotente.
     * Retorna ['aplicada' => bool, 'ja_existia' => bool].
     */
    public function aplicar(
        array $cupomDetails,
        string $ra,
        string $codContrato,
        array $oferta
    ): array {
        $codColigada  = $oferta['CODCOLIGADA'];
        $idPerlet     = $oferta['IDPERLET'];
        $codFilial    = $oferta['CODFILIAL'];
        $codTipoCurso = $oferta['CODTIPOCURSO'];

        $jaAplicada = $this->consulta->bolsaAplicada(
            $codColigada,
            $idPerlet,
            $codContrato,
            $ra,
            $cupomDetails['CODBOLSA']
        );

        if ($jaAplicada !== null) {
            return ['aplicada' => false, 'ja_existia' => true];
        }

        $valor = number_format(floatval($cupomDetails['VALOR']), 2, ',', '');
        $now = date('Y-m-d') . 'T' . date('H:i:s');
        $codUsuario = $this->rmConfig['usuario_servico'] ?? 'victor.forte';

        // SBOLSAALUNO.CODUSUARIO NÃO é enviado: a segurança de campos do RM
        // proíbe defini-lo via integração; o RM preenche automaticamente com
        // o usuário autenticado na conexão SOAP.
        $xml = <<<XML
        <EduBolsaAluno>
            <SBolsaAluno>
                <CODCOLIGADA>{$codColigada}</CODCOLIGADA>
                <IDBOLSAALUNO>0</IDBOLSAALUNO>
                <RA>{$ra}</RA>
                <IDPERLET>{$idPerlet}</IDPERLET>
                <CODCONTRATO>{$codContrato}</CODCONTRATO>
                <CODBOLSA>{$cupomDetails['CODBOLSA']}</CODBOLSA>
                <CODSERVICO>{$cupomDetails['CODSERVICO']}</CODSERVICO>
                <DESCONTO>{$valor}</DESCONTO>
                <TIPODESC>{$cupomDetails['TIPODESCONTO']}</TIPODESC>
                <PARCELAINICIAL>{$cupomDetails['PARCINICIAL']}</PARCELAINICIAL>
                <PARCELAFINAL>{$cupomDetails['PARCFINAL']}</PARCELAFINAL>
                <CODPERLET>{$oferta['CODPERLET']}</CODPERLET>
                <DATACONCESSAO>{$now}</DATACONCESSAO>
                <ATIVA>S</ATIVA>
                <CODCOLIGADA1>{$codColigada}</CODCOLIGADA1>
                <CODFILIAL>{$codFilial}</CODFILIAL>
            </SBolsaAluno>
        </EduBolsaAluno>
        XML;

        $contexto = [
            'CODCOLIGADA'  => $codColigada,
            'CODTIPOCURSO' => $codTipoCurso,
            'CODFILIAL'    => $codFilial,
            'CODSISTEMA'   => $this->rmConfig['contexto_padrao']['CODSISTEMA'] ?? 'S',
            'CODUSUARIO'   => $codUsuario,
        ];

        $result = $this->rm->saveRecord(self::DATASERVER, $xml, $contexto);

        $parts = explode(';', $result, 2);
        if ($parts[0] != $codColigada) {
            throw new RMException(
                'O RM rejeitou a aplicação da bolsa',
                operacao: 'SaveRecord',
                dataServer: self::DATASERVER,
                contexto: $contexto,
                xmlEnviado: $xml,
                retornoRm: $result
            );
        }

        return ['aplicada' => true, 'ja_existia' => false];
    }
}
