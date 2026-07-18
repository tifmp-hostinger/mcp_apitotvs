/**
 * Operações de Aluno no RM — porte de Services/AlunoService.php:
 *  - EduAlunoData          (cadastro do aluno)
 *  - EduUsuarioFilialData  (vínculo usuário x filial)
 *  - GlbUsuarioData        (status/senha do usuário p/ SSO)
 */

import type { RMSoapClient } from '../rm/soap-client.js';
import { RMError, FluxoError, ValidationError, type Etapa } from '../rm/errors.js';
import type { RmConfig } from '../config.js';
import type { SsoCrypto } from '../support/sso-crypto.js';
import { escapeXml } from '../support/xml.js';
import type { ConsultaService } from './consulta.js';
import { s, vazio } from './util.js';
import { ensureHasValue } from '../helpers/validation.js';

export const DATASERVER_ALUNO = 'EduAlunoData';
export const DATASERVER_USUARIO_FILIAL = 'EduUsuarioFilialData';
export const DATASERVER_USUARIO = 'GlbUsuarioData';

export class AlunoService {
    constructor(
        private readonly rm: RMSoapClient,
        private readonly consulta: ConsultaService,
        private readonly cfg: RmConfig,
        private readonly crypto: SsoCrypto
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

    /** Dados do aluno (RA, CODUSUARIO, SENHAPADRAO, EXISTESUSUARIOFILIAL...). */
    buscar(codPessoa: string | number, codColigada: string | number): Promise<Record<string, unknown> | null> {
        return this.consulta.aluno(codPessoa, codColigada);
    }

    /**
     * Fluxo orquestrado com rastreamento de etapas (igual à inscrição):
     * CLIENTE/FORNECEDOR → ALUNO → USUÁRIO/FILIAL → ACESSO (SSO).
     */
    async criarFluxo(input: Record<string, unknown>, baseUrl: string): Promise<Record<string, unknown>> {
        const etapas: Etapa[] = [];
        const add = (etapa: string, detalhe: string, status = 'OK'): void => {
            etapas.push({ etapa, status, detalhe });
        };

        /* ---------- Validação ---------- */
        const codPessoa = String(ensureHasValue(input, 'CODPESSOA'));
        const codColigada = String(ensureHasValue(input, 'CODCOLIGADA'));
        const codTipoCurso = String(ensureHasValue(input, 'CODTIPOCURSO'));
        const codFilial = String(ensureHasValue(input, 'CODFILIAL'));

        const cpf = input['CPF'] !== undefined && input['CPF'] !== ''
            ? String(input['CPF']).replace(/\D/g, '')
            : '';
        const rnm = String(input['RNM'] ?? '');

        add('VALIDAÇÃO', 'Dados de entrada validados');

        /* ---------- Cliente/Fornecedor ---------- */
        const cliFor = cpf !== '' || rnm !== '' ? await this.consulta.cliForPorCpfRnm(cpf, rnm) : null;
        if (cliFor !== null) {
            add(
                'CLIENTE/FORNECEDOR',
                `Cliente/Fornecedor localizado (CODCFO ${s(cliFor['CODCFO'])}); será vinculado ao aluno`,
                'ENCONTRADO'
            );
        } else {
            add(
                'CLIENTE/FORNECEDOR',
                'Nenhum cliente/fornecedor encontrado para o documento; aluno será criado sem vínculo',
                'NAO_ENCONTRADO'
            );
        }

        /* ---------- Aluno (EduAlunoData) ---------- */
        const alunoJaExistia = (await this.consulta.aluno(codPessoa, codColigada)) !== null;
        let chave: string;
        try {
            chave = await this.salvar(codPessoa, codColigada, codTipoCurso, codFilial, cpf, rnm);
        } catch (e) {
            if (e instanceof RMError) {
                throw this.falha('ALUNO', 'Houve um erro ao gravar o aluno.', etapas, e);
            }
            throw e;
        }
        add('ALUNO', `${alunoJaExistia ? 'Aluno atualizado' : 'Aluno criado'}. Chave: ${chave}`, alunoJaExistia ? 'ATUALIZADO' : 'OK');

        const student = await this.buscar(codPessoa, codColigada);
        if (student === null || vazio(student['CODUSUARIO'])) {
            throw this.falhaMsg('ALUNO', 'Não foi possível obter o usuário do aluno gravado.', etapas, student);
        }
        const codUsuario = s(student['CODUSUARIO']);
        const senhaPadrao = s(student['SENHAPADRAO']);

        /* ---------- Usuário/Filial — best-effort ---------- */
        if (s(student['EXISTESUSUARIOFILIAL']) === 'N') {
            try {
                await this.garantirUsuarioFilial(codUsuario, codColigada, codTipoCurso, codFilial);
                add('USUÁRIO/FILIAL DO ALUNO', `Vínculo usuário/filial criado para ${codUsuario}`);
            } catch (e) {
                const motivo = e instanceof RMError ? e.retornoRm ?? e.message : String(e);
                add('USUÁRIO/FILIAL DO ALUNO', `Aluno criado, mas não foi possível criar o vínculo usuário/filial: ${motivo}`, 'ERRO');
            }
        } else {
            add('USUÁRIO/FILIAL DO ALUNO', `Usuário/filial já existia para ${codUsuario}`, 'JA_EXISTIA');
        }

        /* ---------- Acesso / SSO — best-effort ---------- */
        let autoLogin = false;
        let nextUrl = this.cfg.portal.loginUrl;

        const temSenhaPadrao = await this.temSenhaPadrao(codUsuario, senhaPadrao);
        const nuncaAcessou = vazio(student['DATAULTIMOACESSOVALIDO']);

        if (nuncaAcessou || temSenhaPadrao) {
            try {
                await this.ajustarAcessoUsuario(codUsuario, senhaPadrao);
                const token = this.crypto.encrypt(`${codUsuario}$_$${senhaPadrao}`);
                autoLogin = true;
                nextUrl = `${baseUrl}/sso/${token}`;
                add('ACESSO', `SSO de primeiro acesso gerado para ${codUsuario}`);
            } catch (e) {
                const motivo = e instanceof RMError ? e.retornoRm ?? e.message : String(e);
                add('ACESSO', `Aluno criado, mas não foi possível preparar o SSO (acesso): ${motivo}`, 'ERRO');
            }
        } else {
            add('ACESSO', `Aluno ${codUsuario} já alterou a senha. Login manual no portal`);
        }

        return {
            chave,
            RA: student['RA'] ?? null,
            CODUSUARIO: codUsuario,
            autoLogin,
            nextUrl,
            etapas,
        };
    }

    /**
     * Vincula um Cliente/Fornecedor já existente a um aluno já gravado (por RA).
     * Gravação direta no EduAlunoData; não roda o resto do fluxo.
     */
    async vincularCliente(input: Record<string, unknown>): Promise<Record<string, unknown>> {
        const etapas: Etapa[] = [];
        const add = (etapa: string, detalhe: string, status = 'OK'): void => {
            etapas.push({ etapa, status, detalhe });
        };

        // Obrigatório que ACEITA zero (CODCOLCFO costuma ser 0 = CFO global).
        const obrig = (k: string): string => {
            const v = input[k];
            if (v === undefined || v === null || v === '') {
                throw new ValidationError(
                    `Não encontramos um valor que era esperado: ${k}`,
                    `Valor obrigatório não encontrado. Chave do valor esperado: ${k}`,
                    input
                );
            }
            return String(v);
        };

        const ra = obrig('RA');
        const colAluno = obrig('CODCOLIGADA');
        const colCfo = obrig('CODCOLCFO');
        const cfo = obrig('CODCFO');
        const codTipoCurso = obrig('CODTIPOCURSO');
        const codFilial = obrig('CODFILIAL');
        add('VALIDAÇÃO', 'Dados de entrada validados');

        const xml = `<EduAluno>
    <SAluno>
        <CODCOLIGADA>${escapeXml(colAluno)}</CODCOLIGADA>
        <RA>${escapeXml(ra)}</RA>
        <CODCOLCFO>${escapeXml(colCfo)}</CODCOLCFO>
        <CODCFO>${escapeXml(cfo)}</CODCFO>
    </SAluno>
    <SAlunoCompl>
        <CODCOLIGADA>${escapeXml(colAluno)}</CODCOLIGADA>
        <RA>${escapeXml(ra)}</RA>
    </SAlunoCompl>
</EduAluno>`;

        const contexto = this.contexto(colAluno, codTipoCurso, codFilial);

        let result: string;
        try {
            result = await this.rm.saveRecord(DATASERVER_ALUNO, xml, contexto);
        } catch (e) {
            if (e instanceof RMError) {
                throw this.falha('VÍNCULO', 'Erro ao vincular o cliente/fornecedor ao aluno.', etapas, e);
            }
            throw e;
        }

        if (result.split(';', 2)[0] !== colAluno) {
            throw this.falhaMsg('VÍNCULO', 'O RM rejeitou o vínculo do cliente ao aluno.', etapas, result);
        }

        add('VÍNCULO', `Cliente/Fornecedor ${colCfo};${cfo} vinculado ao aluno RA ${ra} (coligada ${colAluno})`);

        return { chave: result, etapas };
    }

    private falha(etapa: string, feedback: string, etapas: Etapa[], e: RMError): FluxoError {
        const f = new FluxoError(etapa, feedback, `Erro em ${etapa}: ${e.retornoRm ?? e.message}`, e.xmlEnviado, e);
        f.etapasConcluidas = etapas;
        return f;
    }

    private falhaMsg(etapa: string, feedback: string, etapas: Etapa[], payload: unknown): FluxoError {
        const f = new FluxoError(etapa, feedback, feedback, payload);
        f.etapasConcluidas = etapas;
        return f;
    }

    /**
     * Cria (RA = 0) ou atualiza o aluno; vincula CFO existente (mesmo CPF/RNM).
     * Retorna a chave "CODCOLIGADA;RA".
     */
    async salvar(
        codPessoa: string | number,
        codColigada: string | number,
        codTipoCurso: string | number,
        codFilial: string | number,
        cpf = '',
        rnm = ''
    ): Promise<string> {
        const existente = await this.consulta.aluno(codPessoa, codColigada);
        const ra = existente !== null ? s(existente['RA']) : '0';

        const cliFor = await this.consulta.cliForPorCpfRnm(cpf, rnm);
        const cliForXml = cliFor !== null
            ? `    <CODCOLCFO>${s(cliFor['CODCOLCFO'])}</CODCOLCFO>\n    <CODCFO>${s(cliFor['CODCFO'])}</CODCFO>\n`
            : '';

        const xml = `<EduAluno>
    <SAluno>
        <CODCOLIGADA>${codColigada}</CODCOLIGADA>
        <RA>${ra}</RA>
${cliForXml}        <CODPESSOA>${codPessoa}</CODPESSOA>
        <CODTIPOCURSO>${codTipoCurso}</CODTIPOCURSO>
    </SAluno>
    <SAlunoCompl>
        <CODCOLIGADA>${codColigada}</CODCOLIGADA>
        <RA>${ra}</RA>
    </SAlunoCompl>
</EduAluno>`;

        const contexto = this.contexto(codColigada, codTipoCurso, codFilial);
        const result = await this.rm.saveRecord(DATASERVER_ALUNO, xml, contexto);

        if (result.split(';', 2)[0] !== String(codColigada)) {
            throw new RMError(
                'O RM rejeitou a gravação do aluno',
                'SaveRecord',
                DATASERVER_ALUNO,
                contexto,
                xml,
                null,
                result
            );
        }
        return result;
    }

    /** Garante o vínculo do usuário do aluno com a filial (ACESSO = 2). */
    async garantirUsuarioFilial(
        codUsuario: string,
        codColigada: string | number,
        codTipoCurso: string | number,
        codFilial: string | number
    ): Promise<string> {
        const xml = `<EduUsuarioFilial>
    <SUsuarioFilial>
        <CODCOLIGADA>${codColigada}</CODCOLIGADA>
        <CODTIPOCURSO>${codTipoCurso}</CODTIPOCURSO>
        <CODFILIAL>${codFilial}</CODFILIAL>
        <CODUSUARIO>${codUsuario}</CODUSUARIO>
        <ACESSO>2</ACESSO>
    </SUsuarioFilial>
</EduUsuarioFilial>`;

        return this.rm.saveRecord(
            DATASERVER_USUARIO_FILIAL,
            xml,
            this.contexto(codColigada, codTipoCurso, codFilial)
        );
    }

    /** Verifica se o usuário ainda usa a senha padrão (AutenticaAcesso). */
    async temSenhaPadrao(codUsuario: string, senhaPadrao: string): Promise<boolean> {
        try {
            return await this.rm.autenticaAcesso(codUsuario, senhaPadrao);
        } catch {
            return false;
        }
    }

    /** Reativa o usuário com a senha padrão sem forçar troca (SSO de 1º acesso). */
    async ajustarAcessoUsuario(codUsuario: string, senhaPadrao: string): Promise<void> {
        const xml = `<GlbUsuario>
    <GUSUARIO>
        <CODUSUARIO>${codUsuario}</CODUSUARIO>
        <STATUS>1</STATUS>
        <SENHA>${senhaPadrao}</SENHA>
        <OBRIGAALTERARSENHA>F</OBRIGAALTERARSENHA>
    </GUSUARIO>
</GlbUsuario>`;

        const result = await this.rm.saveRecord(DATASERVER_USUARIO, xml);

        if (result !== codUsuario) {
            throw new RMError(
                'Houve um erro ao ajustar acesso do usuário',
                'SaveRecord',
                DATASERVER_USUARIO,
                {},
                xml,
                null,
                result
            );
        }
    }
}
