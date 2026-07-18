<?php

declare(strict_types=1);

namespace FMP\RMApi\Exceptions;

use Exception;

/**
 * Falha de negócio em alguma etapa de um fluxo orquestrado
 * (ex.: inscrição: PESSOA, ALUNO, MATRÍCULA NO CURSO...).
 *
 * Substitui a antiga SubscriptionException, agora podendo embrulhar
 * uma RMException para preservar o retorno bruto do RM.
 */
class FluxoException extends Exception
{
    /** Etapas do fluxo concluídas antes da falha (preenchido pelo orquestrador). */
    public array $etapasConcluidas = [];

    public function __construct(
        public readonly string $entity,
        public readonly string $userFeedback,
        public readonly string $logMessage,
        public readonly mixed $payload,
        ?\Throwable $previous = null
    ) {
        parent::__construct($userFeedback, 0, $previous);
    }

    public function rmException(): ?RMException
    {
        $prev = $this->getPrevious();
        return $prev instanceof RMException ? $prev : null;
    }
}
