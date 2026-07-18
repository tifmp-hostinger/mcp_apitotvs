/**
 * Log de integração gravado no próprio RM — porte de LogService.php
 * (DataServer custom RMSPRJ5495296Server, tabela ZMDLOGINTEGEDUVEM).
 *
 * Tolerante a falha: erro ao gravar o log NUNCA derruba o fluxo — cai para
 * o console.error.
 */

import type { RMSoapClient } from '../rm/soap-client.js';
import { escapeXml } from '../support/xml.js';

export class LogService {
    constructor(private readonly rm: RMSoapClient) {
    }

    async saveLog(
        email: string,
        entity: string,
        offer: string,
        status: string,
        message: string,
        payload: unknown
    ): Promise<void> {
        const texto = typeof payload === 'string'
            ? payload
            : JSON.stringify(payload, null, 2);

        // Blinda o CDATA contra "]]>" dentro do payload.
        const payloadCdata = String(texto ?? '').replace(/\]\]>/g, ']]]]><![CDATA[>');

        const xml = `<PRJ5495296>
    <ZMDLOGINTEGEDUVEM>
        <ID>0</ID>
        <EMAIL>${escapeXml(email)}</EMAIL>
        <ENTIDADE>${escapeXml(entity)}</ENTIDADE>
        <CODOFERTA>${escapeXml(offer)}</CODOFERTA>
        <STATUS>${escapeXml(status)}</STATUS>
        <MENSAGEM>${escapeXml(message)}</MENSAGEM>
        <XML><![CDATA[${payloadCdata}]]></XML>
    </ZMDLOGINTEGEDUVEM>
</PRJ5495296>`;

        try {
            await this.rm.saveRecord('RMSPRJ5495296Server', xml);
        } catch (e) {
            console.error(
                `[mcp] Falha ao gravar log no RM: ${e instanceof Error ? e.message : e} | ` +
                `log original: [${entity}/${status}] ${message}`
            );
        }
    }
}
