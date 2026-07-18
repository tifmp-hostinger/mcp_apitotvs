/**
 * MCP TOTVS FMP — servidor MCP (Streamable HTTP) + OAuth 2.1.
 *
 * Ponte conversacional para a API REST api-totvs (www/api), que por sua vez
 * fala SOAP com o TOTVS RM:
 *
 *   cliente MCP (OpenClaw, Claude...) ──HTTP/OAuth──▶ este servidor ──X-API-Key──▶ api-totvs ──SOAP──▶ RM
 *
 * Endpoints:
 *   POST /mcp                       — transporte MCP Streamable HTTP (Bearer obrigatório)
 *   /.well-known/*                  — metadados OAuth (RFC 8414 + RFC 9728)
 *   /authorize /token /register     — servidor de autorização (SDK mcpAuthRouter)
 *   POST /oauth/consent             — envio da senha da tela de autorização
 *   GET  /healthz                   — health check (sem auth)
 *
 * Modo stateless: cada POST /mcp cria servidor+transporte descartáveis e
 * responde JSON puro (enableJsonResponse) — sem sessão, sobrevive a restarts
 * e funciona atrás de qualquer proxy sem sticky session.
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
import { TotvsApiClient } from './api-client.js';
import { registerTotvsTools } from './tools.js';

const cfg = loadConfig();
const provider = new FmpOAuthProvider(cfg);
const api = new TotvsApiClient(cfg.apiBaseUrl, cfg.apiKey, cfg.apiTimeoutMs);

function createMcpServer(): McpServer {
    const server = new McpServer({
        name: 'fmp-totvs-rm',
        title: 'FMP · TOTVS RM (api-totvs)',
        version: '1.0.0',
    }, {
        instructions:
            'Gestão conversacional da integração TOTVS RM da FMP (pessoas, alunos, ' +
            'inscrições, matrículas, cupons e financeiro). As tools devolvem o envelope ' +
            'JSON da API: "sucesso" indica o resultado; em erro, leia "retorno_rm", ' +
            '"etapa" e "etapas_concluidas". Ferramentas de escrita causam efeito real ' +
            'no ERP — confirme com o usuário antes de gravar; financeiro_baixar só ' +
            'executa de verdade com DRY_RUN=false explícito.',
    });
    registerTotvsTools(server, api);
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

/* ---------- OAuth: metadados + /authorize + /token + /register ---------- */

app.use(mcpAuthRouter({
    provider,
    issuerUrl: new URL(cfg.publicUrl),
    resourceServerUrl: new URL(`${cfg.publicUrl}/mcp`),
    resourceName: 'FMP TOTVS RM API',
    scopesSupported: ['totvs'],
}));

app.post('/oauth/consent', (req, res) => provider.handleConsent(req, res));

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
        api_gerenciada: cfg.apiBaseUrl,
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
    console.log(`[mcp]   API TOTVS    : ${cfg.apiBaseUrl}${cfg.apiKey !== '' ? ' (X-API-Key configurada)' : ' (SEM X-API-Key)'}`);
    console.log(`[mcp]   OAuth issuer : ${cfg.publicUrl}`);
    console.log(`[mcp]   tokens estáticos: ${cfg.staticTokens.length}`);
});
