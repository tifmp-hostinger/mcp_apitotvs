<?php

declare(strict_types=1);

namespace FMP\RMApi\Helpers;

use Psr\Http\Message\ResponseInterface;
use Slim\Psr7\Response;

/**
 * Envelope JSON padrão da API.
 *
 * Sucesso:  { "sucesso": true,  "mensagem": "...", "dados": {...} }
 * Erro RM:  { "sucesso": false, "mensagem": "...", "operacao": "...", "dataserver": "...", "retorno_rm": "...", "debug": {...} }
 */
class Json
{
    public static function respond(mixed $payload, int $status = 200): ResponseInterface
    {
        $response = new Response($status);
        $response->getBody()->write(
            json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
        );

        return $response->withHeader('Content-Type', 'application/json');
    }

    public static function success(string $message, mixed $data = null, int $status = 200): ResponseInterface
    {
        return self::respond([
            'sucesso'  => true,
            'mensagem' => $message,
            'dados'    => $data,
        ], $status);
    }

    public static function error(string $message, array $extra = [], int $status = 422): ResponseInterface
    {
        return self::respond(array_merge([
            'sucesso'  => false,
            'mensagem' => $message,
        ], $extra), $status);
    }

    public static function notFound(string $message, mixed $data = null): ResponseInterface
    {
        return self::respond([
            'sucesso'  => false,
            'mensagem' => $message,
            'dados'    => $data,
        ], 404);
    }
}
