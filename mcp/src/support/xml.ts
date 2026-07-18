/**
 * Utilidades XML compartilhadas.
 *
 * escapeXml espelha htmlspecialchars($v, ENT_XML1) do PHP (só & < >);
 * escapeXmlQuotes espelha ENT_XML1 | ENT_QUOTES (também " e ').
 */

export function escapeXml(value: string | number): string {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function escapeXmlQuotes(value: string | number): string {
    return escapeXml(value).replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/** Decodifica as entidades básicas de um texto XML. */
export function decodeXmlEntities(value: string): string {
    return value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/&amp;/g, '&');
}

/** GUID v4 (mesmo formato do ProcessXml::guid() do PHP). */
export function guid(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function pad(n: number): string {
    return String(n).padStart(2, '0');
}

/** date('Y-m-d') do PHP (fuso local). */
export function dataHoje(d = new Date()): string {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** date('Y-m-d').'T'.date('H:i:s') — usado como DataMatricula nos processos. */
export function agoraIso(d = new Date()): string {
    return `${dataHoje(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** date('Y-m-d\TH:i:s.0000000P') — ScheduleDateTime dos processos. */
export function scheduleDateTime(d = new Date()): string {
    const offsetMin = -d.getTimezoneOffset();
    const sinal = offsetMin >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMin);
    return `${agoraIso(d)}.0000000${sinal}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** date('m/Y') — competência (mês corrente) dos processos. */
export function competencia(d = new Date()): string {
    return `${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
