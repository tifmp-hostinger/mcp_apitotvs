<?php

declare(strict_types=1);

/**
 * BaixaService::normalizarDecimal — conversão de valor monetário BR -> RM.
 * O método é privado (detalhe interno do service); testado via reflection
 * para não abrir a API pública só por causa do teste.
 */

use FMP\RMApi\Services\BaixaService;

$normalizar = new \ReflectionMethod(BaixaService::class, 'normalizarDecimal');

$casos = [
    '1.234,56' => '1234.56',   // BR completo (milhar + decimal)
    '465,00'   => '465.00',    // vírgula decimal
    '465.00'   => '465.00',    // já no formato RM
    '465'      => '465.00',    // inteiro ganha casas
    '1234.5'   => '1234.50',   // completa a segunda casa
    ''         => '0.00',      // vazio não explode
];

foreach ($casos as $entrada => $esperado) {
    checkSame("normalizarDecimal('{$entrada}')", $esperado, $normalizar->invoke(null, (string) $entrada));
}
