/**
 * Geração do PDF do contrato de matrícula — porte de ContratoService.php
 * (wsReport: GenerateReport → GetGeneratedReportSize → GetFileChunk).
 */

import type { RMSoapClient } from '../rm/soap-client.js';
import type { RmConfig } from '../config.js';
import { reportParameters } from '../support/report-xml.js';
import type { ConsultaService } from './consulta.js';
import { s } from './util.js';
import { formatCpf } from '../helpers/validation.js';

export class ContratoService {
    constructor(
        private readonly rm: RMSoapClient,
        private readonly consulta: ConsultaService,
        private readonly cfg: RmConfig
    ) {
    }

    /**
     * Gera o contrato e devolve o conteúdo do PDF (como o RM retorna).
     * dados: NOME, CPF, ESTADO, CIDADE (código), BAIRRO (código), RUA,
     *        NUMERO, COMPLEMENTO, NACIONALIDADE, NASCIMENTO (Y-m-d)
     */
    async gerar(dados: Record<string, unknown>): Promise<string> {
        const nome = String(dados['NOME'] ?? '');
        let cpf = String(dados['CPF'] ?? '');
        const estado = String(dados['ESTADO'] ?? '');
        let cidade = String(dados['CIDADE'] ?? '');
        let bairro = String(dados['BAIRRO'] ?? '');
        const rua = String(dados['RUA'] ?? '');
        const numero = String(dados['NUMERO'] ?? '');
        const complemento = String(dados['COMPLEMENTO'] ?? '');
        const nacionalidade = String(dados['NACIONALIDADE'] ?? '');
        let nascimento = String(dados['NASCIMENTO'] ?? '');

        // Y-m-d → d/m/Y
        const partes = nascimento.split('-');
        nascimento = partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : '';

        if (cpf !== '') {
            try {
                cpf = formatCpf(cpf);
            } catch {
                cpf = '';
            }
        }

        // Os códigos de cidade/bairro viram nomes no contrato
        if (cidade !== '') {
            const row = await this.consulta.cidadePorCodigo(cidade);
            cidade = row !== null ? s(row['NOME']) : '';
        }
        if (bairro !== '') {
            const row = await this.consulta.bairroPorCodigo(bairro);
            bairro = row !== null ? s(row['NOME']) : '';
        }

        const parameters = reportParameters({
            NOME_S: nome,
            CPF_S: cpf,
            ESTADO_S: estado,
            CIDADE_S: cidade,
            BAIRRO_S: bairro,
            RUA_S: rua,
            NUMERO_S: numero,
            COMPLEMENTO_S: complemento,
            NACIONALIDADE_S: nacionalidade,
            DATANASCIMENTO_S: nascimento,
        });

        const report = this.cfg.relatorioContrato;

        const guid = await this.rm.generateReport(report.codcoligada, report.id, '', parameters);
        const size = await this.rm.getGeneratedReportSize(guid);
        return this.rm.getFileChunk(guid, 0, size);
    }
}
