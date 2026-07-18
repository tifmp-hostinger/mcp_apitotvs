<?php

declare(strict_types=1);

/**
 * Crypto (tokens de SSO) e Format (máscaras).
 */

use FMP\RMApi\Helpers\Crypto;
use FMP\RMApi\Helpers\Format;

/* ---------- Crypto ---------- */

if (!function_exists('openssl_encrypt')) {
    skip('Crypto', 'ext-openssl ausente neste ambiente');
} else {
    $crypto = new Crypto('aes-256-gcm', str_repeat('k', 32));

    $claro = 'usuario$_$senha-secreta';
    $token = $crypto->encrypt($claro);

    check('token é URL-safe (sem +, / ou =)', preg_match('/^[A-Za-z0-9_-]+$/', $token) === 1);
    checkSame('round-trip encrypt/decrypt', $claro, $crypto->decrypt($token));

    // GCM autentica: token adulterado NÃO pode decriptar silenciosamente.
    $adulterado = substr($token, 0, -2) . 'xx';
    checkThrows('token adulterado é rejeitado', \RuntimeException::class, fn() => $crypto->decrypt($adulterado));

    checkThrows('payload curto é rejeitado', \RuntimeException::class, fn() => $crypto->decrypt('AAAA'));

    $chaveErrada = new Crypto('aes-256-gcm', 'curta');
    checkThrows('chave com tamanho != 32 bytes é rejeitada', \InvalidArgumentException::class, fn() => $chaveErrada->encrypt('x'));
}

/* ---------- Format ---------- */

checkSame('máscara de CPF', '529.982.247-25', Format::cpf('52998224725'));
checkSame('máscara de CPF re-aplicável', '529.982.247-25', Format::cpf('529.982.247-25'));
checkThrows('CPF com tamanho errado', \InvalidArgumentException::class, fn() => Format::cpf('123'));
