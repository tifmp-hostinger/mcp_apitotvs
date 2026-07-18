<?php

declare(strict_types=1);

namespace FMP\RMApi\Controllers;

use FMP\RMApi\Helpers\Json;
use FMP\RMApi\Services\BaixaService;
use FMP\RMApi\Services\LancamentoService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Operações financeiras que disparam processos do RM (wsProcess).
 */
final class FinanceiroController
{
    public function __construct(
        private readonly BaixaService $baixaService,
        private readonly LancamentoService $lancamentoService
    ) {
    }

    /**
     * POST /financeiro/baixas — baixa (quita) um lançamento financeiro.
     *
     * Erros são convertidos pelo handler central: ValidationException -> 422,
     * RMException -> 502 (com operacao/retorno_rm e, em debug, os XMLs).
     */
    public function baixar(Request $request, Response $response): Response
    {
        $body = (array) $request->getParsedBody();

        $dados = $this->baixaService->baixar($body);

        return Json::success('Baixa de lançamento enviada ao RM.', $dados);
    }

    /**
     * POST /financeiro/lancamentos — gera os lançamentos financeiros do
     * contrato do aluno (processo EduGerarLancFromContratoSliceableData).
     * Autônomo (não roda o fluxo de inscrição) e idempotente.
     * Body: { "RA": "...", "OFERTA": "..." }.
     */
    public function gerarLancamentos(Request $request, Response $response): Response
    {
        $body = (array) $request->getParsedBody();
        $ra          = trim((string) ($body['RA'] ?? ''));
        $offer       = trim((string) ($body['OFERTA'] ?? ''));
        $codContrato = trim((string) ($body['CODCONTRATO'] ?? ''));

        if ($ra === '' || $offer === '') {
            return Json::error('Informe RA e OFERTA para gerar os lançamentos.', [], 422);
        }

        $dados = $this->lancamentoService->gerarPorRaOferta($ra, $offer, $codContrato);

        return Json::success(
            $dados['ja_existiam'] ? 'Lançamentos já existiam para o contrato.' : 'Lançamentos gerados com sucesso.',
            $dados
        );
    }
}
