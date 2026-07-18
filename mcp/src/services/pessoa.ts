/** Operações de Pessoa no RM (RhuPessoaData) — porte de PessoaService.php. */

import type { RMSoapClient } from '../rm/soap-client.js';
import { RMError } from '../rm/errors.js';
import { escapeXml } from '../support/xml.js';
import type { ConsultaService } from './consulta.js';
import { s } from './util.js';

export const DATASERVER_PESSOA = 'RhuPessoaData';

export class PessoaService {
    constructor(
        private readonly rm: RMSoapClient,
        private readonly consulta: ConsultaService
    ) {
    }

    /** Registro completo da pessoa pelo CODIGO (ReadRecord). */
    async buscar(codigo: string | number): Promise<Record<string, unknown> | null> {
        const record = await this.rm.readRecord(DATASERVER_PESSOA, [String(codigo)]);
        const pessoa = record['PPessoa'];
        return typeof pessoa === 'object' && pessoa !== null ? (pessoa as Record<string, unknown>) : null;
    }

    /** Pessoa por CPF ou RNM: registro completo ou null. */
    async buscarPorCpfRnm(cpf = '', rnm = ''): Promise<Record<string, unknown> | null> {
        const found = await this.consulta.pessoaPorCpfRnm(cpf, rnm);
        if (found === null) {
            return null;
        }
        return this.buscar(s(found['CODIGO']));
    }

    /**
     * Cria (CODIGO = 0) ou atualiza (CODIGO > 0) a pessoa via SaveRecord.
     * Retorna o CODPESSOA gravado.
     */
    async salvar(p: Record<string, unknown>): Promise<string> {
        const dados = PessoaService.sanitizarDocumentos({ ...p });
        const xml = PessoaService.buildXml(dados);

        const result = await this.rm.saveRecord(DATASERVER_PESSOA, xml);

        if (!/^\d+$/.test(result.trim())) {
            throw new RMError(
                'O RM rejeitou a gravação da pessoa',
                'SaveRecord',
                DATASERVER_PESSOA,
                {},
                xml,
                null,
                result
            );
        }
        return result.trim();
    }

    /**
     * Remove máscara dos campos que o RM grava como dígitos puros
     * (PPESSOA.CPF/CEP têm tamanho fixo — máscara estoura a coluna).
     */
    private static sanitizarDocumentos(p: Record<string, unknown>): Record<string, unknown> {
        for (const campo of ['CPF', 'CEP', 'TELEFONE1']) {
            const v = p[campo];
            if (v !== undefined && v !== null && v !== '') {
                p[campo] = String(v).replace(/\D/g, '');
            }
        }
        return p;
    }

    static buildXml(p: Record<string, unknown>): string {
        const get = (key: string): string => escapeXml(s(p[key]));
        const codigo = p['CODIGO'] !== undefined && p['CODIGO'] !== null && p['CODIGO'] !== ''
            ? String(p['CODIGO'])
            : '0';

        return `<RhuPessoa>
    <PPessoa>
        <CODIGO>${codigo}</CODIGO>
        <NOME>${get('NOME')}</NOME>
        <DTNASCIMENTO>${get('DTNASCIMENTO')}</DTNASCIMENTO>
        <ESTADONATAL>${get('ESTADONATAL')}</ESTADONATAL>
        <NATURALIDADE>${get('NATURALIDADE')}</NATURALIDADE>
        <SEXO>${get('SEXO')}</SEXO>
        <NACIONALIDADE>${get('NACIONALIDADE')}</NACIONALIDADE>
        <RUA>${get('RUA')}</RUA>
        <NUMERO>${get('NUMERO')}</NUMERO>
        <COMPLEMENTO>${get('COMPLEMENTO')}</COMPLEMENTO>
        <BAIRRO>${get('BAIRRO')}</BAIRRO>
        <ESTADO>${get('ESTADO')}</ESTADO>
        <CIDADE>${get('CIDADE')}</CIDADE>
        <CEP>${get('CEP')}</CEP>
        <PAIS>${get('PAIS')}</PAIS>
        <CPF>${get('CPF')}</CPF>
        <TELEFONE1>${get('TELEFONE1')}</TELEFONE1>
        <EMAIL>${get('EMAIL')}</EMAIL>
        <CODMUNICIPIO>${get('CODMUNICIPIO')}</CODMUNICIPIO>
        <CODNATURALIDADE>${get('CODNATURALIDADE')}</CODNATURALIDADE>
        <IDPAIS>${get('IDPAIS')}</IDPAIS>
        <NROREGGERAL>${get('NROREGGERAL')}</NROREGGERAL>
    </PPessoa>
    <VPCompl>
        <CODPESSOA>${codigo}</CODPESSOA>
    </VPCompl>
</RhuPessoa>`;
    }
}
