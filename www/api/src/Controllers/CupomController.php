<?php

declare(strict_types=1);

namespace FMP\RMApi\Controllers;

use FMP\RMApi\Helpers\Json;
use FMP\RMApi\Services\BolsaService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

final class CupomController
{
    public function __construct(private readonly BolsaService $bolsaService)
    {
    }

    /** GET /cupons/{codoferta}/{codplano}/{cupom} */
    public function buscar(Request $request, Response $response, array $args = []): Response
    {
        $cupom = $this->bolsaService->validarCupom(
            $args['codoferta'],
            $args['codplano'],
            $args['cupom']
        );

        if ($cupom === null) {
            return Json::notFound('Cupom não encontrado');
        }

        return Json::success('Cupom obtido com sucesso', $cupom);
    }

    /**
     * POST /cupons/aplicar — aplica um cupom (bolsa) ao contrato do aluno.
     * Autônomo (não roda o fluxo de inscrição) e idempotente.
     * Body: { "RA", "OFERTA", "PLANOPAGAMENTO", "CUPOM" }.
     */
    public function aplicar(Request $request, Response $response): Response
    {
        $body  = (array) $request->getParsedBody();
        $ra          = trim((string) ($body['RA'] ?? ''));
        $offer       = trim((string) ($body['OFERTA'] ?? ''));
        $plano       = trim((string) ($body['PLANOPAGAMENTO'] ?? $body['CODPLANO'] ?? ''));
        $cupom       = trim((string) ($body['CUPOM'] ?? ''));
        $codContrato = trim((string) ($body['CODCONTRATO'] ?? ''));

        if ($ra === '' || $offer === '' || $plano === '' || $cupom === '') {
            return Json::error('Informe RA, OFERTA, PLANOPAGAMENTO e CUPOM para aplicar o cupom.', [], 422);
        }

        $dados = $this->bolsaService->aplicarPorRaOferta($ra, $offer, $plano, $cupom, $codContrato);

        return Json::success(
            $dados['ja_existia'] ? 'Cupom já estava aplicado ao contrato.' : 'Cupom aplicado com sucesso.',
            $dados
        );
    }
}
