<?php

declare(strict_types=1);

namespace FMP\RMApi\Services;

use FMP\RMApi\Clients\RMSoapClient;
use Throwable;

/**
 * Log de integração gravado no próprio RM
 * (DataServer custom RMSPRJ5495296Server, tabela ZMDLOGINTEGEDUVEM).
 *
 * Tolerante a falha: um erro ao gravar o log NUNCA derruba o fluxo de
 * negócio — cai para o error_log do PHP.
 */
class LogService
{
    public function __construct(private readonly RMSoapClient $rm)
    {
    }

    public function saveLog(
        string $email,
        string $entity,
        string $offer,
        string $status,
        string $message,
        mixed $payload
    ): void {
        if (is_array($payload)) {
            $payload = json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        }

        // Escapa os campos de texto (um e-mail com "&" ou mensagem com "<"
        // quebrava o XML e o log era perdido silenciosamente) e blinda o CDATA
        // contra "]]>" dentro do payload.
        $esc = static fn(string $v): string => htmlspecialchars($v, ENT_XML1, 'UTF-8');
        $payloadCdata = str_replace(']]>', ']]]]><![CDATA[>', (string) $payload);

        $xml = <<<XML
        <PRJ5495296>
            <ZMDLOGINTEGEDUVEM>
                <ID>0</ID>
                <EMAIL>{$esc($email)}</EMAIL>
                <ENTIDADE>{$esc($entity)}</ENTIDADE>
                <CODOFERTA>{$esc($offer)}</CODOFERTA>
                <STATUS>{$esc($status)}</STATUS>
                <MENSAGEM>{$esc($message)}</MENSAGEM>
                <XML><![CDATA[{$payloadCdata}]]></XML>
            </ZMDLOGINTEGEDUVEM>
        </PRJ5495296>
        XML;

        try {
            $this->rm->saveRecord('RMSPRJ5495296Server', $xml);
        } catch (Throwable $e) {
            error_log(sprintf(
                '[RM-API] Falha ao gravar log no RM: %s | log original: [%s/%s] %s',
                $e->getMessage(),
                $entity,
                $status,
                $message
            ));
        }
    }
}
