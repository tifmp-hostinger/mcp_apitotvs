<?php

declare(strict_types=1);

use FMP\RMApi\Controllers\AlunoController;
use FMP\RMApi\Controllers\CfoController;
use FMP\RMApi\Controllers\ContratoController;
use FMP\RMApi\Controllers\CupomController;
use FMP\RMApi\Controllers\EnderecoController;
use FMP\RMApi\Controllers\FinanceiroController;
use FMP\RMApi\Controllers\InscricaoController;
use FMP\RMApi\Controllers\MatriculaController;
use FMP\RMApi\Controllers\OfertaController;
use FMP\RMApi\Controllers\PessoaController;
use FMP\RMApi\Controllers\RMController;
use FMP\RMApi\Controllers\SSOController;
use FMP\RMApi\Controllers\StatusController;
use Slim\App;
use Slim\Routing\RouteCollectorProxy;

return function (App $app): void {

    /* ---------- Sistema ---------- */

    $app->get('/status', [StatusController::class, 'getSystemStatus']);

    /* ---------- RM genérico (diagnóstico/exploração) ---------- */

    $app->group('/rm', function (RouteCollectorProxy $rm) {
        $rm->get('/test', [RMController::class, 'testConnection']);
        $rm->get('/schema/{dataserver}', [RMController::class, 'getSchema']);
        $rm->post('/sql/{codsentenca}', [RMController::class, 'sql']);
        $rm->post('/read/{dataserver}', [RMController::class, 'readRecord']);
        $rm->post('/view/{dataserver}', [RMController::class, 'readView']);
        $rm->post('/save/{dataserver}', [RMController::class, 'saveRecord']);
    });

    /* ---------- Pessoa ---------- */

    $app->group('/pessoas', function (RouteCollectorProxy $pessoas) {
        $pessoas->post('', [PessoaController::class, 'salvar']);
        // Busca por documento: GET (leitura). ?cpf=... ou ?rnm=...
        $pessoas->get('/busca', [PessoaController::class, 'buscarPorDocumento']);
        $pessoas->get('/{codigo}', [PessoaController::class, 'buscar']);
    });

    /* ---------- Aluno ---------- */

    $app->group('/alunos', function (RouteCollectorProxy $alunos) {
        $alunos->post('', [AlunoController::class, 'salvar']);
        // Vincula um Cliente/Fornecedor já gravado a um aluno existente (por RA).
        $alunos->post('/cliente-fornecedor', [AlunoController::class, 'vincularCliente']);
        $alunos->get('/{codcoligada}/{codpessoa}', [AlunoController::class, 'buscar']);
    });

    /* ---------- Cliente/Fornecedor (FinCFODataBR) ---------- */

    $app->group('/clientes-fornecedores', function (RouteCollectorProxy $cfo) {
        // Consulta (leitura) por CPF/RNM: GET ?cpf=... ou ?rnm=...
        $cfo->get('/busca', [CfoController::class, 'buscarPorDocumento']);
        // Criação: envia CODCFO=0; o RM gera o código.
        $cfo->post('', [CfoController::class, 'salvar']);
    });

    /* ---------- Inscrição (fluxo completo orquestrado) ---------- */

    $app->post('/inscricoes', [InscricaoController::class, 'criar']);

    /* ---------- Matrícula (etapas granulares) ---------- */

    $app->group('/matriculas', function (RouteCollectorProxy $matriculas) {
        $matriculas->post('/curso', [MatriculaController::class, 'curso']);
        $matriculas->post('/periodo-letivo', [MatriculaController::class, 'periodoLetivo']);
        $matriculas->post('/disciplinas', [MatriculaController::class, 'disciplinas']);
    });

    /* ---------- Contrato ---------- */

    $app->post('/contratos', [ContratoController::class, 'gerar']);

    /* ---------- Financeiro (processos wsProcess) ---------- */

    $app->group('/financeiro', function (RouteCollectorProxy $fin) {
        // Baixa (quitação) de lançamento: processo FinTBCBaixaDataProcess
        // (baixa via WS oficial da TOTVS; configurável por FIN_BAIXA_PROCESSO).
        $fin->post('/baixas', [FinanceiroController::class, 'baixar']);
        // Geração de lançamentos do contrato (autônoma): EduGerarLancFromContratoSliceableData.
        $fin->post('/lancamentos', [FinanceiroController::class, 'gerarLancamentos']);
    });

    /* ---------- Oferta ---------- */

    $app->group('/ofertas', function (RouteCollectorProxy $ofertas) {
        $ofertas->get('/{codoferta}', [OfertaController::class, 'buscar']);
        $ofertas->get('/{codoferta}/planos-pagamento', [OfertaController::class, 'planosPagamento']);
    });

    /* ---------- Endereço ---------- */

    $app->group('/enderecos', function (RouteCollectorProxy $enderecos) {
        $enderecos->get('/estados', [EnderecoController::class, 'estados']);
        $enderecos->get('/estados/{codestado}/cidades', [EnderecoController::class, 'cidades']);
        $enderecos->get('/cidades/{codcidade}/bairros', [EnderecoController::class, 'bairros']);
        $enderecos->get('/cep/{cep}', [EnderecoController::class, 'cep']);
    });

    /* ---------- Cupom ---------- */

    // Aplicação (bolsa) do cupom ao contrato do aluno — autônoma.
    $app->post('/cupons/aplicar', [CupomController::class, 'aplicar']);
    $app->get('/cupons/{codoferta}/{codplano}/{cupom}', [CupomController::class, 'buscar']);

    /* ---------- SSO (exceção HTML — ver SSOController) ---------- */

    $app->get('/sso/{token}', [SSOController::class, 'signIn']);
};
