<?php

declare(strict_types=1);

namespace FMP\RMApi\Controllers;

use FMP\RMApi\Helpers\Json;
use FMP\RMApi\Services\ConsultaService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

final class OfertaController
{
    public function __construct(private readonly ConsultaService $consulta)
    {
    }

    /** GET /ofertas/{codoferta} */
    public function buscar(Request $request, Response $response, array $args = []): Response
    {
        $oferta = $this->consulta->oferta($args['codoferta']);

        if ($oferta === null) {
            return Json::notFound('Não foi possível encontrar os dados da oferta');
        }

        return Json::success('Dados da oferta obtidos com sucesso.', $oferta);
    }

    /** GET /ofertas/{codoferta}/planos-pagamento */
    public function planosPagamento(Request $request, Response $response, array $args = []): Response
    {
        $planos = $this->consulta->planosPagamento($args['codoferta']);

        if (count($planos) === 0) {
            return Json::notFound('Não foi possível encontrar as formas de pagamento da oferta');
        }

        return Json::success('Formas de pagamento da oferta obtidas com sucesso.', $planos);
    }
}
