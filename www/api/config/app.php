<?php

declare(strict_types=1);

/**
 * Configuração geral da aplicação.
 * Agora compatível com Docker / EasyPanel (ENV vars).
 */

use FMP\RMApi\Support\Env;

return [
    'debug' => Env::get('APP_DEBUG', 'false') === 'true',

    'base' => Env::get('APP_BASE', ''),

    'crypto' => [
        'key'    => Env::get('APP_CRYPTO_KEY', ''),
        'method' => Env::get('APP_CRYPTO_METHOD', 'aes-256-gcm'),
    ],
];