<?php

declare(strict_types=1);

/**
 * Extrai os XMLs legados do ProcessXml (heredocs) para arquivos-template com
 * placeholders {{...}}, consumidos pelo servidor MCP (Node). Gerar a partir do
 * PRÓPRIO PHP garante estrutura byte a byte idêntica à validada em produção.
 *
 * Uso: php scripts/extrair-templates-edu.php   (de dentro de mcp/)
 * Regere sempre que www/api/src/Support/ProcessXml.php mudar.
 */

require __DIR__ . '/../../www/api/src/Support/ProcessXml.php';

use FMP\RMApi\Support\ProcessXml;

$destino = __DIR__ . '/../resources/edu';
@mkdir($destino, 0777, true);

/** Neutraliza os valores gerados internamente (GUID, agendamento). */
function neutralizar(string $xml): string
{
    $xml = preg_replace(
        '#(<ExecutionId xmlns="http://www\.totvs\.com/">)[0-9a-f-]{36}(</ExecutionId>)#',
        '$1{{EXECID}}$2',
        $xml
    );
    return preg_replace(
        '#(<ScheduleDateTime xmlns="http://www\.totvs\.com/">)[^<]+(</ScheduleDateTime>)#',
        '$1{{SCHEDULE}}$2',
        $xml
    );
}

/* ---------- Matrícula no período letivo ---------- */

$xml = ProcessXml::matriculaPeriodoLetivo(
    codColigada: '{{CODCOLIGADA}}',
    codFilial: '{{CODFILIAL}}',
    idHabilitacaoFilial: '{{IDHABILITACAOFILIAL}}',
    idPerlet: '{{IDPERLET}}',
    ra: '{{RA}}',
    codTurma: '{{CODTURMA}}',
    codPlanoPagamento: '{{CODPLANOPGTO}}',
    now: '{{NOW}}'
);
$xml = neutralizar($xml);
// Competência (mês corrente) gerada dentro do builder — vira placeholder.
$xml = preg_replace(
    '#(<DtCompetencia(Inicial|Final)Mov>)\d{2}/\d{4}(</DtCompetencia(Inicial|Final)Mov>)#',
    '$1{{COMPETENCIA}}$3',
    $xml
);
file_put_contents($destino . '/EduMatriculaPL.template.xml', $xml);

/* ---------- Matrícula na disciplina (enturmação) ---------- */

$xml = ProcessXml::matriculaDisciplina(
    groupToInclude: [
        'CODCOLIGADA'         => '{{G_CODCOLIGADA}}',
        'CODTIPOCURSO'        => '{{G_CODTIPOCURSO}}',
        'CODFILIAL'           => '{{G_CODFILIAL}}',
        'CODTURMA'            => '{{G_CODTURMA}}',
        'CODDISC'             => '{{G_CODDISC}}',
        'IDTURMADISC'         => '{{G_IDTURMADISC}}',
        'IDHABILITACAOFILIAL' => '{{G_IDHABILITACAOFILIAL}}',
    ],
    idPerlet: '{{IDPERLET}}',
    idHabilitacaoFilial: '{{IDHABILITACAOFILIAL}}',
    ra: '{{RA}}',
    codFilial: '{{CODFILIAL}}',
    codTurma: '{{CODTURMA}}',
    now: '{{NOW}}'
);
file_put_contents($destino . '/EduMatriculaDisciplina.template.xml', neutralizar($xml));

/* ---------- Gerar lançamento ---------- */

$xml = ProcessXml::gerarLancamento(
    codColigada: '{{CODCOLIGADA}}',
    codFilial: '{{CODFILIAL}}',
    idPerlet: '{{IDPERLET}}',
    ra: '{{RA}}',
    codContrato: '{{CODCONTRATO}}'
);
file_put_contents($destino . '/EduGerarLancamento.template.xml', neutralizar($xml));

fwrite(STDOUT, "Templates gerados em {$destino}:\n");
foreach (glob($destino . '/*.template.xml') as $f) {
    fwrite(STDOUT, sprintf("  %s (%d bytes)\n", basename($f), filesize($f)));
}
