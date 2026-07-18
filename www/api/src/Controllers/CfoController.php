<?php

declare(strict_types=1);

namespace FMP\RMApi\Controllers;

use FMP\RMApi\Helpers\Json;
use FMP\RMApi\Helpers\Validation;
use FMP\RMApi\Services\CfoService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

final class CfoController
{
    public function __construct(private readonly CfoService $cfo)
    {
    }

    /**
     * GET /clientes-fornecedores/busca?cpf=...  (ou ?rnm=...)
     * Consulta (leitura) — por isso GET. Aceita também CPF/RNM no corpo (compat).
     */
    public function buscarPorDocumento(Request $request, Response $response, array $args = []): Response
    {
        // Aceita CPF/RNM via query (GET) ou corpo, em qualquer caixa (cpf/CPF).
        $data = [];
        foreach (array_merge((array) $request->getParsedBody(), $request->getQueryParams()) as $k => $v) {
            $data[strtoupper((string) $k)] = $v;
        }

        $isForeigner = isset($data['RNM']) && !empty($data['RNM']);

        if ($isForeigner) {
            $rnm = Validation::ensureRnm(Validation::ensureHasValue($data, 'RNM'));
            $cpf = '';
        } else {
            $rnm = '';
            $cpf = Validation::ensureCpf(Validation::ensureHasValue($data, 'CPF'));
        }

        $cfo = $this->cfo->buscarPorCpfRnm($cpf, $rnm);

        if ($cfo === null) {
            return Json::notFound('Cliente/Fornecedor não encontrado');
        }

        return Json::success('Cliente/Fornecedor encontrado.', $cfo);
    }

    /**
     * POST /clientes-fornecedores — cria o CFO (envia CODCFO=0; o RM gera o código).
     * Body: NOME, CGCCFO (CPF/CNPJ), e campos opcionais (endereço, telefone, e-mail...).
     */
    public function salvar(Request $request, Response $response, array $args = []): Response
    {
        $data = (array) $request->getParsedBody();

        $resultado = $this->cfo->criarFluxo($data);

        $jaExistia = $resultado['jaExistia'] ?? false;
        $mensagem  = $jaExistia
            ? 'Cliente/Fornecedor já cadastrado.'
            : 'Cliente/Fornecedor gravado com sucesso.';

        return Json::success($mensagem, $resultado, $jaExistia ? 200 : 201);
    }
}
