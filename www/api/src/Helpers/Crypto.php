<?php

declare(strict_types=1);

namespace FMP\RMApi\Helpers;

use InvalidArgumentException;
use RuntimeException;

/**
 * Criptografia AES-GCM dos tokens de SSO (URL-safe base64).
 */
class Crypto
{
    private int $tagLength = 16;

    public function __construct(
        private readonly string $method,
        private readonly string $key
    ) {
    }

    public function encrypt(string $plaintext): string
    {
        if (strlen($this->key) !== 32) {
            throw new InvalidArgumentException('A chave deve ter exatamente 32 bytes.');
        }

        $ivLen = openssl_cipher_iv_length($this->method);
        $iv = random_bytes($ivLen);
        $tag = '';

        $cipherRaw = openssl_encrypt($plaintext, $this->method, $this->key, OPENSSL_RAW_DATA, $iv, $tag);

        if ($cipherRaw === false) {
            throw new RuntimeException('Falha na encriptação OpenSSL.');
        }

        return $this->base64urlEncode($iv . $tag . $cipherRaw);
    }

    public function decrypt(string $encrypted): string
    {
        if (strlen($this->key) !== 32) {
            throw new InvalidArgumentException('A chave deve ter exatamente 32 bytes.');
        }

        $data = $this->base64urlDecode($encrypted);

        $ivLen = openssl_cipher_iv_length($this->method);
        if (strlen($data) < $ivLen + $this->tagLength) {
            throw new RuntimeException('Payload muito curto.');
        }

        $iv = substr($data, 0, $ivLen);
        $tag = substr($data, $ivLen, $this->tagLength);
        $cipherRaw = substr($data, $ivLen + $this->tagLength);

        $plaintext = openssl_decrypt($cipherRaw, $this->method, $this->key, OPENSSL_RAW_DATA, $iv, $tag);

        if ($plaintext === false) {
            throw new RuntimeException('Falha na autenticação ou dados corrompidos.');
        }

        return $plaintext;
    }

    private function base64urlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private function base64urlDecode(string $data): string
    {
        $b64 = strtr($data, '-_', '+/');
        $pad = strlen($b64) % 4;
        if ($pad) {
            $b64 .= str_repeat('=', 4 - $pad);
        }
        return base64_decode($b64);
    }
}
