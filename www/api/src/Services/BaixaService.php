<?php

declare(strict_types=1);

namespace FMP\RMApi\Services;

use FMP\RMApi\Clients\RMSoapClient;
use FMP\RMApi\Exceptions\RMException;
use FMP\RMApi\Exceptions\ValidationException;
use FMP\RMApi\Support\Env;
use FMP\RMApi\Support\ProcessXml;

/**
 * Baixa (quitação) de lançamento financeiro no RM.
 *
 * Caminho padrão (VALIDADO em homologação em 13/07/2026): processo
 * FinTBCBaixaDataProcess via wsProcess/ExecuteWithXMLParams — o contrato
 * oficial da TOTVS para baixa por WebService (TDN "Baixa Via Web Service").
 * Processos alternativos são selecionáveis por env (FIN_BAIXA_PROCESSO) e o
 * builder de XML acompanha — ver o match() em baixar() e config/rm.php.
 *
 * É a contrapartida do LancamentoService: enquanto aquele GERA as parcelas
 * (a receber, em aberto), este as BAIXA numa conta/caixa com uma forma de
 * pagamento.
 */
class BaixaService
{
    /**
     * Fallback do ProcessServerName. Na prática o efetivo SEMPRE vem de
     * config rm.baixa.processo (env FIN_BAIXA_PROCESSO) — esta constante só
     * dispara se a chave sumir da config.
     */
    public const PROCESSO = 'FinTBCBaixaDataProcess';

    /** Formas de pagamento aceitas pelo RM (enum FinTipoFormaPagto). */
    private const FORMAS_PAGAMENTO = [
        'Dinheiro', 'Cheque', 'Cartao', 'CartaoCredito', 'CartaoDebito',
        'Transferencia', 'DebitoConta', 'Boleto', 'Pix', 'Outros',
    ];

    public function __construct(
        private readonly RMSoapClient $rm,
        private readonly ConsultaService $consulta,
        private readonly array $rmConfig
    ) {
    }

    /**
     * Executa a baixa de um lançamento.
     *
     * Campos de entrada ($in):
     *  - IDLAN            (obrig.) id do lançamento a baixar
     *  - VALORBAIXA       (obrig.) valor a baixar (aceita "465,00" ou "465.00")
     *  - CODCXA           (obrig.) conta/caixa que recebe (ou env FIN_CODCXA_PADRAO)
     *  - TIPOFORMAPAGTO   (obrig.) Dinheiro | Cheque | Cartao | Transferencia | Pix | ...
     *  - CODCOLIGADA      (opc., default 1)
     *  - CODFILIAL        (opc., default 1)
     *  - DATABAIXA        (opc., default hoje, formato Y-m-d)
     *  - HISTORICOBAIXA   (opc.)
     *  - TIPOBAIXA        (opc., "Simplificada" | "Completa" | "Parcial"; default Simplificada)
     *  - IDFORMAPAGTO     (opc., id da Forma de Pagamento cadastrada no RM; default 1 = Dinheiro)
     *  - DRY_RUN          (opc., true = devolve o XML gerado sem enviar ao RM)
     *
     * @return array<string,mixed>
     * @throws ValidationException dados de entrada inválidos
     * @throws RMException         falha do RM ao processar a baixa
     */
    public function baixar(array $in): array
    {
        $req = function (string $chave) use ($in) {
            $v = $in[$chave] ?? '';
            if (is_string($v)) {
                $v = trim($v);
            }
            if ($v === '' || $v === null) {
                throw new ValidationException(
                    "Informe o campo obrigatório {$chave} para realizar a baixa.",
                    "Baixa: campo obrigatório ausente ({$chave})",
                    $in
                );
            }
            return $v;
        };

        $idLan = $req('IDLAN');
        if (!is_numeric($idLan)) {
            throw new ValidationException(
                'O IDLAN deve ser numérico (id do lançamento no RM).',
                'Baixa: IDLAN não numérico',
                $in
            );
        }

        $valorBaixa = self::normalizarDecimal((string) $req('VALORBAIXA'));
        if ((float) $valorBaixa <= 0) {
            throw new ValidationException(
                'O VALORBAIXA deve ser maior que zero.',
                'Baixa: valor inválido',
                $in
            );
        }

        // CODCXA: do corpo ou de um default por env (FIN_CODCXA_PADRAO).
        $codCxa = trim((string) ($in['CODCXA'] ?? ''));
        if ($codCxa === '') {
            $codCxa = trim((string) Env::get('FIN_CODCXA_PADRAO', ''));
        }
        if ($codCxa === '') {
            throw new ValidationException(
                'Informe o CODCXA (conta/caixa) da baixa, ou configure FIN_CODCXA_PADRAO.',
                'Baixa: CODCXA ausente',
                $in
            );
        }

        $formaPagto = (string) $req('TIPOFORMAPAGTO');
        if (!in_array($formaPagto, self::FORMAS_PAGAMENTO, true)) {
            throw new ValidationException(
                "TIPOFORMAPAGTO inválido. Use um de: " . implode(', ', self::FORMAS_PAGAMENTO) . '.',
                'Baixa: forma de pagamento inválida',
                $in
            );
        }

        $tipoBaixa = (string) ($in['TIPOBAIXA'] ?? 'Simplificada');
        if (!in_array($tipoBaixa, ['Simplificada', 'Completa', 'Parcial'], true)) {
            throw new ValidationException(
                'TIPOBAIXA deve ser "Simplificada", "Completa" ou "Parcial".',
                'Baixa: tipo de baixa inválido',
                $in
            );
        }

        $codColigada = (int) ($in['CODCOLIGADA'] ?? 1);
        $codFilial   = (int) ($in['CODFILIAL'] ?? 1);
        $dataBaixa   = trim((string) ($in['DATABAIXA'] ?? '')) ?: date('Y-m-d');
        $historico   = (string) ($in['HISTORICOBAIXA'] ?? '');
        $codUsuario  = (string) ($this->rmConfig['usuario_servico'] ?? 'integra.eduvem');
        // Forma de pagamento CADASTRADA no RM (FFORMAPAGTO). No contrato TBC o
        // meio de pagamento é este id (1 = Dinheiro na base FMP); TIPOFORMAPAGTO
        // permanece como validação/documentação da intenção.
        $idFormaPagto = trim((string) ($in['IDFORMAPAGTO'] ?? '1'));

        // Nome do process server e operação SOAP configuráveis (o RM pode expor
        // a baixa sob outro nome/operação conforme a versão — ver config/rm.php).
        $processo = (string) ($this->rmConfig['baixa']['processo'] ?? self::PROCESSO);
        $operacao = (string) ($this->rmConfig['baixa']['operacao'] ?? 'ExecuteWithParams');

        // Builder conforme o processo: TBC (contratos WS oficiais da TOTVS) ou o
        // replay do processo da tela (legado/fallback).
        $xml = match ($processo) {
            'FinTBCBaixaDataProcess' => ProcessXml::baixaLancamentoTbc(
                codColigada: $codColigada,
                codFilial: $codFilial,
                idLan: (string) $idLan,
                valorBaixa: $valorBaixa,
                codCxa: $codCxa,
                dataBaixa: $dataBaixa,
                historico: $historico,
                idFormaPagto: $idFormaPagto
            ),
            'FinLanBaixaTBCData' => ProcessXml::baixaLancamentoTbcLan(
                codColigada: $codColigada,
                codFilial: $codFilial,
                idLan: (string) $idLan,
                valorBaixa: $valorBaixa,
                codCxa: $codCxa,
                dataBaixa: $dataBaixa,
                historico: $historico,
                codUsuario: $codUsuario,
                idFormaPagto: $idFormaPagto
            ),
            default => ProcessXml::baixaLancamento(
                codColigada: $codColigada,
                codFilial: $codFilial,
                idLan: (string) $idLan,
                valorBaixa: $valorBaixa,
                codCxa: $codCxa,
                tipoFormaPagto: $formaPagto,
                dataBaixa: $dataBaixa,
                historico: $historico,
                codUsuario: $codUsuario,
                tipoBaixa: $tipoBaixa
            ),
        };

        // Modo diagnóstico: devolve o XML gerado SEM enviar ao RM. Serve para
        // auditar o payload da versão implantada (tamanho/md5 identificam a
        // versão do builder) e conferir os valores preenchidos.
        if (filter_var($in['DRY_RUN'] ?? false, FILTER_VALIDATE_BOOL)) {
            return [
                'dry_run'   => true,
                'PROCESSO'  => $processo,
                'OPERACAO'  => $operacao,
                'ws_url'    => (string) ($this->rmConfig['ws_url'] ?? ''),
                'xml_bytes' => strlen($xml),
                'xml_md5'   => md5($xml),
                'xml'       => $xml,
            ];
        }

        $retorno = $operacao === 'ExecuteWithXMLParams'
            ? $this->rm->executeWithXmlParams($processo, $xml)
            : $this->rm->executeWithParams($processo, $xml);

        // Processos do RM às vezes retornam apenas o JobId; se o retorno for um
        // id numérico diferente de "1", tenta anexar o log do job (Monitor de
        // Jobs) para dar contexto. "1" = sucesso direto.
        $logJob = null;
        if (is_numeric($retorno) && $retorno !== '1') {
            $logJob = $this->consulta->logProcessoFormatado($retorno);
        }

        return [
            'IDLAN'         => (string) $idLan,
            'CODCOLIGADA'   => (string) $codColigada,
            'VALORBAIXADO'  => $valorBaixa,
            'DATABAIXA'     => $dataBaixa,
            'CODCXA'        => $codCxa,
            'FORMAPAGTO'    => $formaPagto,
            'TIPOBAIXA'     => $tipoBaixa,
            'PROCESSO'      => $processo,
            'retorno_rm'    => $retorno,
            'log_job'       => $logJob,
        ];
    }

    /**
     * Normaliza um valor monetário para o formato do RM (ponto decimal, sem
     * separador de milhar): "1.234,56" -> "1234.56", "465,00" -> "465.00",
     * "465" -> "465.00".
     */
    private static function normalizarDecimal(string $valor): string
    {
        $v = trim($valor);
        if ($v === '') {
            return '0.00';
        }

        // Formato brasileiro "1.234,56": remove pontos (milhar), vírgula -> ponto.
        if (str_contains($v, ',') && str_contains($v, '.')) {
            $v = str_replace('.', '', $v);
            $v = str_replace(',', '.', $v);
        } elseif (str_contains($v, ',')) {
            $v = str_replace(',', '.', $v);
        }

        return number_format((float) $v, 2, '.', '');
    }
}
