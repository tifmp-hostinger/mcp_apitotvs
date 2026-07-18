/**
 * Validações de dados de entrada — porte fiel de Helpers/Validation.php
 * (mesmas mensagens de feedback, mesmas regras).
 */

import { ValidationError } from '../rm/errors.js';

export function ensureSexo(value: string): string {
    if (value === 'M' || value === 'F') {
        return value;
    }
    throw new ValidationError(
        'Não encontramos o cadastro para o sexo informado.',
        'Sexo inválido informado.',
        value
    );
}

export function ensureHasValue(arr: unknown, key: string): unknown {
    if (typeof arr === 'object' && arr !== null) {
        const v = (arr as Record<string, unknown>)[key];
        // !empty() do PHP: rejeita undefined, null, '', 0, '0', false
        if (v !== undefined && v !== null && v !== '' && v !== 0 && v !== '0' && v !== false) {
            return v;
        }
    }
    throw new ValidationError(
        `Não encontramos um valor que era esperado: ${key}`,
        `Valor obrigatório não encontrado. Chave do valor esperado: ${key}`,
        arr
    );
}

export function getOnlyNumbers(value: unknown): string {
    return String(value ?? '').replace(/\D/g, '');
}

export function ensureCep(value: string): string {
    const digits = getOnlyNumbers(value);
    if (digits.length !== 8) {
        throw new ValidationError(
            `O CEP informado (${value}) parece incorreto. Por favor revise e tente novamente.`,
            'CEP inválido informado',
            value
        );
    }
    return digits;
}

export function ensureRnm(value: string): string {
    const rnmUpper = value.toUpperCase();
    if (/^[A-Z]\d{6}-\d$/.test(rnmUpper)) {
        return rnmUpper;
    }
    throw new ValidationError(
        `O RNM informado (${value}) não parece correto. Por favor revise e tente novamente.`,
        'RNM inválido informado',
        value
    );
}

export function ensureEmail(value: string): string {
    // Aproximação do FILTER_VALIDATE_EMAIL do PHP.
    if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
        return value;
    }
    throw new ValidationError(
        `O Email informado (${value}) não parece correto. Por favor revise e tente novamente.`,
        'EMAIL inválido informado',
        value
    );
}

export function ensureCpf(value: unknown): string {
    const original = String(value);
    const cpf = original.replace(/\D/g, '');

    const fail = (): never => {
        throw new ValidationError(
            `O CPF informado (${original}) não parece correto. Por favor revise e tente novamente.`,
            'CPF inválido informado',
            original
        );
    };

    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) {
        fail();
    }

    for (let t = 9; t < 11; t++) {
        let sum = 0;
        for (let i = 0; i < t; i++) {
            sum += Number(cpf[i]) * (t + 1 - i);
        }
        let rest = (sum * 10) % 11;
        if (rest === 10) {
            rest = 0;
        }
        if (Number(cpf[t]) !== rest) {
            fail();
        }
    }

    return cpf;
}

export function ensurePastDate(dateInput: string): string {
    let date = dateInput.replace(/^﻿/, '');
    // eslint-disable-next-line no-control-regex
    date = date.replace(/[\x00-\x1F\x7F]/g, '').trim();
    date = date.replace(/[‐‑–—−]/g, '-');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new ValidationError(
            `A data '${date}' não está no formato YYYY-MM-DD.`,
            `Data fora do formato esperado: ${date}`,
            date
        );
    }

    const [y, m, d] = date.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
        throw new ValidationError(`A data '${date}' é inválida.`, `Data inválida: ${date}`, date);
    }

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    if (dt >= hoje) {
        throw new ValidationError(
            `A data '${date}' deve ser anterior à data atual.`,
            `Data não é passada: ${date}`,
            date
        );
    }

    return date;
}

export function ensureDate(value: unknown): string {
    if (typeof value === 'number') {
        const d = new Date(value * 1000);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    if (typeof value !== 'string') {
        throw new ValidationError('A data informada é inválida.', 'Data inválida (tipo não suportado)', value);
    }

    const v = value.trim();

    // d/m/Y (formato BR)
    const br = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (br !== null) {
        return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
    }

    const isValid = (y: number, m: number, d: number): boolean => {
        const dt = new Date(y, m - 1, d);
        return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
    };

    const formatos: Array<[RegExp, (m: RegExpMatchArray) => [number, number, number]]> = [
        [/^(\d{4})-(\d{2})-(\d{2})$/, (m) => [Number(m[1]), Number(m[2]), Number(m[3])]],
        [/^(\d{4})\/(\d{2})\/(\d{2})$/, (m) => [Number(m[1]), Number(m[2]), Number(m[3])]],
        [/^(\d{2})-(\d{2})-(\d{4})$/, (m) => [Number(m[3]), Number(m[2]), Number(m[1])]],
        [/^(\d{2})\.(\d{2})\.(\d{4})$/, (m) => [Number(m[3]), Number(m[2]), Number(m[1])]],
    ];

    for (const [regex, extract] of formatos) {
        const m = v.match(regex);
        if (m !== null) {
            const [y, mo, d] = extract(m);
            if (isValid(y, mo, d)) {
                return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            }
        }
    }

    const parsed = new Date(v);
    if (!Number.isNaN(parsed.getTime())) {
        return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    }

    throw new ValidationError(`A data '${v}' é inválida.`, `Data inválida: ${v}`, v);
}

export function ensureName(value: string): string {
    const normalized = value.normalize('NFC');
    const name = normalized.replace(/\s+/gu, ' ').trim();

    if ([...name].length > 100) {
        throw new ValidationError(
            `O Nome informado (${value}) não parece correto. Por favor revise e tente novamente.`,
            `NOME muito longo informado: ${value}`,
            value
        );
    }

    const parts = name.split(/\s+/u);
    if (parts.length < 2) {
        throw new ValidationError(
            `O Nome informado (${value}) não parece correto. Por favor forneça seu nome completo.`,
            'NOME sem sobrenome informado',
            value
        );
    }

    const regex = /^[\p{L}\p{M}\p{Pd}'’.]+$/u;
    for (const part of parts) {
        if (!regex.test(part)) {
            throw new ValidationError(
                `O Nome informado (${value}) não parece correto. Por favor revise e tente novamente.`,
                'NOME inválido informado',
                value
            );
        }
    }

    return name;
}

const DDDS_VALIDOS = new Set([
    '11', '12', '13', '14', '15', '16', '17', '18', '19',
    '21', '22', '24', '27', '28',
    '31', '32', '33', '34', '35', '37', '38',
    '41', '42', '43', '44', '45', '46', '47', '48', '49',
    '51', '53', '54', '55',
    '61', '62', '63', '64', '65', '66', '67', '68', '69',
    '71', '73', '74', '75', '77', '79',
    '81', '82', '83', '84', '85', '86', '87', '88', '89',
    '91', '92', '93', '94', '95', '96', '97', '98', '99',
]);

export function ensurePhone(input: string): string {
    let value = getOnlyNumbers(input);

    if (value.length === 13 && value.startsWith('55')) {
        value = value.slice(2);
    }

    const m = value.match(/^(\d{2})9\d{8}$/);
    if (m !== null && DDDS_VALIDOS.has(m[1])) {
        return value;
    }

    throw new ValidationError(
        `O Telefone informado (${value}) não parece correto. Por favor revise e tente novamente.`,
        'TELEFONE inválido informado',
        value
    );
}

/** Máscara XXX.XXX.XXX-XX de CPF (porte de Helpers/Format.php). */
export function formatCpf(cpf: string): string {
    const numbers = cpf.replace(/\D/g, '');
    if (numbers.length !== 11) {
        throw new Error('O CPF deve conter exatamente 11 dígitos numéricos.');
    }
    return `${numbers.slice(0, 3)}.${numbers.slice(3, 6)}.${numbers.slice(6, 9)}-${numbers.slice(9)}`;
}
