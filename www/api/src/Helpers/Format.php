<?php

declare(strict_types=1);

namespace FMP\RMApi\Helpers;

use InvalidArgumentException;

class Format
{
    /**
     * Aplica a máscara XXX.XXX.XXX-XX a um CPF.
     */
    public static function cpf(string $cpf): string
    {
        $numbers = preg_replace('/\D/', '', $cpf);

        if (strlen($numbers) !== 11) {
            throw new InvalidArgumentException('O CPF deve conter exatamente 11 dígitos numéricos.');
        }

        return sprintf(
            '%s.%s.%s-%s',
            substr($numbers, 0, 3),
            substr($numbers, 3, 3),
            substr($numbers, 6, 3),
            substr($numbers, 9, 2)
        );
    }
}
