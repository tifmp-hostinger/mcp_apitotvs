<?php

declare(strict_types=1);

/**
 * Executa todos os tests/*Test.php. Uso: php tests/run.php  (ou: composer test)
 * Sai com código != 0 em falha (utilizável em CI/hook de deploy).
 */

require __DIR__ . '/bootstrap.php';

foreach (glob(__DIR__ . '/*Test.php') as $arquivo) {
    T::$arquivo = basename($arquivo);
    fwrite(STDOUT, '== ' . T::$arquivo . "\n");
    require $arquivo;
}

fwrite(STDOUT, sprintf(
    "\n%d asserções OK, %d falha(s), %d pulado(s)\n",
    T::$ok,
    T::$falhas,
    T::$pulados
));

exit(T::$falhas === 0 ? 0 : 1);
