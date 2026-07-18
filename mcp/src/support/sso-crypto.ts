/**
 * Criptografia AES-256-GCM dos tokens de SSO — porte de Helpers/Crypto.php.
 * Formato do payload: base64url(iv[12] + tag[16] + ciphertext), compatível
 * com os tokens gerados pela API PHP (mesma chave = tokens intercambiáveis).
 */

import crypto from 'node:crypto';

const IV_LENGTH = 12;   // openssl_cipher_iv_length('aes-256-gcm')
const TAG_LENGTH = 16;

export class SsoCrypto {
    constructor(private readonly key: string) {
    }

    private ensureKey(): Buffer {
        const key = Buffer.from(this.key, 'utf8');
        if (key.length !== 32) {
            throw new Error('A chave (APP_CRYPTO_KEY) deve ter exatamente 32 bytes.');
        }
        return key;
    }

    encrypt(plaintext: string): string {
        const key = this.ensureKey();
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return Buffer.concat([iv, tag, encrypted]).toString('base64url');
    }

    decrypt(encoded: string): string {
        const key = this.ensureKey();
        const data = Buffer.from(encoded, 'base64url');
        if (data.length < IV_LENGTH + TAG_LENGTH) {
            throw new Error('Payload muito curto.');
        }
        const iv = data.subarray(0, IV_LENGTH);
        const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
        const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        try {
            return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
        } catch {
            throw new Error('Falha na autenticação ou dados corrompidos.');
        }
    }
}
