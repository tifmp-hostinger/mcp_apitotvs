<?php

declare(strict_types=1);

namespace FMP\RMApi\Controllers;

use FMP\RMApi\Helpers\Json;
use FMP\RMApi\Services\AlunoService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Routing\RouteContext;

final class AlunoController
{
    public function __construct(private readonly AlunoService $alunoService)
    {
    }

    /** GET /alunos/{codcoligada}/{codpessoa} */
    public function buscar(Request $request, Response $response, array $args = []): Response
    {
        $aluno = $this->alunoService->buscar($args['codpessoa'], $args['codcoligada']);

        if ($aluno === null) {
            return Json::notFound('Não foi encontrado cadastro de aluno');
        }

        return Json::success('Cadastro de aluno encontrado.', $aluno);
    }

    /**
     * POST /alunos — cria/atualiza o aluno com rastreamento de etapas (igual à inscrição):
     * CLIENTE/FORNECEDOR → ALUNO → USUÁRIO/FILIAL → ACESSO (SSO).
     * Body: { CODPESSOA, CODCOLIGADA, CODTIPOCURSO, CODFILIAL, CPF?, RNM? }
     * Resposta: dados.etapas (sucesso) / etapas_concluidas (erro).
     */
    public function salvar(Request $request, Response $response, array $args = []): Response
    {
        $data = (array) $request->getParsedBody();

        $resultado = $this->alunoService->criarFluxo($data, self::baseUrl($request));

        return Json::success('Aluno gravado com sucesso.', $resultado, 201);
    }

    /**
     * POST /alunos/cliente-fornecedor — vincula um Cliente/Fornecedor já gravado
     * a um aluno existente. Gravação direta (não roda o resto do fluxo).
     * Body: { RA, CODCOLIGADA (do aluno), CODCOLCFO, CODCFO }.
     */
    public function vincularCliente(Request $request, Response $response, array $args = []): Response
    {
        $data = (array) $request->getParsedBody();

        $resultado = $this->alunoService->vincularCliente($data);

        return Json::success('Cliente/Fornecedor vinculado ao aluno com sucesso.', $resultado);
    }

    private static function baseUrl(Request $request): string
    {
        $uri = $request->getUri();
        $basePath = RouteContext::fromRequest($request)->getBasePath();

        return sprintf('%s://%s%s', $uri->getScheme(), $uri->getAuthority(), $basePath);
    }
}
