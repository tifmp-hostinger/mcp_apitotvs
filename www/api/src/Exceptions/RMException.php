<?php

declare(strict_types=1);

namespace FMP\RMApi\Exceptions;

use Exception;

/**
 * Exceção rica para qualquer falha de comunicação/negócio retornada pelo TOTVS RM.
 *
 * Carrega tudo que é necessário para diagnóstico sem abrir o código:
 * operação SOAP, DataServer, contexto, XML enviado, XML retornado e o
 * retorno bruto do RM (SoapFault ou *Result com mensagem de validação).
 */
class RMException extends Exception
{
    public function __construct(
        string $message,
        public readonly string $operacao = '',
        public readonly string $dataServer = '',
        public readonly array $contexto = [],
        public readonly ?string $xmlEnviado = null,
        public readonly ?string $xmlRetornado = null,
        public readonly ?string $retornoRm = null,
        ?\Throwable $previous = null
    ) {
        parent::__construct($message, 0, $previous);
    }

    /**
     * Representação para a resposta JSON da API.
     * Em modo debug inclui os XMLs trafegados.
     */
    public function toArray(bool $debug = false): array
    {
        $out = [
            'operacao'   => $this->operacao,
            'dataserver' => $this->dataServer,
            'retorno_rm' => $this->retornoRm ?? $this->getMessage(),
        ];

        if ($debug) {
            $out['debug'] = [
                'contexto'      => $this->contexto,
                'xml_enviado'   => $this->xmlEnviado,
                'xml_retornado' => $this->xmlRetornado,
                'soap_fault'    => $this->getPrevious() instanceof \SoapFault
                    ? [
                        'faultcode'   => $this->getPrevious()->faultcode ?? null,
                        'faultstring' => $this->getPrevious()->faultstring ?? null,
                        'detail'      => isset($this->getPrevious()->detail)
                            ? json_decode(json_encode($this->getPrevious()->detail), true)
                            : null,
                    ]
                    : null,
            ];
        }

        return $out;
    }
}
