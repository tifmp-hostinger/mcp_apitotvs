<?php

declare(strict_types=1);

namespace FMP\RMApi\Support;

/**
 * Leitura robusta de variáveis de ambiente.
 *
 * Resolve dois problemas comuns em produção:
 *  1) Sob Apache + mod_php, valores definidos no container nem sempre
 *     aparecem em getenv(); por isso também olhamos $_ENV e $_SERVER.
 *  2) A aplicação não tinha leitor de arquivo .env. O load() abaixo
 *     carrega um .env (se existir) sem sobrescrever variáveis que já
 *     vêm do ambiente real (EasyPanel/Docker têm precedência).
 */
final class Env
{
    private static bool $loaded = false;

    /** Carrega um arquivo .env (KEY=VALOR) sem derrubar a aplicação se não existir. */
    public static function load(string $path): void
    {
        if (self::$loaded) {
            return;
        }
        self::$loaded = true;

        if (!is_file($path) || !is_readable($path)) {
            return;
        }

        $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];

        foreach ($lines as $line) {
            $line = trim($line);

            if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
                continue;
            }

            [$key, $value] = explode('=', $line, 2);
            $key   = trim($key);
            $value = trim($value);

            // Remove "export " no início, se houver
            if (str_starts_with($key, 'export ')) {
                $key = trim(substr($key, 7));
            }

            // Remove aspas envolventes
            $len = strlen($value);
            if ($len >= 2
                && (($value[0] === '"' && $value[$len - 1] === '"')
                 || ($value[0] === "'" && $value[$len - 1] === "'"))) {
                $value = substr($value, 1, -1);
            }

            if ($key === '') {
                continue;
            }

            // Ambiente real tem precedência: só define se ainda não existir.
            if (getenv($key) === false && !isset($_ENV[$key]) && !isset($_SERVER[$key])) {
                putenv($key . '=' . $value);
                $_ENV[$key]    = $value;
                $_SERVER[$key] = $value;
            }
        }
    }

    /** Retorna a variável de ambiente, checando getenv/$_ENV/$_SERVER. Vazio conta como ausente. */
    public static function get(string $key, ?string $default = null): ?string
    {
        $value = getenv($key);
        if ($value !== false && $value !== '') {
            return $value;
        }

        if (isset($_ENV[$key]) && $_ENV[$key] !== '') {
            return (string) $_ENV[$key];
        }

        if (isset($_SERVER[$key]) && $_SERVER[$key] !== '') {
            return (string) $_SERVER[$key];
        }

        return $default;
    }
}
