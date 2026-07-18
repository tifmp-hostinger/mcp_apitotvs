<?php

declare(strict_types=1);

/**
 * Regras de validação de entrada (Helpers/Validation) — funções puras com
 * regra de negócio real (dígito verificador de CPF, DDDs, formatos de data).
 */

use FMP\RMApi\Exceptions\ValidationException;
use FMP\RMApi\Helpers\Validation;

/* ---------- CPF ---------- */

checkSame('cpf válido passa e sai só com dígitos', '52998224725', Validation::ensureCpf('529.982.247-25'));
checkThrows('cpf com dígito verificador errado', ValidationException::class, fn() => Validation::ensureCpf('529.982.247-24'));
checkThrows('cpf com 11 dígitos repetidos', ValidationException::class, fn() => Validation::ensureCpf('111.111.111-11'));
checkThrows('cpf curto', ValidationException::class, fn() => Validation::ensureCpf('123'));

/* ---------- RNM ---------- */

checkSame('rnm válido (e uppercase aplicado)', 'A123456-7', Validation::ensureRnm('a123456-7'));
checkThrows('rnm sem letra inicial', ValidationException::class, fn() => Validation::ensureRnm('1234567-8'));
checkThrows('rnm sem dígito verificador', ValidationException::class, fn() => Validation::ensureRnm('A123456'));

/* ---------- CEP ---------- */

checkSame('cep com máscara sai só com dígitos', '01310100', Validation::ensureCep('01310-100'));
checkThrows('cep curto', ValidationException::class, fn() => Validation::ensureCep('1310-100'));

/* ---------- Telefone ---------- */

checkSame('celular válido', '11987654321', Validation::ensurePhone('(11) 98765-4321'));
checkSame('celular com +55 tem o país removido', '11987654321', Validation::ensurePhone('5511987654321'));
checkThrows('fixo (sem o 9) é rejeitado', ValidationException::class, fn() => Validation::ensurePhone('1133334444'));
checkThrows('ddd inexistente é rejeitado', ValidationException::class, fn() => Validation::ensurePhone('20987654321'));

/* ---------- Nome ---------- */

checkSame('nome com acento normalizado', 'José da Silva', Validation::ensureName('  José   da Silva '));
checkThrows('nome sem sobrenome', ValidationException::class, fn() => Validation::ensureName('José'));
checkThrows('nome com dígito', ValidationException::class, fn() => Validation::ensureName('Jo4o Silva'));
checkThrows('nome com mais de 100 chars', ValidationException::class, fn() => Validation::ensureName(str_repeat('Ab ', 40) . 'Fim'));

/* ---------- Datas ---------- */

checkSame('data BR d/m/Y convertida', '2026-07-13', Validation::ensureDate('13/07/2026'));
checkSame('data ISO passa direto', '2026-07-13', Validation::ensureDate('2026-07-13'));
checkSame('data d-m-Y convertida', '2026-07-13', Validation::ensureDate('13-07-2026'));
checkThrows('lixo não vira data', ValidationException::class, fn() => Validation::ensureDate('não é data'));

checkSame('data passada aceita', '2000-01-01', Validation::ensurePastDate('2000-01-01'));
checkThrows('hoje não é passado', ValidationException::class, fn() => Validation::ensurePastDate(date('Y-m-d')));
checkThrows('mês 13 é inválido', ValidationException::class, fn() => Validation::ensurePastDate('2000-13-01'));
checkThrows('ensurePastDate exige Y-m-d estrito', ValidationException::class, fn() => Validation::ensurePastDate('01/01/2000'));

/* ---------- Sexo / presença de valor ---------- */

checkSame('sexo M', 'M', Validation::ensureSexo('M'));
checkThrows('sexo inválido', ValidationException::class, fn() => Validation::ensureSexo('X'));

checkSame('ensureHasValue devolve o valor', 'abc', Validation::ensureHasValue(['K' => 'abc'], 'K'));
checkThrows('ensureHasValue rejeita ausente', ValidationException::class, fn() => Validation::ensureHasValue([], 'K'));
// Quirk documentado: usa !empty(), então "0" é tratado como ausente. Quem
// precisa aceitar zero (ex.: CODCOLCFO=0) valida à mão — ver AlunoService::vincularCliente().
checkThrows('ensureHasValue rejeita "0" (quirk conhecido do empty)', ValidationException::class, fn() => Validation::ensureHasValue(['K' => '0'], 'K'));
