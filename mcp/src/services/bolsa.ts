/** Cupons de desconto → bolsas do aluno (EduBolsaAlunoData) — porte de BolsaService.php. */

import type { RMSoapClient } from '../rm/soap-client.js';
import { RMError, ValidationError } from '../rm/errors.js';
import type { RmConfig } from '../config.js';
import { agoraIso } from '../support/xml.js';
import type { ConsultaService } from './consulta.js';
import { s, vazio } from './util.js';

export const DATASERVER_BOLSA = 'EduBolsaAlunoData';

type Row = Record<string, unknown>;

export class BolsaService {
    constructor(
        private readonly rm: RMSoapClient,
        private readonly consulta: ConsultaService,
        private readonly cfg: RmConfig
    ) {
    }

    /** Valida o cupom para a oferta/plano. Retorna os dados da bolsa ou null. */
    validarCupom(codOferta: string, codPlanoPgto: string, cupom: string): Promise<Row | null> {
        return this.consulta.cupom(codOferta, codPlanoPgto, cupom);
    }

    /**
     * Aplica um cupom a partir de RA + OFERTA + PLANO (rota autônoma).
     * CODCONTRATO opcional: se vazio, resolve pela matrícula no PL (00014).
     */
    async aplicarPorRaOferta(
        ra: string,
        offer: string,
        codPlanoPgto: string,
        cupom: string,
        codContrato = ''
    ): Promise<Record<string, unknown>> {
        const oferta = await this.consulta.oferta(offer);
        if (oferta === null) {
            throw new ValidationError(
                `Oferta '${offer}' não encontrada.`,
                'Aplicação de cupom: oferta inexistente',
                { OFERTA: offer }
            );
        }

        const cupomDetails = await this.validarCupom(offer, codPlanoPgto, cupom);
        if (cupomDetails === null) {
            throw new ValidationError(
                `Cupom '${cupom}' inválido para esta oferta e plano de pagamento.`,
                'Aplicação de cupom: cupom inválido',
                { OFERTA: offer, PLANOPAGAMENTO: codPlanoPgto, CUPOM: cupom }
            );
        }

        let contrato = codContrato.trim();
        if (contrato === '') {
            const pl = await this.consulta.matriculaPeriodoLetivo(offer, ra);
            if (pl === null || vazio(pl['CODCONTRATO'])) {
                throw new ValidationError(
                    `Não foi possível localizar o contrato do aluno (RA ${ra}) nesta oferta. `
                        + 'Envie CODCONTRATO no corpo ou faça a matrícula no período letivo antes.',
                    'Aplicação de cupom: contrato não informado/localizado',
                    { RA: ra, OFERTA: offer }
                );
            }
            contrato = s(pl['CODCONTRATO']);
        }

        const res = await this.aplicar(cupomDetails, ra, contrato, oferta);

        return {
            ...res,
            CODBOLSA: cupomDetails['CODBOLSA'] ?? null,
            CODCONTRATO: contrato,
            CUPOM: cupom,
        };
    }

    /** Aplica a bolsa do cupom ao contrato do aluno. Idempotente. */
    async aplicar(
        cupomDetails: Row,
        ra: string,
        codContrato: string,
        oferta: Row
    ): Promise<{ aplicada: boolean; ja_existia: boolean }> {
        const codColigada = s(oferta['CODCOLIGADA']);
        const idPerlet = s(oferta['IDPERLET']);
        const codFilial = s(oferta['CODFILIAL']);
        const codTipoCurso = s(oferta['CODTIPOCURSO']);

        const jaAplicada = await this.consulta.bolsaAplicada(
            codColigada,
            idPerlet,
            codContrato,
            ra,
            s(cupomDetails['CODBOLSA'])
        );

        if (jaAplicada !== null) {
            return { aplicada: false, ja_existia: true };
        }

        // number_format($v, 2, ',', '') do PHP: vírgula decimal, sem milhar.
        const valor = Number.parseFloat(s(cupomDetails['VALOR']) || '0').toFixed(2).replace('.', ',');
        const now = agoraIso();

        // SBOLSAALUNO.CODUSUARIO NÃO é enviado: a segurança de campos do RM
        // proíbe defini-lo via integração; o RM preenche com o usuário da conexão.
        const xml = `<EduBolsaAluno>
    <SBolsaAluno>
        <CODCOLIGADA>${codColigada}</CODCOLIGADA>
        <IDBOLSAALUNO>0</IDBOLSAALUNO>
        <RA>${ra}</RA>
        <IDPERLET>${idPerlet}</IDPERLET>
        <CODCONTRATO>${codContrato}</CODCONTRATO>
        <CODBOLSA>${s(cupomDetails['CODBOLSA'])}</CODBOLSA>
        <CODSERVICO>${s(cupomDetails['CODSERVICO'])}</CODSERVICO>
        <DESCONTO>${valor}</DESCONTO>
        <TIPODESC>${s(cupomDetails['TIPODESCONTO'])}</TIPODESC>
        <PARCELAINICIAL>${s(cupomDetails['PARCINICIAL'])}</PARCELAINICIAL>
        <PARCELAFINAL>${s(cupomDetails['PARCFINAL'])}</PARCELAFINAL>
        <CODPERLET>${s(oferta['CODPERLET'])}</CODPERLET>
        <DATACONCESSAO>${now}</DATACONCESSAO>
        <ATIVA>S</ATIVA>
        <CODCOLIGADA1>${codColigada}</CODCOLIGADA1>
        <CODFILIAL>${codFilial}</CODFILIAL>
    </SBolsaAluno>
</EduBolsaAluno>`;

        const contexto = {
            CODCOLIGADA: codColigada,
            CODTIPOCURSO: codTipoCurso,
            CODFILIAL: codFilial,
            CODSISTEMA: this.cfg.contextoPadrao.CODSISTEMA,
            CODUSUARIO: this.cfg.usuarioServico,
        };

        const result = await this.rm.saveRecord(DATASERVER_BOLSA, xml, contexto);

        if (result.split(';', 2)[0] !== codColigada) {
            throw new RMError(
                'O RM rejeitou a aplicação da bolsa',
                'SaveRecord',
                DATASERVER_BOLSA,
                contexto,
                xml,
                null,
                result
            );
        }

        return { aplicada: true, ja_existia: false };
    }
}
