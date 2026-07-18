<?php

declare(strict_types=1);

namespace FMP\RMApi\Controllers;

use FMP\RMApi\Exceptions\FluxoException;
use FMP\RMApi\Helpers\Json;
use FMP\RMApi\Helpers\Validation;
use FMP\RMApi\Services\ConsultaService;
use FMP\RMApi\Services\MatriculaService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Endpoints granulares de matrícula (cada etapa isolada).
 * Body comum: { "RA": "...", "OFERTA": "..." }
 */
final class MatriculaController
{
    public function __construct(
        private readonly MatriculaService $matriculaService,
        private readonly ConsultaService $consulta
    ) {
    }

    private function oferta(string $codOferta): array
    {
        $oferta = $this->consulta->oferta($codOferta);

        if ($oferta === null) {
            throw new FluxoException(
                'OFERTA',
                'Não conseguimos encontrar essa oferta de curso',
                'Oferta não encontrada',
                $codOferta
            );
        }

        return $oferta;
    }

    /** POST /matriculas/curso */
    public function curso(Request $request, Response $response, array $args = []): Response
    {
        $data = (array) $request->getParsedBody();
        $ra = (string) Validation::ensureHasValue($data, 'RA');
        $codOferta = (string) Validation::ensureHasValue($data, 'OFERTA');

        $matricula = $this->matriculaService->matricularNoCurso($ra, $codOferta, $this->oferta($codOferta));

        return Json::success('Matrícula no curso efetuada.', $matricula, 201);
    }

    /** POST /matriculas/periodo-letivo — body adicional: PLANOPAGAMENTO */
    public function periodoLetivo(Request $request, Response $response, array $args = []): Response
    {
        $data = (array) $request->getParsedBody();
        $ra = (string) Validation::ensureHasValue($data, 'RA');
        $codOferta = (string) Validation::ensureHasValue($data, 'OFERTA');
        $plano = (string) Validation::ensureHasValue($data, 'PLANOPAGAMENTO');

        $matricula = $this->matriculaService->matricularNoPeriodoLetivo(
            $ra,
            $codOferta,
            $this->oferta($codOferta),
            $plano
        );

        return Json::success('Matrícula no período letivo efetuada.', $matricula, 201);
    }

    /** POST /matriculas/disciplinas */
    public function disciplinas(Request $request, Response $response, array $args = []): Response
    {
        $data = (array) $request->getParsedBody();
        $ra = (string) Validation::ensureHasValue($data, 'RA');
        $codOferta = (string) Validation::ensureHasValue($data, 'OFERTA');

        $turmas = $this->matriculaService->enturmar($ra, $codOferta, $this->oferta($codOferta));

        return Json::success('Enturmação efetuada.', $turmas, 201);
    }
}
