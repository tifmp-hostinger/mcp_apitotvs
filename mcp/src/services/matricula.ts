/**
 * Matrícula do aluno — porte de Services/MatriculaService.php:
 *  - no curso (EduHabilitacaoAlunoData, CODSTATUS 23 = pré-matrícula)
 *  - no período letivo (processo EduMatriculaProcData → gera contrato)
 *  - nas turmas/disciplinas (enturmação)
 */

import type { RMSoapClient } from '../rm/soap-client.js';
import { RMError } from '../rm/errors.js';
import type { RmConfig } from '../config.js';
import { matriculaPeriodoLetivo as xmlMatriculaPL, matriculaDisciplina as xmlMatriculaDisc } from '../support/process-xml.js';
import { agoraIso } from '../support/xml.js';
import { ConsultaService, SQL_PLANOS_PAGAMENTO, SQL_TURMAS_DISCIPLINAS, SQL_LOG_PROCESSO } from './consulta.js';
import { s, sleep } from './util.js';

export const DATASERVER_HABILITACAO = 'EduHabilitacaoAlunoData';
export const PROCESSO_MATRICULA = 'EduMatriculaProcData';

/** Resultado da enturmação quando o aluno já cursa a disciplina. */
export const MSG_JA_CURSANDO = 'O aluno já está cursando a disciplina';
/** Resultado da enturmação quando há débitos anteriores. */
export const MSG_DEBITOS = 'Existem débitos anteriores para o sacado';

type Row = Record<string, unknown>;

export class MatriculaService {
    constructor(
        private readonly rm: RMSoapClient,
        private readonly consulta: ConsultaService,
        private readonly cfg: RmConfig
    ) {
    }

    private contexto(
        codColigada: string | number,
        codTipoCurso: string | number,
        codFilial: string | number
    ): Record<string, string | number> {
        return {
            CODCOLIGADA: codColigada,
            CODTIPOCURSO: codTipoCurso,
            CODFILIAL: codFilial,
            CODSISTEMA: this.cfg.contextoPadrao.CODSISTEMA,
            CODUSUARIO: this.cfg.usuarioServico,
        };
    }

    /**
     * Pré-matrícula (status 23) no curso da oferta. Idempotente.
     * Retorna a linha da matrícula (INT.EDUVEM.00011).
     */
    async matricularNoCurso(ra: string, codOferta: string, oferta: Row): Promise<Row> {
        const existente = await this.consulta.matriculaCurso(codOferta, ra);
        if (existente !== null) {
            return existente;
        }

        const codColigada = s(oferta['CODCOLIGADA']);
        const idHabilitacaoFilial = s(oferta['IDHABILITACAOFILIAL']);
        const codTipoCurso = s(oferta['CODTIPOCURSO']);
        const codFilial = s(oferta['CODFILIAL']);

        const xml = `<EduHabilitacaoAluno>
    <SHabilitacaoAluno>
        <CODCOLIGADA>${codColigada}</CODCOLIGADA>
        <IDHABILITACAOFILIAL>${idHabilitacaoFilial}</IDHABILITACAOFILIAL>
        <RA>${ra}</RA>
        <CODSTATUS>23</CODSTATUS>
        <CODCURSO>${s(oferta['CODCURSO'])}</CODCURSO>
        <CODHABILITACAO>${s(oferta['CODHABILITACAO'])}</CODHABILITACAO>
        <CODGRADE>${s(oferta['CODGRADE'])}</CODGRADE>
        <CODFILIAL>${codFilial}</CODFILIAL>
        <CODTIPOCURSO>${codTipoCurso}</CODTIPOCURSO>
        <CODTURNO>${s(oferta['CODTURNO'])}</CODTURNO>
    </SHabilitacaoAluno>
    <SHabilitacaoAlunoCompl>
        <CODCOLIGADA>${codColigada}</CODCOLIGADA>
        <IDHABILITACAOFILIAL>${idHabilitacaoFilial}</IDHABILITACAOFILIAL>
        <RA>${ra}</RA>
    </SHabilitacaoAlunoCompl>
</EduHabilitacaoAluno>`;

        const contexto = this.contexto(codColigada, codTipoCurso, codFilial);
        const result = await this.rm.saveRecord(DATASERVER_HABILITACAO, xml, contexto);

        if (result !== `${codColigada};${idHabilitacaoFilial};${ra}`) {
            throw new RMError(
                'O RM rejeitou a matrícula no curso',
                'SaveRecord',
                DATASERVER_HABILITACAO,
                contexto,
                xml,
                null,
                result
            );
        }

        const criada = await this.consulta.matriculaCurso(codOferta, ra);
        if (criada === null) {
            throw new RMError(
                'Matrícula no curso não encontrada após a gravação',
                'SaveRecord',
                DATASERVER_HABILITACAO,
                contexto,
                xml,
                null,
                result
            );
        }
        return criada;
    }

    /**
     * Valida o plano de pagamento da oferta ANTES do processo (sem isso o job
     * falha com violação de FK em SPLANOPGTO, difícil de diagnosticar).
     */
    private async validarPlanoPagamento(codOferta: string, codPlanoPagamento: string): Promise<void> {
        const planos = await this.consulta.planosPagamento(codOferta);

        const codigos: string[] = [];
        for (const plano of planos) {
            for (const [campo, valor] of Object.entries(plano)) {
                if (campo.toUpperCase().includes('PLANO')) {
                    codigos.push(s(valor).trim());
                }
            }
        }
        const unicos = [...new Set(codigos.filter((c) => c !== ''))];

        if (unicos.length === 0) {
            throw new RMError(
                'A oferta não possui nenhum plano de pagamento cadastrado',
                'RealizarConsultaSQL',
                SQL_PLANOS_PAGAMENTO,
                { CODOFERTA_S: codOferta },
                null,
                null,
                'A consulta INT.EDUVEM.00013 não retornou planos para esta oferta. '
                    + 'Cadastre o plano de pagamento no período letivo da oferta no RM '
                    + '(Gestão Educacional) antes de matricular.'
            );
        }

        if (!unicos.includes(codPlanoPagamento)) {
            throw new RMError(
                `O plano de pagamento '${codPlanoPagamento}' não está disponível para esta oferta`,
                'RealizarConsultaSQL',
                SQL_PLANOS_PAGAMENTO,
                { CODOFERTA_S: codOferta, PLANOPAGAMENTO: codPlanoPagamento },
                null,
                null,
                `Planos disponíveis para a oferta: ${unicos.join(', ')}. `
                    + 'Enviar um plano fora desta lista faria o processo "Matricular aluno" '
                    + 'falhar no RM com violação de chave estrangeira em SPLANOPGTO.'
            );
        }
    }

    /**
     * Matrícula no período letivo via processo "Matricular aluno" (gera o
     * contrato). Idempotente. Retorna a linha do PL (inclui CODCONTRATO).
     */
    async matricularNoPeriodoLetivo(
        ra: string,
        codOferta: string,
        oferta: Row,
        codPlanoPagamento: string
    ): Promise<Row> {
        const existente = await this.consulta.matriculaPeriodoLetivo(codOferta, ra);
        if (existente !== null) {
            return existente;
        }

        await this.validarPlanoPagamento(codOferta, codPlanoPagamento);

        const xml = xmlMatriculaPL({
            codColigada: s(oferta['CODCOLIGADA']),
            codFilial: s(oferta['CODFILIAL']),
            idHabilitacaoFilial: s(oferta['IDHABILITACAOFILIAL']),
            idPerlet: s(oferta['IDPERLET']),
            ra,
            codTurma: s(oferta['CODTURMA']),
            codPlanoPagamento,
            now: agoraIso(),
        });

        const resultado = await this.rm.executeWithXmlParams(PROCESSO_MATRICULA, xml);

        // O processo roda via JobMonitor (assíncrono): aguarda a matrícula
        // aparecer antes de considerar falha.
        let criada: Row | null = null;
        for (let tentativa = 1; tentativa <= 6; tentativa++) {
            criada = await this.consulta.matriculaPeriodoLetivo(codOferta, ra);
            if (criada !== null) {
                break;
            }
            await sleep(2000);
        }

        if (criada === null) {
            let logJob: string | null = null;
            if (/^\d+$/.test(resultado) && resultado !== '1') {
                logJob = await this.consulta.logProcessoFormatado(resultado);
            }

            const detalheLog = logJob !== null
                ? `\n\n${logJob}`
                : ` Cadastre a sentença ${SQL_LOG_PROCESSO} no RM (ver API.md) para anexar automaticamente o log do job.`;

            throw new RMError(
                'Matrícula no período letivo não encontrada após execução do processo',
                'ExecuteWithXMLParams',
                PROCESSO_MATRICULA,
                {},
                xml,
                null,
                `Retorno do processo 'Matricular aluno': ${resultado}. `
                    + 'A matrícula não foi localizada pela consulta INT.EDUVEM.00014 '
                    + 'após 6 tentativas (~12s).'
                    + detalheLog
            );
        }

        return criada;
    }

    /**
     * Enturmação: matricula o aluno em cada turma/disciplina da oferta.
     * Retorna a lista de turmas processadas com o status de cada uma.
     */
    async enturmar(ra: string, codOferta: string, oferta: Row): Promise<Array<{ turma: Row; ja_cursando: boolean }>> {
        const idPerlet = s(oferta['IDPERLET']);
        const codTurma = s(oferta['CODTURMA']);

        const turmas = await this.consulta.turmasDisciplinas(codOferta, idPerlet, codTurma);

        if (turmas.length === 0) {
            throw new RMError(
                'Não foi possível encontrar turmas/disciplinas para incluir o aluno',
                'RealizarConsultaSQL',
                SQL_TURMAS_DISCIPLINAS,
                { CODOFERTA_S: codOferta, IDPERLET_N: idPerlet, CODTURMA_S: codTurma },
                null,
                null,
                'Consulta não retornou linhas'
            );
        }

        const processadas: Array<{ turma: Row; ja_cursando: boolean }> = [];

        for (const turma of turmas) {
            const xml = xmlMatriculaDisc({
                group: turma,
                idPerlet,
                idHabilitacaoFilial: s(oferta['IDHABILITACAOFILIAL']),
                ra,
                codFilial: s(oferta['CODFILIAL']),
                codTurma,
                now: agoraIso(),
            });

            const result = await this.rm.executeWithXmlParams(PROCESSO_MATRICULA, xml);

            if (result.includes(MSG_DEBITOS)) {
                throw new RMError(
                    'Matrícula bloqueada por existência de débitos anteriores',
                    'ExecuteWithXMLParams',
                    PROCESSO_MATRICULA,
                    {},
                    xml,
                    null,
                    result
                );
            }

            const jaCursando = result.includes(MSG_JA_CURSANDO);

            if (result !== '1' && !jaCursando) {
                const logJob = /^\d+$/.test(result)
                    ? await this.consulta.logProcessoFormatado(result)
                    : null;

                throw new RMError(
                    'Erro inesperado na matrícula na turma/disciplina',
                    'ExecuteWithXMLParams',
                    PROCESSO_MATRICULA,
                    {},
                    xml,
                    null,
                    result + (logJob !== null ? `\n\n${logJob}` : '')
                );
            }

            processadas.push({ turma, ja_cursando: jaCursando });
        }

        return processadas;
    }
}
