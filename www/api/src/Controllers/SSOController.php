<?php

declare(strict_types=1);

namespace FMP\RMApi\Controllers;

use FMP\RMApi\Helpers\Crypto;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * SSO de primeiro acesso ao Portal Educacional TOTVS.
 *
 * EXCEÇÃO documentada ao padrão JSON da API: o auto-login do portal exige
 * um POST de formulário no navegador do aluno, então este endpoint devolve
 * uma página mínima com form auto-submit. É consumido pelo redirect do
 * fluxo de inscrição (nextUrl), não por integrações.
 */
final class SSOController
{
    public function __construct(
        private readonly Crypto $crypto,
        private readonly array $rmConfig
    ) {
    }

    /** GET /sso/{token} */
    public function signIn(Request $request, Response $response, array $args = []): Response
    {
        $rawTokenContent = $this->crypto->decrypt($args['token']);

        [$user, $password] = explode('$_$', $rawTokenContent, 2);

        $user = htmlspecialchars($user, ENT_QUOTES, 'UTF-8');
        $password = htmlspecialchars($password, ENT_QUOTES, 'UTF-8');

        $actionUrl = htmlspecialchars($this->rmConfig['portal']['autologin_url'], ENT_QUOTES, 'UTF-8');
        $alias = htmlspecialchars($this->rmConfig['portal']['alias'], ENT_QUOTES, 'UTF-8');

        $html = <<<HTML
        <!DOCTYPE html>
        <html lang="pt-br">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Redirecionando...</title>
        </head>
        <body>
            <p>Aguarde... Você está sendo redirecionado.</p>
            <form id="form-autologin" action="{$actionUrl}" method="post" style="display:none">
                <input type="hidden" name="User" value="{$user}" />
                <input type="hidden" name="Pass" value="{$password}" />
                <input type="hidden" name="Alias" value="{$alias}" />
            </form>
            <script>document.getElementById('form-autologin').submit();</script>
        </body>
        </html>
        HTML;

        $response->getBody()->write($html);

        return $response->withHeader('Content-Type', 'text/html; charset=utf-8');
    }
}
