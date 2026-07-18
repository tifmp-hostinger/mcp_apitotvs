<?php

declare(strict_types=1);

namespace FMP\RMApi\Clients;

use FMP\RMApi\Exceptions\RMException;
use SoapClient;
use SoapFault;
use Throwable;

/**
 * Cliente SOAP único do TOTVS RM.
 *
 * Responsabilidades:
 *  - criar e cachear SoapClient por endpoint (wsDataServer, wsProcess, wsReport, wsConsultaSQL)
 *  - autenticação básica centralizada
 *  - encapsular todas as operações SOAP usadas pelas integrações
 *  - capturar request/response XML (trace) e lançar RMException rica
 *
 * Nenhuma regra de negócio aqui: apenas transporte + tradução de erros.
 */
class RMSoapClient
{
    /** @var array<string, SoapClient> */
    private array $connections = [];

    public function __construct(
        private readonly string $baseUrl,
        private readonly string $user,
        private readonly string $password
    ) {
    }

    /* =====================================================================
     * Infraestrutura
     * ===================================================================== */

    private function conn(RMWSType $type, ?string $user = null, ?string $password = null): SoapClient
    {
        $custom = $user !== null || $password !== null;

        if (!$custom && isset($this->connections[$type->name])) {
            return $this->connections[$type->name];
        }

        try {
            // ATENÇÃO (pegadinha do SoapClient): connection_timeout limita só a
            // FASE DE CONEXÃO TCP. O tempo de resposta da chamada em si é regido
            // por default_socket_timeout — que o Dockerfile fixa em 300s (casando
            // com max_execution_time/Apache Timeout). Fora do container oficial,
            // configure default_socket_timeout ou uma resposta lenta do RM pode
            // prender o worker pelo default do PHP (60s) ou indefinidamente.
            $client = new SoapClient($this->baseUrl . $type->getUrlSuffix(), [
                'login'              => $user ?? $this->user,
                'password'           => $password ?? $this->password,
                'trace'              => true, // necessário para capturar XML enviado/retornado
                'exceptions'         => true,
                'connection_timeout' => 30,                // não fica pendurado se o RM não responder
                'cache_wsdl'         => WSDL_CACHE_BOTH,    // cacheia o WSDL grande do RM (memória/tempo)
                'keep_alive'         => false,              // evita reuso de socket que trava sob carga
            ]);
        } catch (Throwable $e) {
            throw new RMException(
                'Falha ao conectar no endpoint SOAP do RM: ' . $e->getMessage(),
                operacao: 'WSDL ' . $type->name,
                retornoRm: $e->getMessage(),
                previous: $e
            );
        }

        if (!$custom) {
            $this->connections[$type->name] = $client;
        }

        return $client;
    }

    /**
     * Executa a chamada SOAP capturando request/response e
     * convertendo qualquer falha em RMException.
     */
    private function call(
        RMWSType $type,
        string $function,
        array $arguments,
        string $dataServer = '',
        array $contexto = [],
        ?string $xmlEnviado = null,
        ?SoapClient $client = null
    ): mixed {
        $client ??= $this->conn($type);

        // Marcadores no stderr (Logs do EasyPanel): se aparecer ">> SOAP"
        // mas nunca ">> SOAP OK" nem um erro logado, o processo morreu DENTRO
        // da chamada SOAP (segfault/OOM) — não é rejeição do RM.
        $debug = getenv('APP_DEBUG') === 'true';
        if ($debug) {
            error_log("[RMAPI] >> SOAP {$function} ({$dataServer})");
        }

        try {
            $result = $client->__soapCall($function, $arguments);
            if ($debug) {
                error_log("[RMAPI] >> SOAP {$function} OK");
            }
            return $result;
        } catch (SoapFault $fault) {
            throw new RMException(
                $fault->getMessage(),
                operacao: $function,
                dataServer: $dataServer,
                contexto: $contexto,
                xmlEnviado: $xmlEnviado ?? $client->__getLastRequest(),
                xmlRetornado: $client->__getLastResponse(),
                retornoRm: $fault->getMessage(),
                previous: $fault
            );
        } catch (Throwable $e) {
            throw new RMException(
                $e->getMessage(),
                operacao: $function,
                dataServer: $dataServer,
                contexto: $contexto,
                xmlEnviado: $xmlEnviado ?? $client->__getLastRequest(),
                xmlRetornado: $client->__getLastResponse(),
                retornoRm: $e->getMessage(),
                previous: $e
            );
        }
    }

    /**
     * Heurística para detectar retorno de processo que NÃO é sucesso.
     *
     * O wsProcess do RM devolve uma string: "1"/JobId numérico em sucesso, mas
     * em falha pode devolver a própria mensagem de erro SEM a palavra "error"
     * (ex.: "Classe não encontrada: FinLanBaixaProc", stack traces .NET,
     * "não foi possível..."). Tratar isso como sucesso mascara a falha, então
     * checamos um conjunto de assinaturas típicas de erro do RM.
     */
    private static function pareceErroDeProcesso(string $retorno): bool
    {
        $r = mb_strtolower(trim($retorno));

        $assinaturas = [
            'error', 'exception', 'classe não', 'classe nao', 'não encontrad',
            'nao encontrad', 'not found', 'stack trace', 'nullreference',
            'could not', 'falha ao', 'não foi possível', 'nao foi possivel',
            'system.',
        ];
        foreach ($assinaturas as $sig) {
            if (str_contains($r, $sig)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Contexto no formato esperado pelo RM: "CHAVE=VALOR;CHAVE=VALOR".
     */
    public static function buildContext(array $parameters): string
    {
        $pairs = [];
        foreach ($parameters as $key => $value) {
            $pairs[] = "{$key}={$value}";
        }
        return implode(';', $pairs);
    }

    /**
     * Converte uma string XML do RM em array PHP.
     */
    private static function xmlToArray(string $xml): array
    {
        $loaded = simplexml_load_string($xml);
        if ($loaded === false) {
            return [];
        }
        return json_decode(json_encode($loaded), true) ?: [];
    }

    /* =====================================================================
     * wsDataServer
     * ===================================================================== */

    public function saveRecord(string $dataServerName, string $xml, array $context = []): string
    {
        $result = $this->call(
            RMWSType::DataServer,
            'SaveRecord',
            [
                'SaveRecord' => [
                    'DataServerName' => $dataServerName,
                    'XML'            => $xml,
                    'Contexto'       => self::buildContext($context),
                ],
            ],
            dataServer: $dataServerName,
            contexto: $context,
            xmlEnviado: $xml
        );

        if (!isset($result->SaveRecordResult)) {
            throw new RMException(
                'Formato de resposta inesperado do SaveRecord',
                operacao: 'SaveRecord',
                dataServer: $dataServerName,
                contexto: $context,
                xmlEnviado: $xml,
                retornoRm: json_encode($result)
            );
        }

        return (string) $result->SaveRecordResult;
    }

    public function readRecord(string $dataServerName, array $primaryKey, array $context = []): array
    {
        $result = $this->call(
            RMWSType::DataServer,
            'ReadRecord',
            [
                'ReadRecord' => [
                    'DataServerName' => $dataServerName,
                    'PrimaryKey'     => implode(';', $primaryKey),
                    'Contexto'       => self::buildContext($context),
                ],
            ],
            dataServer: $dataServerName,
            contexto: $context
        );

        if (!isset($result->ReadRecordResult)) {
            throw new RMException(
                'Formato de resposta inesperado do ReadRecord',
                operacao: 'ReadRecord',
                dataServer: $dataServerName,
                contexto: $context,
                retornoRm: json_encode($result)
            );
        }

        return self::xmlToArray((string) $result->ReadRecordResult);
    }

    public function readView(string $dataServerName, string $filter = '1=1', array $context = []): array
    {
        $result = $this->call(
            RMWSType::DataServer,
            'ReadView',
            [
                'ReadView' => [
                    'DataServerName' => $dataServerName,
                    'Filtro'         => $filter,
                    'Contexto'       => self::buildContext($context),
                ],
            ],
            dataServer: $dataServerName,
            contexto: $context
        );

        if (!isset($result->ReadViewResult)) {
            throw new RMException(
                'Formato de resposta inesperado do ReadView',
                operacao: 'ReadView',
                dataServer: $dataServerName,
                contexto: $context,
                retornoRm: json_encode($result)
            );
        }

        return self::xmlToArray((string) $result->ReadViewResult);
    }

    public function deleteRecord(string $dataServerName, string $xml, array $context = []): string
    {
        $result = $this->call(
            RMWSType::DataServer,
            'DeleteRecord',
            [
                'DeleteRecord' => [
                    'DataServerName' => $dataServerName,
                    'XML'            => $xml,
                    'Contexto'       => self::buildContext($context),
                ],
            ],
            dataServer: $dataServerName,
            contexto: $context,
            xmlEnviado: $xml
        );

        if (!isset($result->DeleteRecordResult)) {
            throw new RMException(
                'Formato de resposta inesperado do DeleteRecord',
                operacao: 'DeleteRecord',
                dataServer: $dataServerName,
                contexto: $context,
                xmlEnviado: $xml,
                retornoRm: json_encode($result)
            );
        }

        return (string) $result->DeleteRecordResult;
    }

    /**
     * Retorna o XSD bruto do DataServer.
     */
    public function getSchema(string $dataServerName, array $context = []): string
    {
        $result = $this->call(
            RMWSType::DataServer,
            'GetSchema',
            [
                'GetSchema' => [
                    'DataServerName' => $dataServerName,
                    'Contexto'       => self::buildContext($context),
                ],
            ],
            dataServer: $dataServerName,
            contexto: $context
        );

        if (!isset($result->GetSchemaResult)) {
            throw new RMException(
                'Formato de resposta inesperado do GetSchema',
                operacao: 'GetSchema',
                dataServer: $dataServerName,
                contexto: $context,
                retornoRm: json_encode($result)
            );
        }

        return (string) $result->GetSchemaResult;
    }

    /**
     * Valida usuário/senha no RM. Usa credenciais próprias (não as do serviço).
     */
    public function autenticaAcesso(string $user, string $password): bool
    {
        $client = $this->conn(RMWSType::DataServer, $user, $password);

        $result = $this->call(
            RMWSType::DataServer,
            'AutenticaAcesso',
            [],
            client: $client
        );

        return isset($result->AutenticaAcessoResult) && (string) $result->AutenticaAcessoResult === '1';
    }

    /* =====================================================================
     * wsConsultaSQL
     * ===================================================================== */

    /**
     * Executa uma sentença SQL cadastrada no RM e devolve as linhas como array.
     */
    public function realizarConsultaSQL(
        string $codSentenca,
        array $parameters = [],
        string $codColigada = '0',
        string $codSistema = 'G'
    ): array {
        $result = $this->call(
            RMWSType::SQLConsult,
            'RealizarConsultaSQL',
            [
                'RealizarConsultaSQL' => [
                    'codSentenca' => $codSentenca,
                    'codColigada' => $codColigada,
                    'codSistema'  => $codSistema,
                    'parameters'  => self::buildContext($parameters),
                ],
            ],
            dataServer: $codSentenca,
            contexto: $parameters
        );

        if (!isset($result->RealizarConsultaSQLResult)) {
            throw new RMException(
                'Formato de resposta inesperado do RealizarConsultaSQL',
                operacao: 'RealizarConsultaSQL',
                dataServer: $codSentenca,
                contexto: $parameters,
                retornoRm: json_encode($result)
            );
        }

        $xml = simplexml_load_string((string) $result->RealizarConsultaSQLResult);
        $rows = [];

        if ($xml !== false) {
            foreach ($xml->Resultado as $row) {
                if ($row->count() === 0) {
                    continue;
                }
                $rows[] = json_decode(json_encode($row), true);
            }
        }

        return $rows;
    }

    /* =====================================================================
     * wsProcess
     * ===================================================================== */

    public function executeWithXmlParams(string $processServerName, string $xmlParams): string
    {
        $result = $this->call(
            RMWSType::Process,
            'ExecuteWithXMLParams',
            [
                'ExecuteWithXMLParams' => [
                    'ProcessServerName' => $processServerName,
                    'strXmlParams'      => $xmlParams,
                ],
            ],
            dataServer: $processServerName,
            xmlEnviado: $xmlParams
        );

        if (!isset($result->ExecuteWithXmlParamsResult)) {
            throw new RMException(
                'Formato de resposta inesperado do ExecuteWithXMLParams',
                operacao: 'ExecuteWithXMLParams',
                dataServer: $processServerName,
                xmlEnviado: $xmlParams,
                retornoRm: json_encode($result)
            );
        }

        $resultValue = (string) $result->ExecuteWithXmlParamsResult;

        if (self::pareceErroDeProcesso($resultValue)) {
            throw new RMException(
                'Erro ao executar processo no RM',
                operacao: 'ExecuteWithXMLParams',
                dataServer: $processServerName,
                xmlEnviado: $xmlParams,
                retornoRm: $resultValue
            );
        }

        return $resultValue;
    }

    /**
     * Operação-irmã do ExecuteWithXMLParams (mesma assinatura:
     * ProcessServerName + strXmlParams). Alguns processos financeiros do RM
     * — como FinLanBaixaProc (baixa de lançamento) — são disparados por esta
     * operação. O nome do elemento de retorno varia conforme a versão do WSDL,
     * então a extração é resiliente: usa ExecuteWithParamsResult quando existe
     * e, senão, cai para a primeira propriedade da resposta.
     */
    public function executeWithParams(string $processServerName, string $xmlParams): string
    {
        $result = $this->call(
            RMWSType::Process,
            'ExecuteWithParams',
            [
                'ExecuteWithParams' => [
                    'ProcessServerName' => $processServerName,
                    'strXmlParams'      => $xmlParams,
                ],
            ],
            dataServer: $processServerName,
            xmlEnviado: $xmlParams
        );

        $resultValue = $result->ExecuteWithParamsResult
            ?? (is_object($result) ? (array_values(get_object_vars($result))[0] ?? null) : null);

        if ($resultValue === null) {
            throw new RMException(
                'Formato de resposta inesperado do ExecuteWithParams',
                operacao: 'ExecuteWithParams',
                dataServer: $processServerName,
                xmlEnviado: $xmlParams,
                retornoRm: json_encode($result)
            );
        }

        $resultValue = (string) $resultValue;

        if (self::pareceErroDeProcesso($resultValue)) {
            throw new RMException(
                'Erro ao executar processo no RM',
                operacao: 'ExecuteWithParams',
                dataServer: $processServerName,
                xmlEnviado: $xmlParams,
                retornoRm: $resultValue
            );
        }

        return $resultValue;
    }

    /* =====================================================================
     * wsReport
     * ===================================================================== */

    public function generateReport(
        string $codColigada,
        string $id,
        string $filters,
        string $parameters,
        string $fileName = 'report.pdf'
    ): string {
        $result = $this->call(
            RMWSType::Report,
            'GenerateReport',
            [
                'GenerateReport' => [
                    'codColigada' => $codColigada,
                    'id'          => $id,
                    'filters'     => $filters,
                    'parameters'  => $parameters,
                    'fileName'    => $fileName,
                    'contexto'    => '',
                ],
            ],
            dataServer: "Relatório {$id}",
            xmlEnviado: $parameters
        );

        if (!isset($result->GenerateReportResult)) {
            throw new RMException(
                'Formato de resposta inesperado do GenerateReport',
                operacao: 'GenerateReport',
                dataServer: "Relatório {$id}",
                xmlEnviado: $parameters,
                retornoRm: json_encode($result)
            );
        }

        $guid = (string) $result->GenerateReportResult;

        if (str_contains(strtolower($guid), 'error')) {
            throw new RMException(
                'Erro ao gerar relatório no RM',
                operacao: 'GenerateReport',
                dataServer: "Relatório {$id}",
                xmlEnviado: $parameters,
                retornoRm: $guid
            );
        }

        return $guid;
    }

    public function getGeneratedReportSize(string $guid): int
    {
        $result = $this->call(
            RMWSType::Report,
            'GetGeneratedReportSize',
            ['GetGeneratedReportSize' => ['guid' => $guid]]
        );

        if (!isset($result->GetGeneratedReportSizeResult) || !is_int($result->GetGeneratedReportSizeResult)) {
            throw new RMException(
                'Formato de resposta inesperado do GetGeneratedReportSize',
                operacao: 'GetGeneratedReportSize',
                retornoRm: json_encode($result)
            );
        }

        return $result->GetGeneratedReportSizeResult;
    }

    public function getFileChunk(string $guid, int $offset, int $length): mixed
    {
        $result = $this->call(
            RMWSType::Report,
            'GetFileChunk',
            [
                'GetFileChunk' => [
                    'guid'   => $guid,
                    'offset' => $offset,
                    'length' => $length,
                ],
            ]
        );

        if (!isset($result->GetFileChunkResult)) {
            throw new RMException(
                'Formato de resposta inesperado do GetFileChunk',
                operacao: 'GetFileChunk',
                retornoRm: json_encode($result)
            );
        }

        return $result->GetFileChunkResult;
    }
}
