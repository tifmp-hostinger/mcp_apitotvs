<?php

declare(strict_types=1);

namespace FMP\RMApi\Helpers;

use FMP\RMApi\Exceptions\ValidationException;
use Normalizer;
use Throwable;

/**
 * Validações de dados de entrada (CPF, RNM, CEP, telefone, nome, datas...).
 * Portado integralmente do legado (ValidationUtils).
 */
class Validation
{
    public static function ensureSexo(string $value): string
    {
        if ($value === 'M' || $value === 'F') {
            return $value;
        }

        throw new ValidationException(
            'Não encontramos o cadastro para o sexo informado.',
            'Sexo inválido informado.',
            $value
        );
    }

    public static function ensureHasValue($arr, $key)
    {
        if (is_array($arr) && isset($arr[$key]) && !empty($arr[$key])) {
            return $arr[$key];
        }

        throw new ValidationException(
            "Não encontramos um valor que era esperado: {$key}",
            "Valor obrigatório não encontrado. Chave do valor esperado: {$key}",
            $arr
        );
    }

    public static function getOnlyNumbers($value): string
    {
        return preg_replace('/\D/', '', (string) $value);
    }

    public static function ensureStrLength(string $value, int $length): string
    {
        if (strlen($value) != $length) {
            throw new ValidationException(
                "{$value} não tem o tamanho esperado. Tamanho esperado: {$length}",
                "{$value} não tem o tamanho esperado. Tamanho esperado: {$length}",
                $value
            );
        }

        return $value;
    }

    public static function ensureCep(string $value): string
    {
        try {
            return self::ensureStrLength(self::getOnlyNumbers($value), 8);
        } catch (Throwable) {
            throw new ValidationException(
                "O CEP informado ({$value}) parece incorreto. Por favor revise e tente novamente.",
                'CEP inválido informado',
                $value
            );
        }
    }

    public static function ensureRnm(string $value): string
    {
        $rnmUpper = strtoupper($value);

        // letra maiúscula, 6 dígitos, hífen e dígito verificador
        if (preg_match('/^[A-Z]\d{6}-\d$/', $rnmUpper) === 1) {
            return $rnmUpper;
        }

        throw new ValidationException(
            "O RNM informado ({$value}) não parece correto. Por favor revise e tente novamente.",
            'RNM inválido informado',
            $value
        );
    }

    public static function ensureEmail(string $value): string
    {
        if ((bool) filter_var($value, FILTER_VALIDATE_EMAIL)) {
            return $value;
        }

        throw new ValidationException(
            "O Email informado ({$value}) não parece correto. Por favor revise e tente novamente.",
            'EMAIL inválido informado',
            $value
        );
    }

    public static function ensureCpf($value): string
    {
        $cpf = preg_replace('/\D/', '', (string) $value);

        $fail = fn() => throw new ValidationException(
            "O CPF informado ({$value}) não parece correto. Por favor revise e tente novamente.",
            'CPF inválido informado',
            $value
        );

        if (strlen($cpf) !== 11 || preg_match('/^(\d)\1{10}$/', $cpf)) {
            $fail();
        }

        for ($t = 9; $t < 11; $t++) {
            $sum = 0;
            for ($i = 0; $i < $t; $i++) {
                $sum += (int) $cpf[$i] * (($t + 1) - $i);
            }
            $rest = ($sum * 10) % 11;
            if ($rest === 10) {
                $rest = 0;
            }
            if ((int) $cpf[$t] !== $rest) {
                $fail();
            }
        }

        return $cpf;
    }

    public static function ensurePastDate(string $date): string
    {
        $date = preg_replace('/^\xEF\xBB\xBF/', '', $date);
        $date = preg_replace('/[\x00-\x1F\x7F]/u', '', $date);
        $date = trim($date);
        $date = preg_replace('/[‐‑–—−]/u', '-', $date);

        if (!preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/', $date)) {
            throw new ValidationException(
                "A data '{$date}' não está no formato YYYY-MM-DD.",
                "Data fora do formato esperado: {$date}",
                $date
            );
        }

        $dt = \DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        if ($dt === false || $dt->format('Y-m-d') !== $date) {
            throw new ValidationException(
                "A data '{$date}' é inválida.",
                "Data inválida: {$date}",
                $date
            );
        }

        if ($dt >= new \DateTimeImmutable('today')) {
            throw new ValidationException(
                "A data '{$date}' deve ser anterior à data atual.",
                "Data não é passada: {$date}",
                $date
            );
        }

        return $dt->format('Y-m-d');
    }

    public static function ensureDate($value): string
    {
        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d');
        }

        if (is_numeric($value)) {
            return (new \DateTime())->setTimestamp((int) $value)->format('Y-m-d');
        }

        if (!is_string($value)) {
            throw new ValidationException(
                'A data informada é inválida.',
                'Data inválida (tipo não suportado)',
                $value
            );
        }

        $value = trim($value);

        // d/m/Y (formato BR)
        if (preg_match('#^(\d{1,2})\/(\d{1,2})\/(\d{4})$#', $value, $m)) {
            return sprintf('%04d-%02d-%02d', $m[3], $m[2], $m[1]);
        }

        $formats = ['Y-m-d', 'Y/m/d', 'd-m-Y', 'd.m.Y', 'm/d/Y', 'm-d-Y', 'm.d.Y'];

        foreach ($formats as $format) {
            $date = \DateTime::createFromFormat($format, $value);
            $errors = \DateTime::getLastErrors();

            $noErrors = $errors === false
                || ($errors['warning_count'] === 0 && $errors['error_count'] === 0);

            if ($date && $noErrors && $date->format($format) === $value) {
                return $date->format('Y-m-d');
            }
        }

        try {
            return (new \DateTime($value))->format('Y-m-d');
        } catch (\Exception) {
            throw new ValidationException(
                "A data '{$value}' é inválida.",
                "Data inválida: {$value}",
                $value
            );
        }
    }

    public static function ensureName(string $value): string
    {
        if (class_exists(Normalizer::class)) {
            $value = Normalizer::normalize($value, Normalizer::FORM_C) ?: $value;
        }

        $name = trim(preg_replace('/\s+/u', ' ', $value));

        if (mb_strlen($name, 'UTF-8') > 100) {
            throw new ValidationException(
                "O Nome informado ({$value}) não parece correto. Por favor revise e tente novamente.",
                "NOME muito longo informado: {$value}",
                $value
            );
        }

        $parts = preg_split('/\s+/u', $name);
        if (count($parts) < 2) {
            throw new ValidationException(
                "O Nome informado ({$value}) não parece correto. Por favor forneça seu nome completo.",
                'NOME sem sobrenome informado',
                $value
            );
        }

        $regex = '/^[\p{L}\p{M}\p{Pd}\'\x{2019}\.]+$/u';

        foreach ($parts as $part) {
            if (!preg_match($regex, $part)) {
                throw new ValidationException(
                    "O Nome informado ({$value}) não parece correto. Por favor revise e tente novamente.",
                    'NOME inválido informado',
                    $value
                );
            }
        }

        return $name;
    }

    public static function ensurePhone(string $value): string
    {
        $value = self::getOnlyNumbers($value);

        if (strlen($value) === 13 && str_starts_with($value, '55')) {
            $value = substr($value, 2);
        }

        if (!preg_match('/^([0-9]{2})9[0-9]{8}$/', $value, $matches)) {
            throw new ValidationException(
                "O Telefone informado ({$value}) não parece correto. Por favor revise e tente novamente.",
                'TELEFONE inválido informado',
                $value
            );
        }

        $validDDDs = [
            '11', '12', '13', '14', '15', '16', '17', '18', '19',
            '21', '22', '24', '27', '28',
            '31', '32', '33', '34', '35', '37', '38',
            '41', '42', '43', '44', '45', '46', '47', '48', '49',
            '51', '53', '54', '55',
            '61', '62', '63', '64', '65', '66', '67', '68', '69',
            '71', '73', '74', '75', '77', '79',
            '81', '82', '83', '84', '85', '86', '87', '88', '89',
            '91', '92', '93', '94', '95', '96', '97', '98', '99',
        ];

        if (in_array($matches[1], $validDDDs, true)) {
            return $value;
        }

        throw new ValidationException(
            "O Telefone informado ({$value}) não parece correto. Por favor revise e tente novamente.",
            'TELEFONE inválido informado',
            $value
        );
    }
}
