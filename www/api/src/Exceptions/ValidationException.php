<?php

declare(strict_types=1);

namespace FMP\RMApi\Exceptions;

use Exception;

/**
 * Falha de validação de dados de entrada (antes de qualquer chamada ao RM).
 */
class ValidationException extends Exception
{
    /** Etapas do fluxo concluídas antes da falha (preenchido pelo orquestrador). */
    public array $etapasConcluidas = [];

    public string $entity = 'Validação dos Dados';

    public function __construct(
        public readonly string $userFeedback,
        public readonly string $logMessage,
        public readonly mixed $payload
    ) {
        parent::__construct($userFeedback);
    }
}
