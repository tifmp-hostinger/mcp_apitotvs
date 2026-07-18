/**
 * Baixa (quitação) de lançamento financeiro — porte de BaixaService.php.
 *
 * Caminho padrão (VALIDADO em homologação em 13/07/2026): processo
 * FinTBCBaixaDataProcess via wsProcess — contrato oficial da TOTVS para baixa
 * por WebService. Processos alternativos por env (FIN_BAIXA_PROCESSO); o
 * builder de XML acompanha.
 */

import crypto from 'node:crypto';
import type { RMSoapClient } from '../rm/soap-client.js';
import { ValidationError } from '../rm/errors.js';
import type { RmConfig } from '../config.js';
import { baixaLancamento, baixaLancamentoTbc, baixaLancamentoTbcLan } from '../support/process-xml.js';
import { dataHoje } from '../support/xml.js';
import type { ConsultaService } from './consulta.js';
import { normalizarDecimal, toBool } from './util.js';

export const PROCESSO_BAIXA = 'FinTBCBaixaDataProcess';

const FORMAS_PAGAMENTO = [
    'Dinheiro', 'Cheque', 'Cartao', 'CartaoCredito', 'CartaoDebito',
    'Transferencia', 'DebitoConta', 'Boleto', 'Pix', 'Outros',
];

export class BaixaService {
    constructor(
        private readonly rm: RMSoapClient,
        private readonly consulta: ConsultaService,
        private readonly cfg: RmConfig
    ) {
    }

    /**
     * Executa a baixa de um lançamento. DRY_RUN=true devolve o XML gerado sem
     * enviar ao RM (diagnóstico). Campos e regras idênticos aos da API PHP.
     */
    async baixar(input: Record<string, unknown>): Promise<Record<string, unknown>> {
        const req = (chave: string): string => {
            let v = input[chave];
            if (typeof v === 'string') {
                v = v.trim();
            }
            if (v === undefined || v === null || v === '') {
                throw new ValidationError(
                    `Informe o campo obrigatório ${chave} para realizar a baixa.`,
                    `Baixa: campo obrigatório ausente (${chave})`,
                    input
                );
            }
            return String(v);
        };

        const idLan = req('IDLAN');
        if (!/^\d+$/.test(idLan)) {
            throw new ValidationError(
                'O IDLAN deve ser numérico (id do lançamento no RM).',
                'Baixa: IDLAN não numérico',
                input
            );
        }

        const valorBaixa = normalizarDecimal(req('VALORBAIXA'));
        if (Number.parseFloat(valorBaixa) <= 0) {
            throw new ValidationError('O VALORBAIXA deve ser maior que zero.', 'Baixa: valor inválido', input);
        }

        let codCxa = String(input['CODCXA'] ?? '').trim();
        if (codCxa === '') {
            codCxa = this.cfg.codCxaPadrao.trim();
        }
        if (codCxa === '') {
            throw new ValidationError(
                'Informe o CODCXA (conta/caixa) da baixa, ou configure FIN_CODCXA_PADRAO.',
                'Baixa: CODCXA ausente',
                input
            );
        }

        const formaPagto = req('TIPOFORMAPAGTO');
        if (!FORMAS_PAGAMENTO.includes(formaPagto)) {
            throw new ValidationError(
                `TIPOFORMAPAGTO inválido. Use um de: ${FORMAS_PAGAMENTO.join(', ')}.`,
                'Baixa: forma de pagamento inválida',
                input
            );
        }

        const tipoBaixa = String(input['TIPOBAIXA'] ?? 'Simplificada');
        if (!['Simplificada', 'Completa', 'Parcial'].includes(tipoBaixa)) {
            throw new ValidationError(
                'TIPOBAIXA deve ser "Simplificada", "Completa" ou "Parcial".',
                'Baixa: tipo de baixa inválido',
                input
            );
        }

        const codColigada = Number(input['CODCOLIGADA'] ?? 1);
        const codFilial = Number(input['CODFILIAL'] ?? 1);
        const dataBaixa = String(input['DATABAIXA'] ?? '').trim() || dataHoje();
        const historico = String(input['HISTORICOBAIXA'] ?? '');
        const codUsuario = this.cfg.usuarioServico;
        const idFormaPagto = String(input['IDFORMAPAGTO'] ?? '1').trim();

        const processo = this.cfg.baixa.processo !== '' ? this.cfg.baixa.processo : PROCESSO_BAIXA;
        const operacao = this.cfg.baixa.operacao !== '' ? this.cfg.baixa.operacao : 'ExecuteWithParams';

        let xml: string;
        switch (processo) {
            case 'FinTBCBaixaDataProcess':
                xml = baixaLancamentoTbc({
                    codColigada, codFilial, idLan, valorBaixa, codCxa, dataBaixa, historico, idFormaPagto,
                });
                break;
            case 'FinLanBaixaTBCData':
                xml = baixaLancamentoTbcLan({
                    codColigada, codFilial, idLan, valorBaixa, codCxa, dataBaixa, historico, codUsuario, idFormaPagto,
                });
                break;
            default:
                xml = baixaLancamento({
                    codColigada, codFilial, idLan, valorBaixa, codCxa,
                    tipoFormaPagto: formaPagto, dataBaixa, historico, codUsuario, tipoBaixa,
                });
        }

        // Modo diagnóstico: devolve o XML gerado SEM enviar ao RM.
        if (toBool(input['DRY_RUN'] ?? false)) {
            return {
                dry_run: true,
                PROCESSO: processo,
                OPERACAO: operacao,
                ws_url: this.cfg.wsUrl,
                xml_bytes: Buffer.byteLength(xml, 'utf8'),
                xml_md5: crypto.createHash('md5').update(xml).digest('hex'),
                xml,
            };
        }

        const retorno = operacao === 'ExecuteWithXMLParams'
            ? await this.rm.executeWithXmlParams(processo, xml)
            : await this.rm.executeWithParams(processo, xml);

        // Retorno numérico != "1" costuma ser JobId: anexa o log do Monitor de Jobs.
        let logJob: string | null = null;
        if (/^\d+$/.test(retorno) && retorno !== '1') {
            logJob = await this.consulta.logProcessoFormatado(retorno);
        }

        return {
            IDLAN: idLan,
            CODCOLIGADA: String(codColigada),
            VALORBAIXADO: valorBaixa,
            DATABAIXA: dataBaixa,
            CODCXA: codCxa,
            FORMAPAGTO: formaPagto,
            TIPOBAIXA: tipoBaixa,
            PROCESSO: processo,
            retorno_rm: retorno,
            log_job: logJob,
        };
    }
}
