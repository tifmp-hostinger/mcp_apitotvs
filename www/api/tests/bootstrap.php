<?php

declare(strict_types=1);

/**
 * Micro-runner de testes SEM dependências externas.
 *
 * Por que não PHPUnit (por enquanto): o composer.json não tem require-dev e o
 * build de produção roda `composer install --no-dev`; introduzir PHPUnit mexe
 * no composer.lock e é uma decisão de projeto. Este runner roda com PHP puro
 * (`php tests/run.php` ou `composer test`) e cada check() migra 1:1 para um
 * método de teste do PHPUnit quando/se a decisão for tomada.
 *
 * Requisitos: PHP >= 8.1 com ext-dom (já exigidos pelo projeto).
 * NÃO requer ext-soap: os alvos são funções puras (builders de XML, validação).
 */

error_reporting(E_ALL);
ini_set('display_errors', '1');

// Autoload: usa o vendor/ quando existir; senão, PSR-4 mínimo de src/.
$vendor = __DIR__ . '/../vendor/autoload.php';
if (is_file($vendor)) {
    require $vendor;
} else {
    spl_autoload_register(static function (string $class): void {
        $prefix = 'FMP\\RMApi\\';
        if (str_starts_with($class, $prefix)) {
            $file = __DIR__ . '/../src/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
            if (is_file($file)) {
                require $file;
            }
        }
    });
}

final class T
{
    public static int $ok = 0;
    public static int $falhas = 0;
    public static int $pulados = 0;
    /** @var string[] */
    public static array $detalhesFalhas = [];
    public static string $arquivo = '';
}

/** Registra uma asserção booleana. */
function check(string $nome, bool $cond, string $detalhe = ''): void
{
    if ($cond) {
        T::$ok++;
        return;
    }
    T::$falhas++;
    $msg = '[' . T::$arquivo . "] {$nome}" . ($detalhe !== '' ? " — {$detalhe}" : '');
    T::$detalhesFalhas[] = $msg;
    fwrite(STDERR, "FALHOU: {$msg}\n");
}

/** Asserção de igualdade estrita com diff no relatório. */
function checkSame(string $nome, mixed $esperado, mixed $obtido): void
{
    check(
        $nome,
        $esperado === $obtido,
        'esperado ' . var_export($esperado, true) . ', obtido ' . var_export($obtido, true)
    );
}

/** Asserção de que $fn lança exceção da classe dada. */
function checkThrows(string $nome, string $classe, callable $fn): void
{
    try {
        $fn();
    } catch (\Throwable $e) {
        check($nome, $e instanceof $classe, 'lançou ' . get_class($e) . ' em vez de ' . $classe);
        return;
    }
    check($nome, false, "não lançou {$classe}");
}

/** Marca um teste como pulado (dependência ausente no ambiente). */
function skip(string $nome, string $motivo): void
{
    T::$pulados++;
    fwrite(STDOUT, "PULADO: [{$nome}] {$motivo}\n");
}

/**
 * Valida que a string é XML bem-formado. Os payloads do RM declaram utf-16
 * (exigência do desserializador .NET) mas os bytes são utf-8 — troca a
 * declaração só para o parse, como o próprio código de produção faz.
 */
function xmlBemFormado(string $xml): bool
{
    $chk = preg_replace('/encoding="utf-16"/i', 'encoding="utf-8"', $xml, 1);
    $doc = new \DOMDocument();
    libxml_use_internal_errors(true);
    $ok = @$doc->loadXML($chk);
    libxml_clear_errors();
    return (bool) $ok;
}
