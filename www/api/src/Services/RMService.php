<?php

declare(strict_types=1);

namespace FMP\RMApi\Services;

use FMP\RMApi\Clients\RMSoapClient;
use FMP\RMApi\Support\SchemaParser;

/**
 * Funcionalidades genéricas do RM, sem regra de negócio:
 * schema, teste de conexão, leitura/gravação genérica e consultas SQL.
 */
class RMService
{
    public function __construct(private readonly RMSoapClient $rm)
    {
    }

    /**
     * Valida conectividade + credenciais executando a sentença de status.
     */
    public function testConnection(): array
    {
        $rows = $this->rm->realizarConsultaSQL('INT.EDUVEM.00001');

        return $rows[0] ?? ['OK' => true];
    }

    /**
     * Schema do DataServer. $raw = true devolve o XSD original.
     */
    public function getSchema(string $dataServerName, array $context = [], bool $raw = false): array|string
    {
        $xsd = $this->rm->getSchema($dataServerName, $context);

        if ($raw) {
            return $xsd;
        }

        return (new SchemaParser())->parse($xsd);
    }

    public function readRecord(string $dataServerName, array $primaryKey, array $context = []): array
    {
        return $this->rm->readRecord($dataServerName, $primaryKey, $context);
    }

    public function readView(string $dataServerName, string $filter = '1=1', array $context = []): array
    {
        return $this->rm->readView($dataServerName, $filter, $context);
    }

    public function saveRecord(string $dataServerName, string $xml, array $context = []): string
    {
        return $this->rm->saveRecord($dataServerName, $xml, $context);
    }

    public function deleteRecord(string $dataServerName, string $xml, array $context = []): string
    {
        return $this->rm->deleteRecord($dataServerName, $xml, $context);
    }

    public function sql(
        string $codSentenca,
        array $parameters = [],
        string $codColigada = '0',
        string $codSistema = 'G'
    ): array {
        return $this->rm->realizarConsultaSQL($codSentenca, $parameters, $codColigada, $codSistema);
    }
}
