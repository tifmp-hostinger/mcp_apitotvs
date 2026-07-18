/**
 * Servidor de autorização OAuth 2.1 embutido (Authorization Server = Resource
 * Server), no formato que o mcpAuthRouter do SDK espera:
 *
 *  - Dynamic Client Registration (RFC 7591) aberta — clientes MCP (Claude,
 *    OpenClaw/mcporter, MCP Inspector...) se registram sozinhos;
 *  - /authorize protegido por senha única de operador (MCP_ACCESS_PASSWORD),
 *    com PKCE S256 obrigatório (validado pelo router do SDK);
 *  - tokens JWT HS256 auto-contidos (access 1h, refresh 30d com rotação) —
 *    um restart do container NÃO derruba sessões;
 *  - fallback opcional de tokens estáticos (MCP_STATIC_BEARER_TOKENS) para
 *    clientes headless onde o fluxo de navegador é inviável.
 *
 * Registro de clients persiste em JSON (MCP_DATA_DIR/clients.json); se o
 * arquivo se perder, o cliente apenas se registra de novo no próximo 401.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
    OAuthClientInformationFull,
    OAuthTokenRevocationRequest,
    OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { Config } from './config.js';
import { signJwt, verifyJwt, safeEquals } from './jwt.js';

/* ---------- Store de clients (JSON em disco, cache em memória) ---------- */

class FileClientsStore implements OAuthRegisteredClientsStore {
    private clients = new Map<string, OAuthClientInformationFull>();
    private readonly file: string;
    /** Client pré-configurado por env (sempre válido, sem DCR). */
    private readonly staticClient: OAuthClientInformationFull | null;

    constructor(dataDir: string, staticClientId: string, staticRedirectUris: string[]) {
        this.file = path.join(dataDir, 'clients.json');
        try {
            const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as OAuthClientInformationFull[];
            for (const c of raw) {
                this.clients.set(c.client_id, c);
            }
        } catch {
            // primeiro boot / arquivo ausente: começa vazio
        }

        this.staticClient = staticClientId !== ''
            ? {
                client_id: staticClientId,
                client_name: 'Cliente pré-configurado (MCP_OAUTH_CLIENT_ID)',
                redirect_uris: staticRedirectUris,
                grant_types: ['authorization_code', 'refresh_token'],
                response_types: ['code'],
                token_endpoint_auth_method: 'none',   // client público (PKCE)
                client_id_issued_at: Math.floor(Date.now() / 1000),
            }
            : null;
    }

    getClient(clientId: string): OAuthClientInformationFull | undefined {
        if (this.staticClient !== null && clientId === this.staticClient.client_id) {
            return this.staticClient;
        }
        return this.clients.get(clientId);
    }

    registerClient(
        client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>
    ): OAuthClientInformationFull {
        // O handler do SDK já preenche client_id/client_secret antes de chamar;
        // o fallback randomUUID cobre versões que deleguem a geração ao store.
        const full = client as OAuthClientInformationFull;
        if (!full.client_id) {
            full.client_id = crypto.randomUUID();
            full.client_id_issued_at = Math.floor(Date.now() / 1000);
        }
        this.clients.set(full.client_id, full);
        this.persist();
        return full;
    }

    private persist(): void {
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            fs.writeFileSync(this.file, JSON.stringify([...this.clients.values()], null, 2));
        } catch (e) {
            // Perder o arquivo só obriga o cliente a se registrar de novo.
            console.warn('[mcp] aviso: falha ao persistir clients.json:', (e as Error).message);
        }
    }
}

/* ---------- Rate limit simples da senha (por IP) ---------- */

class PasswordRateLimit {
    private attempts = new Map<string, { count: number; resetAt: number }>();

    /** true = bloqueado. 8 tentativas erradas por IP a cada 10 minutos. */
    blocked(ip: string): boolean {
        const now = Date.now();
        const entry = this.attempts.get(ip);
        if (!entry || entry.resetAt < now) {
            return false;
        }
        return entry.count >= 8;
    }

    fail(ip: string): void {
        const now = Date.now();
        const entry = this.attempts.get(ip);
        if (!entry || entry.resetAt < now) {
            this.attempts.set(ip, { count: 1, resetAt: now + 10 * 60_000 });
        } else {
            entry.count++;
        }
    }

    ok(ip: string): void {
        this.attempts.delete(ip);
    }
}

/* ---------- Página de autorização ---------- */

function esc(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c] as string);
}

function consentPage(clientName: string, redirectUri: string, reqToken: string, erro = ''): string {
    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Autorizar acesso — MCP TOTVS FMP</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; display: flex; min-height: 100vh;
         align-items: center; justify-content: center; margin: 0;
         background: #f4f5f7; color: #1c2430; }
  @media (prefers-color-scheme: dark) { body { background: #10151c; color: #e6e9ee; } }
  .card { background: Canvas; border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
          border-radius: 12px; padding: 28px 32px; max-width: 380px; width: 90%;
          box-shadow: 0 8px 30px rgb(0 0 0 / .12); }
  h1 { font-size: 1.05rem; margin: 0 0 4px; }
  .sub { font-size: .8rem; opacity: .65; margin: 0 0 18px; }
  .cli { font-size: .85rem; background: color-mix(in srgb, CanvasText 6%, transparent);
         border-radius: 8px; padding: 10px 12px; margin-bottom: 18px; word-break: break-all; }
  .cli b { display: block; margin-bottom: 2px; }
  label { display: block; font-size: .8rem; margin-bottom: 6px; }
  input[type=password] { width: 100%; box-sizing: border-box; padding: 10px 12px;
         border-radius: 8px; border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
         background: transparent; color: inherit; font-size: 1rem; }
  button { margin-top: 14px; width: 100%; padding: 10px; border: 0; border-radius: 8px;
           background: #14538b; color: #fff; font-size: .95rem; cursor: pointer; }
  button:hover { background: #0f4373; }
  .erro { color: #c0392b; font-size: .8rem; margin: 10px 0 0; }
</style>
</head>
<body>
<form class="card" method="post" action="/oauth/consent" autocomplete="off">
  <h1>FMP &middot; MCP TOTVS RM</h1>
  <p class="sub">Um cliente MCP está pedindo acesso à API de integração com o TOTVS RM.</p>
  <div class="cli">
    <b>${esc(clientName)}</b>
    redireciona para: ${esc(redirectUri)}
  </div>
  <label for="senha">Senha de acesso (MCP_ACCESS_PASSWORD)</label>
  <input id="senha" name="senha" type="password" required autofocus>
  ${erro !== '' ? `<p class="erro">${esc(erro)}</p>` : ''}
  <input type="hidden" name="req" value="${esc(reqToken)}">
  <button type="submit">Autorizar</button>
</form>
</body>
</html>`;
}

/* ---------- Provider ---------- */

interface CodeClaims {
    cid: string;      // client_id
    ru: string;       // redirect_uri
    cc: string;       // code_challenge (S256)
    scope: string;
    aud: string;      // resource (RFC 8707), se informado
}

export class FmpOAuthProvider implements OAuthServerProvider {
    readonly clientsStore: FileClientsStore;
    private readonly rateLimit = new PasswordRateLimit();
    /** jti de códigos já trocados / tokens revogados (best effort, em memória). */
    private readonly usedJtis = new Map<string, number>();

    constructor(private readonly cfg: Config) {
        this.clientsStore = new FileClientsStore(cfg.dataDir, cfg.oauthClientId, cfg.oauthClientRedirectUris);
        setInterval(() => this.gcJtis(), 60_000).unref();
    }

    private gcJtis(): void {
        const now = Math.floor(Date.now() / 1000);
        for (const [jti, exp] of this.usedJtis) {
            if (exp < now) {
                this.usedJtis.delete(jti);
            }
        }
    }

    /* ----- /authorize (GET, após validação do router do SDK) ----- */

    async authorize(
        client: OAuthClientInformationFull,
        params: AuthorizationParams,
        res: Response
    ): Promise<void> {
        // Todos os parâmetros da autorização viajam assinados num JWT curto:
        // o form não pode ser adulterado no caminho de volta.
        const reqToken = signJwt(this.cfg.signingKey, 'authreq', {
            cid: client.client_id,
            ru: params.redirectUri,
            cc: params.codeChallenge,
            scope: (params.scopes ?? ['totvs']).join(' '),
            aud: params.resource?.href ?? '',
            state: params.state ?? '',
        }, 600);

        res.status(200)
            .type('html')
            .send(consentPage(client.client_name ?? client.client_id, params.redirectUri, reqToken));
    }

    /* ----- POST /oauth/consent (rota própria, fora do router do SDK) ----- */

    handleConsent(req: Request, res: Response): void {
        const ip = req.ip ?? 'desconhecido';
        const { senha, req: reqToken } = (req.body ?? {}) as { senha?: string; req?: string };

        const claims = typeof reqToken === 'string'
            ? verifyJwt(this.cfg.signingKey, reqToken, 'authreq')
            : null;

        if (claims === null) {
            res.status(400).type('html').send(
                '<p>Pedido de autorização expirado ou inválido. Volte ao cliente MCP e tente de novo.</p>'
            );
            return;
        }

        if (this.rateLimit.blocked(ip)) {
            res.status(429).type('html').send(
                '<p>Muitas tentativas de senha. Aguarde alguns minutos e tente novamente.</p>'
            );
            return;
        }

        if (typeof senha !== 'string' || !safeEquals(senha, this.cfg.accessPassword)) {
            this.rateLimit.fail(ip);
            console.warn(`[mcp] senha de autorização incorreta (ip ${ip})`);
            res.status(401).type('html').send(consentPage(
                String(claims.cid),
                String(claims.ru),
                reqToken as string,
                'Senha incorreta.'
            ));
            return;
        }

        this.rateLimit.ok(ip);

        const code = signJwt(this.cfg.signingKey, 'code', {
            cid: claims.cid,
            ru: claims.ru,
            cc: claims.cc,
            scope: claims.scope,
            aud: claims.aud,
        }, 600);

        const redirect = new URL(String(claims.ru));
        redirect.searchParams.set('code', code);
        if (claims.state !== '') {
            redirect.searchParams.set('state', String(claims.state));
        }
        console.log(`[mcp] autorização concedida ao client ${String(claims.cid)} (ip ${ip})`);
        res.redirect(302, redirect.href);
    }

    /* ----- PKCE: o router do SDK compara o verifier com este challenge ----- */

    async challengeForAuthorizationCode(
        _client: OAuthClientInformationFull,
        authorizationCode: string
    ): Promise<string> {
        const claims = verifyJwt(this.cfg.signingKey, authorizationCode, 'code');
        if (claims === null) {
            throw new Error('Código de autorização inválido ou expirado');
        }
        return String(claims.cc);
    }

    /* ----- Troca código -> tokens ----- */

    async exchangeAuthorizationCode(
        client: OAuthClientInformationFull,
        authorizationCode: string,
        _codeVerifier?: string,
        redirectUri?: string,
        resource?: URL
    ): Promise<OAuthTokens> {
        const claims = verifyJwt(this.cfg.signingKey, authorizationCode, 'code');
        if (claims === null) {
            throw new Error('Código de autorização inválido ou expirado');
        }
        if (claims.cid !== client.client_id) {
            throw new Error('Código emitido para outro client');
        }
        if (redirectUri !== undefined && redirectUri !== claims.ru) {
            throw new Error('redirect_uri não confere com o da autorização');
        }
        if (this.usedJtis.has(claims.jti)) {
            throw new Error('Código de autorização já utilizado');
        }
        this.usedJtis.set(claims.jti, claims.exp);

        // RFC 8707: o token vale para o resource pedido na AUTORIZAÇÃO.
        const aud = String(claims.aud || resource?.href || '');
        return this.issueTokens(client.client_id, String(claims.scope), aud);
    }

    /* ----- Refresh com rotação (a expiração absoluta é herdada) ----- */

    async exchangeRefreshToken(
        client: OAuthClientInformationFull,
        refreshToken: string,
        scopes?: string[],
        _resource?: URL
    ): Promise<OAuthTokens> {
        const claims = verifyJwt(this.cfg.signingKey, refreshToken, 'refresh');
        if (claims === null) {
            throw new Error('Refresh token inválido ou expirado');
        }
        if (claims.cid !== client.client_id) {
            throw new Error('Refresh token emitido para outro client');
        }
        if (this.usedJtis.has(claims.jti)) {
            throw new Error('Refresh token revogado');
        }

        const scope = scopes && scopes.length > 0 ? scopes.join(' ') : String(claims.scope);
        return this.issueTokens(client.client_id, scope, String(claims.aud ?? ''), claims.exp);
    }

    private issueTokens(clientId: string, scope: string, aud: string, refreshExpCap?: number): OAuthTokens {
        const now = Math.floor(Date.now() / 1000);
        const refreshTtl = refreshExpCap !== undefined
            ? Math.max(60, Math.min(this.cfg.refreshTokenTtl, refreshExpCap - now))
            : this.cfg.refreshTokenTtl;

        return {
            access_token: signJwt(this.cfg.signingKey, 'access', {
                sub: 'operador',
                cid: clientId,
                scope,
                aud,
            }, this.cfg.accessTokenTtl),
            token_type: 'bearer',
            expires_in: this.cfg.accessTokenTtl,
            scope,
            refresh_token: signJwt(this.cfg.signingKey, 'refresh', {
                cid: clientId,
                scope,
                aud,
            }, refreshTtl),
        };
    }

    /* ----- Validação do Bearer no /mcp ----- */

    async verifyAccessToken(token: string): Promise<AuthInfo> {
        // 1) tokens estáticos (clientes headless configurados à mão).
        //    O middleware do SDK exige expiresAt: informamos "agora + 1h",
        //    recalculado a cada verificação — na prática, não expira.
        for (const staticToken of this.cfg.staticTokens) {
            if (safeEquals(token, staticToken)) {
                return {
                    token,
                    clientId: 'static-token',
                    scopes: ['totvs'],
                    expiresAt: Math.floor(Date.now() / 1000) + 3600,
                };
            }
        }

        // 2) access token JWT emitido pelo fluxo OAuth.
        //    InvalidTokenError → 401 com WWW-Authenticate (o cliente MCP
        //    reinicia o fluxo OAuth); um Error genérico viraria 500.
        const claims = verifyJwt(this.cfg.signingKey, token, 'access');
        if (claims === null || this.usedJtis.has(claims.jti)) {
            throw new InvalidTokenError('Access token inválido, expirado ou revogado');
        }

        return {
            token,
            clientId: String(claims.cid),
            scopes: String(claims.scope ?? '').split(' ').filter((s) => s !== ''),
            expiresAt: claims.exp,
        };
    }

    /* ----- Revogação (RFC 7009) — denylist por jti, best effort ----- */

    async revokeToken(
        _client: OAuthClientInformationFull,
        request: OAuthTokenRevocationRequest
    ): Promise<void> {
        for (const typ of ['access', 'refresh']) {
            const claims = verifyJwt(this.cfg.signingKey, request.token, typ);
            if (claims !== null) {
                this.usedJtis.set(claims.jti, claims.exp);
                return;
            }
        }
        // Token inválido/já revogado: RFC manda não fazer nada.
    }
}
