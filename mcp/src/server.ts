/**
 * MCP TOTVS FMP — servidor MCP (Streamable HTTP) + OAuth 2.1.
 *
 * Este servidor É a integração com o TOTVS RM: fala SOAP direto com o ERP
 * (wsDataServer, wsProcess, wsReport, wsConsultaSQL), sem API intermediária.
 *
 *   cliente MCP (OpenClaw, Claude...) ──HTTP/OAuth──▶ este servidor ──SOAP──▶ TOTVS RM
 *
 * Endpoints:
 *   POST /mcp                       — transporte MCP Streamable HTTP (Bearer obrigatório)
 *   /.well-known/*                  — metadados OAuth (RFC 8414 + RFC 9728)
 *   /authorize /token /register     — servidor de autorização (SDK mcpAuthRouter)
 *   POST /oauth/consent             — envio da senha da tela de autorização
 *   GET  /sso/{token}               — auto-login do Portal Educacional (HTML; sem auth)
 *   GET  /healthz                   — health check (sem auth)
 *
 * Modo stateless: cada POST /mcp cria servidor+transporte descartáveis e
 * responde JSON puro — sem sessão, sobrevive a restarts e funciona atrás de
 * qualquer proxy sem sticky session.
 */

import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
    mcpAuthRouter,
    getOAuthProtectedResourceMetadataUrl,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { loadConfig } from './config.js';
import { FmpOAuthProvider } from './oauth.js';
import { buildServices } from './services/registry.js';
import { registerTotvsTools } from './tools.js';

const cfg = loadConfig();
const provider = new FmpOAuthProvider(cfg);
const services = buildServices(cfg);

function createMcpServer(): McpServer {
    const server = new McpServer({
        name: 'fmp-totvs-rm',
        title: 'FMP · TOTVS RM',
        version: '2.0.0',
    }, {
        instructions:
            'Gestão conversacional do TOTVS RM da FMP via SOAP direto (pessoas, alunos, ' +
            'inscrições, matrículas, cupons e financeiro). As tools devolvem o envelope ' +
            'JSON padrão: "sucesso" indica o resultado; em erro, leia "retorno_rm", ' +
            '"etapa" e "etapas_concluidas". Ferramentas de escrita causam efeito real ' +
            'no ERP — confirme com o usuário antes de gravar; financeiro_baixar só ' +
            'executa de verdade com DRY_RUN=false explícito.',
    });
    registerTotvsTools(server, services, cfg);
    return server;
}

const app = express();
// Um único proxy reverso na frente (EasyPanel/Traefik). `true` seria
// permissivo demais e quebra o rate limit interno do SDK (IP forjável).
app.set('trust proxy', 1);
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: false }));

/* ---------- CORS (clientes MCP em navegador precisam de preflight) ---------- */

app.use((req, res, next) => {
    const origin = req.headers.origin;
    const aberto = cfg.corsOrigins.includes('*');
    if (aberto) {
        res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (origin && cfg.corsOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID, X-Requested-With'
    );
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, WWW-Authenticate');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
    }
    next();
});

/* ---------- Log de diagnóstico das rotas OAuth ----------
 * Ajuda a depurar "não foi possível registrar" do conector: mostra no log do
 * EasyPanel cada passo (descoberta, /register, /authorize, /token) e o status.
 */

app.use((req, res, next) => {
    if (/^\/(register|authorize|token|revoke|\.well-known)/.test(req.path)) {
        res.on('finish', () => {
            console.log(`[mcp:oauth] ${req.method} ${req.path} -> ${res.statusCode}`);
        });
    }
    next();
});

/* ---------- OAuth: metadados + /authorize + /token + /register ----------
 * rateLimit:false — o rate-limit por IP do SDK erra o IP atrás de proxy
 * (X-Forwarded-For) e pode derrubar o DCR; a tela de senha tem limitador
 * próprio (PasswordRateLimit). Reative com MCP_OAUTH_RATE_LIMIT=on.
 */

const semRateLimit = cfg.disableOauthRateLimit ? { rateLimit: false as const } : {};

app.use(mcpAuthRouter({
    provider,
    issuerUrl: new URL(cfg.publicUrl),
    resourceServerUrl: new URL(`${cfg.publicUrl}/mcp`),
    resourceName: 'FMP TOTVS RM',
    scopesSupported: ['totvs'],
    authorizationOptions: { ...semRateLimit },
    tokenOptions: { ...semRateLimit },
    clientRegistrationOptions: { ...semRateLimit },
    revocationOptions: { ...semRateLimit },
}));

app.post('/oauth/consent', (req, res) => provider.handleConsent(req, res));

/* ---------- SSO do Portal Educacional (exceção HTML — porte do SSOController) ----------
 * Consumida pelo navegador do ALUNO (redirect do fluxo de inscrição/aluno),
 * por isso fica fora da autenticação MCP — como na API PHP, a segurança é o
 * próprio token AES-256-GCM (expira junto com a senha padrão).
 */

app.get('/sso/:token', (req, res) => {
    let user: string;
    let password: string;
    try {
        const raw = services.crypto.decrypt(req.params.token);
        [user, password] = raw.split('$_$', 2) as [string, string];
        if (user === undefined || password === undefined) {
            throw new Error('token malformado');
        }
    } catch {
        res.status(400).type('html').send('<p>Link de acesso inválido ou expirado.</p>');
        return;
    }

    const esc = (v: string): string => v
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

    res.type('html').send(`<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Redirecionando...</title>
</head>
<body>
    <p>Aguarde... Você está sendo redirecionado.</p>
    <form id="form-autologin" action="${esc(cfg.rm.portal.autologinUrl)}" method="post" style="display:none">
        <input type="hidden" name="User" value="${esc(user)}" />
        <input type="hidden" name="Pass" value="${esc(password)}" />
        <input type="hidden" name="Alias" value="${esc(cfg.rm.portal.alias)}" />
    </form>
    <script>document.getElementById('form-autologin').submit();</script>
</body>
</html>`);
});

/* ---------- Infra ---------- */

app.get('/healthz', (_req, res) => {
    res.json({ ok: true, servico: 'mcp-apitotvs' });
});

app.get('/', (_req, res) => {
    res.json({
        servico: 'FMP · MCP TOTVS RM',
        transporte: 'MCP Streamable HTTP',
        endpoint_mcp: `${cfg.publicUrl}/mcp`,
        autenticacao: 'OAuth 2.1 (descoberta automática via /.well-known/oauth-protected-resource/mcp) ou Bearer estático',
        integracao: `SOAP direto com o TOTVS RM (${cfg.rm.wsUrl !== '' ? cfg.rm.wsUrl : 'TOTVS_WS_URL não configurada'})`,
    });
});

/* ---------- Endpoint MCP (Bearer obrigatório) ---------- */

const bearer = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(`${cfg.publicUrl}/mcp`)),
});

app.post('/mcp', bearer, async (req, res) => {
    try {
        const server = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,   // stateless
            enableJsonResponse: true,        // resposta JSON direta (sem SSE)
        });
        res.on('close', () => {
            transport.close();
            server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    } catch (e) {
        console.error('[mcp] erro no /mcp:', e);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: { code: -32603, message: 'Erro interno no servidor MCP' },
                id: null,
            });
        }
    }
});

// Sem sessão/stream persistente: GET (SSE) e DELETE não se aplicam.
app.all('/mcp', bearer, (_req, res) => {
    res.status(405).set('Allow', 'POST').json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Método não permitido: use POST (transporte stateless).' },
        id: null,
    });
});

app.use((_req, res) => {
    res.status(404).json({ sucesso: false, mensagem: 'Rota não encontrada.' });
});

app.listen(cfg.port, () => {
    console.log(`[mcp] MCP TOTVS FMP no ar na porta ${cfg.port}`);
    console.log(`[mcp]   endpoint MCP : ${cfg.publicUrl}/mcp`);
    console.log(`[mcp]   TOTVS RM     : ${cfg.rm.wsUrl !== '' ? cfg.rm.wsUrl : '(TOTVS_WS_URL NÃO CONFIGURADA)'} (SOAP direto)`);
    console.log(`[mcp]   OAuth issuer : ${cfg.publicUrl}`);
    console.log(`[mcp]   tokens estáticos: ${cfg.staticTokens.length}`);
    console.log(`[mcp]   OAuth rate-limit do SDK: ${cfg.disableOauthRateLimit ? 'DESLIGADO' : 'ligado'}`);
    if (cfg.oauthClientId !== '') {
        console.log(`[mcp]   OAuth Client ID pré-configurado: ${cfg.oauthClientId}`);
        console.log(`[mcp]     redirect_uris aceitas: ${cfg.oauthClientRedirectUris.join(', ')}`);
    }
});
