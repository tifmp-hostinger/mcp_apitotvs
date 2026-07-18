<?php

declare(strict_types=1);

/**
 * Configuração da conexão SOAP com o TOTVS RM
 * versão compatível com Docker / EasyPanel (ENV vars).
 */

use FMP\RMApi\Support\Env;

return [
    // Conexão SOAP
    'ws_url'      => Env::get('TOTVS_WS_URL', ''),
    'ws_user'     => Env::get('TOTVS_WS_USER', ''),
    'ws_password' => Env::get('TOTVS_WS_PASSWORD', ''),
    // Contexto padrão
    'contexto_padrao' => [
        'CODSISTEMA' => 'S',
        'CODUSUARIO' => Env::get('TOTVS_WS_USER', 'integra.eduvem'),
    ],
    // SQL padrões
    'sql' => [
        'codcoligada' => '0',
        'codsistema'  => 'G',
    ],

    // Usuário de serviço
    'usuario_servico' => Env::get('TOTVS_WS_USER', 'integra.eduvem'),

    // Baixa de lançamento. Nome do process server e operação SOAP configuráveis
    // por env — o RM expõe a baixa sob um nome que varia por versão/patch.
    //   FIN_BAIXA_PROCESSO: ProcessServerName   FIN_BAIXA_OPERACAO: ExecuteWithParams | ExecuteWithXMLParams
    //   FIN_CODCXA_PADRAO : conta/caixa default quando não vier no corpo
    //
    // ATENÇÃO: "Classe não encontrada: FinLanBaixaProc" = o nome NÃO existe
    // nesta instância. Descubra o nome real por inspeção READ-ONLY no RM:
    //   (a) Monitor de Jobs de uma baixa já feita → coluna "Classe de Processo"; ou
    //   (b) tela "Baixar" → "Salvar parâmetros como XML" e CANCELE antes de confirmar
    //       (revela o ProcessServerName E o elemento-raiz correto do XML).
    // Default atual: FinLanBaixaData (nome indicado pela equipe do RM; reaproveita
    // o XML <FinLanBaixaParamsProc>). Ainda a CONFIRMAR na instância — se der
    // "Classe não encontrada", tente os candidatos: FinLanBaixaProcData,
    // FinLanBaixaTBCData, ou FinTBCBaixaDataProcess (este EXIGE outro XML,
    // <FinTBCBaixaParamsProc>, não é só renomear).
    // Operação recomendada: ExecuteWithXMLParams (os processos que funcionam usam-na
    // — MatriculaService/LancamentoService — e força separador decimal '.').
    // NUNCA teste nomes em produção: nome errado é inofensivo, mas o nome CERTO
    // EXECUTA uma baixa real. Confirme antes; teste em homologação/sandbox.
    // FinTBCBaixaDataProcess = caminho OFICIAL da TOTVS para baixa via WebService
    // (TDN "Baixa Via Web Service"): contrato pequeno (FinTBCBaixaParamsProc), o RM
    // carrega o lançamento da base pelo IdLan. Pré-requisito: Novo Modelo de Baixa.
    // FinLanBaixaData é o processo da TELA — via WS as coleções chegam vazias e ele
    // responde "Os lançamentos devem ser informados" (não use; fica como fallback
    // configurável para o builder de replay).
    // Operação: os exemplos da TDN para os processos TBC usam ExecuteWithXmlParams —
    // a mesma operação da Matrícula/Lançamento, que comprovadamente entrega objetos
    // complexos ao processo. Processos alternativos por env (builder acompanha):
    //   FinTBCBaixaDataProcess (default) | FinLanBaixaTBCData | FinLanBaixaData (tela/replay)
    'baixa' => [
        'processo' => Env::get('FIN_BAIXA_PROCESSO', 'FinTBCBaixaDataProcess'),
        'operacao' => Env::get('FIN_BAIXA_OPERACAO', 'ExecuteWithXMLParams'),
    ],

    // Relatório contrato (o ID do relatório pode variar entre bases/ambientes)
    'relatorio_contrato' => [
        'codcoligada' => '0',
        'id'          => Env::get('FIN_RELATORIO_CONTRATO_ID', '1664'),
    ],

    // Portal do aluno. Defaults de PRODUÇÃO (114384); para homolog (114385)
    // sobrescreva por env. Usado só nos links de login/autologin do portal —
    // NÃO afeta as chamadas SOAP (essas seguem TOTVS_WS_URL).
    'portal' => [
        'login_url'     => Env::get('TOTVS_PORTAL_LOGIN_URL', 'https://fundacaoescola114384.rm.cloudtotvs.com.br/FrameHTML/Web/App/Edu/PortalEducacional/login/'),
        'autologin_url' => Env::get('TOTVS_PORTAL_AUTOLOGIN_URL', 'https://fundacaoescola114384.rm.cloudtotvs.com.br/Corpore.Net/Source/EDU-EDUCACIONAL/Public/EduPortalAlunoLogin.aspx?AutoLoginType=ExternalLogin&redirect=financeiro.new'),
        'alias'         => Env::get('TOTVS_PORTAL_ALIAS', 'CorporeRM'),
    ],
];