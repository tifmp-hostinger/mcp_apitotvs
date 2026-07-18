/**
 * Smoke test ponta a ponta — roda sem rede externa e sem RM real:
 *
 *   1. sobe um MOCK SOAP do TOTVS RM (wsDataServer/wsProcess/wsConsultaSQL),
 *      que confere basic auth + SOAPAction e devolve respostas canônicas;
 *   2. sobe o servidor MCP compilado apontando para o mock;
 *   3. executa o fluxo OAuth 2.1 completo: descoberta (RFC 9728/8414) →
 *      registro dinâmico → /authorize (senha) → /token (PKCE S256) → refresh;
 *   4. fala MCP de verdade: initialize, tools/list, tools/call cobrindo
 *      consulta SQL, SaveRecord, validação, 404, SoapFault e a baixa;
 *   5. confere as travas: 401 sem token, senha errada, código single-use,
 *      DRY_RUN=true por padrão na baixa, token estático, rota /sso.
 *
 * Uso: npm run smoke   (exit != 0 em falha — utilizável em CI)
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const MOCK_PORT = 18098;
const MCP_PORT = 18300;
const BASE = `http://127.0.0.1:${MCP_PORT}`;
const RM_USER = 'integra.teste';
const RM_PASS = 'senha-rm';
const SENHA = 'senha-super-secreta';
const STATIC_TOKEN = 'token-estatico-para-openclaw-1234567890';
const CRYPTO_KEY = '0123456789abcdef0123456789abcdef'; // 32 bytes

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

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ---------- 1. mock SOAP do TOTVS RM ---------- */

const chamadasRm = [];

function soapEnvelope(op, result) {
    return '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>'
        + `<${op}Response xmlns="http://www.totvs.com/"><${op}Result>${esc(result)}</${op}Result></${op}Response>`
        + '</s:Body></s:Envelope>';
}

function linhas(rows) {
    const cols = rows.map((r) => `<Resultado>${Object.entries(r).map(([k, v]) => `<${k}>${esc(String(v))}</${k}>`).join('')}</Resultado>`);
    return `<NewDataSet>${cols.join('')}</NewDataSet>`;
}

const OFERTA_OK = {
    CODCOLIGADA: '1', IDHABILITACAOFILIAL: '333', CODCURSO: 'DIR', CODHABILITACAO: 'H1',
    CODGRADE: 'G1', CODFILIAL: '1', CODTURNO: '3', IDPERLET: '44', CODTURMA: 'T01',
    CODTIPOCURSO: '2', CODPERLET: '2026/1',
};

const mock = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => (corpo += c));
    req.on('end', () => {
        const auth = req.headers.authorization ?? '';
        const soapAction = String(req.headers.soapaction ?? '');
        chamadasRm.push({ url: req.url, auth, soapAction, corpo });

        const authOk = auth === 'Basic ' + Buffer.from(`${RM_USER}:${RM_PASS}`).toString('base64');
        if (!authOk) {
            res.statusCode = 401;
            res.end('Unauthorized');
            return;
        }

        res.setHeader('Content-Type', 'text/xml; charset=utf-8');

        if (req.url === '/wsConsultaSQL/MEX') {
            const sentenca = corpo.match(/<codSentenca>([^<]+)<\/codSentenca>/)?.[1] ?? '';
            const params = corpo.match(/<parameters>([^<]*)<\/parameters>/)?.[1] ?? '';
            let rows = [];
            if (sentenca === 'INT.EDUVEM.00001') {
                rows = [{ OK: '1', MENSAGEM: 'RM no ar (mock)' }];
            } else if (sentenca === 'INT.EDUVEM.00006' && params.includes('OF-EXISTE')) {
                rows = [OFERTA_OK];
            } // demais sentenças: vazio
            res.end(soapEnvelope('RealizarConsultaSQL', linhas(rows)));
            return;
        }

        if (req.url === '/wsDataServer/MEX') {
            const ds = corpo.match(/<DataServerName>([^<]+)<\/DataServerName>/)?.[1] ?? '';
            if (soapAction.includes('SaveRecord')) {
                if (ds === 'FalhaData') {
                    res.statusCode = 500;
                    res.end('<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault>'
                        + '<faultcode>s:Client</faultcode><faultstring>Coluna NOME não permite nulos (mock)</faultstring>'
                        + '</s:Fault></s:Body></s:Envelope>');
                    return;
                }
                res.end(soapEnvelope('SaveRecord', ds === 'RhuPessoaData' ? '12345' : '1;OK'));
                return;
            }
            if (soapAction.includes('ReadRecord')) {
                res.end(soapEnvelope('ReadRecord', '<RhuPessoa><PPessoa><CODIGO>12345</CODIGO><NOME>Fulano Mock</NOME></PPessoa></RhuPessoa>'));
                return;
            }
        }

        if (req.url === '/wsProcess/MEX') {
            res.end(soapEnvelope('ExecuteWithXmlParams', '1'));
            return;
        }

        res.statusCode = 404;
        res.end('rota mock desconhecida: ' + req.url);
    });
});
await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));

/* ---------- 2. servidor MCP ---------- */

const child = spawn(process.execPath, ['dist/server.js'], {
    env: {
        ...process.env,
        PORT: String(MCP_PORT),
        MCP_PUBLIC_URL: BASE,
        TOTVS_WS_URL: `http://127.0.0.1:${MOCK_PORT}`,
        TOTVS_WS_USER: RM_USER,
        TOTVS_WS_PASSWORD: RM_PASS,
        APP_CRYPTO_KEY: CRYPTO_KEY,
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

let idSeq = 0;
const callTool = (token, name, args) => mcpCall(token, {
    jsonrpc: '2.0', id: ++idSeq + 100, method: 'tools/call',
    params: { name, arguments: args },
});
const toolText = (r) => r.body?.result?.content?.[0]?.text ?? '';

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
        (semToken.headers.get('www-authenticate') ?? '').includes('/.well-known/oauth-protected-resource')
    );

    /* ---------- 4. descoberta OAuth + DCR + senha + PKCE + refresh ---------- */

    const prm = await (await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json();
    check('protected resource metadata: resource = /mcp', prm.resource === `${BASE}/mcp`);

    const asMeta = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
    check('AS metadata: PKCE S256 + endpoints', (asMeta.code_challenge_methods_supported ?? []).includes('S256')
        && Boolean(asMeta.authorization_endpoint && asMeta.token_endpoint && asMeta.registration_endpoint));

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
    check('registro dinâmico devolve client_id', typeof reg.client_id === 'string' && reg.client_id.length > 0);

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

    const html = await (await fetch(authUrl)).text();
    const reqToken = html.match(/name="req" value="([^"]+)"/)?.[1];
    check('GET /authorize devolve página de senha assinada', typeof reqToken === 'string');

    const errado = await fetch(`${BASE}/oauth/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ senha: 'senha-errada', req: reqToken }),
        redirect: 'manual',
    });
    check('senha errada devolve 401', errado.status === 401);

    const consent = await fetch(`${BASE}/oauth/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ senha: SENHA, req: reqToken }),
        redirect: 'manual',
    });
    check('senha certa redireciona com code+state', consent.status === 302);
    const loc = new URL(consent.headers.get('location'));
    const code = loc.searchParams.get('code');
    check('state preservado', loc.searchParams.get('state') === 'estado-xyz');

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
    check('token endpoint emite access + refresh', Boolean(tokens.access_token && tokens.refresh_token));

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
    check('refresh token emite novo access', Boolean(refreshed.access_token));

    const tk = tokens.access_token;

    /* ---------- 5. protocolo MCP ---------- */

    const init = await mcpCall(tk, initPayload);
    check('initialize devolve serverInfo', init.body?.result?.serverInfo?.name === 'fmp-totvs-rm');

    const list = await mcpCall(tk, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const nomes = (list.body?.result?.tools ?? []).map((t) => t.name);
    check('tools/list devolve as tools', nomes.length >= 26, `total: ${nomes.length}`);
    for (const esperado of ['totvs_status', 'inscricao_criar', 'financeiro_baixar', 'rm_sql', 'pessoa_salvar', 'aluno_gerar_sso']) {
        check(`tools/list contém ${esperado}`, nomes.includes(esperado));
    }

    /* ---------- 6. tools contra o RM mock (SOAP direto) ---------- */

    const status = await callTool(tk, 'totvs_status', {});
    check('totvs_status executa a sentença 00001 no RM', toolText(status).includes('RM no ar (mock)'));
    check(
        'chamada SOAP com basic auth + SOAPAction corretos',
        chamadasRm.some((c) => c.url === '/wsConsultaSQL/MEX'
            && c.soapAction.includes('IwsConsultaSQL/RealizarConsultaSQL'))
    );

    const sql = await callTool(tk, 'rm_sql', {
        codsentenca: 'INT.EDUVEM.00006',
        parametros: { CODOFERTA_S: 'OF-EXISTE' },
    });
    check('rm_sql devolve linhas da consulta', toolText(sql).includes('IDHABILITACAOFILIAL'));
    check(
        'parâmetros da consulta no formato CHAVE=VALOR',
        chamadasRm.some((c) => c.corpo.includes('<parameters>CODOFERTA_S=OF-EXISTE</parameters>'))
    );

    const pessoa = await callTool(tk, 'pessoa_salvar', {
        campos: { NOME: 'Fulano & Cia', CPF: '529.982.247-25', CEP: '90.000-000' },
    });
    check('pessoa_salvar grava e devolve CODPESSOA (HTTP 201)', toolText(pessoa).startsWith('HTTP 201') && toolText(pessoa).includes('"CODPESSOA": "12345"'));
    const savePessoa = chamadasRm.find((c) => c.corpo.includes('RhuPessoaData'));
    check(
        'XML da pessoa vai escapado e com CPF/CEP normalizados',
        savePessoa !== undefined
            && savePessoa.corpo.includes('Fulano &amp;amp; Cia')   // & do valor escapado no XML interno, reescapado no envelope
            && savePessoa.corpo.includes('&lt;CPF&gt;52998224725&lt;/CPF&gt;')
            && savePessoa.corpo.includes('&lt;CEP&gt;90000000&lt;/CEP&gt;')
    );

    const buscaPessoa = await callTool(tk, 'pessoa_buscar', { codigo: '12345' });
    check('pessoa_buscar por código lê via ReadRecord', toolText(buscaPessoa).includes('Fulano Mock'));

    const cpfInvalido = await callTool(tk, 'pessoa_buscar', { cpf: '123' });
    check('CPF inválido vira 422 com feedback de validação',
        buscaFalhou(cpfInvalido) && toolText(cpfInvalido).includes('não parece correto'));

    const ofertaNaoExiste = await callTool(tk, 'oferta_consultar', { codoferta: 'OF-NAO-EXISTE' });
    check('oferta inexistente devolve 404', toolText(ofertaNaoExiste).startsWith('HTTP 404'));

    const ofertaExiste = await callTool(tk, 'oferta_consultar', { codoferta: 'OF-EXISTE' });
    check('oferta existente devolve os dados', toolText(ofertaExiste).includes('"CODTURMA": "T01"'));

    const fault = await callTool(tk, 'rm_save', { dataserver: 'FalhaData', xml: '<X/>' });
    check('SoapFault do RM vira 502 com retorno_rm',
        toolText(fault).startsWith('HTTP 502') && toolText(fault).includes('não permite nulos'));

    /* ---------- 7. baixa: DRY_RUN default + execução real no mock ---------- */

    const chamadasAntes = chamadasRm.filter((c) => c.url === '/wsProcess/MEX').length;
    const dry = await callTool(tk, 'financeiro_baixar', {
        IDLAN: '555', VALORBAIXA: '465,00', TIPOFORMAPAGTO: 'Pix', CODCXA: '1',
    });
    check('financeiro_baixar é DRY_RUN por padrão (não chama o RM)',
        toolText(dry).includes('"dry_run": true')
        && chamadasRm.filter((c) => c.url === '/wsProcess/MEX').length === chamadasAntes);
    check('dry-run devolve o XML TBC com valor normalizado',
        toolText(dry).includes('FinTBCBaixaDataProcess') && toolText(dry).includes('465.00'));

    const real = await callTool(tk, 'financeiro_baixar', {
        IDLAN: '555', VALORBAIXA: '465,00', TIPOFORMAPAGTO: 'Pix', CODCXA: '1', DRY_RUN: false,
    });
    check('DRY_RUN=false executa o processo no RM (retorno_rm=1)',
        toolText(real).includes('"retorno_rm": "1"')
        && chamadasRm.some((c) => c.url === '/wsProcess/MEX' && c.corpo.includes('FinTBCBaixaDataProcess')));

    /* ---------- 8. /sso + token estático ---------- */

    // Token gerado com a MESMA chave/formato (iv+tag+cipher, base64url)
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(CRYPTO_KEY), iv);
    const enc = Buffer.concat([cipher.update('aluno.teste$_$senha123', 'utf8'), cipher.final()]);
    const ssoToken = Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url');

    const sso = await fetch(`${BASE}/sso/${ssoToken}`);
    const ssoHtml = await sso.text();
    check('GET /sso/{token} devolve form de auto-login',
        sso.status === 200 && ssoHtml.includes('name="User" value="aluno.teste"') && ssoHtml.includes('form-autologin'));

    const ssoInvalido = await fetch(`${BASE}/sso/token-invalido`);
    check('token de SSO inválido devolve 400', ssoInvalido.status === 400);

    const initEstatico = await mcpCall(STATIC_TOKEN, initPayload);
    check('token estático é aceito', initEstatico.status === 200);

    const tokenInvalido = await mcpCall('token-que-nao-existe', initPayload);
    check('token inválido devolve 401', tokenInvalido.status === 401);
} finally {
    child.kill('SIGTERM');
    mock.close();
}

function buscaFalhou(r) {
    return r.body?.result?.isError === true;
}

console.log(`\n== ${okCount} verificações OK, ${failCount} falha(s)`);
process.exit(failCount === 0 ? 0 : 1);
