/**
 * Compara os XMLs gerados pelos builders PHP (api legada, www/api) e pelos
 * builders TypeScript do MCP, com entradas idênticas. Valores de sessão
 * (ExecutionId/ScheduleDateTime, gerados a cada chamada) são normalizados;
 * TODO O RESTO deve ser byte a byte igual — prova de porte fiel.
 *
 * Uso: npm run build && node scripts/diff-xml.mjs   (pulado se não houver php)
 */

import { execFileSync } from 'node:child_process';

let phpOut;
try {
    phpOut = execFileSync('php', [new URL('./dump-xml.php', import.meta.url).pathname], {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
    });
} catch (e) {
    if (e.code === 'ENOENT') {
        console.log('php indisponível — diff PHP×TS pulado.');
        process.exit(0);
    }
    throw e;
}
const php = JSON.parse(phpOut);

const processXml = await import('../dist/support/process-xml.js');
const { PessoaService } = await import('../dist/services/pessoa.js');
const { CfoService } = await import('../dist/services/cfo.js');
const { reportParameters } = await import('../dist/support/report-xml.js');

const ts = {
    matriculaPL: processXml.matriculaPeriodoLetivo({
        codColigada: '1', codFilial: '2', idHabilitacaoFilial: '333', idPerlet: '44',
        ra: '000123', codTurma: 'T01', codPlanoPagamento: 'PP01', now: '2026-07-18T10:00:00',
    }),
    matriculaDisc: processXml.matriculaDisciplina({
        group: {
            CODCOLIGADA: '1', CODTIPOCURSO: '2', CODFILIAL: '1', CODTURMA: 'T01',
            CODDISC: 'D0001', IDTURMADISC: '99', IDHABILITACAOFILIAL: '333',
        },
        idPerlet: '44', idHabilitacaoFilial: '333', ra: '000123',
        codFilial: '1', codTurma: 'T01', now: '2026-07-18T10:00:00',
    }),
    gerarLancamento: processXml.gerarLancamento({
        codColigada: '1', codFilial: '1', idPerlet: '44', ra: '000123', codContrato: 'C-0001',
    }),
    baixaTbc: processXml.baixaLancamentoTbc({
        codColigada: 1, codFilial: 1, idLan: '555', valorBaixa: '465.00', codCxa: '1',
        dataBaixa: '2026-07-13', historico: 'Baixa via API & teste', idFormaPagto: 1,
    }),
    baixaTbcLan: processXml.baixaLancamentoTbcLan({
        codColigada: 1, codFilial: 1, idLan: '555', valorBaixa: '465.00', codCxa: '1',
        dataBaixa: '2026-07-13', historico: 'Baixa via API & teste',
        codUsuario: 'integra.eduvem', idFormaPagto: 1,
    }),
    baixaReplay: processXml.baixaLancamento({
        codColigada: 1, codFilial: 1, idLan: '555', valorBaixa: '465.00', codCxa: '1',
        tipoFormaPagto: 'Dinheiro', dataBaixa: '2026-07-13',
        historico: 'Baixa via API & teste', codUsuario: 'integra.eduvem', tipoBaixa: 'Simplificada',
    }),
    pessoa: PessoaService.buildXml({
        CODIGO: '12345',
        NOME: 'José & Maria <Teste> "Aspas"',
        DTNASCIMENTO: '1990-01-15',
        SEXO: 'M',
        NACIONALIDADE: '10',
        CPF: '52998224725',
        EMAIL: 'jose@fmp.edu.br',
        TELEFONE1: '51999998888',
        RUA: "Av. Ipiranga 'Esquina'",
        NUMERO: '1000',
        BAIRRO: 'Centro',
        ESTADO: 'RS',
        CIDADE: 'Porto Alegre',
        CEP: '90000000',
        CODMUNICIPIO: '4314902',
        IDPAIS: 1,
    }),
    cfo: CfoService.buildXml({
        CODCOLIGADA: '0',
        CODCFO: '0',
        NOME: 'José & Maria <CFO>',
        CGCCFO: '52998224725',
        RUA: 'Av. Ipiranga',
        NUMERO: '1000',
        BAIRRO: 'Centro',
        CIDADE: 'Porto Alegre',
        CODETD: 'RS',
        CEP: '90000000',
        TELEFONE: '51999998888',
        EMAIL: 'jose@fmp.edu.br',
    }),
    report: reportParameters({
        NOME_S: 'José & <Maria> "Aspas"',
        CPF_S: '529.982.247-25',
    }),
};

/** Neutraliza sessão (GUID/agendamento) e whitespace de layout entre tags. */
function normalize(xml) {
    return xml
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<GUID>')
        .replace(/<ScheduleDateTime([^>]*)>[^<]+<\/ScheduleDateTime>/g, '<ScheduleDateTime$1>X</ScheduleDateTime>')
        // PHP e TS diferem apenas na indentação dos builders inline (heredoc
        // dedentado vs template literal): compara a SEQUÊNCIA de tags/conteúdo.
        .split('\n').map((l) => l.trim()).filter((l) => l !== '').join('\n');
}

let falhas = 0;
for (const nome of Object.keys(php)) {
    const a = normalize(php[nome]);
    const b = normalize(ts[nome] ?? '');
    if (a === b) {
        console.log(`  ok   ${nome} (${php[nome].length} bytes PHP / ${ts[nome].length} bytes TS)`);
    } else {
        falhas++;
        console.error(`  FALHA ${nome}: XMLs divergem`);
        const la = a.split('\n');
        const lb = b.split('\n');
        for (let i = 0; i < Math.max(la.length, lb.length); i++) {
            if (la[i] !== lb[i]) {
                console.error(`    linha ${i + 1}:`);
                console.error(`      PHP: ${la[i] ?? '(ausente)'}`);
                console.error(`      TS : ${lb[i] ?? '(ausente)'}`);
                break;
            }
        }
    }
}

console.log(`\n== diff PHP×TS: ${Object.keys(php).length - falhas} iguais, ${falhas} divergente(s)`);
process.exit(falhas === 0 ? 0 : 1);
