<?php

declare(strict_types=1);

/**
 * Middleware de autenticação por API key — inclusive o modo estrito de
 * produção (sem API_KEY configurada -> 503 nas rotas não isentas).
 */

use FMP\RMApi\Middleware\ApiKeyAuth;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;

if (!class_exists(\Slim\Psr7\Factory\ServerRequestFactory::class)) {
    skip('ApiKeyAuth', 'slim/psr7 indisponível (rode composer install para habilitar este teste)');
    return;
}

$okHandler = new class implements RequestHandlerInterface {
    public function handle(ServerRequestInterface $request): ResponseInterface
    {
        return new \Slim\Psr7\Response(200);
    }
};

$req = static function (string $method, string $path, array $headers = []): ServerRequestInterface {
    $r = (new \Slim\Psr7\Factory\ServerRequestFactory())->createServerRequest($method, 'https://api.local' . $path);
    foreach ($headers as $k => $v) {
        $r = $r->withHeader($k, $v);
    }
    return $r;
};

/* ---------- comportamento legado: sem chave e sem modo estrito = aberto ---------- */

$aberto = new ApiKeyAuth('');
checkSame('sem chave + sem modo estrito: passa', 200, $aberto($req('GET', '/pessoas/1'), $okHandler)->getStatusCode());

/* ---------- modo estrito (produção sem API_KEY) ---------- */

$estrito = new ApiKeyAuth('', exigirChave: true);
checkSame('estrito sem chave: rota comum -> 503', 503, $estrito($req('GET', '/pessoas/1'), $okHandler)->getStatusCode());
checkSame('estrito sem chave: /status segue isento', 200, $estrito($req('GET', '/status'), $okHandler)->getStatusCode());
checkSame('estrito sem chave: /sso/{token} segue isento', 200, $estrito($req('GET', '/sso/abc123'), $okHandler)->getStatusCode());
checkSame('estrito sem chave: OPTIONS (preflight) passa', 200, $estrito($req('OPTIONS', '/pessoas'), $okHandler)->getStatusCode());

/* ---------- com chave configurada ---------- */

$auth = new ApiKeyAuth('segredo-123');
checkSame('sem header: 401', 401, $auth($req('GET', '/pessoas/1'), $okHandler)->getStatusCode());
checkSame('chave errada: 401', 401, $auth($req('GET', '/pessoas/1', ['X-API-Key' => 'errada']), $okHandler)->getStatusCode());
checkSame('X-API-Key correta: 200', 200, $auth($req('GET', '/pessoas/1', ['X-API-Key' => 'segredo-123']), $okHandler)->getStatusCode());
checkSame('Authorization Bearer: 200', 200, $auth($req('POST', '/financeiro/baixas', ['Authorization' => 'Bearer segredo-123']), $okHandler)->getStatusCode());
checkSame('isento não exige chave mesmo configurada', 200, $auth($req('GET', '/status'), $okHandler)->getStatusCode());

/* ---------- isenção não vaza para prefixos parecidos ---------- */

checkSame('/ssoutra-coisa NÃO é isento', 401, $auth($req('GET', '/ssoutra-coisa'), $okHandler)->getStatusCode());
checkSame('/ssoutra-coisa no modo estrito -> 503', 503, $estrito($req('GET', '/ssoutra-coisa'), $okHandler)->getStatusCode());
