/**
 * XMLs de processos do RM (wsProcess / ExecuteWithXmlParams) — porte de
 * www/api/src/Support/ProcessXml.php, TOTALMENTE convertido para o estilo
 * template-em-arquivo + placeholders {{...}}:
 *
 *  - resources/edu/*.template.xml — EXTRAÍDOS dos heredocs do PHP pelo script
 *    scripts/extrair-templates-edu.php (estrutura byte a byte idêntica à que
 *    roda em produção; regere se o ProcessXml.php mudar);
 *  - resources/fin/*.template.xml — cópias dos templates da API PHP (o TBC é
 *    o caminho de baixa VALIDADO em homologação em 13/07/2026).
 *
 * Como no PHP, os valores são interpolados crus (sem escape) nos templates
 * Edu — são códigos internos do RM —, e escapados nos pontos em que o PHP
 * escapava (baixas).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeXml, guid, scheduleDateTime, competencia } from './xml.js';

const RESOURCES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'resources');

const cache = new Map<string, string>();

function template(rel: string): string {
    let tpl = cache.get(rel);
    if (tpl === undefined) {
        const file = path.join(RESOURCES, rel);
        tpl = fs.readFileSync(file, 'utf8');
        if (tpl.trim() === '') {
            throw new Error(`Template vazio: ${file}`);
        }
        cache.set(rel, tpl);
    }
    return tpl;
}

function render(rel: string, valores: Record<string, string>): string {
    let xml = template(rel);
    for (const [chave, valor] of Object.entries(valores)) {
        xml = xml.split(`{{${chave}}}`).join(valor);
    }
    if (xml.includes('{{')) {
        const restante = xml.match(/\{\{[A-Z0-9_]+\}\}/g) ?? [];
        throw new Error(`Template ${rel} com placeholder não resolvido: ${[...new Set(restante)].join(', ')}`);
    }
    return xml;
}

/** Sessão neutra de cada execução (ExecutionId novo + agendamento agora). */
function sessao(): Record<string, string> {
    return {
        EXECID: guid(),
        SCHEDULE: scheduleDateTime(),
    };
}

/* =====================================================================
 * Educacional (EduMatriculaProcData / EduGerarLancFromContratoSliceableData)
 * ===================================================================== */

/** Processo "Matricular aluno": matrícula no PL + geração do contrato. */
export function matriculaPeriodoLetivo(p: {
    codColigada: string | number;
    codFilial: string | number;
    idHabilitacaoFilial: string | number;
    idPerlet: string | number;
    ra: string;
    codTurma: string;
    codPlanoPagamento: string;
    now: string;
}): string {
    return render('edu/EduMatriculaPL.template.xml', {
        ...sessao(),
        COMPETENCIA: competencia(),
        CODCOLIGADA: String(p.codColigada),
        CODFILIAL: String(p.codFilial),
        IDHABILITACAOFILIAL: String(p.idHabilitacaoFilial),
        IDPERLET: String(p.idPerlet),
        RA: p.ra,
        CODTURMA: p.codTurma,
        CODPLANOPGTO: p.codPlanoPagamento,
        NOW: p.now,
    });
}

/**
 * Processo "Matricular aluno nas disciplinas" (enturmação).
 * @param group linha da consulta INT.EDUVEM.00019 (CODCOLIGADA, CODTIPOCURSO,
 *              CODFILIAL, CODTURMA, CODDISC, IDTURMADISC, IDHABILITACAOFILIAL)
 */
export function matriculaDisciplina(p: {
    group: Record<string, unknown>;
    idPerlet: string | number;
    idHabilitacaoFilial: string | number;
    ra: string;
    codFilial: string | number;
    codTurma: string;
    now: string;
}): string {
    const g = (k: string): string => String(p.group[k] ?? '');
    return render('edu/EduMatriculaDisciplina.template.xml', {
        ...sessao(),
        G_CODCOLIGADA: g('CODCOLIGADA'),
        G_CODTIPOCURSO: g('CODTIPOCURSO'),
        G_CODFILIAL: g('CODFILIAL'),
        G_CODTURMA: g('CODTURMA'),
        G_CODDISC: g('CODDISC'),
        G_IDTURMADISC: g('IDTURMADISC'),
        G_IDHABILITACAOFILIAL: g('IDHABILITACAOFILIAL'),
        IDPERLET: String(p.idPerlet),
        IDHABILITACAOFILIAL: String(p.idHabilitacaoFilial),
        RA: p.ra,
        CODFILIAL: String(p.codFilial),
        CODTURMA: p.codTurma,
        NOW: p.now,
    });
}

/** Processo "Gerar lançamento" financeiro a partir do contrato. */
export function gerarLancamento(p: {
    codColigada: string | number;
    codFilial: string | number;
    idPerlet: string | number;
    ra: string;
    codContrato: string;
}): string {
    return render('edu/EduGerarLancamento.template.xml', {
        ...sessao(),
        CODCOLIGADA: String(p.codColigada),
        CODFILIAL: String(p.codFilial),
        IDPERLET: String(p.idPerlet),
        RA: p.ra,
        CODCONTRATO: p.codContrato,
    });
}

/* =====================================================================
 * Financeiro — Baixa de lançamento
 * ===================================================================== */

function decimal(valor: string, casas: number): string {
    return Number.parseFloat(valor).toFixed(casas);
}

/**
 * Baixa via TBC (FinTBCBaixaDataProcess) — caminho OFICIAL da TOTVS para baixa
 * por WebService, VALIDADO em homologação (13/07/2026). O RM carrega o
 * lançamento da base pelo IdLan e contabiliza por Evento Contábil.
 */
export function baixaLancamentoTbc(p: {
    codColigada: string | number;
    codFilial: string | number;
    idLan: string;
    valorBaixa: string;
    codCxa: string;
    dataBaixa: string;
    historico: string;
    idFormaPagto?: string | number;
    chapaFuncionario?: string | number;
}): string {
    return render('fin/FinTBCBaixaParamsProc.template.xml', {
        CODCOLIGADA: String(p.codColigada),
        CODFILIAL: String(p.codFilial),
        CHAPA: escapeXml(String(p.chapaFuncionario ?? '-1')),
        IDLAN: p.idLan,
        DATA: `${p.dataBaixa}T00:00:00-03:00`,
        HISTBAIXA: escapeXml(p.historico),
        CODCXA: escapeXml(p.codCxa),
        IDFORMAPAGTO: String(p.idFormaPagto ?? 1),
        VALOR: decimal(p.valorBaixa, 2),
    });
}

/**
 * Variante TBC orientada a pagamento (FinLanBaixaTBCData). ATENÇÃO: nunca
 * validada contra o RM real — valide em homologação antes de usar.
 */
export function baixaLancamentoTbcLan(p: {
    codColigada: string | number;
    codFilial: string | number;
    idLan: string;
    valorBaixa: string;
    codCxa: string;
    dataBaixa: string;
    historico: string;
    codUsuario: string;
    idFormaPagto?: string | number;
    chapaFuncionario?: string | number;
}): string {
    return render('fin/FinLanBaixaTBCParamsProc.template.xml', {
        CODCOLIGADA: String(p.codColigada),
        CODFILIAL: String(p.codFilial),
        CHAPA: escapeXml(String(p.chapaFuncionario ?? '-1')),
        USUARIO: escapeXml(p.codUsuario),
        IDLAN: p.idLan,
        DATA: `${p.dataBaixa}T00:00:00-03:00`,
        HISTBAIXA: escapeXml(p.historico),
        CODCXA: escapeXml(p.codCxa),
        IDFORMAPAGTO: String(p.idFormaPagto ?? 1),
        VALOR: decimal(p.valorBaixa, 2),
    });
}

/**
 * Replay do processo da TELA (FinLanBaixaData) — mantido apenas como fallback
 * configurável; via WS responde "Os lançamentos devem ser informados".
 */
export function baixaLancamento(p: {
    codColigada: string | number;
    codFilial: string | number;
    idLan: string;
    valorBaixa: string;
    codCxa: string;
    tipoFormaPagto: string;
    dataBaixa: string;
    historico: string;
    codUsuario: string;
    tipoBaixa?: string;
    chapaFuncionario?: string | number;
}): string {
    return render('fin/FinLanBaixaParamsProc.real.template.xml', {
        ...sessao(),
        USUARIO: escapeXml(p.codUsuario),
        VALOR4: decimal(p.valorBaixa, 4),
        VALOR2: decimal(p.valorBaixa, 2),
        IDLAN: p.idLan,
        CODCXA: escapeXml(p.codCxa),
        DATA: p.dataBaixa,
        FORMAPAGTO: escapeXml(p.tipoFormaPagto),
        TIPOBAIXA: escapeXml(p.tipoBaixa ?? 'Simplificada'),
        HISTBAIXA: escapeXml(p.historico),
        CODCOLIGADA: String(p.codColigada),
        CODFILIAL: String(p.codFilial),
        CHAPA: escapeXml(String(p.chapaFuncionario ?? '-1')),
    });
}
