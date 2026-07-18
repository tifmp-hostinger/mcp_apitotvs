/**
 * Cliente SOAP único do TOTVS RM — porte de www/api/src/Clients/RMSoapClient.php.
 *
 * Diferença deliberada em relação ao PHP: NÃO carrega o WSDL (o ext-soap
 * baixava o WSDL gigante do RM só para descobrir contratos fixos e conhecidos).
 * Aqui os envelopes SOAP 1.1 são montados à mão e enviados via fetch com basic
 * auth — mesmos elementos, mesma ordem, mesmo namespace http://www.totvs.com/
 * que o ext-soap gerava. Sem WSDL: sem estouro de memória, sem cache, sem
 * segfault.
 *
 * Nenhuma regra de negócio aqui: apenas transporte + tradução de erros
 * (RMError rica com operacao/dataserver/XMLs/retorno_rm).
 */

import { XMLParser } from 'fast-xml-parser';
import { RMError } from './errors.js';
import { decodeXmlEntities, escapeXml } from '../support/xml.js';

/** Endpoints SOAP expostos pelo RM (ex-enum RMWSType). */
const SERVICES = {
    DataServer: { path: '/wsDataServer/MEX', iface: 'IwsDataServer' },
    Process: { path: '/wsProcess/MEX', iface: 'IwsProcess' },
    Report: { path: '/wsReport/MEX', iface: 'IwsReport' },
    SQLConsult: { path: '/wsConsultaSQL/MEX', iface: 'IwsConsultaSQL' },
} as const;

type ServiceName = keyof typeof SERVICES;

export class RMSoapClient {
    private readonly parser = new XMLParser({
        ignoreAttributes: true,
        parseTagValue: false,   // valores sempre como string (como o simplexml do PHP)
        trimValues: false,
    });

    constructor(
        private readonly baseUrl: string,
        private readonly user: string,
        private readonly password: string,
        private readonly timeoutMs = 300_000
    ) {
    }

    /* =====================================================================
     * Infraestrutura
     * ===================================================================== */

    /** Contexto no formato esperado pelo RM: "CHAVE=VALOR;CHAVE=VALOR". */
    static buildContext(parameters: Record<string, string | number>): string {
        return Object.entries(parameters).map(([k, v]) => `${k}=${v}`).join(';');
    }

    /**
     * Executa a chamada SOAP 1.1: monta o envelope, envia com basic auth e
     * extrai o elemento <{operacao}Result>. Converte QUALQUER falha
     * (rede, HTTP, SoapFault, resposta sem Result) em RMError rica.
     */
    private async call(
        service: ServiceName,
        operation: string,
        params: Record<string, string>,
        dataServer = '',
        contexto: Record<string, string | number> = {},
        xmlEnviado: string | null = null,
        credentials?: { user: string; password: string }
    ): Promise<string> {
        const svc = SERVICES[service];
        const url = this.baseUrl + svc.path;
        const soapAction = `http://www.totvs.com/${svc.iface}/${operation}`;

        const inner = Object.entries(params)
            .map(([tag, value]) => `<${tag}>${escapeXml(value)}</${tag}>`)
            .join('');
        const envelope =
            '<?xml version="1.0" encoding="utf-8"?>' +
            '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>' +
            `<${operation} xmlns="http://www.totvs.com/">${inner}</${operation}>` +
            '</s:Body></s:Envelope>';

        const user = credentials?.user ?? this.user;
        const password = credentials?.password ?? this.password;

        const debug = process.env.APP_DEBUG === 'true';
        if (debug) {
            console.error(`[rm] >> SOAP ${operation} (${dataServer})`);
        }

        let response: Response;
        let bodyText: string;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/xml; charset=utf-8',
                    SOAPAction: `"${soapAction}"`,
                    Authorization: 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64'),
                },
                body: envelope,
                signal: AbortSignal.timeout(this.timeoutMs),
            });
            bodyText = await response.text();
        } catch (e) {
            const motivo = e instanceof Error ? e.message : String(e);
            throw new RMError(
                `Falha ao conectar no endpoint SOAP do RM (${svc.path}): ${motivo}`,
                operation,
                dataServer,
                contexto,
                xmlEnviado ?? envelope,
                null,
                motivo
            );
        }

        // SoapFault (WCF devolve HTTP 500 com <Fault> no corpo)
        const faultstring = bodyText.match(/<(?:\w+:)?faultstring[^>]*>([\s\S]*?)<\/(?:\w+:)?faultstring>/i);
        if (faultstring !== null) {
            const msg = decodeXmlEntities(faultstring[1].trim());
            const faultcode = bodyText.match(/<(?:\w+:)?faultcode[^>]*>([\s\S]*?)<\/(?:\w+:)?faultcode>/i);
            throw new RMError(msg, operation, dataServer, contexto, xmlEnviado ?? envelope, bodyText, msg, {
                faultcode: faultcode?.[1]?.trim(),
                faultstring: msg,
            });
        }

        if (!response.ok) {
            const msg = `HTTP ${response.status} do endpoint SOAP do RM` +
                (response.status === 401 ? ' (credenciais TOTVS_WS_USER/TOTVS_WS_PASSWORD recusadas)' : '');
            throw new RMError(msg, operation, dataServer, contexto, xmlEnviado ?? envelope, bodyText, bodyText.slice(0, 2000));
        }

        // Extrai <{operacao}Result> (com fallback para qualquer *Result, como o
        // executeWithParams do PHP fazia — o nome varia conforme a versão do WSDL).
        const exact = new RegExp(`<(?:\\w+:)?${operation}Result[^>]*>([\\s\\S]*?)</(?:\\w+:)?${operation}Result>`, 'i');
        let m = bodyText.match(exact);
        if (m === null) {
            // Elemento auto-fechado = resultado vazio/nil
            const selfClosed = new RegExp(`<(?:\\w+:)?${operation}Result[^>]*/>`, 'i');
            if (selfClosed.test(bodyText)) {
                return '';
            }
            m = bodyText.match(/<(?:\w+:)?(\w+Result)[^>]*>([\s\S]*?)<\/(?:\w+:)?\1>/i);
            if (m !== null) {
                m = [m[0], m[2]] as RegExpMatchArray;
            }
        }
        if (m === null) {
            throw new RMError(
                `Formato de resposta inesperado do ${operation}`,
                operation,
                dataServer,
                contexto,
                xmlEnviado ?? envelope,
                bodyText,
                bodyText.slice(0, 2000)
            );
        }

        if (debug) {
            console.error(`[rm] >> SOAP ${operation} OK`);
        }

        return decodeXmlEntities(m[1]);
    }

    /**
     * Heurística para detectar retorno de processo que NÃO é sucesso
     * (o wsProcess devolve a mensagem de erro como string "de sucesso").
     */
    private static pareceErroDeProcesso(retorno: string): boolean {
        const r = retorno.trim().toLowerCase();
        const assinaturas = [
            'error', 'exception', 'classe não', 'classe nao', 'não encontrad',
            'nao encontrad', 'not found', 'stack trace', 'nullreference',
            'could not', 'falha ao', 'não foi possível', 'nao foi possivel',
            'system.',
        ];
        return assinaturas.some((sig) => r.includes(sig));
    }

    /** Converte uma string XML do RM em objeto (equivalente ao simplexml→json do PHP). */
    private xmlToObject(xml: string): Record<string, unknown> {
        if (xml.trim() === '') {
            return {};
        }
        try {
            const parsed = this.parser.parse(xml) as Record<string, unknown>;
            // O PHP devolvia o CONTEÚDO do elemento raiz (simplexml_load_string).
            const keys = Object.keys(parsed).filter((k) => k !== '?xml');
            if (keys.length === 1 && typeof parsed[keys[0]] === 'object' && parsed[keys[0]] !== null) {
                return parsed[keys[0]] as Record<string, unknown>;
            }
            return parsed;
        } catch {
            return {};
        }
    }

    /* =====================================================================
     * wsDataServer
     * ===================================================================== */

    async saveRecord(
        dataServerName: string,
        xml: string,
        context: Record<string, string | number> = {}
    ): Promise<string> {
        return this.call(
            'DataServer',
            'SaveRecord',
            {
                DataServerName: dataServerName,
                XML: xml,
                Contexto: RMSoapClient.buildContext(context),
            },
            dataServerName,
            context,
            xml
        );
    }

    async readRecord(
        dataServerName: string,
        primaryKey: Array<string | number>,
        context: Record<string, string | number> = {}
    ): Promise<Record<string, unknown>> {
        const result = await this.call(
            'DataServer',
            'ReadRecord',
            {
                DataServerName: dataServerName,
                PrimaryKey: primaryKey.join(';'),
                Contexto: RMSoapClient.buildContext(context),
            },
            dataServerName,
            context
        );
        return this.xmlToObject(result);
    }

    async readView(
        dataServerName: string,
        filter = '1=1',
        context: Record<string, string | number> = {}
    ): Promise<Record<string, unknown>> {
        const result = await this.call(
            'DataServer',
            'ReadView',
            {
                DataServerName: dataServerName,
                Filtro: filter,
                Contexto: RMSoapClient.buildContext(context),
            },
            dataServerName,
            context
        );
        return this.xmlToObject(result);
    }

    async deleteRecord(
        dataServerName: string,
        xml: string,
        context: Record<string, string | number> = {}
    ): Promise<string> {
        return this.call(
            'DataServer',
            'DeleteRecord',
            {
                DataServerName: dataServerName,
                XML: xml,
                Contexto: RMSoapClient.buildContext(context),
            },
            dataServerName,
            context,
            xml
        );
    }

    /** Retorna o XSD bruto do DataServer. */
    async getSchema(dataServerName: string, context: Record<string, string | number> = {}): Promise<string> {
        return this.call(
            'DataServer',
            'GetSchema',
            {
                DataServerName: dataServerName,
                Contexto: RMSoapClient.buildContext(context),
            },
            dataServerName,
            context
        );
    }

    /** Valida usuário/senha no RM (usa credenciais próprias, não as do serviço). */
    async autenticaAcesso(user: string, password: string): Promise<boolean> {
        const result = await this.call('DataServer', 'AutenticaAcesso', {}, '', {}, null, { user, password });
        return result === '1';
    }

    /* =====================================================================
     * wsConsultaSQL
     * ===================================================================== */

    /** Executa uma sentença SQL cadastrada no RM e devolve as linhas como array. */
    async realizarConsultaSQL(
        codSentenca: string,
        parameters: Record<string, string | number> = {},
        codColigada = '0',
        codSistema = 'G'
    ): Promise<Array<Record<string, unknown>>> {
        const result = await this.call(
            'SQLConsult',
            'RealizarConsultaSQL',
            {
                codSentenca,
                codColigada,
                codSistema,
                parameters: RMSoapClient.buildContext(parameters),
            },
            codSentenca,
            parameters
        );

        const parsed = this.xmlToObject(result);
        const resultado = parsed['Resultado'];
        if (resultado === undefined || resultado === null) {
            return [];
        }

        const rows = Array.isArray(resultado) ? resultado : [resultado];
        return rows.filter(
            (row): row is Record<string, unknown> =>
                typeof row === 'object' && row !== null && Object.keys(row).length > 0
        );
    }

    /* =====================================================================
     * wsProcess
     * ===================================================================== */

    async executeWithXmlParams(processServerName: string, xmlParams: string): Promise<string> {
        const result = await this.call(
            'Process',
            'ExecuteWithXmlParams',
            {
                ProcessServerName: processServerName,
                strXmlParams: xmlParams,
            },
            processServerName,
            {},
            xmlParams
        );

        if (RMSoapClient.pareceErroDeProcesso(result)) {
            throw new RMError(
                'Erro ao executar processo no RM',
                'ExecuteWithXMLParams',
                processServerName,
                {},
                xmlParams,
                null,
                result
            );
        }
        return result;
    }

    /** Operação-irmã do ExecuteWithXmlParams (mesma assinatura). */
    async executeWithParams(processServerName: string, xmlParams: string): Promise<string> {
        const result = await this.call(
            'Process',
            'ExecuteWithParams',
            {
                ProcessServerName: processServerName,
                strXmlParams: xmlParams,
            },
            processServerName,
            {},
            xmlParams
        );

        if (RMSoapClient.pareceErroDeProcesso(result)) {
            throw new RMError(
                'Erro ao executar processo no RM',
                'ExecuteWithParams',
                processServerName,
                {},
                xmlParams,
                null,
                result
            );
        }
        return result;
    }

    /* =====================================================================
     * wsReport
     * ===================================================================== */

    async generateReport(
        codColigada: string,
        id: string,
        filters: string,
        parameters: string,
        fileName = 'report.pdf'
    ): Promise<string> {
        const guid = await this.call(
            'Report',
            'GenerateReport',
            {
                codColigada,
                id,
                filters,
                parameters,
                fileName,
                contexto: '',
            },
            `Relatório ${id}`,
            {},
            parameters
        );

        if (guid.toLowerCase().includes('error')) {
            throw new RMError(
                'Erro ao gerar relatório no RM',
                'GenerateReport',
                `Relatório ${id}`,
                {},
                parameters,
                null,
                guid
            );
        }
        return guid;
    }

    async getGeneratedReportSize(guid: string): Promise<number> {
        const result = await this.call('Report', 'GetGeneratedReportSize', { guid });
        const size = Number(result);
        if (!Number.isInteger(size)) {
            throw new RMError(
                'Formato de resposta inesperado do GetGeneratedReportSize',
                'GetGeneratedReportSize',
                '',
                {},
                null,
                null,
                result
            );
        }
        return size;
    }

    async getFileChunk(guid: string, offset: number, length: number): Promise<string> {
        return this.call('Report', 'GetFileChunk', {
            guid,
            offset: String(offset),
            length: String(length),
        });
    }
}
