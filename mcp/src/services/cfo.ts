/**
 * Cliente/Fornecedor no RM (FinCFODataBR) — porte de Services/CfoService.php.
 *
 * Regras confirmadas com a FMP: CODCOLIGADA do registro sempre 0 (CFO global);
 * contexto do SaveRecord com CODCOLIGADA=1 e CODSISTEMA=F; CODCFO=0 na criação
 * (o RM gera); PAGREC=3; PESSOAFISOUJUR derivado do documento (11 díg.=F, 14=J).
 */

import type { RMSoapClient } from '../rm/soap-client.js';
import { RMError, FluxoError, type Etapa } from '../rm/errors.js';
import type { RmConfig } from '../config.js';
import { escapeXml } from '../support/xml.js';
import type { ConsultaService } from './consulta.js';
import { s } from './util.js';
import { ensureHasValue } from '../helpers/validation.js';

export const DATASERVER_CFO = 'FinCFODataBR';

const CODCOLIGADA = '0';
const CODCOLIGADA_CONTEXTO = '1';

const CAMPOS_OPCIONAIS = [
    'CGCCFO', 'CIDENTIDADE', 'RUA', 'NUMERO', 'COMPLEMENTO', 'BAIRRO',
    'CIDADE', 'CODETD', 'CEP', 'TELEFONE', 'TELEX', 'EMAIL',
    'CODMUNICIPIO', 'ESTADOCIVIL', 'IDPAIS', 'CODTCF',
];

export class CfoService {
    constructor(
        private readonly rm: RMSoapClient,
        private readonly consulta: ConsultaService,
        private readonly cfg: RmConfig
    ) {
    }

    /** Consulta o CFO por CPF/RNM (INT.EDUVEM.00009, a mesma do Aluno). */
    buscarPorCpfRnm(cpf = '', rnm = ''): Promise<Record<string, unknown> | null> {
        return this.consulta.cliForPorCpfRnm(cpf, rnm);
    }

    /**
     * Cria o CFO rastreando etapas. Idempotente: documento já cadastrado
     * não duplica (status JA_EXISTIA).
     */
    async criarFluxo(input: Record<string, unknown>): Promise<Record<string, unknown>> {
        const etapas: Etapa[] = [];
        const add = (etapa: string, detalhe: string, status = 'OK'): void => {
            etapas.push({ etapa, status, detalhe });
        };

        /* ---------- Validação ---------- */
        ensureHasValue(input, 'NOME');
        const doc = String(input['CGCCFO'] ?? input['CPF'] ?? input['CNPJ'] ?? '').replace(/\D/g, '');
        const rnm = String(input['RNM'] ?? '');
        add('VALIDAÇÃO', 'Dados de entrada validados');

        /* ---------- Consulta (idempotência) ---------- */
        let existente: Record<string, unknown> | null = null;
        if (doc !== '' && doc.length === 11) {
            existente = await this.consulta.cliForPorCpfRnm(doc, rnm);
        } else if (rnm !== '') {
            existente = await this.consulta.cliForPorCpfRnm('', rnm);
        }

        if (existente !== null) {
            const codColCfo = s(existente['CODCOLCFO']) !== '' ? s(existente['CODCOLCFO']) : CODCOLIGADA;
            const codCfo = s(existente['CODCFO']);
            add('CONSULTA', `Cliente/Fornecedor já existe (CODCFO ${codCfo}); não será duplicado`, 'JA_EXISTIA');
            return {
                chave: `${codColCfo};${codCfo}`,
                CODCOLCFO: codColCfo,
                CODCFO: codCfo,
                jaExistia: true,
                cliente: existente,
                etapas,
            };
        }
        add('CONSULTA', 'Documento não cadastrado; prosseguindo para a criação', 'NAO_ENCONTRADO');

        /* ---------- Gravação ---------- */
        let chave: string;
        try {
            chave = await this.salvar(input);
        } catch (e) {
            if (e instanceof RMError) {
                const f = new FluxoError(
                    'GRAVAÇÃO',
                    'Houve um erro ao gravar o cliente/fornecedor.',
                    `Erro ao gravar CFO: ${e.retornoRm ?? e.message}`,
                    e.xmlEnviado,
                    e
                );
                f.etapasConcluidas = etapas;
                throw f;
            }
            throw e;
        }
        add('GRAVAÇÃO', `Cliente/Fornecedor gravado. Chave: ${chave}`);

        const parts = chave.split(';', 2);
        return {
            chave,
            CODCOLCFO: parts[0] ?? CODCOLIGADA,
            CODCFO: parts[1] ?? '',
            jaExistia: false,
            etapas,
        };
    }

    /** Cria o CFO (CODCFO=0 → RM gera). Retorna "CODCOLIGADA;CODCFO". */
    async salvar(input: Record<string, unknown>): Promise<string> {
        const p = CfoService.sanitizar({ ...input });
        p['CODCOLIGADA'] = CODCOLIGADA;
        p['CODCFO'] = String(p['CODCFO'] ?? '0');

        const xml = CfoService.buildXml(p);

        const contexto = {
            CODCOLIGADA: CODCOLIGADA_CONTEXTO,
            CODSISTEMA: 'F',
            CODUSUARIO: this.cfg.usuarioServico,
        };

        const result = await this.rm.saveRecord(DATASERVER_CFO, xml, contexto);

        const parts = result.split(';');
        if (parts.length < 2 || parts[0] !== CODCOLIGADA) {
            throw new RMError(
                'O RM rejeitou a gravação do cliente/fornecedor',
                'SaveRecord',
                DATASERVER_CFO,
                contexto,
                xml,
                null,
                result
            );
        }
        return result;
    }

    private static sanitizar(p: Record<string, unknown>): Record<string, unknown> {
        for (const campo of ['CGCCFO', 'CEP', 'TELEFONE', 'TELEX']) {
            const v = p[campo];
            if (v !== undefined && v !== null && v !== '') {
                p[campo] = String(v).replace(/\D/g, '');
            }
        }
        return p;
    }

    static buildXml(p: Record<string, unknown>): string {
        const esc = (v: unknown): string => escapeXml(s(v));

        const codcol = String(p['CODCOLIGADA'] ?? CODCOLIGADA);
        const codcfo = String(p['CODCFO'] ?? '0');

        const doc = String(p['CGCCFO'] ?? '').replace(/\D/g, '');
        const pessoa = p['PESSOAFISOUJUR'] ?? (doc.length === 14 ? 'J' : 'F');

        const obrig: Record<string, unknown> = {
            CODCOLIGADA: codcol,
            CODCFO: codcfo,
            NOMEFANTASIA: p['NOMEFANTASIA'] ?? p['NOME'] ?? '',
            NOME: p['NOME'] ?? '',
            PAGREC: p['PAGREC'] ?? '3',
            ATIVO: p['ATIVO'] ?? '1',
            PESSOAFISOUJUR: pessoa,
            IDCFO: p['IDCFO'] ?? '0',
        };

        let fcfo = '';
        for (const [tag, val] of Object.entries(obrig)) {
            fcfo += `                <${tag}>${esc(val)}</${tag}>\n`;
        }
        for (const tag of CAMPOS_OPCIONAIS) {
            const v = p[tag];
            if (v !== undefined && v !== null && v !== '') {
                fcfo += `                <${tag}>${esc(v)}</${tag}>\n`;
            }
        }

        return '<FinCFOBR>\n'
            + '            <FCFO>\n'
            + fcfo
            + '            </FCFO>\n'
            + '            <FCFOCOMPL>\n'
            + `                <CODCOLIGADA>${esc(codcol)}</CODCOLIGADA>\n`
            + `                <CODCFO>${esc(codcfo)}</CODCFO>\n`
            + '            </FCFOCOMPL>\n'
            + '        </FinCFOBR>';
    }
}
