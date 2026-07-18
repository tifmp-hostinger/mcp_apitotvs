<?php

declare(strict_types=1);

namespace FMP\RMApi\Controllers;

use FMP\RMApi\Helpers\Json;
use FMP\RMApi\Services\ConsultaService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

final class EnderecoController
{
    public function __construct(private readonly ConsultaService $consulta)
    {
    }

    /** GET /enderecos/estados */
    public function estados(Request $request, Response $response, array $args = []): Response
    {
        return Json::success('Lista de estados obtida com sucesso', $this->consulta->estados());
    }

    /** GET /enderecos/estados/{codestado}/cidades */
    public function cidades(Request $request, Response $response, array $args = []): Response
    {
        return Json::success(
            'Lista de cidades obtida com sucesso',
            $this->consulta->cidadesPorUf($args['codestado'])
        );
    }

    /** GET /enderecos/cidades/{codcidade}/bairros */
    public function bairros(Request $request, Response $response, array $args = []): Response
    {
        return Json::success(
            'Lista de bairros obtida com sucesso',
            $this->consulta->bairrosPorCidade($args['codcidade'])
        );
    }

    /** GET /enderecos/cep/{cep} */
    public function cep(Request $request, Response $response, array $args = []): Response
    {
        $rows = $this->consulta->enderecoPorCep($args['cep']);

        if (count($rows) === 0) {
            return Json::notFound('CEP não encontrado. Por favor, preencha seus dados de endereço.');
        }

        return Json::success('Endereço obtido com sucesso', $rows[0]);
    }
}
