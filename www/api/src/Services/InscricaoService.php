<?php

declare(strict_types=1);

namespace FMP\RMApi\Services;

use FMP\RMApi\Exceptions\FluxoException;
use FMP\RMApi\Exceptions\RMException;
use FMP\RMApi\Exceptions\ValidationException;
use FMP\RMApi\Helpers\Crypto;
use FMP\RMApi\Helpers\Validation;
use Throwable;

/**
 * Orquestra o fluxo completo de inscrição (portado do legado
 * SubscriptionController::submitSubscription):
 *
 *   oferta → pessoa → aluno (+usuário/filial +acesso/SSO)
 *   → matrícula no curso → matrícula no período letivo (contrato)
 *   → enturmação → cupom/bolsa → lançamento financeiro
 *
 * Cada etapa é idempotente: inscrições reenviadas retomam de onde pararam.
 * Todas as etapas concluídas são rastreadas e devolvidas tanto no sucesso
 * (dados.etapas) quanto no erro (etapas_concluidas).
 */
class InscricaoService
{
    /** @var array<int, array{etapa: string, status: string, detalhe: string}> */
    private array $etapas = [];

    public function __construct(
        private readonly ConsultaService $consulta,
        private readonly PessoaService $pessoaService,
        private readonly AlunoService $alunoService,
        private readonly MatriculaService $matriculaService,
        private readonly BolsaService $bolsaService,
        private readonly LancamentoService $lancamentoService,
        private readonly LogService $log,
        private readonly Crypto $crypto,
        private readonly array $rmConfig
    ) {
    }

    private function etapaOk(string $etapa, string $detalhe, string $status = 'OK'): void
    {
        $this->etapas[] = [
            'etapa'   => $etapa,
            'status'  => $status,
            'detalhe' => $detalhe,
        ];
    }

    /**
     * Executa a inscrição completa.
     *
     * @param array  $data    payload da inscrição (CPF/RNM, NOME, OFERTA, PLANOPAGAMENTO...)
     * @param string $baseUrl base da API, usada para montar a URL de SSO
     *
     * @return array{autoLogin: bool, nextUrl: string, etapas: array}
     */
    public function executar(array $data, string $baseUrl): array
    {
        $this->etapas = [];

        try {
            return $this->executarFluxo($data, $baseUrl);
        } catch (FluxoException | ValidationException $e) {
            $e->etapasConcluidas = $this->etapas;
            throw $e;
        } catch (RMException $e) {
            // Falha de RM fora dos invólucros das etapas: embrulha preservando o rastro
            $fluxo = new FluxoException(
                'INSCRIÇÃO',
                'Houve um erro inesperado ao processar sua inscrição.',
                $e->getMessage(),
                null,
                $e
            );
            $fluxo->etapasConcluidas = $this->etapas;
            throw $fluxo;
        }
    }

    private function executarFluxo(array $data, string $baseUrl): array
    {
        $rawEmail = $data['EMAIL'] ?? '';
        $rawOffer = $data['OFERTA'] ?? '';

        $this->log->saveLog($rawEmail, 'INSCRIÇÃO', $rawOffer, 'RECEBIDA', 'INSCRIÇÃO RECEBIDA', $data);

        /* ---------- Validação geral ---------- */

        $isForeigner = !isset($data['CPF']) || empty($data['CPF']);

        $offer = Validation::ensureHasValue($data, 'OFERTA');

        if ($isForeigner) {
            $rnm = Validation::ensureRnm(Validation::ensureHasValue($data, 'RNM'));
            $cpf = '';
        } else {
            $rnm = '';
            $cpf = Validation::ensureCpf(Validation::ensureHasValue($data, 'CPF'));
        }

        $email = Validation::ensureEmail(Validation::ensureHasValue($data, 'EMAIL'));
        $codPlanoPagamento = (string) Validation::ensureHasValue($data, 'PLANOPAGAMENTO');

        $this->etapaOk('VALIDAÇÃO', 'Dados de entrada validados');

        /* ---------- Oferta ---------- */

        $oferta = $this->consulta->oferta($offer);

        if ($oferta === null) {
            throw new FluxoException(
                'OFERTA',
                'Não conseguimos encontrar essa oferta de curso',
                'Oferta não encontrada',
                $offer
            );
        }

        foreach (
            ['CODCOLIGADA', 'IDHABILITACAOFILIAL', 'CODCURSO', 'CODHABILITACAO', 'CODGRADE',
             'CODFILIAL', 'CODTURNO', 'IDPERLET', 'CODTURMA', 'CODTIPOCURSO'] as $key
        ) {
            Validation::ensureHasValue($oferta, $key);
        }

        $codColigada  = $oferta['CODCOLIGADA'];
        $codTipoCurso = $oferta['CODTIPOCURSO'];
        $codFilial    = $oferta['CODFILIAL'];

        $this->etapaOk('OFERTA', sprintf(
            'Oferta %s localizada (curso %s, turma %s, PL %s)',
            $offer,
            $oferta['CODCURSO'],
            $oferta['CODTURMA'],
            $oferta['IDPERLET']
        ));

        /* ---------- Pessoa ---------- */

        $codPessoa = $this->etapaPessoa($data, $cpf, $rnm, $isForeigner, $email, $offer);

        /* ---------- Aluno + acesso ---------- */

        [$student, $autoLogin, $nextUrl] = $this->etapaAluno(
            $codPessoa,
            $codColigada,
            $codTipoCurso,
            $codFilial,
            $cpf,
            $rnm,
            $email,
            $offer,
            $baseUrl
        );

        $ra = (string) $student['RA'];

        /* ---------- Matrícula no curso ---------- */

        $jaMatriculadoCurso = $this->consulta->matriculaCurso($offer, $ra) !== null;

        try {
            $this->matriculaService->matricularNoCurso($ra, $offer, $oferta);
        } catch (RMException $e) {
            throw new FluxoException(
                'MATRÍCULA NO CURSO',
                'Houve um erro inesperado ao realizar sua matrícula no curso.',
                "Erro no processo de matrícula no curso. Erro: {$e->retornoRm}",
                $e->xmlEnviado,
                $e
            );
        }

        $this->etapaOk(
            'MATRÍCULA NO CURSO',
            $jaMatriculadoCurso ? 'Aluno já possuía matrícula no curso' : 'Matrícula no curso realizada',
            $jaMatriculadoCurso ? 'JA_EXISTIA' : 'OK'
        );

        $this->log->saveLog(
            $email,
            'MATRÍCULA NO CURSO',
            $offer,
            $jaMatriculadoCurso ? 'INFO' : 'SUCESSO',
            $jaMatriculadoCurso
                ? 'Aluno já possui matrícula no curso. Pulando etapa.'
                : 'Matrícula no curso realizada.',
            ['CODOFERTA_S' => $offer, 'RA_S' => $ra]
        );

        /* ---------- Matrícula no período letivo (gera contrato) ---------- */

        $jaMatriculadoPL = $this->consulta->matriculaPeriodoLetivo($offer, $ra) !== null;

        try {
            $matriculaPL = $this->matriculaService->matricularNoPeriodoLetivo(
                $ra,
                $offer,
                $oferta,
                $codPlanoPagamento
            );
        } catch (RMException $e) {
            throw new FluxoException(
                'MATRÍCULA NO PERÍODO LETIVO',
                'Houve um erro inesperado ao realizar sua matrícula.',
                "Erro na matrícula no período letivo. Erro: {$e->retornoRm}",
                $e->xmlEnviado,
                $e
            );
        }

        $codContrato = (string) $matriculaPL['CODCONTRATO'];

        $this->etapaOk(
            'MATRÍCULA NO PERÍODO LETIVO',
            ($jaMatriculadoPL
                ? 'Aluno já possuía matrícula no período letivo'
                : 'Matrícula no período letivo realizada')
                . ". Contrato: {$codContrato}",
            $jaMatriculadoPL ? 'JA_EXISTIA' : 'OK'
        );

        $this->log->saveLog(
            $email,
            'MATRÍCULA NO PERÍODO LETIVO',
            $offer,
            'INFO',
            $jaMatriculadoPL
                ? 'Aluno já possui matrícula no período letivo. Pulando etapa.'
                : 'Matrícula no período letivo realizada.',
            ['CODOFERTA_S' => $offer, 'RA_S' => $ra]
        );

        /* ---------- Enturmação ---------- */

        try {
            $turmas = $this->matriculaService->enturmar($ra, $offer, $oferta);
        } catch (RMException $e) {
            $feedback = str_contains((string) $e->retornoRm, MatriculaService::MSG_DEBITOS)
                ? 'Não foi possível realizar a matrícula pois existem débitos anteriores.'
                : 'Houve um erro inesperado ao realizar sua matrícula.';

            throw new FluxoException(
                'MATRÍCULA NA TURMA/DISCIPLINA',
                $feedback,
                "Erro na matrícula na turma/disciplina. Erro: {$e->retornoRm}",
                $e->xmlEnviado,
                $e
            );
        }

        $jaCursando = count(array_filter($turmas, fn($t) => $t['ja_cursando']));

        $this->etapaOk('ENTURMAÇÃO', sprintf(
            '%d turma(s)/disciplina(s) processada(s)%s',
            count($turmas),
            $jaCursando > 0 ? " ({$jaCursando} já cursando)" : ''
        ));

        foreach ($turmas as $t) {
            if ($t['ja_cursando']) {
                $this->log->saveLog(
                    $email,
                    'MATRÍCULA NA TURMA/DISCIPLINA',
                    $offer,
                    'INFO',
                    'Aluno já possui matrícula na turma/disciplina. Pulando etapa.',
                    ['CODOFERTA_S' => $offer, 'RA_S' => $ra, 'TURMADISCIPLINA' => $t['turma']]
                );
            }
        }

        /* ---------- Cupom / Bolsa ---------- */

        if (isset($data['CUPOM']) && !empty($data['CUPOM'])) {
            $this->etapaCupom($data['CUPOM'], $offer, $codPlanoPagamento, $ra, $codContrato, $oferta, $email);
        }

        /* ---------- Lançamento financeiro ---------- */

        try {
            $lancamento = $this->lancamentoService->gerar(
                $codColigada,
                $codFilial,
                $oferta['IDPERLET'],
                $ra,
                $codContrato
            );
        } catch (RMException $e) {
            throw new FluxoException(
                'LANÇAMENTO FINANCEIRO',
                'Houve um erro inesperado ao realizar sua matrícula.',
                "Erro ao gerar lançamento financeiro. Erro: {$e->retornoRm}",
                $e->xmlEnviado,
                $e
            );
        }

        $this->etapaOk(
            'LANÇAMENTO FINANCEIRO',
            $lancamento['ja_existiam'] ? 'Lançamentos já existiam' : 'Lançamentos gerados',
            $lancamento['ja_existiam'] ? 'JA_EXISTIA' : 'OK'
        );

        /* ---------- Fim ---------- */

        $this->log->saveLog(
            $email,
            'INSCRIÇÃO',
            $offer,
            'SUCESSO',
            'Processo de inscrição finalizado com sucesso.',
            ['autoLogin' => $autoLogin, 'nextUrl' => $nextUrl]
        );

        return [
            'autoLogin' => $autoLogin,
            'nextUrl'   => $nextUrl,
            'etapas'    => $this->etapas,
        ];
    }

    /**
     * Upsert da pessoa no RM. Retorna o CODPESSOA.
     */
    private function etapaPessoa(
        array $data,
        string $cpf,
        string $rnm,
        bool $isForeigner,
        string $email,
        string $offer
    ): string {
        $existente = $this->consulta->pessoaPorCpfRnm($cpf, $rnm);
        $codPessoa = $existente['CODIGO'] ?? 0;
        $pessoaJaExistia = $existente !== null;

        $hasBrazilianAddress = isset($data['CEP']) && !empty($data['CEP']);

        if ($hasBrazilianAddress) {
            $cep = Validation::ensureCep(Validation::ensureHasValue($data, 'CEP'));
            $codEstado = Validation::ensureHasValue($data, 'ESTADO');

            $cidadeRow = $this->consulta->cidadePorCodigo(
                (string) Validation::ensureHasValue($data, 'CIDADE')
            );

            if ($cidadeRow === null) {
                throw new FluxoException(
                    'PESSOA',
                    'Não conseguimos encontrar o cadastro para o código de cidade informado',
                    'CIDADE inválida',
                    $data['CIDADE'] ?? null
                );
            }

            $bairroRow = $this->consulta->bairroPorCodigo(
                (string) Validation::ensureHasValue($data, 'BAIRRO')
            );

            if ($bairroRow === null) {
                throw new FluxoException(
                    'PESSOA',
                    'Não conseguimos encontrar o cadastro para o código de bairro informado',
                    'BAIRRO inválido',
                    $data['BAIRRO'] ?? null
                );
            }

            $municipio    = $cidadeRow['NOME'];
            $codMunicipio = $cidadeRow['CODMUNICIPIO'];
            $bairro       = $bairroRow['NOME'];
            $rua          = Validation::ensureHasValue($data, 'RUA');
            $idPais       = 1;
            $pais         = 'Brasil';
            $numero       = $data['NUMERO'] ?? '';
            $complemento  = $data['COMPLEMENTO'] ?? '';
        } else {
            $cep = '';
            $codEstado = '';
            $municipio = '';
            $codMunicipio = '';
            $bairro = '';
            $rua = '';
            $idPais = 27;
            $pais = 'Outro';
            $numero = '';
            $complemento = '';
        }

        if (!$isForeigner) {
            $naturalityKey = Validation::ensureHasValue($data, 'NATURALIDADE');
            $naturalityInfo = $this->consulta->cidadePorCodigo((string) $naturalityKey);

            if ($naturalityInfo === null) {
                throw new FluxoException(
                    'PESSOA',
                    'Não conseguimos encontrar o cadastro para o código de naturalidade',
                    'NATURALIDADE inválida',
                    $naturalityKey
                );
            }

            $estadoNatal    = Validation::ensureHasValue($naturalityInfo, 'ESTADO');
            $cidadeNatal    = Validation::ensureHasValue($naturalityInfo, 'NOME');
            $codCidadeNatal = Validation::ensureHasValue($naturalityInfo, 'CODMUNICIPIO');
        } else {
            $estadoNatal = '';
            $cidadeNatal = '';
            $codCidadeNatal = '';
        }

        $pessoa = [
            'CODIGO'          => $codPessoa,
            'NOME'            => Validation::ensureName(Validation::ensureHasValue($data, 'NOME')),
            'DTNASCIMENTO'    => Validation::ensurePastDate(
                Validation::ensureDate(Validation::ensureHasValue($data, 'NASCIMENTO'))
            ),
            'ESTADONATAL'     => $estadoNatal,
            'NATURALIDADE'    => $cidadeNatal,
            'SEXO'            => Validation::ensureSexo(Validation::ensureHasValue($data, 'SEXO')),
            'NACIONALIDADE'   => $isForeigner ? '50' : '10',
            'RUA'             => $rua,
            'NUMERO'          => $numero,
            'COMPLEMENTO'     => $complemento,
            'BAIRRO'          => $bairro,
            'ESTADO'          => $codEstado,
            'CIDADE'          => $municipio,
            'CEP'             => $cep,
            'PAIS'            => $pais,
            'CPF'             => $cpf,
            'TELEFONE1'       => Validation::ensurePhone(Validation::ensureHasValue($data, 'TELEFONE')),
            'EMAIL'           => $email,
            'CODMUNICIPIO'    => $codMunicipio,
            'CODNATURALIDADE' => $codCidadeNatal,
            'IDPAIS'          => $idPais,
            'NROREGGERAL'     => $rnm,
        ];

        try {
            $codPessoa = $this->pessoaService->salvar($pessoa);
        } catch (RMException $e) {
            throw new FluxoException(
                'PESSOA',
                'Houve um erro inesperado ao criar seu cadastro.',
                "Erro ao criar pessoa: {$e->retornoRm}",
                $e->xmlEnviado,
                $e
            );
        }

        $this->etapaOk(
            'PESSOA',
            ($pessoaJaExistia ? 'Pessoa atualizada' : 'Pessoa criada') . ". CODPESSOA: {$codPessoa}",
            $pessoaJaExistia ? 'ATUALIZADA' : 'OK'
        );

        $this->log->saveLog(
            $email,
            'PESSOA',
            $offer,
            'SUCESSO',
            "Pessoa criada/atualizada com sucesso. Chave: {$codPessoa}",
            $pessoa
        );

        return $codPessoa;
    }

    /**
     * Upsert do aluno + usuário/filial + preparação do acesso (SSO).
     *
     * @return array{0: array, 1: bool, 2: string} [aluno, autoLogin, nextUrl]
     */
    private function etapaAluno(
        string $codPessoa,
        string|int $codColigada,
        string|int $codTipoCurso,
        string|int $codFilial,
        string $cpf,
        string $rnm,
        string $email,
        string $offer,
        string $baseUrl
    ): array {
        $alunoJaExistia = $this->consulta->aluno($codPessoa, $codColigada) !== null;

        try {
            $studentKeys = $this->alunoService->salvar(
                $codPessoa,
                $codColigada,
                $codTipoCurso,
                $codFilial,
                $cpf,
                $rnm
            );
        } catch (RMException $e) {
            throw new FluxoException(
                'ALUNO',
                'Houve um erro inesperado ao criar seu cadastro.',
                "Erro ao criar aluno: {$e->retornoRm}",
                $e->xmlEnviado,
                $e
            );
        }

        $this->etapaOk(
            'ALUNO',
            ($alunoJaExistia ? 'Aluno atualizado' : 'Aluno criado') . ". Chave: {$studentKeys}",
            $alunoJaExistia ? 'ATUALIZADO' : 'OK'
        );

        $this->log->saveLog(
            $email,
            'ALUNO',
            $offer,
            'SUCESSO',
            "Aluno criado/atualizado com sucesso. Chave: {$studentKeys}",
            $studentKeys
        );

        $student = $this->alunoService->buscar($codPessoa, $codColigada);

        if ($student === null) {
            throw new FluxoException(
                'ALUNO',
                'Houve um erro inesperado ao criar seu cadastro.',
                'Erro ao buscar aluno cadastrado',
                ['CODPESSOA_N' => $codPessoa, 'CODCOLIGADA_N' => $codColigada]
            );
        }

        if (!isset($student['CODUSUARIO']) || empty($student['CODUSUARIO'])) {
            throw new FluxoException(
                'ALUNO',
                'Houve um erro inesperado ao criar seu cadastro.',
                'Não foi possível obter usuário do aluno cadastrado.',
                $student
            );
        }

        if (($student['EXISTESUSUARIOFILIAL'] ?? '') === 'N') {
            try {
                $this->alunoService->garantirUsuarioFilial(
                    $student['CODUSUARIO'],
                    $codColigada,
                    $codTipoCurso,
                    $codFilial
                );
            } catch (RMException $e) {
                throw new FluxoException(
                    'USUÁRIO/FILIAL DO ALUNO',
                    'Houve um erro inesperado ao criar seu cadastro.',
                    "Erro ao definir usuário/filial: {$e->retornoRm}",
                    $e->xmlEnviado,
                    $e
                );
            }

            $this->etapaOk('USUÁRIO/FILIAL DO ALUNO', "Vínculo usuário/filial criado para {$student['CODUSUARIO']}");

            $this->log->saveLog(
                $email,
                'USUÁRIO/FILIAL DO ALUNO',
                $offer,
                'SUCESSO',
                'Cadastro de usuário/filial do aluno definido com sucesso.',
                ['CODUSUARIO' => $student['CODUSUARIO']]
            );
        }

        $hasDefaultPassword = $this->alunoService->temSenhaPadrao(
            $student['CODUSUARIO'],
            (string) ($student['SENHAPADRAO'] ?? '')
        );

        $hasNeverAccessed = !isset($student['DATAULTIMOACESSOVALIDO'])
            || empty($student['DATAULTIMOACESSOVALIDO']);

        if ($hasNeverAccessed || $hasDefaultPassword) {
            $this->alunoService->ajustarAcessoUsuario(
                $student['CODUSUARIO'],
                (string) $student['SENHAPADRAO']
            );

            $ssoToken = $this->crypto->encrypt(
                $student['CODUSUARIO'] . '$_$' . $student['SENHAPADRAO']
            );

            $autoLogin = true;
            $nextUrl = sprintf('%s/sso/%s', $baseUrl, $ssoToken);

            $this->etapaOk('ACESSO', "SSO de primeiro acesso gerado para {$student['CODUSUARIO']}");

            $this->log->saveLog(
                $email,
                'CHECKOUT',
                $offer,
                'INFO',
                'Aluno com senha padrão. Redirecionando com SSO.',
                ['url' => $nextUrl, 'codusuario' => $student['CODUSUARIO']]
            );
        } else {
            $autoLogin = false;
            $nextUrl = $this->rmConfig['portal']['login_url'];

            $this->etapaOk('ACESSO', "Aluno {$student['CODUSUARIO']} já alterou a senha. Login manual no portal");

            $this->log->saveLog(
                $email,
                'CHECKOUT',
                $offer,
                'INFO',
                'Aluno com senha alterada. Redirecionamento sem SSO.',
                ['url' => $nextUrl, 'codusuario' => $student['CODUSUARIO']]
            );
        }

        return [$student, $autoLogin, $nextUrl];
    }

    private function etapaCupom(
        string $cupom,
        string $offer,
        string $codPlanoPagamento,
        string $ra,
        string $codContrato,
        array $oferta,
        string $email
    ): void {
        $cupomDetails = $this->bolsaService->validarCupom($offer, $codPlanoPagamento, $cupom);

        if ($cupomDetails === null) {
            throw new FluxoException(
                'CUPOM',
                'Não encontramos esse cupom.',
                "Cupom inválido: {$cupom}",
                ['CODOFERTA_S' => $offer, 'CODPLANOPGTO_S' => $codPlanoPagamento, 'CUPOM_S' => $cupom]
            );
        }

        try {
            $resultado = $this->bolsaService->aplicar($cupomDetails, $ra, $codContrato, $oferta);
        } catch (RMException $e) {
            throw new FluxoException(
                'CUPOM',
                'Houve um erro inesperado ao realizar sua matrícula.',
                "Erro ao aplicar bolsa. Erro: {$e->retornoRm}",
                $e->xmlEnviado,
                $e
            );
        }

        $this->etapaOk(
            'CUPOM',
            ($resultado['ja_existia'] ? 'Cupom já estava aplicado' : 'Cupom aplicado')
                . " (bolsa {$cupomDetails['CODBOLSA']})",
            $resultado['ja_existia'] ? 'JA_EXISTIA' : 'OK'
        );

        $this->log->saveLog(
            $email,
            'CUPOM',
            $offer,
            'INFO',
            $resultado['ja_existia'] ? 'Cupom já aplicado. Pulando etapa.' : 'Cupom aplicado.',
            [
                'CODCOLIGADA_N' => $oferta['CODCOLIGADA'],
                'IDPERLET_N'    => $oferta['IDPERLET'],
                'CODCONTRATO_S' => $codContrato,
                'RA_S'          => $ra,
                'CODBOLSA_N'    => $cupomDetails['CODBOLSA'],
            ]
        );
    }
}
