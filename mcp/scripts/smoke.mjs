/**
 * Smoke test ponta a ponta — roda sem rede externa e sem RM:
 *
 *   1. sobe uma API mock (papel do api-totvs) que confere o X-API-Key;
 *   2. sobe o servidor MCP compilado (dist/server.js) apontando para a mock;
 *   3. executa o fluxo OAuth 2.1 completo: descoberta (RFC 9728/8414) →
 *      registro dinâmico → /authorize (senha) → /token (PKCE S256) → refresh;
 *   4. fala MCP de verdade: initialize, tools/list, tools/call;
 *   5. confere as travas: 401 sem token, senha errada, código single-use,
 *      DRY_RUN=true por padrão na baixa, token estático.
 *
 * Uso: npm run smoke   (exit != 0 em falha — utilizável em CI)
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const MOCK_PORT = 18099;
const MCP_PORT = 18300;
const BASE = `http://127.0.0.1:${MCP_PORT}`;
const API_KEY = 'chave-teste-api';
const SENHA = 'senha-super-secreta';
const STATIC_TOKEN = 'token-estatico-para-openclaw-1234567890';

let okCount = 0;
let failCount = 0;

function check(nome, cond, extra = '') {
    if (cond) {
        okCount++;
        console.log(`  ok   ${nome}`);
    } else {
        failCount++;
        console.error(`  FALHA ${nome}${extra ? ` — ${extra}` : ''}`);
    }
}

/* ---------- 1. API mock (simula o api-totvs) ---------- */

const chamadasMock = [];
const mock = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => (corpo += c));
    req.on('end', () => {
        const body = corpo ? JSON.parse(corpo) : null;
        chamadasMock.push({ method: req.method, url: req.url, apiKey: req.headers['x-api-key'], body });
        res.setHeader('Content-Type', 'application/json');

        if (req.url === '/status') {
            res.end(JSON.stringify({ sucesso: true, mensagem: 'API no ar', dados: { versao: 'mock' } }));
        } else if (req.url === '/financeiro/baixas') {
            res.end(JSON.stringify({ sucesso: true, mensagem: 'dry-run', dados: { DRY_RUN: body?.DRY_RUN } }));
        } else if (req.url?.startsWith('/pessoas/busca')) {
            res.statusCode = 404;
            res.end(JSON.stringify({ sucesso: false, mensagem: 'Pessoa não encontrada' }));
        } else {
            res.end(JSON.stringify({ sucesso: true, dados: { url: req.url } }));
        }
    });
});
await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));

/* ---------- 2. servidor MCP ---------- */

const child = spawn(process.execPath, ['dist/server.js'], {
    env: {
        ...process.env,
        PORT: String(MCP_PORT),
        MCP_PUBLIC_URL: BASE,
        TOTVS_API_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
        TOTVS_API_KEY: API_KEY,
        MCP_OAUTH_SIGNING_KEY: crypto.randomBytes(32).toString('hex'),
        MCP_ACCESS_PASSWORD: SENHA,
        MCP_STATIC_BEARER_TOKENS: ` ${STATIC_TOKEN} `,
        MCP_DATA_DIR: `${process.env.TMPDIR ?? '/tmp'}/mcp-smoke-${process.pid}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => process.env.SMOKE_VERBOSE && process.stdout.write(`[srv] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[srv:err] ${d}`));

for (let i = 0; ; i++) {
    try {
        const r = await fetch(`${BASE}/healthz`);
        if (r.ok) break;
    } catch { /* ainda subindo */ }
    if (i > 50) throw new Error('servidor MCP não subiu');
    await new Promise((r) => setTimeout(r, 100));
}
console.log('== servidor MCP no ar; iniciando verificações\n');

async function mcpCall(token, payload) {
    const r = await fetch(`${BASE}/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
    });
    let body = null;
    const texto = await r.text();
    try { body = JSON.parse(texto); } catch { body = texto; }
    return { status: r.status, headers: r.headers, body };
}

const initPayload = {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'smoke-test', version: '1.0.0' },
    },
};

try {
    /* ---------- 3. sem token → 401 + resource_metadata ---------- */

    const semToken = await mcpCall(null, initPayload);
    check('POST /mcp sem token devolve 401', semToken.status === 401);
    check(
        'WWW-Authenticate aponta o resource metadata',
        (semToken.headers.get('www-authenticate') ?? '').includes('/.well-known/oauth-protected-resource'),
        semToken.headers.get('www-authenticate') ?? '(ausente)'
    );

    /* ---------- 4. descoberta OAuth ---------- */

    const prm = await (await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json();
    check('protected resource metadata: resource = /mcp', prm.resource === `${BASE}/mcp`, JSON.stringify(prm));
    check('protected resource metadata: authorization_servers', Array.isArray(prm.authorization_servers) && prm.authorization_servers.length > 0);

    const asMeta = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
    check('AS metadata: PKCE S256', (asMeta.code_challenge_methods_supported ?? []).includes('S256'));
    check('AS metadata: endpoints presentes', Boolean(asMeta.authorization_endpoint && asMeta.token_endpoint && asMeta.registration_endpoint));

    /* ---------- 5. registro dinâmico ---------- */

    const redirectUri = 'http://127.0.0.1:19999/callback';
    const reg = await (await fetch(asMeta.registration_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_name: 'Smoke Test',
            redirect_uris: [redirectUri],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
        }),
    })).json();
    check('registro dinâmico devolve client_id', typeof reg.client_id === 'string' && reg.client_id.length > 0, JSON.stringify(reg));

    /* ---------- 6. /authorize + senha ---------- */

    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const authUrl = new URL(asMeta.authorization_endpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', reg.client_id);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', 'estado-xyz');
    authUrl.searchParams.set('resource', `${BASE}/mcp`);

    const authPage = await fetch(authUrl);
    const html = await authPage.text();
    check('GET /authorize devolve página de senha', authPage.status === 200 && html.includes('name="req"'));

    const reqToken = html.match(/name="req" value="([^"]+)"/)?.[1];
    check('página contém o pedido assinado', typeof reqToken === 'string');

    // senha errada
    const errado = await fetch(`${BASE}/oauth/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ senha: 'senha-errada', req: reqToken }),
        redirect: 'manual',
    });
    check('senha errada devolve 401 (re-renderiza)', errado.status === 401);

    // senha certa
    const consent = await fetch(`${BASE}/oauth/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ senha: SENHA, req: reqToken }),
        redirect: 'manual',
    });
    check('senha certa redireciona (302)', consent.status === 302);
    const loc = new URL(consent.headers.get('location'));
    const code = loc.searchParams.get('code');
    check('redirect carrega code + state', Boolean(code) && loc.searchParams.get('state') === 'estado-xyz');

    /* ---------- 7. /token (PKCE) + refresh ---------- */

    const tokenParams = {
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: reg.client_id,
        redirect_uri: redirectUri,
        resource: `${BASE}/mcp`,
    };
    const tokens = await (await fetch(asMeta.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(tokenParams),
    })).json();
    check('token endpoint emite access + refresh', Boolean(tokens.access_token && tokens.refresh_token), JSON.stringify(tokens));

    // código não pode ser reutilizado
    const reuso = await fetch(asMeta.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(tokenParams),
    });
    check('código de autorização é single-use', reuso.status >= 400);

    const refreshed = await (await fetch(asMeta.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: tokens.refresh_token,
            client_id: reg.client_id,
        }),
    })).json();
    check('refresh token emite novo access', Boolean(refreshed.access_token), JSON.stringify(refreshed));

    /* ---------- 8. protocolo MCP com o access token ---------- */

    const init = await mcpCall(tokens.access_token, initPayload);
    check('initialize responde 200', init.status === 200, JSON.stringify(init.body));
    check('initialize devolve serverInfo', init.body?.result?.serverInfo?.name === 'fmp-totvs-rm');

    const list = await mcpCall(tokens.access_token, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const nomes = (list.body?.result?.tools ?? []).map((t) => t.name);
    check('tools/list devolve as tools', nomes.length >= 25, `total: ${nomes.length}`);
    for (const esperado of ['totvs_status', 'inscricao_criar', 'financeiro_baixar', 'rm_sql', 'pessoa_buscar']) {
        check(`tools/list contém ${esperado}`, nomes.includes(esperado));
    }

    const status = await mcpCall(tokens.access_token, {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'totvs_status', arguments: {} },
    });
    const statusTexto = status.body?.result?.content?.[0]?.text ?? '';
    check('tools/call totvs_status chega na API', statusTexto.includes('API no ar'), statusTexto.slice(0, 120));
    check('API mock recebeu o X-API-Key', chamadasMock.some((c) => c.url === '/status' && c.apiKey === API_KEY));

    /* ---------- 9. trava da baixa: DRY_RUN default true ---------- */

    await mcpCall(tokens.access_token, {
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: {
            name: 'financeiro_baixar',
            arguments: { IDLAN: '123', VALORBAIXA: '10.00', TIPOFORMAPAGTO: 'Pix' },
        },
    });
    const baixa = chamadasMock.find((c) => c.url === '/financeiro/baixas');
    check('financeiro_baixar envia DRY_RUN=true por padrão', baixa?.body?.DRY_RUN === true, JSON.stringify(baixa?.body));

    /* ---------- 10. token estático + erro de tool ---------- */

    const initEstatico = await mcpCall(STATIC_TOKEN, initPayload);
    check('token estático é aceito', initEstatico.status === 200);

    const buscaVazia = await mcpCall(STATIC_TOKEN, {
        jsonrpc: '2.0', id: 5, method: 'tools/call',
        params: { name: 'pessoa_buscar', arguments: { cpf: '00000000000' } },
    });
    check('404 da API vira isError na tool', buscaVazia.body?.result?.isError === true);

    const tokenInvalido = await mcpCall('token-que-nao-existe', initPayload);
    check('token inválido devolve 401', tokenInvalido.status === 401);
} finally {
    child.kill('SIGTERM');
    mock.close();
}

console.log(`\n== ${okCount} verificações OK, ${failCount} falha(s)`);
process.exit(failCount === 0 ? 0 : 1);
