/**
 * Parser do XSD dos DataServers (GetSchema) — porte de Support/SchemaParser.php.
 * Mesma estrutura de saída: { TABELAS: {...}, RELACOES: [...] }.
 */

import { XMLParser } from 'fast-xml-parser';

type Node = Record<string, unknown>;

interface Campo {
    NOME: string;
    TIPO: string | null;
    PADRAO: string | null;
    DESCRICAO: string | null;
    RESTRICOES: Record<string, unknown>;
    CHAVE?: boolean;
}

interface Tabela {
    CAMPOS: Campo[];
    RESTRICOES: { PRIMARIA: string[][]; UNICA: string[][] };
}

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    parseAttributeValue: false,
});

/** Busca filhos pelo nome local (com ou sem prefixo de namespace). */
function children(node: unknown, local: string): Node[] {
    if (typeof node !== 'object' || node === null) {
        return [];
    }
    const out: Node[] = [];
    for (const [key, value] of Object.entries(node as Node)) {
        const name = key.includes(':') ? key.split(':').pop() : key;
        if (name === local && !key.startsWith('@_')) {
            if (Array.isArray(value)) {
                out.push(...(value as Node[]));
            } else if (typeof value === 'object' && value !== null) {
                out.push(value as Node);
            }
        }
    }
    return out;
}

function attr(node: Node, name: string): string {
    for (const [key, value] of Object.entries(node)) {
        if (!key.startsWith('@_')) {
            continue;
        }
        const attrName = key.slice(2);
        const local = attrName.includes(':') ? attrName.split(':').pop() : attrName;
        if (attrName === name || local === name) {
            return String(value);
        }
    }
    return '';
}

function semPrefixo(tipo: string): string {
    return tipo.includes(':') ? tipo.split(':').pop() ?? tipo : tipo;
}

export function parseSchema(xsd: string): { TABELAS: Record<string, Tabela>; RELACOES: unknown[] } {
    const doc = parser.parse(xsd) as Node;
    const schema = children(doc, 'schema')[0] ?? doc;
    const rootElements = children(schema, 'element');

    const tabelas: Record<string, Tabela> = {};
    const constraints: Record<string, Record<string, Record<string, string[]>>> = {};

    /* ---------- Tabelas e campos ---------- */
    for (const root of rootElements) {
        for (const complexType of children(root, 'complexType')) {
            for (const choice of children(complexType, 'choice')) {
                for (const tableNode of children(choice, 'element')) {
                    const tableName = attr(tableNode, 'name').toUpperCase();
                    const campos: Campo[] = [];

                    for (const tct of children(tableNode, 'complexType')) {
                        for (const seq of children(tct, 'sequence')) {
                            for (const fieldNode of children(seq, 'element')) {
                                campos.push(parseField(fieldNode));
                            }
                        }
                    }

                    tabelas[tableName] = {
                        CAMPOS: campos,
                        RESTRICOES: { PRIMARIA: [], UNICA: [] },
                    };
                    constraints[tableName] = { primary: {}, unique: {} };
                }
            }
        }
    }

    /* ---------- Uniques / chaves primárias ---------- */
    for (const root of rootElements) {
        for (const uniq of children(root, 'unique')) {
            const selector = children(uniq, 'selector')[0];
            const xpath = selector !== undefined ? attr(selector, 'xpath') : '';
            const m = xpath.match(/\.\/\/(\w+)/);
            if (m === null) {
                continue;
            }
            const tableName = m[1].toUpperCase();
            if (tabelas[tableName] === undefined) {
                continue;
            }

            const fields = children(uniq, 'field').map((f) => attr(f, 'xpath'));
            const isPrimary = attr(uniq, 'PrimaryKey') === 'true';
            const keyName = attr(uniq, 'name');

            constraints[tableName][isPrimary ? 'primary' : 'unique'][keyName] = fields;

            if (isPrimary) {
                tabelas[tableName].RESTRICOES.PRIMARIA.push(fields);
                for (const fname of fields) {
                    for (const campo of tabelas[tableName].CAMPOS) {
                        if (campo.NOME === fname) {
                            campo.CHAVE = true;
                        }
                    }
                }
            } else {
                tabelas[tableName].RESTRICOES.UNICA.push(fields);
            }
        }
    }

    /* ---------- Relacionamentos (keyref → FK) ---------- */
    const relacoes: unknown[] = [];
    for (const root of rootElements) {
        for (const keyref of children(root, 'keyref')) {
            const refer = semPrefixo(attr(keyref, 'refer'));
            const selector = children(keyref, 'selector')[0];
            const fromXpath = selector !== undefined ? attr(selector, 'xpath') : '';
            const fromTable = fromXpath.replace(/^\.\/\/(\w+).*/, '$1');
            const fromFields = children(keyref, 'field').map((f) => attr(f, 'xpath'));

            let toInfo: { table: string; fields: string[] } | null = null;
            for (const [tName, c] of Object.entries(constraints)) {
                if (c.primary[refer] !== undefined) {
                    toInfo = { table: tName, fields: c.primary[refer] };
                    break;
                }
                if (c.unique[refer] !== undefined) {
                    toInfo = { table: tName, fields: c.unique[refer] };
                    break;
                }
            }

            if (toInfo !== null) {
                relacoes.push({
                    DETABELA: fromTable,
                    DECAMPO: fromFields,
                    PARATABELA: toInfo.table,
                    PARACAMPO: toInfo.fields,
                });
            }
        }
    }

    /* ---------- CHAVE=false não aparece na saída (como no PHP) ---------- */
    for (const tabela of Object.values(tabelas)) {
        for (const campo of tabela.CAMPOS) {
            if (campo.CHAVE === false || campo.CHAVE === undefined) {
                delete campo.CHAVE;
            }
        }
    }

    return { TABELAS: tabelas, RELACOES: relacoes };
}

function parseField(fieldNode: Node): Campo {
    const name = attr(fieldNode, 'name');

    let type = attr(fieldNode, 'type');
    const simpleType = children(fieldNode, 'simpleType')[0];
    const restriction = simpleType !== undefined ? children(simpleType, 'restriction')[0] : undefined;
    if (type === '' && restriction !== undefined) {
        type = attr(restriction, 'base');
    }
    if (type !== '') {
        type = semPrefixo(type);
    }

    const defaultAttr = attr(fieldNode, 'default');
    const caption = attr(fieldNode, 'Caption');

    const restricoes: Record<string, unknown> = {};
    if (restriction !== undefined) {
        const maxLength = children(restriction, 'maxLength')[0];
        if (maxLength !== undefined) {
            restricoes.maxLength = Number(attr(maxLength, 'value'));
        }
        const enums = children(restriction, 'enumeration').map((e) => attr(e, 'value'));
        if (enums.length > 0) {
            restricoes.enum = enums;
        }
    }

    return {
        NOME: name,
        TIPO: type !== '' ? type : null,
        PADRAO: defaultAttr !== '' ? defaultAttr : null,
        DESCRICAO: caption !== '' ? caption : null,
        RESTRICOES: restricoes,
        CHAVE: false,
    };
}
