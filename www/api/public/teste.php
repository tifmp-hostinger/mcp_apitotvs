<?php

declare(strict_types=1);

use FMP\RMApi\Support\Env as RMEnv;

/**
 * Diagnóstico de ambiente — mostra o que o PHP do container realmente enxerga.
 * NÃO expõe segredos: senha/usuário aparecem apenas como "definido: true/false".
 * Acesse: https://SEU-DOMINIO/teste.php
 */

require __DIR__ . '/../vendor/autoload.php';

RMEnv::load(__DIR__ . '/../.env');

header('Content-Type: application/json; charset=utf-8');

$wsUrl = (string) RMEnv::get('TOTVS_WS_URL', '');

// Mostra só o host (sem caminho/segredo) para conferência visual
$hostPreview = null;
if ($wsUrl !== '') {
    $parts = parse_url($wsUrl);
    if ($parts !== false && isset($parts['host'])) {
        $hostPreview = ($parts['scheme'] ?? 'http') . '://' . $parts['host']
            . (isset($parts['port']) ? ':' . $parts['port'] : '');
    } else {
        $hostPreview = '(valor presente, mas nao parece uma URL valida)';
    }
}

echo json_encode([
    'ok'                    => true,
    'php_version'           => PHP_VERSION,
    'sapi'                  => PHP_SAPI,
    'ext_soap'              => extension_loaded('soap'),
    'ext_curl'              => extension_loaded('curl'),
    'env_file_existe'       => is_file(__DIR__ . '/../.env'),
    'TOTVS_WS_URL_definido' => $wsUrl !== '',
    'TOTVS_WS_URL_host'     => $hostPreview,
    'TOTVS_WS_USER_definido'     => RMEnv::get('TOTVS_WS_USER', '') !== '',
    'TOTVS_WS_PASSWORD_definido' => RMEnv::get('TOTVS_WS_PASSWORD', '') !== '',
    'APP_CRYPTO_KEY_definido'    => RMEnv::get('APP_CRYPTO_KEY', '') !== '',
    'soap_wsdl_cache_enabled'    => ini_get('soap.wsdl_cache_enabled'),
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
