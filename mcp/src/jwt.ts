/**
 * JWT HS256 mínimo com crypto nativo — sem dependência externa.
 *
 * Usado para códigos de autorização, access tokens e refresh tokens.
 * Auto-contido de propósito: o servidor fica stateless (um restart não
 * invalida tokens já emitidos) e não precisa de banco.
 */

import crypto from 'node:crypto';

export interface JwtPayload {
    /** Tipo do token: authreq | code | access | refresh. */
    typ: string;
    jti: string;
    iat: number;
    exp: number;
    [claim: string]: unknown;
}

function b64url(data: Buffer | string): string {
    return Buffer.from(data).toString('base64url');
}

const HEADER = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

function hmac(key: string, data: string): string {
    return crypto.createHmac('sha256', key).update(data).digest('base64url');
}

export function signJwt(
    key: string,
    typ: string,
    claims: Record<string, unknown>,
    ttlSeconds: number
): string {
    const now = Math.floor(Date.now() / 1000);
    const payload: JwtPayload = {
        ...claims,
        typ,
        jti: crypto.randomUUID(),
        iat: now,
        exp: now + ttlSeconds,
    };
    const body = `${HEADER}.${b64url(JSON.stringify(payload))}`;
    return `${body}.${hmac(key, body)}`;
}

/**
 * Verifica assinatura, expiração e tipo. Retorna null para qualquer token
 * inválido (nunca lança — quem chama decide o erro HTTP adequado).
 */
export function verifyJwt(key: string, token: string, expectedTyp: string): JwtPayload | null {
    const parts = token.split('.');
    if (parts.length !== 3) {
        return null;
    }
    const [header, payload, signature] = parts;

    const expected = hmac(key, `${header}.${payload}`);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return null;
    }

    let decoded: JwtPayload;
    try {
        decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
        return null;
    }

    if (decoded.typ !== expectedTyp) {
        return null;
    }
    if (typeof decoded.exp !== 'number' || decoded.exp < Math.floor(Date.now() / 1000)) {
        return null;
    }
    return decoded;
}

/** Comparação em tempo constante de segredos de tamanhos possivelmente diferentes. */
export function safeEquals(a: string, b: string): boolean {
    const ha = crypto.createHash('sha256').update(a).digest();
    const hb = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(ha, hb);
}
