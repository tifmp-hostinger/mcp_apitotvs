<?php

declare(strict_types=1);

/**
 * Builders de XML dos processos do RM (funções puras: parâmetros -> string).
 *
 * Estes testes cristalizam as verificações feitas manualmente durante a
 * depuração da baixa financeira (jul/2026): XML bem-formado, placeholders
 * todos resolvidos, valores dinâmicos injetados nos pontos certos e restos
 * do template capturado devidamente neutralizados.
 */

use FMP\RMApi\Support\ProcessXml;

/* =====================================================================
 * baixaLancamentoTbc — FinTBCBaixaDataProcess (caminho VALIDADO em homolog)
 * ===================================================================== */

$xml = ProcessXml::baixaLancamentoTbc(
    codColigada: 1,
    codFilial: 1,
    idLan: '777123',
    valorBaixa: '465.00',
    codCxa: '50380',
    dataBaixa: '2026-07-14',
    historico: 'Baixa via API',
    idFormaPagto: 1
);

check('tbc: XML bem-formado', xmlBemFormado($xml));
check('tbc: declaração utf-16 é o primeiro byte', str_starts_with($xml, '<?xml version="1.0" encoding="utf-16"?>'));
check('tbc: nenhum placeholder {{...}} sobrando', !str_contains($xml, '{{'));
check('tbc: raiz FinTBCBaixaParamsProc', str_contains($xml, '<FinTBCBaixaParamsProc'));
checkSame('tbc: IdLan no lançamento e no ValoresAlteracao (2 pontos)', 2, substr_count($xml, '<IdLan>777123</IdLan>'));
checkSame('tbc: DataBaixa na raiz e no lançamento (2 pontos)', 2, substr_count($xml, '<DataBaixa>2026-07-14T00:00:00-03:00</DataBaixa>'));
check('tbc: DataSistema preenchida', str_contains($xml, '<DataSistema>2026-07-14T00:00:00-03:00</DataSistema>'));
check('tbc: caixa no pagamento', str_contains($xml, '<CodCxa>50380</CodCxa>'));
check('tbc: forma de pagamento (id do cadastro FFORMAPAGTO)', str_contains($xml, '<IdFormaPagamento>1</IdFormaPagamento>'));
check('tbc: valor do pagamento', str_contains($xml, '<Valor>465.00</Valor>'));
check('tbc: PK FLAN presente', str_contains($xml, '>777123</d2p1:anyType>'));
check('tbc: Cartao de exemplo esvaziado', str_contains($xml, '<Cartao />'));
check('tbc: Cheques de exemplo esvaziado', str_contains($xml, '<Cheques />'));
check('tbc: Partidas de exemplo esvaziadas (contabiliza por Evento Contábil)', str_contains($xml, '<Partidas />'));
check('tbc: TipoGeracaoLancamentoContabil=EventoContabil', str_contains($xml, '<TipoGeracaoLancamentoContabil>EventoContabil</TipoGeracaoLancamentoContabil>'));

// Valores com caracteres especiais são escapados e o XML continua íntegro.
$xmlEsc = ProcessXml::baixaLancamentoTbc(1, 1, '1', '10.00', 'CX', '2026-01-01', 'Grupo <A> & Cia', 1);
check('tbc: histórico com <>& escapado', str_contains($xmlEsc, 'Grupo &lt;A&gt; &amp; Cia'));
check('tbc: XML segue bem-formado com histórico especial', xmlBemFormado($xmlEsc));

// Valor sempre normalizado com 2 casas.
$xmlValor = ProcessXml::baixaLancamentoTbc(1, 1, '1', '10', 'CX', '2026-01-01', '', 1);
check('tbc: valor "10" vira "10.00"', str_contains($xmlValor, '<Valor>10.00</Valor>'));

/* =====================================================================
 * baixaLancamentoTbcLan — FinLanBaixaTBCData (alternativa, NÃO validada no RM)
 * ===================================================================== */

$xml = ProcessXml::baixaLancamentoTbcLan(
    codColigada: 1,
    codFilial: 1,
    idLan: '777123',
    valorBaixa: '465.00',
    codCxa: '50380',
    dataBaixa: '2026-07-14',
    historico: 'Baixa via API',
    codUsuario: 'integra.eduvem',
    idFormaPagto: 1
);

check('tbcLan: XML bem-formado', xmlBemFormado($xml));
check('tbcLan: nenhum placeholder sobrando', !str_contains($xml, '{{'));
check('tbcLan: raiz FinLanBaixaTBCParamsProc', str_contains($xml, '<FinLanBaixaTBCParamsProc'));
check('tbcLan: lançamento na ListIdLan', str_contains($xml, '<d4p1:int>777123</d4p1:int>'));
checkSame('tbcLan: usuário nos 2 CodUsuario', 2, substr_count($xml, 'integra.eduvem'));
check('tbcLan: forma de pagamento', str_contains($xml, '<IdFormaPagto>1</IdFormaPagto>'));
check('tbcLan: valor do meio de pagamento', str_contains($xml, '<Valor>465.00</Valor>'));
check('tbcLan: LanctoParaBaixas de exemplo esvaziado', str_contains($xml, '<LanctoParaBaixas />'));
check('tbcLan: Cartao/Cheque de exemplo esvaziados', str_contains($xml, '<Cartao />') && str_contains($xml, '<Cheque />'));

/* =====================================================================
 * baixaLancamento — replay do processo da tela (fallback FinLanBaixaData)
 * ===================================================================== */

$xml = ProcessXml::baixaLancamento(
    codColigada: 1,
    codFilial: 1,
    idLan: '777123',
    valorBaixa: '465.00',
    codCxa: '99887',
    tipoFormaPagto: 'Pix',
    dataBaixa: '2026-07-14',
    historico: 'Baixa via API',
    codUsuario: 'integra.eduvem',
    tipoBaixa: 'Simplificada'
);

check('replay: XML bem-formado', xmlBemFormado($xml));
check('replay: nenhum placeholder sobrando', !str_contains($xml, '{{'));
// O FinLancamentoBaixaResult tem membros duplicados por herança .NET e objetos
// aninhados que também carregam a identidade: o IDLAN precisa aparecer em TODOS
// os 43 pontos do template (preencher só o primeiro causou semanas de
// "Os lançamentos devem ser informados").
checkSame('replay: IDLAN nos 43 pontos do template', 43, substr_count($xml, '777123'));
checkSame('replay: valor com 4 casas nos 11 pontos', 11, substr_count($xml, '465.0000'));
check('replay: nenhum resto do lançamento capturado (idlan)', !str_contains($xml, '1082893'));
check('replay: nenhum resto do valor capturado', !str_contains($xml, '2000.0'));
check('replay: nenhum resto do usuário capturado', !str_contains($xml, 'felipe.silva'));
check('replay: nenhum resto da caixa capturada', !str_contains($xml, '50380'));
check('replay: boleto do capturado neutralizado', !str_contains($xml, '499178') && str_contains($xml, '<IsBoleto>false</IsBoleto>'));
check('replay: IdBaixa da sessão da tela neutralizado', !str_contains($xml, '>100001<'));
check('replay: elos de pagamento preservados (IdPagto=1)', str_contains($xml, '<IdPagto>1</IdPagto>'));

/* =====================================================================
 * Builders legados (matrícula / lançamento) — contrato mínimo
 * ===================================================================== */

$xml = ProcessXml::matriculaPeriodoLetivo(
    codColigada: 1,
    codFilial: 1,
    idHabilitacaoFilial: 42,
    idPerlet: 7,
    ra: '24001268',
    codTurma: 'TURMA-X',
    codPlanoPagamento: 'PP01',
    now: '2026-07-14T10:00:00'
);

check('matriculaPL: XML bem-formado', xmlBemFormado($xml));
check('matriculaPL: declaração é o primeiro byte (contrato do dedent)', str_starts_with($xml, '<?xml'));
check('matriculaPL: RA injetado', str_contains($xml, '24001268'));
check('matriculaPL: turma injetada', str_contains($xml, 'TURMA-X'));
check('matriculaPL: plano de pagamento injetado', str_contains($xml, 'PP01'));
check('matriculaPL: ServerName do processo', str_contains($xml, '<ServerName xmlns="http://www.totvs.com/">EduMatriculaProcData</ServerName>'));

$xml = ProcessXml::matriculaDisciplina(
    groupToInclude: [
        'CODCOLIGADA'         => 1,
        'CODFILIAL'           => 1,
        'CODTIPOCURSO'        => 2,
        'CODTURMA'            => 'TURMA-X',
        'CODDISC'             => 'DISC-1',
        'IDTURMADISC'         => 555,
        'IDHABILITACAOFILIAL' => 42,
    ],
    idPerlet: 7,
    idHabilitacaoFilial: 42,
    ra: '24001268',
    codFilial: 1,
    codTurma: 'TURMA-X',
    now: '2026-07-14T10:00:00'
);

check('matriculaDisc: XML bem-formado', xmlBemFormado($xml));
check('matriculaDisc: disciplina injetada', str_contains($xml, 'DISC-1'));
check('matriculaDisc: RA injetado', str_contains($xml, '24001268'));

$xml = ProcessXml::gerarLancamento(
    codColigada: 1,
    codFilial: 1,
    idPerlet: 7,
    ra: '24001268',
    codContrato: 'CT-0001'
);

check('gerarLanc: XML bem-formado', xmlBemFormado($xml));
check('gerarLanc: contrato injetado', str_contains($xml, 'CT-0001'));
check('gerarLanc: RA injetado', str_contains($xml, '24001268'));
