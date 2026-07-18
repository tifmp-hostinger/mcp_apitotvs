<?php

declare(strict_types=1);

namespace FMP\RMApi\Services;

use FMP\RMApi\Clients\RMSoapClient;

/**
 * Centraliza TODAS as sentenças SQL cadastradas no RM (INT.EDUVEM.*),
 * com nomes de método semânticos. Nenhum outro lugar do código deve
 * referenciar códigos de sentença diretamente.
 */
class ConsultaService
{
    public const SQL_STATUS              = 'INT.EDUVEM.00001';
    public const SQL_ESTADOS             = 'INT.EDUVEM.00002';
    public const SQL_CIDADES_POR_UF      = 'INT.EDUVEM.00003';
    public const SQL_BAIRROS_POR_CIDADE  = 'INT.EDUVEM.00004';
    public const SQL_ENDERECO_POR_CEP    = 'INT.EDUVEM.00005';
    public const SQL_OFERTA              = 'INT.EDUVEM.00006';
    public const SQL_PESSOA_POR_CPF_RNM  = 'INT.EDUVEM.00007';
    public const SQL_ALUNO               = 'INT.EDUVEM.00008';
    public const SQL_CLIFOR_POR_CPF_RNM  = 'INT.EDUVEM.00009';
    public const SQL_CIDADE_POR_CODIGO   = 'INT.EDUVEM.00010';
    public const SQL_MATRICULA_CURSO     = 'INT.EDUVEM.00011';
    public const SQL_PLANOS_PAGAMENTO    = 'INT.EDUVEM.00013';
    public const SQL_MATRICULA_PL        = 'INT.EDUVEM.00014';
    public const SQL_CUPOM               = 'INT.EDUVEM.00016';
    public const SQL_BOLSA_APLICADA      = 'INT.EDUVEM.00017';
    public const SQL_LANCAMENTOS         = 'INT.EDUVEM.00018';
    public const SQL_TURMAS_DISCIPLINAS  = 'INT.EDUVEM.00019';
    public const SQL_BAIRRO_POR_CODIGO   = 'INT.EDUVEM.00020';
    /** Log de execução de job do Monitor de Jobs (parâmetro JOBID_N) — ver API.md. */
    public const SQL_LOG_PROCESSO         = 'INT.EDUVEM.00021';

    public function __construct(private readonly RMSoapClient $rm)
    {
    }

    /* ---------- Processos / Jobs ---------- */

    /**
     * Busca o log de execução de um job (detalhes, erros, parâmetros, resumo)
     * e devolve como texto. Retorna null se a sentença SQL_LOG_PROCESSO ainda
     * não estiver cadastrada no RM ou não houver linhas — nunca lança exceção,
     * pois é usado dentro de tratamentos de erro.
     */
    public function logProcessoFormatado(string|int $jobId): ?string
    {
        try {
            $rows = $this->rm->realizarConsultaSQL(self::SQL_LOG_PROCESSO, ['JOBID_N' => $jobId]);
        } catch (\Throwable) {
            return null;
        }

        if (count($rows) === 0) {
            return null;
        }

        $linhas = [];
        foreach ($rows as $row) {
            $valores = array_map(
                fn($v) => trim(is_array($v) ? json_encode($v, JSON_UNESCAPED_UNICODE) : (string) $v),
                array_values($row)
            );
            $linhas[] = implode(' | ', array_filter($valores, fn($v) => $v !== ''));
        }

        return "LOG DO JOB {$jobId} (Monitor de Jobs do RM):\n" . implode("\n", $linhas);
    }

    /* ---------- Sistema ---------- */

    public function status(): array
    {
        return $this->rm->realizarConsultaSQL(self::SQL_STATUS);
    }

    /* ---------- Endereço ---------- */

    public function estados(): array
    {
        return $this->rm->realizarConsultaSQL(self::SQL_ESTADOS);
    }

    public function cidadesPorUf(string $codEstado): array
    {
        return $this->rm->realizarConsultaSQL(self::SQL_CIDADES_POR_UF, ['CODESTADO_S' => $codEstado]);
    }

    public function bairrosPorCidade(string $codCidade): array
    {
        return $this->rm->realizarConsultaSQL(self::SQL_BAIRROS_POR_CIDADE, ['CODCIDADE_S' => $codCidade]);
    }

    public function enderecoPorCep(string $cep): array
    {
        return $this->rm->realizarConsultaSQL(self::SQL_ENDERECO_POR_CEP, ['CEP_S' => $cep]);
    }

    public function cidadePorCodigo(string $codCidade): ?array
    {
        $rows = $this->rm->realizarConsultaSQL(self::SQL_CIDADE_POR_CODIGO, ['CODCIDADE_S' => $codCidade]);
        return $rows[0] ?? null;
    }

    public function bairroPorCodigo(string $codBairro): ?array
    {
        $rows = $this->rm->realizarConsultaSQL(self::SQL_BAIRRO_POR_CODIGO, ['CODBAIRRO_S' => $codBairro]);
        return $rows[0] ?? null;
    }

    /* ---------- Oferta ---------- */

    public function oferta(string $codOferta): ?array
    {
        $rows = $this->rm->realizarConsultaSQL(self::SQL_OFERTA, ['CODOFERTA_S' => $codOferta]);
        return $rows[0] ?? null;
    }

    public function planosPagamento(string $codOferta): array
    {
        return $this->rm->realizarConsultaSQL(self::SQL_PLANOS_PAGAMENTO, ['CODOFERTA_S' => $codOferta]);
    }

    /* ---------- Pessoa / Aluno ---------- */

    public function pessoaPorCpfRnm(string $cpf, string $rnm): ?array
    {
        $rows = $this->rm->realizarConsultaSQL(self::SQL_PESSOA_POR_CPF_RNM, [
            'CPF_S' => $cpf !== '' ? $cpf : '0',
            'RNM_S' => $rnm !== '' ? $rnm : '0',
        ]);
        return $rows[0] ?? null;
    }

    public function aluno(string|int $codPessoa, string|int $codColigada): ?array
    {
        $rows = $this->rm->realizarConsultaSQL(self::SQL_ALUNO, [
            'CODPESSOA_N'   => $codPessoa,
            'CODCOLIGADA_N' => $codColigada,
        ]);
        return $rows[0] ?? null;
    }

    public function cliForPorCpfRnm(string $cpf, string $rnm): ?array
    {
        $rows = $this->rm->realizarConsultaSQL(self::SQL_CLIFOR_POR_CPF_RNM, [
            'CPF_S' => $cpf !== '' ? $cpf : '0',
            'RNM_S' => $rnm !== '' ? $rnm : '0',
        ]);
        return $rows[0] ?? null;
    }

    /* ---------- Matrícula ---------- */

    public function matriculaCurso(string $codOferta, string $ra): ?array
    {
        $rows = $this->rm->realizarConsultaSQL(self::SQL_MATRICULA_CURSO, [
            'CODOFERTA_S' => $codOferta,
            'RA_S'        => $ra,
        ]);
        return $rows[0] ?? null;
    }

    public function matriculaPeriodoLetivo(string $codOferta, string $ra): ?array
    {
        $rows = $this->rm->realizarConsultaSQL(self::SQL_MATRICULA_PL, [
            'CODOFERTA_S' => $codOferta,
            'RA_S'        => $ra,
        ]);
        return $rows[0] ?? null;
    }

    public function turmasDisciplinas(string $codOferta, string|int $idPerlet, string $codTurma): array
    {
        return $this->rm->realizarConsultaSQL(self::SQL_TURMAS_DISCIPLINAS, [
            'CODOFERTA_S' => $codOferta,
            'IDPERLET_N'  => $idPerlet,
            'CODTURMA_S'  => $codTurma,
        ]);
    }

    /* ---------- Cupom / Bolsa / Financeiro ---------- */

    public function cupom(string $codOferta, string $codPlanoPgto, string $cupom): ?array
    {
        $rows = $this->rm->realizarConsultaSQL(self::SQL_CUPOM, [
            'CODOFERTA_S'    => $codOferta,
            'CODPLANOPGTO_S' => $codPlanoPgto,
            'CUPOM_S'        => $cupom,
        ]);
        return $rows[0] ?? null;
    }

    public function bolsaAplicada(
        string|int $codColigada,
        string|int $idPerlet,
        string $codContrato,
        string $ra,
        string|int $codBolsa
    ): ?array {
        $rows = $this->rm->realizarConsultaSQL(self::SQL_BOLSA_APLICADA, [
            'CODCOLIGADA_N' => $codColigada,
            'IDPERLET_N'    => $idPerlet,
            'CODCONTRATO_S' => $codContrato,
            'RA_S'          => $ra,
            'CODBOLSA_N'    => $codBolsa,
        ]);
        return $rows[0] ?? null;
    }

    public function lancamentos(
        string|int $codColigada,
        string|int $idPerlet,
        string $codContrato,
        string $ra
    ): array {
        return $this->rm->realizarConsultaSQL(self::SQL_LANCAMENTOS, [
            'CODCOLIGADA_N' => $codColigada,
            'IDPERLET_N'    => $idPerlet,
            'CODCONTRATO_S' => $codContrato,
            'RA_S'          => $ra,
        ]);
    }
}
