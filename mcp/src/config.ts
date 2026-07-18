/**
 * Configuração central via variáveis de ambiente.
 *
 * As envs do TOTVS RM usam OS MESMOS NOMES da API PHP (config/rm.php):
 * TOTVS_WS_URL/USER/PASSWORD, APP_CRYPTO_KEY, FIN_BAIXA_*, TOTVS_PORTAL_* —
 * migração 1:1 do painel (EasyPanel).
 *
 * Em produção (NODE_ENV=production) MCP_PUBLIC_URL, MCP_OAUTH_SIGNING_KEY e
 * MCP_ACCESS_PASSWORD são obrigatórias — sem elas o boot aborta, para evitar
 * subir um servidor de gestão do TOTVS aberto por esquecimento.
 */

import crypto from 'node:crypto';

export interface RmConfig {
    /** Base SOAP do RM, ex.: https://fundacaoescola114384.rm.cloudtotvs.com.br:8051 */
    wsUrl: string;
    wsUser: string;
    wsPassword: string;
    /** Timeout das chamadas SOAP (processos do RM são lentos; a API PHP usava 300s). */
    timeoutMs: number;
    contextoPadrao: { CODSISTEMA: string; CODUSUARIO: string };
    sql: { codcoligada: string; codsistema: string };
    usuarioServico: string;
    baixa: { processo: string; operacao: string };
    codCxaPadrao: string;
    relatorioContrato: { codcoligada: string; id: string };
    portal: { loginUrl: string; autologinUrl: string; alias: string };
    /** Chave de 32 bytes do AES-256-GCM dos tokens de SSO. */
    cryptoKey: string;
    debug: boolean;
}

export interface Config {
    port: number;
    /** URL pública (issuer OAuth, links de SSO). Sem barra final. */
    publicUrl: string;
    /** Segredo HS256 dos JWTs (códigos, access e refresh tokens). */
    signingKey: string;
    /** Senha pedida na tela de autorização OAuth. */
    accessPassword: string;
    /** Tokens estáticos aceitos como Bearer (para clientes headless, ex.: OpenClaw). */
    staticTokens: string[];
    accessTokenTtl: number;
    refreshTokenTtl: number;
    corsOrigins: string[];
    dataDir: string;
    /**
     * Client OAuth PRÉ-CONFIGURADO (opcional). Quando definido, esse client_id
     * é sempre válido — sem depender de Dynamic Client Registration. Serve para
     * o campo "OAuth Client ID" do conector personalizado do Claude/Cowork,
     * caso o DCR automático falhe. Vazio = só DCR.
     */
    oauthClientId: string;
    /** Redirect URIs aceitas pelo client pré-configurado (callback do cliente MCP). */
    oauthClientRedirectUris: string[];
    /** Desliga o rate-limit interno do SDK nas rotas OAuth (evita falhas atrás de proxy). */
    disableOauthRateLimit: boolean;
    rm: RmConfig;
}

function env(name: string, fallback = ''): string {
    const v = process.env[name];
    return v === undefined || v === '' ? fallback : v;
}

function stripSlash(url: string): string {
    return url.replace(/\/+$/, '');
}

export function loadConfig(): Config {
    const production = env('NODE_ENV') === 'production';
    const port = Number(env('PORT', '3300'));

    const publicUrl = stripSlash(env('MCP_PUBLIC_URL', production ? '' : `http://localhost:${port}`));
    let signingKey = env('MCP_OAUTH_SIGNING_KEY');
    let accessPassword = env('MCP_ACCESS_PASSWORD');

    const faltando: string[] = [];
    if (publicUrl === '') faltando.push('MCP_PUBLIC_URL');
    if (signingKey === '') faltando.push('MCP_OAUTH_SIGNING_KEY');
    if (accessPassword === '') faltando.push('MCP_ACCESS_PASSWORD');

    if (faltando.length > 0) {
        if (production) {
            throw new Error(
                `Variáveis de ambiente obrigatórias ausentes: ${faltando.join(', ')}. ` +
                'Defina-as no painel (EasyPanel) antes de subir o serviço.'
            );
        }
        if (signingKey === '') {
            signingKey = crypto.randomBytes(32).toString('hex');
            console.warn('[mcp] MCP_OAUTH_SIGNING_KEY ausente — usando chave EFÊMERA (tokens morrem no restart).');
        }
        if (accessPassword === '') {
            accessPassword = crypto.randomBytes(9).toString('base64url');
            console.warn(`[mcp] MCP_ACCESS_PASSWORD ausente — senha de dev gerada: ${accessPassword}`);
        }
    }

    if (signingKey.length < 32) {
        throw new Error('MCP_OAUTH_SIGNING_KEY precisa ter pelo menos 32 caracteres.');
    }

    const wsUser = env('TOTVS_WS_USER');

    const rm: RmConfig = {
        wsUrl: stripSlash(env('TOTVS_WS_URL')),
        wsUser,
        wsPassword: env('TOTVS_WS_PASSWORD'),
        timeoutMs: Number(env('TOTVS_WS_TIMEOUT_MS', '300000')),
        contextoPadrao: {
            CODSISTEMA: 'S',
            CODUSUARIO: wsUser !== '' ? wsUser : 'integra.eduvem',
        },
        sql: { codcoligada: '0', codsistema: 'G' },
        usuarioServico: wsUser !== '' ? wsUser : 'integra.eduvem',
        baixa: {
            processo: env('FIN_BAIXA_PROCESSO', 'FinTBCBaixaDataProcess'),
            operacao: env('FIN_BAIXA_OPERACAO', 'ExecuteWithXMLParams'),
        },
        codCxaPadrao: env('FIN_CODCXA_PADRAO'),
        relatorioContrato: {
            codcoligada: '0',
            id: env('FIN_RELATORIO_CONTRATO_ID', '1664'),
        },
        portal: {
            loginUrl: env(
                'TOTVS_PORTAL_LOGIN_URL',
                'https://fundacaoescola114384.rm.cloudtotvs.com.br/FrameHTML/Web/App/Edu/PortalEducacional/login/'
            ),
            autologinUrl: env(
                'TOTVS_PORTAL_AUTOLOGIN_URL',
                'https://fundacaoescola114384.rm.cloudtotvs.com.br/Corpore.Net/Source/EDU-EDUCACIONAL/Public/EduPortalAlunoLogin.aspx?AutoLoginType=ExternalLogin&redirect=financeiro.new'
            ),
            alias: env('TOTVS_PORTAL_ALIAS', 'CorporeRM'),
        },
        cryptoKey: env('APP_CRYPTO_KEY'),
        debug: env('APP_DEBUG', 'false') === 'true',
    };

    if (rm.wsUrl === '' || rm.wsUser === '' || rm.wsPassword === '') {
        console.warn(
            '[mcp] AVISO: TOTVS_WS_URL/TOTVS_WS_USER/TOTVS_WS_PASSWORD incompletas — ' +
            'as chamadas ao RM vão falhar até que sejam configuradas.'
        );
    }

    return {
        port,
        publicUrl,
        signingKey,
        accessPassword,
        staticTokens: env('MCP_STATIC_BEARER_TOKENS')
            .split(',')
            .map((t) => t.trim())
            .filter((t) => t.length > 0),
        accessTokenTtl: Number(env('MCP_ACCESS_TOKEN_TTL_SECONDS', '3600')),
        refreshTokenTtl: Number(env('MCP_REFRESH_TOKEN_TTL_SECONDS', '2592000')),
        corsOrigins: env('MCP_CORS_ORIGINS', '*')
            .split(',')
            .map((o) => o.trim())
            .filter((o) => o.length > 0),
        dataDir: env('MCP_DATA_DIR', 'data'),
        oauthClientId: env('MCP_OAUTH_CLIENT_ID'),
        // Defaults = callbacks conhecidos do conector do Claude (web/Cowork).
        // Ajuste por env se o Claude exibir outra "Callback URL".
        oauthClientRedirectUris: env(
            'MCP_OAUTH_REDIRECT_URIS',
            'https://claude.ai/api/mcp/auth_callback,https://claude.com/api/mcp/auth_callback'
        )
            .split(',')
            .map((u) => u.trim())
            .filter((u) => u.length > 0),
        // Atrás de um proxy (EasyPanel/Traefik), o rate-limit por IP do SDK pode
        // tropeçar no X-Forwarded-For e derrubar o /register (DCR). A tela de
        // senha tem limitador próprio, então desligamos por padrão.
        disableOauthRateLimit: env('MCP_OAUTH_RATE_LIMIT', 'off') !== 'on',
        rm,
    };
}
