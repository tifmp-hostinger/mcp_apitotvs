/**
 * Funcionalidades genéricas do RM (sem regra de negócio) — porte de
 * RMService.php: schema, teste de conexão, leitura/gravação genérica e SQL.
 */

import type { RMSoapClient } from '../rm/soap-client.js';
import { parseSchema } from '../support/schema-parser.js';
import { SQL_STATUS } from './consulta.js';

export class RMService {
    constructor(private readonly rm: RMSoapClient) {
    }

    /** Valida conectividade + credenciais executando a sentença de status. */
    async testConnection(): Promise<Record<string, unknown>> {
        const rows = await this.rm.realizarConsultaSQL(SQL_STATUS);
        return rows[0] ?? { OK: true };
    }

    /** Schema do DataServer. raw=true devolve o XSD original. */
    async getSchema(
        dataServerName: string,
        context: Record<string, string | number> = {},
        raw = false
    ): Promise<unknown> {
        const xsd = await this.rm.getSchema(dataServerName, context);
        return raw ? xsd : parseSchema(xsd);
    }

    readRecord(
        dataServerName: string,
        primaryKey: Array<string | number>,
        context: Record<string, string | number> = {}
    ): Promise<Record<string, unknown>> {
        return this.rm.readRecord(dataServerName, primaryKey, context);
    }

    readView(
        dataServerName: string,
        filter = '1=1',
        context: Record<string, string | number> = {}
    ): Promise<Record<string, unknown>> {
        return this.rm.readView(dataServerName, filter, context);
    }

    saveRecord(
        dataServerName: string,
        xml: string,
        context: Record<string, string | number> = {}
    ): Promise<string> {
        return this.rm.saveRecord(dataServerName, xml, context);
    }

    sql(
        codSentenca: string,
        parameters: Record<string, string | number> = {},
        codColigada = '0',
        codSistema = 'G'
    ): Promise<Array<Record<string, unknown>>> {
        return this.rm.realizarConsultaSQL(codSentenca, parameters, codColigada, codSistema);
    }
}
