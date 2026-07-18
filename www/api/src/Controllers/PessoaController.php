<?php

declare(strict_types=1);

namespace FMP\RMApi\Controllers;

use FMP\RMApi\Helpers\Json;
use FMP\RMApi\Helpers\Validation;
use FMP\RMApi\Services\PessoaService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

final class PessoaController
{
    public function __construct(private readonly PessoaService $pessoaService)
    {
    }

    /** GET /pessoas/{codigo} */
    public function buscar(Request $request, Response $response, array $args = []): Response
    {
        $pessoa = $this->pessoaService->buscar($args['codigo']);

        if ($pessoa === null) {
            return Json::notFound('Não foi encontrado cadastro de pessoa');
        }

        return Json::success('Cadastro de pessoa encontrado.', $pessoa);
    }

    /**
     * GET /pessoas/busca?cpf=...  (ou ?rnm=...)
     * Aceita também CPF/RNM no corpo (compatibilidade com o consumo antigo via POST).
     */
    public function buscarPorDocumento(Request $request, Response $response, array $args = []): Response
    {
        // Aceita CPF/RNM via query (GET) ou corpo, em qualquer caixa (cpf/CPF).
        $data = self::normalizarChaves(
            array_merge((array) $request->getParsedBody(), $request->getQueryParams())
        );

        $isForeigner = isset($data['RNM']) && !empty($data['RNM']);

        if ($isForeigner) {
            $rnm = Validation::ensureRnm(Validation::ensureHasValue($data, 'RNM'));
            $cpf = '';
        } else {
            $rnm = '';
            $cpf = Validation::ensureCpf(Validation::ensureHasValue($data, 'CPF'));
        }

        $pessoa = $this->pessoaService->buscarPorCpfRnm($cpf, $rnm);

        if ($pessoa === null) {
            return Json::notFound('Não foi encontrado cadastro de pessoa');
        }

        return Json::success('Cadastro de pessoa encontrado.', $pessoa);
    }

    /**
     * POST /pessoas — cria (sem CODIGO) ou atualiza (com CODIGO) uma pessoa.
     * Body: campos da PPessoa (NOME, DTNASCIMENTO, SEXO, CPF, EMAIL...)
     */
    public function salvar(Request $request, Response $response, array $args = []): Response
    {
        $data = (array) $request->getParsedBody();

        $codPessoa = $this->pessoaService->salvar($data);

        return Json::success('Pessoa gravada com sucesso.', ['CODPESSOA' => $codPessoa], 201);
    }

    /** Sobe as chaves para maiúsculas (CPF/RNM funcionam vindo como cpf/rnm na query). */
    private static function normalizarChaves(array $data): array
    {
        $out = [];
        foreach ($data as $k => $v) {
            $out[strtoupper((string) $k)] = $v;
        }
        return $out;
    }
}
