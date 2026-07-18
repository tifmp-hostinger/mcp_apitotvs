<?php

declare(strict_types=1);

namespace FMP\RMApi\Controllers;

use FMP\RMApi\Helpers\Json;
use FMP\RMApi\Services\InscricaoService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Routing\RouteContext;

final class InscricaoController
{
    public function __construct(private readonly InscricaoService $inscricaoService)
    {
    }

    /**
     * POST /inscricoes — fluxo completo:
     * pessoa → aluno → matrícula → enturmação → cupom → lançamento.
     */
    public function criar(Request $request, Response $response, array $args = []): Response
    {
        $data = (array) $request->getParsedBody();

        $resultado = $this->inscricaoService->executar($data, self::baseUrl($request));

        return Json::success('Inscrição efetuada com sucesso!', $resultado);
    }

    private static function baseUrl(Request $request): string
    {
        $uri = $request->getUri();
        $basePath = RouteContext::fromRequest($request)->getBasePath();

        return sprintf('%s://%s%s', $uri->getScheme(), $uri->getAuthority(), $basePath);
    }
}
