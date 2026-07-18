/** Utilidades compartilhadas dos services. */

/** Converte um valor de linha de consulta em string ('' para elemento vazio {}). */
export function s(value: unknown): string {
    if (value === undefined || value === null) {
        return '';
    }
    if (typeof value === 'object') {
        return '';   // simplexml: elemento vazio vira objeto/array vazio
    }
    return String(value);
}

/** empty() do PHP para valores de linha de consulta. */
export function vazio(value: unknown): boolean {
    const v = s(value);
    return v === '' || v === '0';
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** filter_var(..., FILTER_VALIDATE_BOOL) do PHP. */
export function toBool(value: unknown): boolean {
    if (typeof value === 'boolean') {
        return value;
    }
    const v = String(value ?? '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

/** number_format($v, 2, '.', '') do PHP. */
export function decimal2(valor: string | number): string {
    const n = typeof valor === 'number' ? valor : Number.parseFloat(valor);
    return (Number.isFinite(n) ? n : 0).toFixed(2);
}

/**
 * Normaliza valor monetário para o formato do RM (ponto decimal, sem milhar):
 * "1.234,56" → "1234.56", "465,00" → "465.00", "465" → "465.00".
 */
export function normalizarDecimal(valor: string): string {
    let v = valor.trim();
    if (v === '') {
        return '0.00';
    }
    if (v.includes(',') && v.includes('.')) {
        v = v.replace(/\./g, '').replace(',', '.');
    } else if (v.includes(',')) {
        v = v.replace(',', '.');
    }
    return decimal2(v);
}
