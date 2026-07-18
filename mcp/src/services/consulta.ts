/**
 * Centraliza TODAS as sentenças SQL cadastradas no RM (INT.EDUVEM.*) —
 * porte fiel de Services/ConsultaService.php. Nenhum outro lugar do código
 * deve referenciar códigos de sentença diretamente.
 */

import type { RMSoapClient } from '../rm/soap-client.js';
import { s } from './util.js';

type Row = Record<string, unknown>;

export const SQL_STATUS = 'INT.EDUVEM.00001';
export const SQL_ESTADOS = 'INT.EDUVEM.00002';
export const SQL_CIDADES_POR_UF = 'INT.EDUVEM.00003';
export const SQL_BAIRROS_POR_CIDADE = 'INT.EDUVEM.00004';
export const SQL_ENDERECO_POR_CEP = 'INT.EDUVEM.00005';
export const SQL_OFERTA = 'INT.EDUVEM.00006';
export const SQL_PESSOA_POR_CPF_RNM = 'INT.EDUVEM.00007';
export const SQL_ALUNO = 'INT.EDUVEM.00008';
export const SQL_CLIFOR_POR_CPF_RNM = 'INT.EDUVEM.00009';
export const SQL_CIDADE_POR_CODIGO = 'INT.EDUVEM.00010';
export const SQL_MATRICULA_CURSO = 'INT.EDUVEM.00011';
export const SQL_PLANOS_PAGAMENTO = 'INT.EDUVEM.00013';
export const SQL_MATRICULA_PL = 'INT.EDUVEM.00014';
export const SQL_CUPOM = 'INT.EDUVEM.00016';
export const SQL_BOLSA_APLICADA = 'INT.EDUVEM.00017';
export const SQL_LANCAMENTOS = 'INT.EDUVEM.00018';
export const SQL_TURMAS_DISCIPLINAS = 'INT.EDUVEM.00019';
export const SQL_BAIRRO_POR_CODIGO = 'INT.EDUVEM.00020';
/** Log de execução de job do Monitor de Jobs (parâmetro JOBID_N). */
export const SQL_LOG_PROCESSO = 'INT.EDUVEM.00021';

export class ConsultaService {
    constructor(private readonly rm: RMSoapClient) {
    }

    /* ---------- Processos / Jobs ---------- */

    /**
     * Log de execução de um job como texto. null se a sentença não estiver
     * cadastrada ou não houver linhas — nunca lança (usado em tratamento de erro).
     */
    async logProcessoFormatado(jobId: string | number): Promise<string | null> {
        let rows: Row[];
        try {
            rows = await this.rm.realizarConsultaSQL(SQL_LOG_PROCESSO, { JOBID_N: jobId });
        } catch {
            return null;
        }
        if (rows.length === 0) {
            return null;
        }
        const linhas = rows.map((row) =>
            Object.values(row)
                .map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v).trim()))
                .filter((v) => v !== '')
                .join(' | ')
        );
        return `LOG DO JOB ${jobId} (Monitor de Jobs do RM):\n${linhas.join('\n')}`;
    }

    /* ---------- Sistema ---------- */

    status(): Promise<Row[]> {
        return this.rm.realizarConsultaSQL(SQL_STATUS);
    }

    /* ---------- Endereço ---------- */

    estados(): Promise<Row[]> {
        return this.rm.realizarConsultaSQL(SQL_ESTADOS);
    }

    cidadesPorUf(codEstado: string): Promise<Row[]> {
        return this.rm.realizarConsultaSQL(SQL_CIDADES_POR_UF, { CODESTADO_S: codEstado });
    }

    bairrosPorCidade(codCidade: string): Promise<Row[]> {
        return this.rm.realizarConsultaSQL(SQL_BAIRROS_POR_CIDADE, { CODCIDADE_S: codCidade });
    }

    enderecoPorCep(cep: string): Promise<Row[]> {
        return this.rm.realizarConsultaSQL(SQL_ENDERECO_POR_CEP, { CEP_S: cep });
    }

    async cidadePorCodigo(codCidade: string): Promise<Row | null> {
        const rows = await this.rm.realizarConsultaSQL(SQL_CIDADE_POR_CODIGO, { CODCIDADE_S: codCidade });
        return rows[0] ?? null;
    }

    async bairroPorCodigo(codBairro: string): Promise<Row | null> {
        const rows = await this.rm.realizarConsultaSQL(SQL_BAIRRO_POR_CODIGO, { CODBAIRRO_S: codBairro });
        return rows[0] ?? null;
    }

    /* ---------- Oferta ---------- */

    async oferta(codOferta: string): Promise<Row | null> {
        const rows = await this.rm.realizarConsultaSQL(SQL_OFERTA, { CODOFERTA_S: codOferta });
        return rows[0] ?? null;
    }

    planosPagamento(codOferta: string): Promise<Row[]> {
        return this.rm.realizarConsultaSQL(SQL_PLANOS_PAGAMENTO, { CODOFERTA_S: codOferta });
    }

    /* ---------- Pessoa / Aluno ---------- */

    async pessoaPorCpfRnm(cpf: string, rnm: string): Promise<Row | null> {
        const rows = await this.rm.realizarConsultaSQL(SQL_PESSOA_POR_CPF_RNM, {
            CPF_S: cpf !== '' ? cpf : '0',
            RNM_S: rnm !== '' ? rnm : '0',
        });
        return rows[0] ?? null;
    }

    async aluno(codPessoa: string | number, codColigada: string | number): Promise<Row | null> {
        const rows = await this.rm.realizarConsultaSQL(SQL_ALUNO, {
            CODPESSOA_N: codPessoa,
            CODCOLIGADA_N: codColigada,
        });
        return rows[0] ?? null;
    }

    async cliForPorCpfRnm(cpf: string, rnm: string): Promise<Row | null> {
        const rows = await this.rm.realizarConsultaSQL(SQL_CLIFOR_POR_CPF_RNM, {
            CPF_S: cpf !== '' ? cpf : '0',
            RNM_S: rnm !== '' ? rnm : '0',
        });
        return rows[0] ?? null;
    }

    /* ---------- Matrícula ---------- */

    async matriculaCurso(codOferta: string, ra: string): Promise<Row | null> {
        const rows = await this.rm.realizarConsultaSQL(SQL_MATRICULA_CURSO, {
            CODOFERTA_S: codOferta,
            RA_S: ra,
        });
        return rows[0] ?? null;
    }

    async matriculaPeriodoLetivo(codOferta: string, ra: string): Promise<Row | null> {
        const rows = await this.rm.realizarConsultaSQL(SQL_MATRICULA_PL, {
            CODOFERTA_S: codOferta,
            RA_S: ra,
        });
        return rows[0] ?? null;
    }

    turmasDisciplinas(codOferta: string, idPerlet: string | number, codTurma: string): Promise<Row[]> {
        return this.rm.realizarConsultaSQL(SQL_TURMAS_DISCIPLINAS, {
            CODOFERTA_S: codOferta,
            IDPERLET_N: idPerlet,
            CODTURMA_S: codTurma,
        });
    }

    /* ---------- Cupom / Bolsa / Financeiro ---------- */

    async cupom(codOferta: string, codPlanoPgto: string, cupom: string): Promise<Row | null> {
        const rows = await this.rm.realizarConsultaSQL(SQL_CUPOM, {
            CODOFERTA_S: codOferta,
            CODPLANOPGTO_S: codPlanoPgto,
            CUPOM_S: cupom,
        });
        return rows[0] ?? null;
    }

    async bolsaAplicada(
        codColigada: string | number,
        idPerlet: string | number,
        codContrato: string,
        ra: string,
        codBolsa: string | number
    ): Promise<Row | null> {
        const rows = await this.rm.realizarConsultaSQL(SQL_BOLSA_APLICADA, {
            CODCOLIGADA_N: codColigada,
            IDPERLET_N: idPerlet,
            CODCONTRATO_S: codContrato,
            RA_S: ra,
            CODBOLSA_N: codBolsa,
        });
        return rows[0] ?? null;
    }

    lancamentos(
        codColigada: string | number,
        idPerlet: string | number,
        codContrato: string,
        ra: string
    ): Promise<Row[]> {
        return this.rm.realizarConsultaSQL(SQL_LANCAMENTOS, {
            CODCOLIGADA_N: codColigada,
            IDPERLET_N: idPerlet,
            CODCONTRATO_S: codContrato,
            RA_S: ra,
        });
    }
}

export { s };
