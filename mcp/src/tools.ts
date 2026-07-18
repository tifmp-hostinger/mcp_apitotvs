/**
 * Tools MCP — agora falando DIRETO com o TOTVS RM via services próprios
 * (sem API REST intermediária). Cada tool replica a semântica da rota
 * equivalente da antiga api-totvs (mensagens, envelope e status):
 *
 *   Sucesso:            { sucesso: true, mensagem, dados }
 *   Validação/Fluxo:    { sucesso: false, mensagem, etapa?, detalhe, etapas_concluidas?, retorno_rm? }  (422)
 *   Erro do RM:         { sucesso: false, mensagem, operacao, dataserver, retorno_rm }                  (502)
 *
 * Convenções:
 *  - consultas levam readOnlyHint; gravações levam destructiveHint quando
 *    causam efeito real no RM;
 *  - financeiro_baixar tem DRY_RUN=true POR PADRÃO: o agente só executa a
 *    baixa real com DRY_RUN=false explícito.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Config } from './config.js';
import type { Services } from './services/registry.js';
import { RMError, FluxoError, ValidationError } from './rm/errors.js';
import { ensureCpf, ensureRnm } from './helpers/validation.js';
import { s } from './services/util.js';

/** Campos aceitos como string ou número (o RM não distingue). */
const sn = z.union([z.string(), z.number()]);

interface Resultado {
    status: number;
    body: Record<string, unknown>;
}

function ok(mensagem: string, dados: unknown, status = 200): Resultado {
    return { status, body: { sucesso: true, mensagem, dados } };
}

function naoEncontrado(mensagem: string): Resultado {
    return { status: 404, body: { sucesso: false, mensagem, dados: null } };
}

/** Converte exceções no envelope de erro da API (mesma política do index.php). */
function paraEnvelopeDeErro(e: unknown, debug: boolean): Resultado {
    if (e instanceof ValidationError) {
        const extra: Record<string, unknown> = { detalhe: e.logMessage };
        if (e.etapasConcluidas.length > 0) {
            extra.etapas_concluidas = e.etapasConcluidas;
        }
        return { status: 422, body: { sucesso: false, mensagem: e.userFeedback, ...extra } };
    }

    if (e instanceof FluxoError) {
        const extra: Record<string, unknown> = { etapa: e.entity, detalhe: e.logMessage };
        if (debug) {
            extra.payload = e.payload;
        }
        if (e.etapasConcluidas.length > 0) {
            extra.etapas_concluidas = e.etapasConcluidas;
        }
        const rmEx = e.rmError();
        if (rmEx !== null) {
            Object.assign(extra, rmEx.toEnvelope(debug));
        }
        return { status: 422, body: { sucesso: false, mensagem: e.userFeedback, ...extra } };
    }

    if (e instanceof RMError) {
        return { status: 502, body: { sucesso: false, mensagem: e.message, ...e.toEnvelope(debug) } };
    }

    const mensagem = e instanceof Error ? e.message : String(e);
    return { status: 500, body: { sucesso: false, mensagem } };
}

export function registerTotvsTools(server: McpServer, svc: Services, cfg: Config): void {
    const ro = { readOnlyHint: true };
    const debug = cfg.rm.debug;

    function tool(
        name: string,
        meta: {
            title: string;
            description: string;
            inputSchema: Record<string, z.ZodTypeAny>;
            annotations?: Record<string, boolean>;
        },
        handler: (args: Record<string, unknown>) => Promise<Resultado>
    ): void {
        server.registerTool(name, meta, (async (args: Record<string, unknown>): Promise<CallToolResult> => {
            let resultado: Resultado;
            try {
                resultado = await handler(args ?? {});
            } catch (e) {
                resultado = paraEnvelopeDeErro(e, debug);
            }
            const okStatus = resultado.status >= 200 && resultado.status < 300;
            return {
                content: [{
                    type: 'text',
                    text: `HTTP ${resultado.status}\n${JSON.stringify(resultado.body, null, 2)}`,
                }],
                isError: !okStatus,
            };
        }) as never);
    }

    /* ================= Sistema / diagnóstico ================= */

    tool('totvs_status', {
        title: 'Status da integração TOTVS',
        description: 'Health check: executa a sentença de status (INT.EDUVEM.00001) no RM. Não toca em dados.',
        inputSchema: {},
        annotations: ro,
    }, async () => {
        try {
            const rows = await svc.consulta.status();
            return ok('Status obtido com sucesso', rows[0] ?? rows);
        } catch {
            return {
                status: 200,
                body: {
                    sucesso: true,
                    mensagem: 'Não foi possível se comunicar com o servidor.',
                    dados: { OK: false, MENSAGEM: 'Infelizmente nosso sistema está apresentando instabilidade. Tente novamente mais tarde.' },
                },
            };
        }
    });

    tool('totvs_teste_rm', {
        title: 'Testar conexão com o RM',
        description: 'Testa conexão e credenciais SOAP com o TOTVS RM (sentença de status).',
        inputSchema: {},
        annotations: ro,
    }, async () => ok('Conexão com o RM OK', await svc.rm.testConnection()));

    tool('rm_schema', {
        title: 'Schema de um DataServer',
        description: 'Schema parseado de um DataServer do RM — tabelas, campos, chaves, FKs (GetSchema). xml=true devolve o XSD bruto.',
        inputSchema: {
            dataserver: z.string().describe('Nome do DataServer, ex.: RhuPessoaData, EduAlunoData'),
            xml: z.boolean().optional().describe('true = XSD bruto em vez do schema parseado'),
            contexto: z.record(z.string(), sn).optional().describe('Contexto opcional, ex.: {"CODCOLIGADA": 1}'),
        },
        annotations: ro,
    }, async ({ dataserver, xml, contexto }) =>
        ok('Schema obtido com sucesso', await svc.rm.getSchema(
            String(dataserver),
            (contexto ?? {}) as Record<string, string | number>,
            xml === true
        )));

    tool('rm_sql', {
        title: 'Executar sentença SQL cadastrada',
        description: 'Executa uma sentença SQL cadastrada no RM (wsConsultaSQL). As sentenças da integração são INT.EDUVEM.00001–00021. Somente sentenças já cadastradas no RM podem ser executadas.',
        inputSchema: {
            codsentenca: z.string().describe('Código da sentença, ex.: INT.EDUVEM.00007'),
            parametros: z.record(z.string(), sn).optional().describe('Parâmetros, ex.: {"CPF_S": "12345678901"}'),
            codcoligada: z.string().optional().describe('Default "0"'),
            codsistema: z.string().optional().describe('Default "G"'),
        },
        annotations: ro,
    }, async ({ codsentenca, parametros, codcoligada, codsistema }) =>
        ok('Consulta executada com sucesso', await svc.rm.sql(
            String(codsentenca),
            (parametros ?? {}) as Record<string, string | number>,
            String(codcoligada ?? '0'),
            String(codsistema ?? 'G')
        )));

    tool('rm_read', {
        title: 'ReadRecord genérico',
        description: 'Lê um registro de um DataServer pela chave primária.',
        inputSchema: {
            dataserver: z.string(),
            chave: z.array(sn).describe('Partes da chave primária, na ordem, ex.: ["1","000123"]'),
            contexto: z.record(z.string(), sn).optional(),
        },
        annotations: ro,
    }, async ({ dataserver, chave, contexto }) =>
        ok('Registro obtido com sucesso', await svc.rm.readRecord(
            String(dataserver),
            chave as Array<string | number>,
            (contexto ?? {}) as Record<string, string | number>
        )));

    tool('rm_view', {
        title: 'ReadView genérico',
        description: 'Lê registros de um DataServer por filtro SQL.',
        inputSchema: {
            dataserver: z.string(),
            filtro: z.string().optional().describe('Filtro SQL, ex.: "CODCOLIGADA=1". Default "1=1"'),
            contexto: z.record(z.string(), sn).optional(),
        },
        annotations: ro,
    }, async ({ dataserver, filtro, contexto }) =>
        ok('Consulta executada com sucesso', await svc.rm.readView(
            String(dataserver),
            String(filtro ?? '1=1'),
            (contexto ?? {}) as Record<string, string | number>
        )));

    tool('rm_save', {
        title: 'SaveRecord genérico (avançado)',
        description: 'GRAVA um registro em qualquer DataServer com XML cru. Ferramenta avançada de administração: prefira as tools específicas (pessoa_salvar, aluno_criar...). Confirme com o usuário antes de usar.',
        inputSchema: {
            dataserver: z.string(),
            xml: z.string().describe('XML no formato do DataServer (use rm_schema para descobrir a estrutura)'),
            contexto: z.record(z.string(), sn).optional(),
        },
        annotations: { destructiveHint: true },
    }, async ({ dataserver, xml, contexto }) =>
        ok('Registro gravado com sucesso', {
            resultado: await svc.rm.saveRecord(
                String(dataserver),
                String(xml),
                (contexto ?? {}) as Record<string, string | number>
            ),
        }));

    /* ================= Pessoa ================= */

    tool('pessoa_buscar', {
        title: 'Buscar pessoa',
        description: 'Busca uma pessoa (PPessoa/RhuPessoaData) por código, CPF ou RNM. Informe exatamente um dos três.',
        inputSchema: {
            codigo: sn.optional().describe('CODPESSOA (busca direta por ReadRecord)'),
            cpf: z.string().optional().describe('CPF (somente dígitos ou formatado)'),
            rnm: z.string().optional().describe('RNM do estrangeiro'),
        },
        annotations: ro,
    }, async ({ codigo, cpf, rnm }) => {
        let pessoa: Record<string, unknown> | null;
        if (codigo !== undefined && codigo !== '') {
            pessoa = await svc.pessoa.buscar(String(codigo));
        } else if (rnm !== undefined && rnm !== '') {
            pessoa = await svc.pessoa.buscarPorCpfRnm('', ensureRnm(String(rnm)));
        } else if (cpf !== undefined && cpf !== '') {
            pessoa = await svc.pessoa.buscarPorCpfRnm(ensureCpf(cpf), '');
        } else {
            return { status: 422, body: { sucesso: false, mensagem: 'Informe codigo, cpf ou rnm.' } };
        }
        return pessoa === null
            ? naoEncontrado('Não foi encontrado cadastro de pessoa')
            : ok('Cadastro de pessoa encontrado.', pessoa);
    });

    tool('pessoa_salvar', {
        title: 'Criar/atualizar pessoa',
        description: 'Cria ou atualiza uma pessoa no RM (SaveRecord RhuPessoaData). CODIGO=0 ou ausente cria; preenchido atualiza. Campos usuais: NOME, DTNASCIMENTO (Y-m-d), SEXO (M/F), CPF, EMAIL, TELEFONE1, RUA, NUMERO, BAIRRO, ESTADO, CIDADE, CEP, CODMUNICIPIO, IDPAIS, NROREGGERAL. CPF/CEP/TELEFONE1 são normalizados para dígitos. Retorna o CODPESSOA.',
        inputSchema: {
            campos: z.record(z.string(), sn).describe('Campos da PPessoa, ex.: {"NOME": "Fulano de Tal", "CPF": "12345678901"}'),
        },
    }, async ({ campos }) =>
        ok('Pessoa gravada com sucesso.', {
            CODPESSOA: await svc.pessoa.salvar(campos as Record<string, unknown>),
        }, 201));

    /* ================= Aluno ================= */

    tool('aluno_buscar', {
        title: 'Buscar aluno',
        description: 'Busca o aluno pela coligada e CODPESSOA. Retorna RA, CODUSUARIO, SENHAPADRAO, EXISTESUSUARIOFILIAL, DATAULTIMOACESSOVALIDO.',
        inputSchema: { codcoligada: sn, codpessoa: sn },
        annotations: ro,
    }, async ({ codcoligada, codpessoa }) => {
        const aluno = await svc.aluno.buscar(String(codpessoa), String(codcoligada));
        return aluno === null
            ? naoEncontrado('Não foi encontrado cadastro de aluno')
            : ok('Cadastro de aluno encontrado.', aluno);
    });

    tool('aluno_criar', {
        title: 'Criar aluno (fluxo orquestrado)',
        description: 'Cria o aluno a partir de uma pessoa existente. Fluxo com etapas: valida cliente/fornecedor pelo CPF/RNM → aluno (EduAlunoData) → usuário/filial → acesso/SSO. Idempotente; devolve dados.etapas.',
        inputSchema: {
            CODPESSOA: sn,
            CODCOLIGADA: sn.describe('Ex.: 1'),
            CODTIPOCURSO: sn.describe('Ex.: 2'),
            CODFILIAL: sn.describe('Ex.: 1'),
            CPF: z.string().optional(),
            RNM: z.string().optional(),
        },
    }, async (args) =>
        ok('Aluno gravado com sucesso.', await svc.aluno.criarFluxo(args, cfg.publicUrl), 201));

    tool('aluno_vincular_clifor', {
        title: 'Vincular cliente/fornecedor ao aluno',
        description: 'Grava CODCOLCFO/CODCFO direto no EduAlunoData de um aluno existente por RA. CODTIPOCURSO e CODFILIAL são obrigatórios (contexto educacional completo).',
        inputSchema: {
            RA: z.string(),
            CODCFO: z.string().describe('Código do cliente/fornecedor'),
            CODCOLCFO: sn.describe('Coligada do CFO; CFO global = 0'),
            CODCOLIGADA: sn.describe('Coligada do aluno; ex.: 1'),
            CODTIPOCURSO: sn.describe('Ex.: 2'),
            CODFILIAL: sn.describe('Ex.: 1'),
        },
    }, async (args) =>
        ok('Cliente/Fornecedor vinculado ao aluno com sucesso.', await svc.aluno.vincularCliente(args)));

    /* ================= Cliente/Fornecedor ================= */

    tool('clifor_buscar', {
        title: 'Buscar cliente/fornecedor',
        description: 'Busca um cliente/fornecedor (FinCFO) por CPF ou RNM (INT.EDUVEM.00009). Retorna CODCOLCFO e CODCFO.',
        inputSchema: {
            cpf: z.string().optional(),
            rnm: z.string().optional(),
        },
        annotations: ro,
    }, async ({ cpf, rnm }) => {
        let cfo: Record<string, unknown> | null;
        if (rnm !== undefined && rnm !== '') {
            cfo = await svc.cfo.buscarPorCpfRnm('', ensureRnm(String(rnm)));
        } else if (cpf !== undefined && cpf !== '') {
            cfo = await svc.cfo.buscarPorCpfRnm(ensureCpf(cpf), '');
        } else {
            return { status: 422, body: { sucesso: false, mensagem: 'Informe cpf ou rnm.' } };
        }
        return cfo === null
            ? naoEncontrado('Cliente/Fornecedor não encontrado')
            : ok('Cliente/Fornecedor encontrado.', cfo);
    });

    tool('clifor_criar', {
        title: 'Criar cliente/fornecedor',
        description: 'Cria um cliente/fornecedor global (FinCFODataBR). Idempotente: se o CGCCFO (CPF/CNPJ) já existir, devolve o existente sem duplicar. Campos usuais: NOME (obrigatório), CGCCFO, RUA, NUMERO, BAIRRO, CIDADE, CODETD, CEP, TELEFONE, EMAIL.',
        inputSchema: {
            campos: z.record(z.string(), sn).describe('Campos do FCFO, ex.: {"NOME": "Fulano", "CGCCFO": "12345678901"}'),
        },
    }, async ({ campos }) => {
        const resultado = await svc.cfo.criarFluxo(campos as Record<string, unknown>);
        const jaExistia = resultado['jaExistia'] === true;
        return ok(
            jaExistia ? 'Cliente/Fornecedor já cadastrado.' : 'Cliente/Fornecedor gravado com sucesso.',
            resultado,
            jaExistia ? 200 : 201
        );
    });

    /* ================= Inscrição (fluxo completo) ================= */

    tool('inscricao_criar', {
        title: 'Inscrição completa (orquestrada)',
        description: 'Executa a inscrição completa de um aluno: pessoa → aluno → usuário/filial → acesso/SSO → matrícula no curso → matrícula no período letivo (contrato) → enturmação → cupom/bolsa → lançamento financeiro. IDEMPOTENTE: reenvio retoma de onde parou. Brasileiro: CPF + NATURALIDADE obrigatórios; estrangeiro: RNM no lugar do CPF. CIDADE e BAIRRO são CÓDIGOS (use enderecos_*). Pode demorar minutos.',
        inputSchema: {
            OFERTA: z.string(),
            PLANOPAGAMENTO: z.string(),
            CPF: z.string().optional().describe('Obrigatório para brasileiro'),
            RNM: z.string().optional().describe('Obrigatório para estrangeiro (sem CPF)'),
            NOME: z.string(),
            NASCIMENTO: z.string().describe('Y-m-d, ex.: 1990-01-15'),
            SEXO: z.string().describe('M ou F'),
            EMAIL: z.string(),
            TELEFONE: z.string(),
            CEP: z.string().optional().describe('Endereço BR (opcional para estrangeiro)'),
            ESTADO: z.string().optional().describe('UF, ex.: RS'),
            CIDADE: z.string().optional().describe('CÓDIGO da cidade (enderecos_cidades)'),
            BAIRRO: z.string().optional().describe('CÓDIGO do bairro (enderecos_bairros)'),
            RUA: z.string().optional(),
            NUMERO: z.string().optional(),
            COMPLEMENTO: z.string().optional(),
            NATURALIDADE: z.string().optional().describe('CÓDIGO da cidade natal; obrigatório para brasileiro'),
            CUPOM: z.string().optional(),
        },
    }, async (args) =>
        ok('Inscrição efetuada com sucesso!', await svc.inscricao.executar(args, cfg.publicUrl)));

    /* ================= Matrícula (etapas granulares) ================= */

    const oferta = async (codOferta: string): Promise<Record<string, unknown>> => {
        const row = await svc.consulta.oferta(codOferta);
        if (row === null) {
            throw new FluxoError('OFERTA', 'Não conseguimos encontrar essa oferta de curso', 'Oferta não encontrada', codOferta);
        }
        return row;
    };

    tool('matricula_curso', {
        title: 'Matricular no curso',
        description: 'Pré-matrícula do aluno no curso da oferta (EduHabilitacaoAlunoData, status 23). Idempotente.',
        inputSchema: { RA: z.string(), OFERTA: z.string() },
    }, async ({ RA, OFERTA }) =>
        ok('Matrícula no curso efetuada.', await svc.matricula.matricularNoCurso(
            String(RA), String(OFERTA), await oferta(String(OFERTA))
        ), 201));

    tool('matricula_periodo_letivo', {
        title: 'Matricular no período letivo',
        description: 'Matrícula no período letivo — gera o CONTRATO (processo EduMatriculaProcData). Idempotente; valida o plano de pagamento antes.',
        inputSchema: { RA: z.string(), OFERTA: z.string(), PLANOPAGAMENTO: z.string() },
    }, async ({ RA, OFERTA, PLANOPAGAMENTO }) =>
        ok('Matrícula no período letivo efetuada.', await svc.matricula.matricularNoPeriodoLetivo(
            String(RA), String(OFERTA), await oferta(String(OFERTA)), String(PLANOPAGAMENTO)
        ), 201));

    tool('matricula_disciplinas', {
        title: 'Enturmar nas disciplinas',
        description: 'Matricula o aluno nas turmas/disciplinas da oferta (processo EduMatriculaProcData).',
        inputSchema: { RA: z.string(), OFERTA: z.string() },
    }, async ({ RA, OFERTA }) =>
        ok('Matrícula nas turmas/disciplinas efetuada.', await svc.matricula.enturmar(
            String(RA), String(OFERTA), await oferta(String(OFERTA))
        ), 201));

    /* ================= Contrato (PDF) ================= */

    tool('contrato_gerar', {
        title: 'Gerar contrato (PDF)',
        description: 'Gera o PDF do contrato via relatório do RM (GenerateReport → GetFileChunk). Por padrão o CONTEUDO é omitido da resposta para não estourar o contexto — retornar_conteudo=true devolve o conteúdo bruto.',
        inputSchema: {
            NOME: z.string(),
            CPF: z.string(),
            ESTADO: z.string(),
            CIDADE: z.string().describe('CÓDIGO da cidade'),
            BAIRRO: z.string().describe('CÓDIGO do bairro'),
            RUA: z.string(),
            NUMERO: z.string(),
            COMPLEMENTO: z.string().optional(),
            NACIONALIDADE: z.string().optional(),
            NASCIMENTO: z.string().describe('Y-m-d'),
            retornar_conteudo: z.boolean().optional().describe('Default false: omite o binário do PDF'),
        },
    }, async ({ retornar_conteudo, ...campos }) => {
        const conteudo = await svc.contrato.gerar(campos as Record<string, unknown>);
        const dados = retornar_conteudo === true
            ? { CONTEUDO: conteudo }
            : { CONTEUDO: `<conteúdo do PDF omitido: ${String(conteudo).length} caracteres — use retornar_conteudo=true para obter>` };
        return ok('Contrato gerado com sucesso.', dados);
    });

    /* ================= Financeiro ================= */

    tool('financeiro_baixar', {
        title: 'Baixar (quitar) lançamento financeiro',
        description: 'ATENÇÃO: EXECUTA UMA BAIXA REAL no RM (processo FinTBCBaixaDataProcess, validado em homologação) — registra o recebimento de uma parcela. Nesta tool DRY_RUN é TRUE POR PADRÃO: gera e devolve o XML sem enviar ao RM. Para efetivar a baixa de verdade, confirme com o usuário e chame novamente com DRY_RUN=false.',
        inputSchema: {
            IDLAN: sn.describe('ID do lançamento em aberto'),
            VALORBAIXA: z.string().describe('Valor, ex.: "465.00" (aceita vírgula)'),
            TIPOFORMAPAGTO: z.string().describe('Dinheiro|Cheque|Cartao|CartaoCredito|CartaoDebito|Transferencia|DebitoConta|Boleto|Pix|Outros'),
            CODCXA: z.string().optional().describe('Conta/caixa; sem ela usa a env FIN_CODCXA_PADRAO'),
            CODCOLIGADA: sn.optional().describe('Default 1'),
            CODFILIAL: sn.optional().describe('Default 1'),
            DATABAIXA: z.string().optional().describe('Y-m-d; default hoje'),
            HISTORICOBAIXA: z.string().optional(),
            TIPOBAIXA: z.string().optional().describe('Simplificada (default) | Completa | Parcial'),
            IDFORMAPAGTO: sn.optional().describe('ID da forma de pagamento no RM; default 1 (Dinheiro)'),
            DRY_RUN: z.boolean().optional().describe('DEFAULT TRUE nesta tool. false = executa a baixa REAL no RM'),
        },
        annotations: { destructiveHint: true },
    }, async ({ DRY_RUN, ...campos }) =>
        ok('Baixa de lançamento enviada ao RM.', await svc.baixa.baixar({ ...campos, DRY_RUN: DRY_RUN !== false })));

    tool('financeiro_gerar_lancamentos', {
        title: 'Gerar lançamentos do contrato',
        description: 'Gera os lançamentos financeiros do contrato do aluno (processo EduGerarLancFromContratoSliceableData). Idempotente: se já existem, não regera. CODCONTRATO opcional (resolve pela matrícula no período letivo).',
        inputSchema: {
            RA: z.string(),
            OFERTA: z.string(),
            CODCONTRATO: z.string().optional(),
        },
    }, async ({ RA, OFERTA, CODCONTRATO }) => {
        const dados = await svc.lancamento.gerarPorRaOferta(String(RA), String(OFERTA), String(CODCONTRATO ?? ''));
        const jaExistiam = dados['ja_existiam'] === true;
        return ok(
            jaExistiam ? 'Lançamentos já existiam para o contrato.' : 'Lançamentos gerados com sucesso.',
            dados
        );
    });

    /* ================= Oferta / consultas ================= */

    tool('oferta_consultar', {
        title: 'Consultar oferta',
        description: 'Dados da oferta de curso: coligada, curso, turma, período letivo... (INT.EDUVEM.00006).',
        inputSchema: { codoferta: z.string() },
        annotations: ro,
    }, async ({ codoferta }) => {
        const row = await svc.consulta.oferta(String(codoferta));
        return row === null
            ? naoEncontrado('Não foi possível encontrar os dados da oferta')
            : ok('Dados da oferta obtidos com sucesso.', row);
    });

    tool('oferta_planos_pagamento', {
        title: 'Planos de pagamento da oferta',
        description: 'Lista os planos de pagamento de uma oferta (INT.EDUVEM.00013).',
        inputSchema: { codoferta: z.string() },
        annotations: ro,
    }, async ({ codoferta }) => {
        const planos = await svc.consulta.planosPagamento(String(codoferta));
        return planos.length === 0
            ? naoEncontrado('Não foi possível encontrar as formas de pagamento da oferta')
            : ok('Formas de pagamento da oferta obtidas com sucesso.', planos);
    });

    tool('enderecos_estados', {
        title: 'Listar estados',
        description: 'Lista os estados cadastrados no RM (INT.EDUVEM.00002).',
        inputSchema: {},
        annotations: ro,
    }, async () => ok('Lista de estados obtida com sucesso', await svc.consulta.estados()));

    tool('enderecos_cidades', {
        title: 'Listar cidades de um estado',
        description: 'Lista as cidades de uma UF com seus CÓDIGOS (INT.EDUVEM.00003). Os códigos alimentam CIDADE/NATURALIDADE da inscrição.',
        inputSchema: { uf: z.string().describe('Ex.: RS') },
        annotations: ro,
    }, async ({ uf }) =>
        ok('Lista de cidades obtida com sucesso', await svc.consulta.cidadesPorUf(String(uf))));

    tool('enderecos_bairros', {
        title: 'Listar bairros de uma cidade',
        description: 'Lista os bairros de uma cidade com seus CÓDIGOS (INT.EDUVEM.00004).',
        inputSchema: { codcidade: z.string().describe('Código da cidade (enderecos_cidades)') },
        annotations: ro,
    }, async ({ codcidade }) =>
        ok('Lista de bairros obtida com sucesso', await svc.consulta.bairrosPorCidade(String(codcidade))));

    tool('enderecos_cep', {
        title: 'Consultar CEP',
        description: 'Resolve um CEP para estado/cidade/bairro/rua no cadastro do RM (INT.EDUVEM.00005).',
        inputSchema: { cep: z.string() },
        annotations: ro,
    }, async ({ cep }) => {
        const rows = await svc.consulta.enderecoPorCep(String(cep));
        return rows.length === 0
            ? naoEncontrado('CEP não encontrado. Por favor, preencha seus dados de endereço.')
            : ok('Endereço obtido com sucesso', rows[0]);
    });

    /* ================= Cupom ================= */

    tool('cupom_consultar', {
        title: 'Consultar cupom',
        description: 'Valida um cupom para oferta + plano de pagamento (INT.EDUVEM.00016).',
        inputSchema: {
            codoferta: z.string(),
            codplano: z.string(),
            cupom: z.string(),
        },
        annotations: ro,
    }, async ({ codoferta, codplano, cupom }) => {
        const row = await svc.consulta.cupom(String(codoferta), String(codplano), String(cupom));
        return row === null
            ? naoEncontrado('Cupom não encontrado')
            : ok('Cupom obtido com sucesso', row);
    });

    tool('cupom_aplicar', {
        title: 'Aplicar cupom (bolsa)',
        description: 'Aplica o cupom/bolsa ao contrato do aluno (EduBolsaAlunoData). Idempotente: se já aplicado, não duplica. CODCONTRATO opcional (resolve pela matrícula no período letivo).',
        inputSchema: {
            RA: z.string(),
            OFERTA: z.string(),
            PLANOPAGAMENTO: z.string(),
            CUPOM: z.string(),
            CODCONTRATO: z.string().optional(),
        },
    }, async ({ RA, OFERTA, PLANOPAGAMENTO, CUPOM, CODCONTRATO }) => {
        const dados = await svc.bolsa.aplicarPorRaOferta(
            String(RA), String(OFERTA), String(PLANOPAGAMENTO), String(CUPOM), String(CODCONTRATO ?? '')
        );
        const jaExistia = dados['ja_existia'] === true;
        return ok(jaExistia ? 'Cupom já estava aplicado ao contrato.' : 'Cupom aplicado com sucesso.', dados);
    });

    /* ================= Aluno — SSO manual ================= */

    tool('aluno_gerar_sso', {
        title: 'Gerar link de SSO do aluno',
        description: 'Gera o link de auto-login (SSO) do Portal Educacional para um aluno, a partir de CODPESSOA + CODCOLIGADA. Reativa o usuário com a senha padrão se necessário. Retorna a URL /sso/{token} servida por este próprio servidor.',
        inputSchema: {
            codpessoa: sn,
            codcoligada: sn.describe('Ex.: 1'),
        },
    }, async ({ codpessoa, codcoligada }) => {
        const student = await svc.aluno.buscar(String(codpessoa), String(codcoligada));
        if (student === null) {
            return naoEncontrado('Não foi encontrado cadastro de aluno');
        }
        const codUsuario = s(student['CODUSUARIO']);
        const senhaPadrao = s(student['SENHAPADRAO']);
        if (codUsuario === '') {
            return { status: 422, body: { sucesso: false, mensagem: 'Aluno sem CODUSUARIO no RM.' } };
        }
        await svc.aluno.ajustarAcessoUsuario(codUsuario, senhaPadrao);
        const token = svc.crypto.encrypt(`${codUsuario}$_$${senhaPadrao}`);
        return ok('SSO gerado com sucesso.', {
            CODUSUARIO: codUsuario,
            nextUrl: `${cfg.publicUrl}/sso/${token}`,
        });
    });
}
