<?php

declare(strict_types=1);

namespace FMP\RMApi\Controllers;

use FMP\RMApi\Helpers\Json;
use FMP\RMApi\Services\RMService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Endpoints genéricos/utilitários do RM (diagnóstico e exploração).
 */
final class RMController
{
    public function __construct(private readonly RMService $rmService)
    {
    }

    /** GET /rm/test */
    public function testConnection(Request $request, Response $response, array $args = []): Response
    {
        return Json::success('Conexão com o RM OK', $this->rmService->testConnection());
    }

    /** GET /rm/schema/{dataserver}?xml=1  (alias antigo: ?raw=1) */
    public function getSchema(Request $request, Response $response, array $args = []): Response
    {
        $query = $request->getQueryParams();
        // ?xml=1 devolve o XSD bruto. Mantém ?raw=1 como alias por compatibilidade.
        $raw = ($query['xml'] ?? $query['raw'] ?? '') === '1';

        $schema = $this->rmService->getSchema($args['dataserver'], [], $raw);

        if ($raw) {
            $response->getBody()->write((string) $schema);
            return $response->withHeader('Content-Type', 'application/xml');
        }

      return Json::success('Schema obtido com sucesso', $schema);
    }

    /** POST /rm/sql/{codsentenca} — body: { "parametros": {...}, "codcoligada": "0", "codsistema": "G" } */
    public function sql(Request $request, Response $response, array $args = []): Response
    {
        $body = (array) $request->getParsedBody();

        $rows = $this->rmService->sql(
            $args['codsentenca'],
            (array) ($body['parametros'] ?? []),
            (string) ($body['codcoligada'] ?? '0'),
            (string) ($body['codsistema'] ?? 'G')
        );

        return Json::success('Consulta executada com sucesso', $rows);
    }

    /** POST /rm/read/{dataserver} — body: { "chave": ["1", "..."], "contexto": {...} } */
    public function readRecord(Request $request, Response $response, array $args = []): Response
    {
        $body = (array) $request->getParsedBody();

        $record = $this->rmService->readRecord(
            $args['dataserver'],
            (array) ($body['chave'] ?? []),
            (array) ($body['contexto'] ?? [])
        );

        return Json::success('Registro obtido com sucesso', $record);
    }

    /** POST /rm/view/{dataserver} — body: { "filtro": "1=1", "contexto": {...} } */
    public function readView(Request $request, Response $response, array $args = []): Response
    {
        $body = (array) $request->getParsedBody();

        $rows = $this->rmService->readView(
            $args['dataserver'],
            (string) ($body['filtro'] ?? '1=1'),
            (array) ($body['contexto'] ?? [])
        );

        return Json::success('Consulta executada com sucesso', $rows);
    }

    /** POST /rm/save/{dataserver} — body: { "xml": "<...>", "contexto": {...} } */
    public function saveRecord(Request $request, Response $response, array $args = []): Response
    {
        $body = (array) $request->getParsedBody();

        if (empty($body['xml'])) {
            return Json::error('O campo "xml" é obrigatório.');
        }

        $result = $this->rmService->saveRecord(
            $args['dataserver'],
            (string) $body['xml'],
            (array) ($body['contexto'] ?? [])
        );

        return Json::success('Registro gravado com sucesso', ['resultado' => $result]);
    }
}
