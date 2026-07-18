/**
 * Fluxo completo de inscrição — porte fiel de Services/InscricaoService.php:
 *
 *   oferta → pessoa → aluno (+usuário/filial +acesso/SSO)
 *   → matrícula no curso → matrícula no período letivo (contrato)
 *   → enturmação → cupom/bolsa → lançamento financeiro
 *
 * Cada etapa é idempotente: inscrições reenviadas retomam de onde pararam.
 * Etapas concluídas são rastreadas e devolvidas no sucesso (dados.etapas)
 * e no erro (etapas_concluidas).
 */

import { RMError, FluxoError, ValidationError, type Etapa } from '../rm/errors.js';
import type { RmConfig } from '../config.js';
import type { SsoCrypto } from '../support/sso-crypto.js';
import type { ConsultaService } from './consulta.js';
import type { PessoaService } from './pessoa.js';
import type { AlunoService } from './aluno.js';
import type { MatriculaService } from './matricula.js';
import type { BolsaService } from './bolsa.js';
import type { LancamentoService } from './lancamento.js';
import type { LogService } from './log.js';
import { s, vazio } from './util.js';
import {
    ensureCep, ensureCpf, ensureDate, ensureEmail, ensureHasValue,
    ensureName, ensurePastDate, ensurePhone, ensureRnm, ensureSexo,
} from '../helpers/validation.js';

type Row = Record<string, unknown>;

export class InscricaoService {
    private etapas: Etapa[] = [];

    constructor(
        private readonly consulta: ConsultaService,
        private readonly pessoaService: PessoaService,
        private readonly alunoService: AlunoService,
        private readonly matriculaService: MatriculaService,
        private readonly bolsaService: BolsaService,
        private readonly lancamentoService: LancamentoService,
        private readonly log: LogService,
        private readonly crypto: SsoCrypto,
        private readonly cfg: RmConfig
    ) {
    }

    private etapaOk(etapa: string, detalhe: string, status = 'OK'): void {
        this.etapas.push({ etapa, status, detalhe });
    }

    /** Executa a inscrição completa. */
    async executar(data: Row, baseUrl: string): Promise<Record<string, unknown>> {
        this.etapas = [];

        try {
            return await this.executarFluxo(data, baseUrl);
        } catch (e) {
            if (e instanceof FluxoError || e instanceof ValidationError) {
                e.etapasConcluidas = this.etapas;
                throw e;
            }
            if (e instanceof RMError) {
                const fluxo = new FluxoError(
                    'INSCRIÇÃO',
                    'Houve um erro inesperado ao processar sua inscrição.',
                    e.message,
                    null,
                    e
                );
                fluxo.etapasConcluidas = this.etapas;
                throw fluxo;
            }
            throw e;
        }
    }

    private async executarFluxo(data: Row, baseUrl: string): Promise<Record<string, unknown>> {
        const rawEmail = String(data['EMAIL'] ?? '');
        const rawOffer = String(data['OFERTA'] ?? '');

        await this.log.saveLog(rawEmail, 'INSCRIÇÃO', rawOffer, 'RECEBIDA', 'INSCRIÇÃO RECEBIDA', data);

        /* ---------- Validação geral ---------- */

        const isForeigner = data['CPF'] === undefined || data['CPF'] === '' || data['CPF'] === null;

        const offer = String(ensureHasValue(data, 'OFERTA'));

        let cpf = '';
        let rnm = '';
        if (isForeigner) {
            rnm = ensureRnm(String(ensureHasValue(data, 'RNM')));
        } else {
            cpf = ensureCpf(ensureHasValue(data, 'CPF'));
        }

        const email = ensureEmail(String(ensureHasValue(data, 'EMAIL')));
        const codPlanoPagamento = String(ensureHasValue(data, 'PLANOPAGAMENTO'));

        this.etapaOk('VALIDAÇÃO', 'Dados de entrada validados');

        /* ---------- Oferta ---------- */

        const oferta = await this.consulta.oferta(offer);
        if (oferta === null) {
            throw new FluxoError('OFERTA', 'Não conseguimos encontrar essa oferta de curso', 'Oferta não encontrada', offer);
        }

        for (const key of [
            'CODCOLIGADA', 'IDHABILITACAOFILIAL', 'CODCURSO', 'CODHABILITACAO', 'CODGRADE',
            'CODFILIAL', 'CODTURNO', 'IDPERLET', 'CODTURMA', 'CODTIPOCURSO',
        ]) {
            ensureHasValue(oferta, key);
        }

        const codColigada = s(oferta['CODCOLIGADA']);
        const codTipoCurso = s(oferta['CODTIPOCURSO']);
        const codFilial = s(oferta['CODFILIAL']);

        this.etapaOk('OFERTA', `Oferta ${offer} localizada (curso ${s(oferta['CODCURSO'])}, turma ${s(oferta['CODTURMA'])}, PL ${s(oferta['IDPERLET'])})`);

        /* ---------- Pessoa ---------- */

        const codPessoa = await this.etapaPessoa(data, cpf, rnm, isForeigner, email, offer);

        /* ---------- Aluno + acesso ---------- */

        const [student, autoLogin, nextUrl] = await this.etapaAluno(
            codPessoa, codColigada, codTipoCurso, codFilial, cpf, rnm, email, offer, baseUrl
        );

        const ra = s(student['RA']);

        /* ---------- Matrícula no curso ---------- */

        const jaMatriculadoCurso = (await this.consulta.matriculaCurso(offer, ra)) !== null;

        try {
            await this.matriculaService.matricularNoCurso(ra, offer, oferta);
        } catch (e) {
            if (e instanceof RMError) {
                throw new FluxoError(
                    'MATRÍCULA NO CURSO',
                    'Houve um erro inesperado ao realizar sua matrícula no curso.',
                    `Erro no processo de matrícula no curso. Erro: ${e.retornoRm}`,
                    e.xmlEnviado,
                    e
                );
            }
            throw e;
        }

        this.etapaOk(
            'MATRÍCULA NO CURSO',
            jaMatriculadoCurso ? 'Aluno já possuía matrícula no curso' : 'Matrícula no curso realizada',
            jaMatriculadoCurso ? 'JA_EXISTIA' : 'OK'
        );

        await this.log.saveLog(
            email, 'MATRÍCULA NO CURSO', offer,
            jaMatriculadoCurso ? 'INFO' : 'SUCESSO',
            jaMatriculadoCurso ? 'Aluno já possui matrícula no curso. Pulando etapa.' : 'Matrícula no curso realizada.',
            { CODOFERTA_S: offer, RA_S: ra }
        );

        /* ---------- Matrícula no período letivo (gera contrato) ---------- */

        const jaMatriculadoPL = (await this.consulta.matriculaPeriodoLetivo(offer, ra)) !== null;

        let matriculaPL: Row;
        try {
            matriculaPL = await this.matriculaService.matricularNoPeriodoLetivo(ra, offer, oferta, codPlanoPagamento);
        } catch (e) {
            if (e instanceof RMError) {
                throw new FluxoError(
                    'MATRÍCULA NO PERÍODO LETIVO',
                    'Houve um erro inesperado ao realizar sua matrícula.',
                    `Erro na matrícula no período letivo. Erro: ${e.retornoRm}`,
                    e.xmlEnviado,
                    e
                );
            }
            throw e;
        }

        const codContrato = s(matriculaPL['CODCONTRATO']);

        this.etapaOk(
            'MATRÍCULA NO PERÍODO LETIVO',
            (jaMatriculadoPL ? 'Aluno já possuía matrícula no período letivo' : 'Matrícula no período letivo realizada')
                + `. Contrato: ${codContrato}`,
            jaMatriculadoPL ? 'JA_EXISTIA' : 'OK'
        );

        await this.log.saveLog(
            email, 'MATRÍCULA NO PERÍODO LETIVO', offer, 'INFO',
            jaMatriculadoPL ? 'Aluno já possui matrícula no período letivo. Pulando etapa.' : 'Matrícula no período letivo realizada.',
            { CODOFERTA_S: offer, RA_S: ra }
        );

        /* ---------- Enturmação ---------- */

        let turmas: Array<{ turma: Row; ja_cursando: boolean }>;
        try {
            turmas = await this.matriculaService.enturmar(ra, offer, oferta);
        } catch (e) {
            if (e instanceof RMError) {
                const feedback = String(e.retornoRm ?? '').includes('Existem débitos anteriores para o sacado')
                    ? 'Não foi possível realizar a matrícula pois existem débitos anteriores.'
                    : 'Houve um erro inesperado ao realizar sua matrícula.';

                throw new FluxoError(
                    'MATRÍCULA NA TURMA/DISCIPLINA',
                    feedback,
                    `Erro na matrícula na turma/disciplina. Erro: ${e.retornoRm}`,
                    e.xmlEnviado,
                    e
                );
            }
            throw e;
        }

        const jaCursando = turmas.filter((t) => t.ja_cursando).length;

        this.etapaOk('ENTURMAÇÃO', `${turmas.length} turma(s)/disciplina(s) processada(s)${jaCursando > 0 ? ` (${jaCursando} já cursando)` : ''}`);

        for (const t of turmas) {
            if (t.ja_cursando) {
                await this.log.saveLog(
                    email, 'MATRÍCULA NA TURMA/DISCIPLINA', offer, 'INFO',
                    'Aluno já possui matrícula na turma/disciplina. Pulando etapa.',
                    { CODOFERTA_S: offer, RA_S: ra, TURMADISCIPLINA: t.turma }
                );
            }
        }

        /* ---------- Cupom / Bolsa ---------- */

        if (data['CUPOM'] !== undefined && data['CUPOM'] !== '' && data['CUPOM'] !== null) {
            await this.etapaCupom(String(data['CUPOM']), offer, codPlanoPagamento, ra, codContrato, oferta, email);
        }

        /* ---------- Lançamento financeiro ---------- */

        let lancamento: { gerados: boolean; ja_existiam: boolean };
        try {
            lancamento = await this.lancamentoService.gerar(codColigada, codFilial, s(oferta['IDPERLET']), ra, codContrato);
        } catch (e) {
            if (e instanceof RMError) {
                throw new FluxoError(
                    'LANÇAMENTO FINANCEIRO',
                    'Houve um erro inesperado ao realizar sua matrícula.',
                    `Erro ao gerar lançamento financeiro. Erro: ${e.retornoRm}`,
                    e.xmlEnviado,
                    e
                );
            }
            throw e;
        }

        this.etapaOk(
            'LANÇAMENTO FINANCEIRO',
            lancamento.ja_existiam ? 'Lançamentos já existiam' : 'Lançamentos gerados',
            lancamento.ja_existiam ? 'JA_EXISTIA' : 'OK'
        );

        /* ---------- Fim ---------- */

        await this.log.saveLog(
            email, 'INSCRIÇÃO', offer, 'SUCESSO',
            'Processo de inscrição finalizado com sucesso.',
            { autoLogin, nextUrl }
        );

        return { autoLogin, nextUrl, etapas: this.etapas };
    }

    /** Upsert da pessoa no RM. Retorna o CODPESSOA. */
    private async etapaPessoa(
        data: Row,
        cpf: string,
        rnm: string,
        isForeigner: boolean,
        email: string,
        offer: string
    ): Promise<string> {
        const existente = await this.consulta.pessoaPorCpfRnm(cpf, rnm);
        let codPessoa = existente !== null ? s(existente['CODIGO']) : '0';
        const pessoaJaExistia = existente !== null;

        const hasBrazilianAddress = data['CEP'] !== undefined && data['CEP'] !== '' && data['CEP'] !== null;

        let cep = '', codEstado = '', municipio = '', codMunicipio = '', bairro = '', rua = '';
        let idPais: number, pais: string, numero = '', complemento = '';

        if (hasBrazilianAddress) {
            cep = ensureCep(String(ensureHasValue(data, 'CEP')));
            codEstado = String(ensureHasValue(data, 'ESTADO'));

            const cidadeRow = await this.consulta.cidadePorCodigo(String(ensureHasValue(data, 'CIDADE')));
            if (cidadeRow === null) {
                throw new FluxoError(
                    'PESSOA',
                    'Não conseguimos encontrar o cadastro para o código de cidade informado',
                    'CIDADE inválida',
                    data['CIDADE'] ?? null
                );
            }

            const bairroRow = await this.consulta.bairroPorCodigo(String(ensureHasValue(data, 'BAIRRO')));
            if (bairroRow === null) {
                throw new FluxoError(
                    'PESSOA',
                    'Não conseguimos encontrar o cadastro para o código de bairro informado',
                    'BAIRRO inválido',
                    data['BAIRRO'] ?? null
                );
            }

            municipio = s(cidadeRow['NOME']);
            codMunicipio = s(cidadeRow['CODMUNICIPIO']);
            bairro = s(bairroRow['NOME']);
            rua = String(ensureHasValue(data, 'RUA'));
            idPais = 1;
            pais = 'Brasil';
            numero = String(data['NUMERO'] ?? '');
            complemento = String(data['COMPLEMENTO'] ?? '');
        } else {
            idPais = 27;
            pais = 'Outro';
        }

        let estadoNatal = '', cidadeNatal = '', codCidadeNatal = '';
        if (!isForeigner) {
            const naturalityKey = ensureHasValue(data, 'NATURALIDADE');
            const naturalityInfo = await this.consulta.cidadePorCodigo(String(naturalityKey));

            if (naturalityInfo === null) {
                throw new FluxoError(
                    'PESSOA',
                    'Não conseguimos encontrar o cadastro para o código de naturalidade',
                    'NATURALIDADE inválida',
                    naturalityKey
                );
            }

            estadoNatal = String(ensureHasValue(naturalityInfo, 'ESTADO'));
            cidadeNatal = String(ensureHasValue(naturalityInfo, 'NOME'));
            codCidadeNatal = String(ensureHasValue(naturalityInfo, 'CODMUNICIPIO'));
        }

        const pessoa: Row = {
            CODIGO: codPessoa,
            NOME: ensureName(String(ensureHasValue(data, 'NOME'))),
            DTNASCIMENTO: ensurePastDate(ensureDate(ensureHasValue(data, 'NASCIMENTO'))),
            ESTADONATAL: estadoNatal,
            NATURALIDADE: cidadeNatal,
            SEXO: ensureSexo(String(ensureHasValue(data, 'SEXO'))),
            NACIONALIDADE: isForeigner ? '50' : '10',
            RUA: rua,
            NUMERO: numero,
            COMPLEMENTO: complemento,
            BAIRRO: bairro,
            ESTADO: codEstado,
            CIDADE: municipio,
            CEP: cep,
            PAIS: pais,
            CPF: cpf,
            TELEFONE1: ensurePhone(String(ensureHasValue(data, 'TELEFONE'))),
            EMAIL: email,
            CODMUNICIPIO: codMunicipio,
            CODNATURALIDADE: codCidadeNatal,
            IDPAIS: idPais,
            NROREGGERAL: rnm,
        };

        try {
            codPessoa = await this.pessoaService.salvar(pessoa);
        } catch (e) {
            if (e instanceof RMError) {
                throw new FluxoError(
                    'PESSOA',
                    'Houve um erro inesperado ao criar seu cadastro.',
                    `Erro ao criar pessoa: ${e.retornoRm}`,
                    e.xmlEnviado,
                    e
                );
            }
            throw e;
        }

        this.etapaOk(
            'PESSOA',
            `${pessoaJaExistia ? 'Pessoa atualizada' : 'Pessoa criada'}. CODPESSOA: ${codPessoa}`,
            pessoaJaExistia ? 'ATUALIZADA' : 'OK'
        );

        await this.log.saveLog(
            email, 'PESSOA', offer, 'SUCESSO',
            `Pessoa criada/atualizada com sucesso. Chave: ${codPessoa}`,
            pessoa
        );

        return codPessoa;
    }

    /**
     * Upsert do aluno + usuário/filial + preparação do acesso (SSO).
     * Retorna [aluno, autoLogin, nextUrl].
     */
    private async etapaAluno(
        codPessoa: string,
        codColigada: string,
        codTipoCurso: string,
        codFilial: string,
        cpf: string,
        rnm: string,
        email: string,
        offer: string,
        baseUrl: string
    ): Promise<[Row, boolean, string]> {
        const alunoJaExistia = (await this.consulta.aluno(codPessoa, codColigada)) !== null;

        let studentKeys: string;
        try {
            studentKeys = await this.alunoService.salvar(codPessoa, codColigada, codTipoCurso, codFilial, cpf, rnm);
        } catch (e) {
            if (e instanceof RMError) {
                throw new FluxoError(
                    'ALUNO',
                    'Houve um erro inesperado ao criar seu cadastro.',
                    `Erro ao criar aluno: ${e.retornoRm}`,
                    e.xmlEnviado,
                    e
                );
            }
            throw e;
        }

        this.etapaOk(
            'ALUNO',
            `${alunoJaExistia ? 'Aluno atualizado' : 'Aluno criado'}. Chave: ${studentKeys}`,
            alunoJaExistia ? 'ATUALIZADO' : 'OK'
        );

        await this.log.saveLog(
            email, 'ALUNO', offer, 'SUCESSO',
            `Aluno criado/atualizado com sucesso. Chave: ${studentKeys}`,
            studentKeys
        );

        const student = await this.alunoService.buscar(codPessoa, codColigada);

        if (student === null) {
            throw new FluxoError(
                'ALUNO',
                'Houve um erro inesperado ao criar seu cadastro.',
                'Erro ao buscar aluno cadastrado',
                { CODPESSOA_N: codPessoa, CODCOLIGADA_N: codColigada }
            );
        }

        if (vazio(student['CODUSUARIO'])) {
            throw new FluxoError(
                'ALUNO',
                'Houve um erro inesperado ao criar seu cadastro.',
                'Não foi possível obter usuário do aluno cadastrado.',
                student
            );
        }

        const codUsuario = s(student['CODUSUARIO']);
        const senhaPadrao = s(student['SENHAPADRAO']);

        if (s(student['EXISTESUSUARIOFILIAL']) === 'N') {
            try {
                await this.alunoService.garantirUsuarioFilial(codUsuario, codColigada, codTipoCurso, codFilial);
            } catch (e) {
                if (e instanceof RMError) {
                    throw new FluxoError(
                        'USUÁRIO/FILIAL DO ALUNO',
                        'Houve um erro inesperado ao criar seu cadastro.',
                        `Erro ao definir usuário/filial: ${e.retornoRm}`,
                        e.xmlEnviado,
                        e
                    );
                }
                throw e;
            }

            this.etapaOk('USUÁRIO/FILIAL DO ALUNO', `Vínculo usuário/filial criado para ${codUsuario}`);

            await this.log.saveLog(
                email, 'USUÁRIO/FILIAL DO ALUNO', offer, 'SUCESSO',
                'Cadastro de usuário/filial do aluno definido com sucesso.',
                { CODUSUARIO: codUsuario }
            );
        }

        const hasDefaultPassword = await this.alunoService.temSenhaPadrao(codUsuario, senhaPadrao);
        const hasNeverAccessed = vazio(student['DATAULTIMOACESSOVALIDO']);

        let autoLogin: boolean;
        let nextUrl: string;

        if (hasNeverAccessed || hasDefaultPassword) {
            await this.alunoService.ajustarAcessoUsuario(codUsuario, senhaPadrao);

            const ssoToken = this.crypto.encrypt(`${codUsuario}$_$${senhaPadrao}`);

            autoLogin = true;
            nextUrl = `${baseUrl}/sso/${ssoToken}`;

            this.etapaOk('ACESSO', `SSO de primeiro acesso gerado para ${codUsuario}`);

            await this.log.saveLog(
                email, 'CHECKOUT', offer, 'INFO',
                'Aluno com senha padrão. Redirecionando com SSO.',
                { url: nextUrl, codusuario: codUsuario }
            );
        } else {
            autoLogin = false;
            nextUrl = this.cfg.portal.loginUrl;

            this.etapaOk('ACESSO', `Aluno ${codUsuario} já alterou a senha. Login manual no portal`);

            await this.log.saveLog(
                email, 'CHECKOUT', offer, 'INFO',
                'Aluno com senha alterada. Redirecionamento sem SSO.',
                { url: nextUrl, codusuario: codUsuario }
            );
        }

        return [student, autoLogin, nextUrl];
    }

    private async etapaCupom(
        cupom: string,
        offer: string,
        codPlanoPagamento: string,
        ra: string,
        codContrato: string,
        oferta: Row,
        email: string
    ): Promise<void> {
        const cupomDetails = await this.bolsaService.validarCupom(offer, codPlanoPagamento, cupom);

        if (cupomDetails === null) {
            throw new FluxoError(
                'CUPOM',
                'Não encontramos esse cupom.',
                `Cupom inválido: ${cupom}`,
                { CODOFERTA_S: offer, CODPLANOPGTO_S: codPlanoPagamento, CUPOM_S: cupom }
            );
        }

        let resultado: { aplicada: boolean; ja_existia: boolean };
        try {
            resultado = await this.bolsaService.aplicar(cupomDetails, ra, codContrato, oferta);
        } catch (e) {
            if (e instanceof RMError) {
                throw new FluxoError(
                    'CUPOM',
                    'Houve um erro inesperado ao realizar sua matrícula.',
                    `Erro ao aplicar bolsa. Erro: ${e.retornoRm}`,
                    e.xmlEnviado,
                    e
                );
            }
            throw e;
        }

        this.etapaOk(
            'CUPOM',
            `${resultado.ja_existia ? 'Cupom já estava aplicado' : 'Cupom aplicado'} (bolsa ${s(cupomDetails['CODBOLSA'])})`,
            resultado.ja_existia ? 'JA_EXISTIA' : 'OK'
        );

        await this.log.saveLog(
            email, 'CUPOM', offer, 'INFO',
            resultado.ja_existia ? 'Cupom já aplicado. Pulando etapa.' : 'Cupom aplicado.',
            {
                CODCOLIGADA_N: s(oferta['CODCOLIGADA']),
                IDPERLET_N: s(oferta['IDPERLET']),
                CODCONTRATO_S: codContrato,
                RA_S: ra,
                CODBOLSA_N: s(cupomDetails['CODBOLSA']),
            }
        );
    }
}
