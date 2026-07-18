/**
 * Lançamentos financeiros a partir do contrato — porte de LancamentoService.php
 * (processo EduGerarLancFromContratoSliceableData).
 */

import type { RMSoapClient } from '../rm/soap-client.js';
import { RMError, ValidationError } from '../rm/errors.js';
import { gerarLancamento as xmlGerarLancamento } from '../support/process-xml.js';
import { ConsultaService, SQL_LANCAMENTOS, SQL_LOG_PROCESSO } from './consulta.js';
import { s, sleep, vazio } from './util.js';

export const PROCESSO_LANCAMENTO = 'EduGerarLancFromContratoSliceableData';

export class LancamentoService {
    constructor(
        private readonly rm: RMSoapClient,
        private readonly consulta: ConsultaService
    ) {
    }

    /**
     * Geração a partir de RA + OFERTA (rota autônoma). CODCONTRATO opcional:
     * se vazio, resolve pela matrícula no período letivo (INT.EDUVEM.00014).
     */
    async gerarPorRaOferta(ra: string, offer: string, codContrato = ''): Promise<Record<string, unknown>> {
        const oferta = await this.consulta.oferta(offer);
        if (oferta === null) {
            throw new ValidationError(
                `Oferta '${offer}' não encontrada.`,
                'Geração de lançamentos: oferta inexistente',
                { OFERTA: offer }
            );
        }

        let contrato = codContrato.trim();
        if (contrato === '') {
            const pl = await this.consulta.matriculaPeriodoLetivo(offer, ra);
            if (pl === null || vazio(pl['CODCONTRATO'])) {
                throw new ValidationError(
                    `Não foi possível localizar o contrato do aluno (RA ${ra}) nesta oferta. `
                        + 'Envie CODCONTRATO no corpo ou faça a matrícula no período letivo antes.',
                    'Geração de lançamentos: contrato não informado/localizado',
                    { RA: ra, OFERTA: offer }
                );
            }
            contrato = s(pl['CODCONTRATO']);
        }

        const res = await this.gerar(
            s(oferta['CODCOLIGADA']),
            s(oferta['CODFILIAL']),
            s(oferta['IDPERLET']),
            ra,
            contrato
        );

        return { ...res, CODCONTRATO: contrato, RA: ra, OFERTA: offer };
    }

    /**
     * Gera os lançamentos do contrato. Idempotente; confirmação com
     * retentativas (o job do RM é assíncrono). Em falha, anexa o log do job.
     */
    async gerar(
        codColigada: string | number,
        codFilial: string | number,
        idPerlet: string | number,
        ra: string,
        codContrato: string
    ): Promise<{ gerados: boolean; ja_existiam: boolean }> {
        const existentes = await this.consulta.lancamentos(codColigada, idPerlet, codContrato, ra);
        if (existentes.length > 0) {
            return { gerados: false, ja_existiam: true };
        }

        const xml = xmlGerarLancamento({ codColigada, codFilial, idPerlet, ra, codContrato });

        const resultado = await this.rm.executeWithXmlParams(PROCESSO_LANCAMENTO, xml);

        let gerados: Array<Record<string, unknown>> = [];
        for (let tentativa = 1; tentativa <= 6; tentativa++) {
            gerados = await this.consulta.lancamentos(codColigada, idPerlet, codContrato, ra);
            if (gerados.length > 0) {
                break;
            }
            await sleep(2000);
        }

        if (gerados.length === 0) {
            let logJob: string | null = null;
            if (/^\d+$/.test(resultado) && resultado !== '1') {
                logJob = await this.consulta.logProcessoFormatado(resultado);
            }

            const detalheLog = logJob !== null
                ? `\n\n${logJob}`
                : ` Cadastre a sentença ${SQL_LOG_PROCESSO} no RM (ver API.md) para anexar automaticamente o log do job`
                    + ' (detalhes, erros, parâmetros e resumo do Monitor de Jobs).';

            throw new RMError(
                'Erro ao gerar lançamento financeiro',
                'ExecuteWithXMLParams',
                PROCESSO_LANCAMENTO,
                {},
                xml,
                null,
                `Retorno do processo 'Gerar lançamento': ${resultado}. `
                    + `Os lançamentos não foram localizados pela consulta ${SQL_LANCAMENTOS} após 6 tentativas (~12s).`
                    + detalheLog
            );
        }

        return { gerados: true, ja_existiam: false };
    }
}
