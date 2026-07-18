<?php

declare(strict_types=1);

namespace FMP\RMApi\Services;

use FMP\RMApi\Clients\RMSoapClient;
use FMP\RMApi\Exceptions\RMException;

/**
 * Operações de Pessoa no RM (DataServer RhuPessoaData).
 */
class PessoaService
{
    public const DATASERVER = 'RhuPessoaData';

    public function __construct(
        private readonly RMSoapClient $rm,
        private readonly ConsultaService $consulta
    ) {
    }

    /**
     * Busca o registro completo da pessoa pelo CODIGO (ReadRecord).
     */
    public function buscar(string|int $codigo): ?array
    {
        $record = $this->rm->readRecord(self::DATASERVER, [(string) $codigo]);

        return $record['PPessoa'] ?? null;
    }

    /**
     * Busca pessoa por CPF ou RNM. Retorna o registro completo ou null.
     */
    public function buscarPorCpfRnm(string $cpf = '', string $rnm = ''): ?array
    {
        $found = $this->consulta->pessoaPorCpfRnm($cpf, $rnm);

        if ($found === null) {
            return null;
        }

        return $this->buscar($found['CODIGO']);
    }

    /**
     * Cria (CODIGO = 0) ou atualiza (CODIGO > 0) a pessoa via SaveRecord.
     * Retorna o CODPESSOA gravado.
     *
     * Campos esperados em $p (já validados/normalizados):
     * CODIGO, NOME, DTNASCIMENTO, ESTADONATAL, NATURALIDADE, SEXO,
     * NACIONALIDADE, RUA, NUMERO, COMPLEMENTO, BAIRRO, ESTADO, CIDADE,
     * CEP, PAIS, CPF, TELEFONE1, EMAIL, CODMUNICIPIO, CODNATURALIDADE,
     * IDPAIS, NROREGGERAL
     */
    public function salvar(array $p): string
    {
        $p = self::sanitizarDocumentos($p);

        $xml = self::buildXml($p);

        $result = $this->rm->saveRecord(self::DATASERVER, $xml);

        if (!is_numeric($result)) {
            throw new RMException(
                'O RM rejeitou a gravação da pessoa',
                operacao: 'SaveRecord',
                dataServer: self::DATASERVER,
                xmlEnviado: $xml,
                retornoRm: $result
            );
        }

        return $result;
    }

    /**
     * Remove máscara dos campos que o RM grava como dígitos puros.
     * A coluna PPESSOA.CPF (e CEP) tem tamanho fixo: enviar com pontos/traços
     * estoura ("String or binary data would be truncated ... column 'CPF'").
     */
    private static function sanitizarDocumentos(array $p): array
    {
        foreach (['CPF', 'CEP', 'TELEFONE1'] as $campo) {
            if (isset($p[$campo]) && $p[$campo] !== '') {
                $p[$campo] = preg_replace('/\D/', '', (string) $p[$campo]);
            }
        }
        return $p;
    }

    public static function buildXml(array $p): string
    {
        $get = fn(string $key) => htmlspecialchars((string) ($p[$key] ?? ''), ENT_XML1, 'UTF-8');
        $codigo = (string) ($p['CODIGO'] ?? '0');

        return <<<XML
        <RhuPessoa>
            <PPessoa>
                <CODIGO>{$codigo}</CODIGO>
                <NOME>{$get('NOME')}</NOME>
                <DTNASCIMENTO>{$get('DTNASCIMENTO')}</DTNASCIMENTO>
                <ESTADONATAL>{$get('ESTADONATAL')}</ESTADONATAL>
                <NATURALIDADE>{$get('NATURALIDADE')}</NATURALIDADE>
                <SEXO>{$get('SEXO')}</SEXO>
                <NACIONALIDADE>{$get('NACIONALIDADE')}</NACIONALIDADE>
                <RUA>{$get('RUA')}</RUA>
                <NUMERO>{$get('NUMERO')}</NUMERO>
                <COMPLEMENTO>{$get('COMPLEMENTO')}</COMPLEMENTO>
                <BAIRRO>{$get('BAIRRO')}</BAIRRO>
                <ESTADO>{$get('ESTADO')}</ESTADO>
                <CIDADE>{$get('CIDADE')}</CIDADE>
                <CEP>{$get('CEP')}</CEP>
                <PAIS>{$get('PAIS')}</PAIS>
                <CPF>{$get('CPF')}</CPF>
                <TELEFONE1>{$get('TELEFONE1')}</TELEFONE1>
                <EMAIL>{$get('EMAIL')}</EMAIL>
                <CODMUNICIPIO>{$get('CODMUNICIPIO')}</CODMUNICIPIO>
                <CODNATURALIDADE>{$get('CODNATURALIDADE')}</CODNATURALIDADE>
                <IDPAIS>{$get('IDPAIS')}</IDPAIS>
                <NROREGGERAL>{$get('NROREGGERAL')}</NROREGGERAL>
            </PPessoa>
            <VPCompl>
                <CODPESSOA>{$codigo}</CODPESSOA>
            </VPCompl>
        </RhuPessoa>
        XML;
    }
}
