<?php

declare(strict_types=1);

namespace FMP\RMApi\Services;

use FMP\RMApi\Clients\RMSoapClient;
use FMP\RMApi\Exceptions\RMException;
use FMP\RMApi\Support\ProcessXml;

/**
 * Matrícula do aluno:
 *  - no curso (EduHabilitacaoAlunoData, CODSTATUS 23 = pré-matrícula)
 *  - no período letivo (processo EduMatriculaProcData → gera contrato)
 *  - nas turmas/disciplinas (processo EduMatriculaProcData / enturmação)
 */
class MatriculaService
{
    public const DATASERVER_HABILITACAO = 'EduHabilitacaoAlunoData';
    public const PROCESSO_MATRICULA     = 'EduMatriculaProcData';

    /** Resultado da enturmação quando o aluno já cursa a disciplina. */
    public const MSG_JA_CURSANDO = 'O aluno já está cursando a disciplina';
    /** Resultado da enturmação quando há débitos anteriores. */
    public const MSG_DEBITOS = 'Existem débitos anteriores para o sacado';

    public function __construct(
        private readonly RMSoapClient $rm,
        private readonly ConsultaService $consulta,
        private readonly array $rmConfig
    ) {
    }

    private function contexto(string|int $codColigada, string|int $codTipoCurso, string|int $codFilial): array
    {
        return [
            'CODCOLIGADA'  => $codColigada,
            'CODTIPOCURSO' => $codTipoCurso,
            'CODFILIAL'    => $codFilial,
            'CODSISTEMA'   => $this->rmConfig['contexto_padrao']['CODSISTEMA'] ?? 'S',
            'CODUSUARIO'   => $this->rmConfig['usuario_servico'] ?? 'integra.eduvem',
        ];
    }

    /**
     * Matrícula (pré-matrícula, status 23) do aluno no curso da oferta.
     * Idempotente: se já existe, não regrava.
     * Retorna a linha da matrícula (INT.EDUVEM.00011).
     */
    public function matricularNoCurso(string $ra, string $codOferta, array $oferta): array
    {
        $existente = $this->consulta->matriculaCurso($codOferta, $ra);
        if ($existente !== null) {
            return $existente;
        }

        $codColigada         = $oferta['CODCOLIGADA'];
        $idHabilitacaoFilial = $oferta['IDHABILITACAOFILIAL'];
        $codTipoCurso        = $oferta['CODTIPOCURSO'];
        $codFilial           = $oferta['CODFILIAL'];

        $xml = <<<XML
        <EduHabilitacaoAluno>
            <SHabilitacaoAluno>
                <CODCOLIGADA>{$codColigada}</CODCOLIGADA>
                <IDHABILITACAOFILIAL>{$idHabilitacaoFilial}</IDHABILITACAOFILIAL>
                <RA>{$ra}</RA>
                <CODSTATUS>23</CODSTATUS>
                <CODCURSO>{$oferta['CODCURSO']}</CODCURSO>
                <CODHABILITACAO>{$oferta['CODHABILITACAO']}</CODHABILITACAO>
                <CODGRADE>{$oferta['CODGRADE']}</CODGRADE>
                <CODFILIAL>{$codFilial}</CODFILIAL>
                <CODTIPOCURSO>{$codTipoCurso}</CODTIPOCURSO>
                <CODTURNO>{$oferta['CODTURNO']}</CODTURNO>
            </SHabilitacaoAluno>
            <SHabilitacaoAlunoCompl>
                <CODCOLIGADA>{$codColigada}</CODCOLIGADA>
                <IDHABILITACAOFILIAL>{$idHabilitacaoFilial}</IDHABILITACAOFILIAL>
                <RA>{$ra}</RA>
            </SHabilitacaoAlunoCompl>
        </EduHabilitacaoAluno>
        XML;

        $contexto = $this->contexto($codColigada, $codTipoCurso, $codFilial);
        $result = $this->rm->saveRecord(self::DATASERVER_HABILITACAO, $xml, $contexto);

        if ($result !== "{$codColigada};{$idHabilitacaoFilial};{$ra}") {
            throw new RMException(
                'O RM rejeitou a matrícula no curso',
                operacao: 'SaveRecord',
                dataServer: self::DATASERVER_HABILITACAO,
                contexto: $contexto,
                xmlEnviado: $xml,
                retornoRm: $result
            );
        }

        $criada = $this->consulta->matriculaCurso($codOferta, $ra);

        if ($criada === null) {
            throw new RMException(
                'Matrícula no curso não encontrada após a gravação',
                operacao: 'SaveRecord',
                dataServer: self::DATASERVER_HABILITACAO,
                contexto: $contexto,
                xmlEnviado: $xml,
                retornoRm: $result
            );
        }

        return $criada;
    }

    /**
     * Garante que o plano de pagamento existe/está disponível para a oferta
     * ANTES de disparar o processo de matrícula. Sem isso, o job do RM falha
     * com erro de chave estrangeira em SPLANOPGTO (dbo.PlanoDePagamento),
     * difícil de diagnosticar pelo monitor de jobs.
     */
    private function validarPlanoPagamento(string $codOferta, string $codPlanoPagamento): void
    {
        $planos = $this->consulta->planosPagamento($codOferta);

        $codigos = [];
        foreach ($planos as $plano) {
            foreach ($plano as $campo => $valor) {
                if (str_contains(strtoupper((string) $campo), 'PLANO')) {
                    $codigos[] = trim((string) $valor);
                }
            }
        }
        $codigos = array_values(array_unique(array_filter($codigos)));

        if (count($codigos) === 0) {
            throw new RMException(
                'A oferta não possui nenhum plano de pagamento cadastrado',
                operacao: 'RealizarConsultaSQL',
                dataServer: ConsultaService::SQL_PLANOS_PAGAMENTO,
                contexto: ['CODOFERTA_S' => $codOferta],
                retornoRm: 'A consulta INT.EDUVEM.00013 não retornou planos para esta oferta. '
                    . 'Cadastre o plano de pagamento no período letivo da oferta no RM '
                    . '(Gestão Educacional) antes de matricular.'
            );
        }

        if (!in_array($codPlanoPagamento, $codigos, true)) {
            throw new RMException(
                "O plano de pagamento '{$codPlanoPagamento}' não está disponível para esta oferta",
                operacao: 'RealizarConsultaSQL',
                dataServer: ConsultaService::SQL_PLANOS_PAGAMENTO,
                contexto: ['CODOFERTA_S' => $codOferta, 'PLANOPAGAMENTO' => $codPlanoPagamento],
                retornoRm: 'Planos disponíveis para a oferta: ' . implode(', ', $codigos) . '. '
                    . 'Enviar um plano fora desta lista faria o processo "Matricular aluno" '
                    . 'falhar no RM com violação de chave estrangeira em SPLANOPGTO.'
            );
        }
    }

    /**
     * Matrícula no período letivo via processo "Matricular aluno"
     * (gera o contrato). Idempotente.
     * Retorna a linha da matrícula no PL (inclui CODCONTRATO).
     */
    public function matricularNoPeriodoLetivo(
        string $ra,
        string $codOferta,
        array $oferta,
        string $codPlanoPagamento
    ): array {
        $existente = $this->consulta->matriculaPeriodoLetivo($codOferta, $ra);
        if ($existente !== null) {
            return $existente;
        }

        $this->validarPlanoPagamento($codOferta, $codPlanoPagamento);

        $xml = ProcessXml::matriculaPeriodoLetivo(
            codColigada: $oferta['CODCOLIGADA'],
            codFilial: $oferta['CODFILIAL'],
            idHabilitacaoFilial: $oferta['IDHABILITACAOFILIAL'],
            idPerlet: $oferta['IDPERLET'],
            ra: $ra,
            codTurma: $oferta['CODTURMA'],
            codPlanoPagamento: $codPlanoPagamento,
            now: date('Y-m-d') . 'T' . date('H:i:s')
        );

        $resultado = $this->rm->executeWithXmlParams(self::PROCESSO_MATRICULA, $xml);

        // O processo roda via JobMonitor (SyncExecution=false) e pode concluir
        // de forma assíncrona: aguarda a matrícula aparecer antes de falhar.
        $criada = null;
        for ($tentativa = 1; $tentativa <= 6; $tentativa++) {
            $criada = $this->consulta->matriculaPeriodoLetivo($codOferta, $ra);
            if ($criada !== null) {
                break;
            }
            sleep(2);
        }

        // Correção de bug do legado: a verificação pós-processo agora valida
        // a matrícula no PL (antes validava a variável errada, da matrícula no curso).
        if ($criada === null) {
            $logJob = null;
            if (is_numeric($resultado) && $resultado !== '1') {
                $logJob = $this->consulta->logProcessoFormatado($resultado);
            }

            $detalheLog = $logJob !== null
                ? "\n\n{$logJob}"
                : ' Cadastre a sentença ' . ConsultaService::SQL_LOG_PROCESSO
                    . ' no RM (ver API.md) para a API anexar automaticamente o log do job.';

            throw new RMException(
                'Matrícula no período letivo não encontrada após execução do processo',
                operacao: 'ExecuteWithXMLParams',
                dataServer: self::PROCESSO_MATRICULA,
                xmlEnviado: $xml,
                retornoRm: "Retorno do processo 'Matricular aluno': {$resultado}. "
                    . 'A matrícula não foi localizada pela consulta INT.EDUVEM.00014 '
                    . 'após 6 tentativas (~12s).'
                    . $detalheLog
            );
        }

        return $criada;
    }

    /**
     * Enturmação: matricula o aluno em cada turma/disciplina da oferta.
     * Retorna a lista de turmas processadas com o status de cada uma.
     */
    public function enturmar(string $ra, string $codOferta, array $oferta): array
    {
        $idPerlet = $oferta['IDPERLET'];
        $codTurma = $oferta['CODTURMA'];

        $turmas = $this->consulta->turmasDisciplinas($codOferta, $idPerlet, $codTurma);

        if (count($turmas) === 0) {
            throw new RMException(
                'Não foi possível encontrar turmas/disciplinas para incluir o aluno',
                operacao: 'RealizarConsultaSQL',
                dataServer: ConsultaService::SQL_TURMAS_DISCIPLINAS,
                contexto: ['CODOFERTA_S' => $codOferta, 'IDPERLET_N' => $idPerlet, 'CODTURMA_S' => $codTurma],
                retornoRm: 'Consulta não retornou linhas'
            );
        }

        $processadas = [];

        foreach ($turmas as $turma) {
            $xml = ProcessXml::matriculaDisciplina(
                groupToInclude: $turma,
                idPerlet: $idPerlet,
                idHabilitacaoFilial: $oferta['IDHABILITACAOFILIAL'],
                ra: $ra,
                codFilial: $oferta['CODFILIAL'],
                codTurma: $codTurma,
                now: date('Y-m-d') . 'T' . date('H:i:s')
            );

            $result = $this->rm->executeWithXmlParams(self::PROCESSO_MATRICULA, $xml);

            if (str_contains($result, self::MSG_DEBITOS)) {
                throw new RMException(
                    'Matrícula bloqueada por existência de débitos anteriores',
                    operacao: 'ExecuteWithXMLParams',
                    dataServer: self::PROCESSO_MATRICULA,
                    xmlEnviado: $xml,
                    retornoRm: $result
                );
            }

            $jaCursando = str_contains($result, self::MSG_JA_CURSANDO);

            if ($result !== '1' && !$jaCursando) {
                $logJob = is_numeric($result)
                    ? $this->consulta->logProcessoFormatado($result)
                    : null;

                throw new RMException(
                    'Erro inesperado na matrícula na turma/disciplina',
                    operacao: 'ExecuteWithXMLParams',
                    dataServer: self::PROCESSO_MATRICULA,
                    xmlEnviado: $xml,
                    retornoRm: $result . ($logJob !== null ? "\n\n{$logJob}" : '')
                );
            }

            $processadas[] = [
                'turma'       => $turma,
                'ja_cursando' => $jaCursando,
            ];
        }

        return $processadas;
    }
}
