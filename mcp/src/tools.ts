/**
 * Tools MCP — espelham as rotas da API REST api-totvs (ver www/api/API.md).
 *
 * Convenções:
 *  - nomes em snake_case por domínio (pessoa_*, aluno_*, financeiro_*...);
 *  - toda tool devolve o envelope JSON da API como texto (o agente lê
 *    "sucesso", "retorno_rm", "etapas" etc. diretamente);
 *  - consultas levam readOnlyHint; gravações levam destructiveHint quando
 *    causam efeito real no RM;
 *  - financeiro_baixar tem DRY_RUN=true POR PADRÃO (diferente da API!):
 *    agente conversacional só executa a baixa real com DRY_RUN=false explícito.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ApiResponse, TotvsApiClient } from './api-client.js';

function toResult(r: ApiResponse): CallToolResult {
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body, null, 2);
    const sucessoEnvelope =
        typeof r.body === 'object' && r.body !== null && 'sucesso' in r.body
            ? (r.body as { sucesso: unknown }).sucesso !== false
            : true;
    const ok = r.status >= 200 && r.status < 300 && sucessoEnvelope;
    return {
        content: [{ type: 'text', text: `HTTP ${r.status}\n${text}` }],
        isError: !ok,
    };
}

/** Campos aceitos como string ou número (o RM não distingue). */
const sn = z.union([z.string(), z.number()]);

export function registerTotvsTools(server: McpServer, api: TotvsApiClient): void {

    const ro = { readOnlyHint: true };

    /* ================= Sistema / diagnóstico ================= */

    server.registerTool('totvs_status', {
        title: 'Status da API TOTVS',
        description: 'Health check da API de integração (GET /status). Não exige autenticação na API e não toca em dados.',
        inputSchema: {},
        annotations: ro,
    }, async () => toResult(await api.get('/status')));

    server.registerTool('totvs_teste_rm', {
        title: 'Testar conexão com o RM',
        description: 'Testa conexão e credenciais SOAP com o TOTVS RM (GET /rm/test).',
        inputSchema: {},
        annotations: ro,
    }, async () => toResult(await api.get('/rm/test')));

    server.registerTool('rm_schema', {
        title: 'Schema de um DataServer',
        description: 'Retorna o schema parseado de um DataServer do RM — tabelas, campos, chaves, FKs (GET /rm/schema/{dataserver}). Use xml=true para o XSD bruto.',
        inputSchema: {
            dataserver: z.string().describe('Nome do DataServer, ex.: RhuPessoaData, EduAlunoData'),
            xml: z.boolean().optional().describe('true = devolve o XSD bruto em vez do schema parseado'),
        },
        annotations: ro,
    }, async ({ dataserver, xml }) =>
        toResult(await api.get(`/rm/schema/${encodeURIComponent(dataserver)}`, xml ? { xml: '1' } : undefined)));

    server.registerTool('rm_sql', {
        title: 'Executar sentença SQL cadastrada',
        description: 'Executa uma sentença SQL cadastrada no RM (POST /rm/sql/{codsentenca}). As sentenças da integração são INT.EDUVEM.00001–00021. Somente sentenças já cadastradas no RM podem ser executadas.',
        inputSchema: {
            codsentenca: z.string().describe('Código da sentença, ex.: INT.EDUVEM.00007'),
            parametros: z.record(z.string(), sn).optional().describe('Parâmetros da sentença, ex.: {"CPF_S": "12345678901"}'),
            codcoligada: z.string().optional().describe('Default "0"'),
            codsistema: z.string().optional().describe('Default "G"'),
        },
        annotations: ro,
    }, async ({ codsentenca, parametros, codcoligada, codsistema }) =>
        toResult(await api.post(`/rm/sql/${encodeURIComponent(codsentenca)}`, {
            parametros: parametros ?? {},
            ...(codcoligada !== undefined ? { codcoligada } : {}),
            ...(codsistema !== undefined ? { codsistema } : {}),
        })));

    server.registerTool('rm_read', {
        title: 'ReadRecord genérico',
        description: 'Lê um registro de um DataServer pela chave primária (POST /rm/read/{dataserver}).',
        inputSchema: {
            dataserver: z.string(),
            chave: z.array(sn).describe('Partes da chave primária, na ordem, ex.: ["1","000123"]'),
            contexto: z.record(z.string(), sn).optional().describe('Contexto opcional, ex.: {"CODCOLIGADA": 1}'),
        },
        annotations: ro,
    }, async ({ dataserver, chave, contexto }) =>
        toResult(await api.post(`/rm/read/${encodeURIComponent(dataserver)}`, { chave, contexto: contexto ?? {} })));

    server.registerTool('rm_view', {
        title: 'ReadView genérico',
        description: 'Lê registros de um DataServer por filtro SQL (POST /rm/view/{dataserver}).',
        inputSchema: {
            dataserver: z.string(),
            filtro: z.string().optional().describe('Filtro SQL, ex.: "CODCOLIGADA=1". Default "1=1"'),
            contexto: z.record(z.string(), sn).optional(),
        },
        annotations: ro,
    }, async ({ dataserver, filtro, contexto }) =>
        toResult(await api.post(`/rm/view/${encodeURIComponent(dataserver)}`, {
            filtro: filtro ?? '1=1',
            contexto: contexto ?? {},
        })));

    server.registerTool('rm_save', {
        title: 'SaveRecord genérico (avançado)',
        description: 'GRAVA um registro em qualquer DataServer com XML cru (POST /rm/save/{dataserver}). Ferramenta avançada de administração: prefira as tools específicas (pessoa_salvar, aluno_criar...). Confirme com o usuário antes de usar.',
        inputSchema: {
            dataserver: z.string(),
            xml: z.string().describe('XML no formato do DataServer (use rm_schema para descobrir a estrutura)'),
            contexto: z.record(z.string(), sn).optional(),
        },
        annotations: { destructiveHint: true },
    }, async ({ dataserver, xml, contexto }) =>
        toResult(await api.post(`/rm/save/${encodeURIComponent(dataserver)}`, { xml, contexto: contexto ?? {} })));

    /* ================= Pessoa ================= */

    server.registerTool('pessoa_buscar', {
        title: 'Buscar pessoa',
        description: 'Busca uma pessoa (PPessoa) por código, CPF ou RNM. Informe exatamente um dos três.',
        inputSchema: {
            codigo: sn.optional().describe('CODPESSOA (busca direta)'),
            cpf: z.string().optional().describe('CPF (somente dígitos ou formatado)'),
            rnm: z.string().optional().describe('RNM do estrangeiro'),
        },
        annotations: ro,
    }, async ({ codigo, cpf, rnm }) => {
        if (codigo !== undefined) {
            return toResult(await api.get(`/pessoas/${encodeURIComponent(String(codigo))}`));
        }
        if (cpf || rnm) {
            return toResult(await api.get('/pessoas/busca', { cpf, rnm }));
        }
        return {
            content: [{ type: 'text', text: 'Informe codigo, cpf ou rnm.' }],
            isError: true,
        };
    });

    server.registerTool('pessoa_salvar', {
        title: 'Criar/atualizar pessoa',
        description: 'Cria ou atualiza uma pessoa no RM (POST /pessoas, DataServer RhuPessoaData). CODIGO=0 ou ausente cria; CODIGO preenchido atualiza. Campos usuais: NOME, DTNASCIMENTO (Y-m-d), SEXO (M/F), CPF, EMAIL, TELEFONE1, RUA, NUMERO, BAIRRO, ESTADO, CIDADE, CEP, CODMUNICIPIO, IDPAIS, NROREGGERAL. Retorna o CODPESSOA.',
        inputSchema: {
            campos: z.record(z.string(), sn).describe('Campos da PPessoa, ex.: {"NOME": "Fulano", "CPF": "12345678901", ...}'),
        },
    }, async ({ campos }) => toResult(await api.post('/pessoas', campos)));

    /* ================= Aluno ================= */

    server.registerTool('aluno_buscar', {
        title: 'Buscar aluno',
        description: 'Busca o aluno pela coligada e CODPESSOA (GET /alunos/{codcoligada}/{codpessoa}). Retorna RA, CODUSUARIO, SENHAPADRAO, EXISTESUSUARIOFILIAL, DATAULTIMOACESSOVALIDO.',
        inputSchema: {
            codcoligada: sn,
            codpessoa: sn,
        },
        annotations: ro,
    }, async ({ codcoligada, codpessoa }) =>
        toResult(await api.get(`/alunos/${encodeURIComponent(String(codcoligada))}/${encodeURIComponent(String(codpessoa))}`)));

    server.registerTool('aluno_criar', {
        title: 'Criar aluno (fluxo orquestrado)',
        description: 'Cria o aluno a partir de uma pessoa existente (POST /alunos). Fluxo com etapas: valida cliente/fornecedor pelo CPF/RNM → aluno (EduAlunoData) → usuário/filial → acesso/SSO. Idempotente; devolve dados.etapas.',
        inputSchema: {
            CODPESSOA: sn,
            CODCOLIGADA: sn.optional().describe('Default 1'),
            CODTIPOCURSO: sn.optional().describe('Default 2'),
            CODFILIAL: sn.optional().describe('Default 1'),
            CPF: z.string().optional(),
            RNM: z.string().optional(),
        },
    }, async (args) => toResult(await api.post('/alunos', args)));

    server.registerTool('aluno_vincular_clifor', {
        title: 'Vincular cliente/fornecedor ao aluno',
        description: 'Grava CODCOLCFO/CODCFO direto no EduAlunoData de um aluno existente por RA (POST /alunos/cliente-fornecedor). CODTIPOCURSO e CODFILIAL são obrigatórios no contexto educacional.',
        inputSchema: {
            RA: z.string(),
            CODCFO: z.string().describe('Código do cliente/fornecedor'),
            CODCOLCFO: sn.optional().describe('Coligada do CFO; CFO global = 0'),
            CODCOLIGADA: sn.optional().describe('Coligada do aluno; default 1'),
            CODTIPOCURSO: sn.optional().describe('Default 2'),
            CODFILIAL: sn.optional().describe('Default 1'),
        },
    }, async (args) => toResult(await api.post('/alunos/cliente-fornecedor', args)));

    /* ================= Cliente/Fornecedor ================= */

    server.registerTool('clifor_buscar', {
        title: 'Buscar cliente/fornecedor',
        description: 'Busca um cliente/fornecedor (FinCFO) por CPF/CNPJ ou RNM (GET /clientes-fornecedores/busca). Retorna CODCOLCFO e CODCFO.',
        inputSchema: {
            cpf: z.string().optional().describe('CPF ou CNPJ'),
            rnm: z.string().optional(),
        },
        annotations: ro,
    }, async ({ cpf, rnm }) => toResult(await api.get('/clientes-fornecedores/busca', { cpf, rnm })));

    server.registerTool('clifor_criar', {
        title: 'Criar cliente/fornecedor',
        description: 'Cria um cliente/fornecedor global (POST /clientes-fornecedores, FinCFODataBR). Idempotente: se o CGCCFO (CPF/CNPJ) já existir, devolve o existente sem duplicar. Campos usuais: NOME (obrigatório), CGCCFO, RUA, NUMERO, BAIRRO, CIDADE, CODETD, CEP, TELEFONE, EMAIL.',
        inputSchema: {
            campos: z.record(z.string(), sn).describe('Campos do FCFO, ex.: {"NOME": "Fulano", "CGCCFO": "12345678901"}'),
        },
    }, async ({ campos }) => toResult(await api.post('/clientes-fornecedores', campos)));

    /* ================= Inscrição (fluxo completo) ================= */

    server.registerTool('inscricao_criar', {
        title: 'Inscrição completa (orquestrada)',
        description: 'Executa a inscrição completa de um aluno (POST /inscricoes): pessoa → aluno → usuário/filial → acesso/SSO → matrícula no curso → matrícula no período letivo (contrato) → enturmação → cupom/bolsa → lançamento financeiro. IDEMPOTENTE: reenvio retoma de onde parou. Brasileiro: CPF + NATURALIDADE obrigatórios; estrangeiro: RNM no lugar do CPF. CIDADE e BAIRRO são CÓDIGOS (use enderecos_* para descobrir). Pode demorar minutos.',
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
    }, async (args) => toResult(await api.post('/inscricoes', args)));

    /* ================= Matrícula (etapas granulares) ================= */

    server.registerTool('matricula_curso', {
        title: 'Matricular no curso',
        description: 'Pré-matrícula do aluno no curso da oferta (POST /matriculas/curso, EduHabilitacaoAlunoData).',
        inputSchema: { RA: z.string(), OFERTA: z.string() },
    }, async (args) => toResult(await api.post('/matriculas/curso', args)));

    server.registerTool('matricula_periodo_letivo', {
        title: 'Matricular no período letivo',
        description: 'Matrícula no período letivo — gera o CONTRATO (POST /matriculas/periodo-letivo, processo EduMatriculaProcData).',
        inputSchema: { RA: z.string(), OFERTA: z.string(), PLANOPAGAMENTO: z.string() },
    }, async (args) => toResult(await api.post('/matriculas/periodo-letivo', args)));

    server.registerTool('matricula_disciplinas', {
        title: 'Enturmar nas disciplinas',
        description: 'Matricula o aluno nas turmas/disciplinas da oferta (POST /matriculas/disciplinas, processo EduMatriculaProcData).',
        inputSchema: { RA: z.string(), OFERTA: z.string() },
    }, async (args) => toResult(await api.post('/matriculas/disciplinas', args)));

    /* ================= Contrato (PDF) ================= */

    server.registerTool('contrato_gerar', {
        title: 'Gerar contrato (PDF)',
        description: 'Gera o PDF do contrato via relatório do RM (POST /contratos). Por padrão o CONTEUDO (PDF) é omitido da resposta para não estourar o contexto — retornar_conteudo=true devolve o conteúdo bruto.',
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
        const r = await api.post('/contratos', campos);
        if (!retornar_conteudo && typeof r.body === 'object' && r.body !== null) {
            const dados = (r.body as { dados?: { CONTEUDO?: unknown } }).dados;
            if (dados && dados.CONTEUDO !== undefined) {
                const tamanho = String(dados.CONTEUDO).length;
                dados.CONTEUDO = `<conteúdo do PDF omitido: ${tamanho} caracteres — use retornar_conteudo=true para obter>`;
            }
        }
        return toResult(r);
    });

    /* ================= Financeiro ================= */

    server.registerTool('financeiro_baixar', {
        title: 'Baixar (quitar) lançamento financeiro',
        description: 'ATENÇÃO: EXECUTA UMA BAIXA REAL no RM (POST /financeiro/baixas, processo FinTBCBaixaDataProcess) — registra o recebimento de uma parcela. Nesta tool DRY_RUN é TRUE POR PADRÃO: gera e devolve o XML sem enviar ao RM. Para efetivar a baixa de verdade, confirme com o usuário e chame novamente com DRY_RUN=false.',
        inputSchema: {
            IDLAN: sn.describe('ID do lançamento em aberto'),
            VALORBAIXA: z.string().describe('Valor, ex.: "465.00" (aceita vírgula)'),
            TIPOFORMAPAGTO: z.string().describe('Dinheiro|Cheque|Cartao|CartaoCredito|CartaoDebito|Transferencia|DebitoConta|Boleto|Pix|Outros'),
            CODCXA: z.string().optional().describe('Conta/caixa; sem ela usa a env FIN_CODCXA_PADRAO da API'),
            CODCOLIGADA: sn.optional().describe('Default 1'),
            CODFILIAL: sn.optional().describe('Default 1'),
            DATABAIXA: z.string().optional().describe('Y-m-d; default hoje'),
            HISTORICOBAIXA: z.string().optional(),
            TIPOBAIXA: z.string().optional().describe('Simplificada (default) | Completa | Parcial'),
            IDFORMAPAGTO: sn.optional().describe('ID da forma de pagamento no RM; default 1'),
            DRY_RUN: z.boolean().optional().describe('DEFAULT TRUE nesta tool. false = executa a baixa REAL no RM'),
        },
        annotations: { destructiveHint: true },
    }, async ({ DRY_RUN, ...campos }) =>
        toResult(await api.post('/financeiro/baixas', { ...campos, DRY_RUN: DRY_RUN !== false })));

    server.registerTool('financeiro_gerar_lancamentos', {
        title: 'Gerar lançamentos do contrato',
        description: 'Gera os lançamentos financeiros do contrato do aluno (POST /financeiro/lancamentos, processo EduGerarLancFromContratoSliceableData). Idempotente: se já existem, não regera. CODCONTRATO opcional (resolve pela matrícula no período letivo).',
        inputSchema: {
            RA: z.string(),
            OFERTA: z.string(),
            CODCONTRATO: z.string().optional(),
        },
    }, async (args) => toResult(await api.post('/financeiro/lancamentos', args)));

    /* ================= Oferta / consultas ================= */

    server.registerTool('oferta_consultar', {
        title: 'Consultar oferta',
        description: 'Dados da oferta de curso: coligada, curso, turma, período letivo... (GET /ofertas/{codoferta}).',
        inputSchema: { codoferta: z.string() },
        annotations: ro,
    }, async ({ codoferta }) => toResult(await api.get(`/ofertas/${encodeURIComponent(codoferta)}`)));

    server.registerTool('oferta_planos_pagamento', {
        title: 'Planos de pagamento da oferta',
        description: 'Lista os planos de pagamento de uma oferta (GET /ofertas/{codoferta}/planos-pagamento).',
        inputSchema: { codoferta: z.string() },
        annotations: ro,
    }, async ({ codoferta }) =>
        toResult(await api.get(`/ofertas/${encodeURIComponent(codoferta)}/planos-pagamento`)));

    server.registerTool('enderecos_estados', {
        title: 'Listar estados',
        description: 'Lista os estados cadastrados no RM (GET /enderecos/estados).',
        inputSchema: {},
        annotations: ro,
    }, async () => toResult(await api.get('/enderecos/estados')));

    server.registerTool('enderecos_cidades', {
        title: 'Listar cidades de um estado',
        description: 'Lista as cidades de uma UF com seus CÓDIGOS (GET /enderecos/estados/{uf}/cidades). Os códigos alimentam CIDADE/NATURALIDADE da inscrição.',
        inputSchema: { uf: z.string().describe('Ex.: RS') },
        annotations: ro,
    }, async ({ uf }) => toResult(await api.get(`/enderecos/estados/${encodeURIComponent(uf)}/cidades`)));

    server.registerTool('enderecos_bairros', {
        title: 'Listar bairros de uma cidade',
        description: 'Lista os bairros de uma cidade com seus CÓDIGOS (GET /enderecos/cidades/{codcidade}/bairros).',
        inputSchema: { codcidade: z.string().describe('Código da cidade (enderecos_cidades)') },
        annotations: ro,
    }, async ({ codcidade }) =>
        toResult(await api.get(`/enderecos/cidades/${encodeURIComponent(codcidade)}/bairros`)));

    server.registerTool('enderecos_cep', {
        title: 'Consultar CEP',
        description: 'Resolve um CEP para estado/cidade/bairro/rua no cadastro do RM (GET /enderecos/cep/{cep}).',
        inputSchema: { cep: z.string() },
        annotations: ro,
    }, async ({ cep }) => toResult(await api.get(`/enderecos/cep/${encodeURIComponent(cep)}`)));

    /* ================= Cupom ================= */

    server.registerTool('cupom_consultar', {
        title: 'Consultar cupom',
        description: 'Valida um cupom para oferta + plano de pagamento (GET /cupons/{codoferta}/{codplano}/{cupom}).',
        inputSchema: {
            codoferta: z.string(),
            codplano: z.string(),
            cupom: z.string(),
        },
        annotations: ro,
    }, async ({ codoferta, codplano, cupom }) =>
        toResult(await api.get(
            `/cupons/${encodeURIComponent(codoferta)}/${encodeURIComponent(codplano)}/${encodeURIComponent(cupom)}`
        )));

    server.registerTool('cupom_aplicar', {
        title: 'Aplicar cupom (bolsa)',
        description: 'Aplica o cupom/bolsa ao contrato do aluno (POST /cupons/aplicar, EduBolsaAlunoData). Idempotente: se já aplicado, não duplica. CODCONTRATO opcional.',
        inputSchema: {
            RA: z.string(),
            OFERTA: z.string(),
            PLANOPAGAMENTO: z.string(),
            CUPOM: z.string(),
            CODCONTRATO: z.string().optional(),
        },
    }, async (args) => toResult(await api.post('/cupons/aplicar', args)));
}
