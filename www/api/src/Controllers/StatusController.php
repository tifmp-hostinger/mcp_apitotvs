<?php

declare(strict_types=1);

namespace FMP\RMApi\Controllers;

use FMP\RMApi\Helpers\Json;
use FMP\RMApi\Services\ConsultaService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Throwable;

final class StatusController
{
    public function __construct(private readonly ConsultaService $consulta)
    {
    }

    public function getSystemStatus(Request $request, Response $response, array $args = []): Response
    {
        try {
            $rows = $this->consulta->status();
        } catch (Throwable) {
            return Json::respond([
                'sucesso'  => true,
                'mensagem' => 'Não foi possível se comunicar com o servidor.',
                'dados'    => [
                    'OK'       => false,
                    'MENSAGEM' => 'Infelizmente nosso sistema está apresentando instabilidade. Tente novamente mais tarde.',
                ],
            ]);
        }

        return Json::success('Status obtido com sucesso', $rows[0] ?? $rows);
    }
}
