<?php

declare(strict_types=1);

/**
 * Gera os XMLs dos builders PHP com entradas FIXAS e imprime como JSON.
 * Consumido por scripts/diff-xml.mjs para comparar byte a byte com os
 * builders TypeScript do MCP (porte fiel).
 */

require __DIR__ . '/../../www/api/src/Support/ProcessXml.php';
require __DIR__ . '/../../www/api/src/Support/ReportXml.php';
require __DIR__ . '/../../www/api/src/Services/PessoaService.php';
require __DIR__ . '/../../www/api/src/Services/CfoService.php';

use FMP\RMApi\Services\CfoService;
use FMP\RMApi\Services\PessoaService;
use FMP\RMApi\Support\ProcessXml;
use FMP\RMApi\Support\ReportXml;

$out = [];

$out['matriculaPL'] = ProcessXml::matriculaPeriodoLetivo(
    codColigada: '1',
    codFilial: '2',
    idHabilitacaoFilial: '333',
    idPerlet: '44',
    ra: '000123',
    codTurma: 'T01',
    codPlanoPagamento: 'PP01',
    now: '2026-07-18T10:00:00'
);

$out['matriculaDisc'] = ProcessXml::matriculaDisciplina(
    groupToInclude: [
        'CODCOLIGADA'         => '1',
        'CODTIPOCURSO'        => '2',
        'CODFILIAL'           => '1',
        'CODTURMA'            => 'T01',
        'CODDISC'             => 'D0001',
        'IDTURMADISC'         => '99',
        'IDHABILITACAOFILIAL' => '333',
    ],
    idPerlet: '44',
    idHabilitacaoFilial: '333',
    ra: '000123',
    codFilial: '1',
    codTurma: 'T01',
    now: '2026-07-18T10:00:00'
);

$out['gerarLancamento'] = ProcessXml::gerarLancamento(
    codColigada: '1',
    codFilial: '1',
    idPerlet: '44',
    ra: '000123',
    codContrato: 'C-0001'
);

$out['baixaTbc'] = ProcessXml::baixaLancamentoTbc(
    codColigada: 1,
    codFilial: 1,
    idLan: '555',
    valorBaixa: '465.00',
    codCxa: '1',
    dataBaixa: '2026-07-13',
    historico: 'Baixa via API & teste',
    idFormaPagto: 1
);

$out['baixaTbcLan'] = ProcessXml::baixaLancamentoTbcLan(
    codColigada: 1,
    codFilial: 1,
    idLan: '555',
    valorBaixa: '465.00',
    codCxa: '1',
    dataBaixa: '2026-07-13',
    historico: 'Baixa via API & teste',
    codUsuario: 'integra.eduvem',
    idFormaPagto: 1
);

$out['baixaReplay'] = ProcessXml::baixaLancamento(
    codColigada: 1,
    codFilial: 1,
    idLan: '555',
    valorBaixa: '465.00',
    codCxa: '1',
    tipoFormaPagto: 'Dinheiro',
    dataBaixa: '2026-07-13',
    historico: 'Baixa via API & teste',
    codUsuario: 'integra.eduvem',
    tipoBaixa: 'Simplificada'
);

$out['pessoa'] = PessoaService::buildXml([
    'CODIGO'       => '12345',
    'NOME'         => 'José & Maria <Teste> "Aspas"',
    'DTNASCIMENTO' => '1990-01-15',
    'SEXO'         => 'M',
    'NACIONALIDADE' => '10',
    'CPF'          => '52998224725',
    'EMAIL'        => 'jose@fmp.edu.br',
    'TELEFONE1'    => '51999998888',
    'RUA'          => "Av. Ipiranga 'Esquina'",
    'NUMERO'       => '1000',
    'BAIRRO'       => 'Centro',
    'ESTADO'       => 'RS',
    'CIDADE'       => 'Porto Alegre',
    'CEP'          => '90000000',
    'CODMUNICIPIO' => '4314902',
    'IDPAIS'       => 1,
]);

$out['cfo'] = CfoService::buildXml([
    'CODCOLIGADA' => '0',
    'CODCFO'      => '0',
    'NOME'        => 'José & Maria <CFO>',
    'CGCCFO'      => '52998224725',
    'RUA'         => 'Av. Ipiranga',
    'NUMERO'      => '1000',
    'BAIRRO'      => 'Centro',
    'CIDADE'      => 'Porto Alegre',
    'CODETD'      => 'RS',
    'CEP'         => '90000000',
    'TELEFONE'    => '51999998888',
    'EMAIL'       => 'jose@fmp.edu.br',
]);

$out['report'] = ReportXml::parameters([
    'NOME_S' => 'José & <Maria> "Aspas"',
    'CPF_S'  => '529.982.247-25',
]);

echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
