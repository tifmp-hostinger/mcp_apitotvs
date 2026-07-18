/**
 * Cliente HTTP da API REST api-totvs (www/api).
 *
 * Único ponto de contato com a API — mesmo papel que o RMSoapClient tem na
 * aplicação PHP. Envia X-API-Key, fala JSON e devolve o envelope da API
 * ({ sucesso, mensagem, dados } ou o envelope de erro rico) sem interpretar.
 */

export interface ApiResponse {
    status: number;
    body: unknown;
}

export class TotvsApiClient {
    constructor(
        private readonly baseUrl: string,
        private readonly apiKey: string,
        private readonly timeoutMs: number
    ) {
    }

    async request(
        method: 'GET' | 'POST',
        path: string,
        options: { query?: Record<string, string | undefined>; body?: unknown } = {}
    ): Promise<ApiResponse> {
        const url = new URL(this.baseUrl + path);
        for (const [k, v] of Object.entries(options.query ?? {})) {
            if (v !== undefined && v !== '') {
                url.searchParams.set(k, v);
            }
        }

        const headers: Record<string, string> = { Accept: 'application/json' };
        if (this.apiKey !== '') {
            headers['X-API-Key'] = this.apiKey;
        }
        if (options.body !== undefined) {
            headers['Content-Type'] = 'application/json';
        }

        let response: globalThis.Response;
        try {
            response = await fetch(url, {
                method,
                headers,
                body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        } catch (e) {
            const motivo = e instanceof Error ? e.message : String(e);
            return {
                status: 0,
                body: {
                    sucesso: false,
                    mensagem: `Falha de rede ao chamar a API TOTVS (${url.pathname}): ${motivo}`,
                },
            };
        }

        const text = await response.text();
        let body: unknown;
        try {
            body = JSON.parse(text);
        } catch {
            body = text;
        }
        return { status: response.status, body };
    }

    get(path: string, query?: Record<string, string | undefined>): Promise<ApiResponse> {
        return this.request('GET', path, { query });
    }

    post(path: string, body?: unknown): Promise<ApiResponse> {
        return this.request('POST', path, { body });
    }
}
