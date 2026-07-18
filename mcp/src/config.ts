/**
 * Configuração central via variáveis de ambiente (mesma filosofia do
 * config/rm.php da API PHP: env real tem precedência, defaults seguros).
 *
 * Em produção (NODE_ENV=production) MCP_PUBLIC_URL, MCP_OAUTH_SIGNING_KEY e
 * MCP_ACCESS_PASSWORD são obrigatórias — sem elas o boot aborta, para evitar
 * subir um servidor de gestão do TOTVS aberto por esquecimento (mesma postura
 * do API_KEY obrigatório da API PHP).
 */

import crypto from 'node:crypto';

export interface Config {
    port: number;
    /** URL pública (issuer OAuth e base dos metadados). Sem barra final. */
    publicUrl: string;
    /** Base da API REST api-totvs (ex.: https://api-totvs.fmp.edu.br). Sem barra final. */
    apiBaseUrl: string;
    /** Chave enviada no header X-API-Key para a API REST. */
    apiKey: string;
    /** Timeout das chamadas à API REST (processos do RM podem ser lentos). */
    apiTimeoutMs: number;
    /** Segredo HS256 dos JWTs (códigos, access e refresh tokens). */
    signingKey: string;
    /** Senha pedida na tela de autorização OAuth. */
    accessPassword: string;
    /** Tokens estáticos aceitos como Bearer (para clientes headless, ex.: OpenClaw). */
    staticTokens: string[];
    accessTokenTtl: number;
    refreshTokenTtl: number;
    /** Origens CORS permitidas ("*" = aberto). */
    corsOrigins: string[];
    /** Diretório de dados (clients OAuth registrados). */
    dataDir: string;
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
        // Dev local: gera valores efêmeros para permitir experimentar.
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

    return {
        port,
        publicUrl,
        apiBaseUrl: stripSlash(env('TOTVS_API_BASE_URL', 'https://api-totvs.fmp.edu.br')),
        apiKey: env('TOTVS_API_KEY'),
        apiTimeoutMs: Number(env('TOTVS_API_TIMEOUT_MS', '300000')),
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
    };
}
