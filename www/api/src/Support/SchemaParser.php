<?php

declare(strict_types=1);

namespace FMP\RMApi\Support;

class SchemaParser
{
    private const NS_XS = 'http://www.w3.org/2001/XMLSchema';

    private \DOMXPath $xp;

    /**
     * Analisa o XSD e devolve a estrutura no formato público exigido.
     */
    public function parse(string $xmlString): array
    {
        $dom = new \DOMDocument();
        $dom->loadXML($xmlString, LIBXML_NOWARNING | LIBXML_NOERROR);

        $this->xp = new \DOMXPath($dom);
        $this->xp->registerNamespace('xs', self::NS_XS);
        $this->xp->registerNamespace('ms', 'urn:schemas-microsoft-com:xml-msdata');

        // 1) Tabelas e campos
        $tables = $this->parseTables();

        // 2) Constraints (primary / unique)
        $this->applyUniqueAndPrimaryKeys($tables);

        // 3) Relacionamentos (keyref -> FK)
        $relations = $this->parseKeyRefs($tables);

        // 4) Ajusta estrutura para o formato de saída
        $this->normalizeTablesForOutput($tables);

        return [
            'TABELAS' => $tables,
            'RELACOES' => $relations,
        ];
    }

    /**
     * Converte "fields" → "CAMPOS", remove metadados internos e garante chaves.
     */
    private function normalizeTablesForOutput(array &$tables): void
    {
        foreach ($tables as &$tbl) {
            // Renomeia "fields" → "CAMPOS"
            $tbl['CAMPOS'] = $tbl['fields'] ?? [];
            unset($tbl['fields']);

            // Remove metadados internos
            unset($tbl['constraints']);

            // Limpa atributo CHAVE quando não é PK
            foreach ($tbl['CAMPOS'] as &$field) {
                if (isset($field['CHAVE']) && $field['CHAVE'] === false) {
                    unset($field['CHAVE']);
                }
            }
            unset($field);

            // Garante estrutura de restrições sempre presente
            $tbl['RESTRICOES']['PRIMARIA'] = $tbl['RESTRICOES']['PRIMARIA'] ?? [];
            $tbl['RESTRICOES']['UNICA']    = $tbl['RESTRICOES']['UNICA']    ?? [];
        }
        unset($tbl);
    }

    /* ----------  Tabelas & Campos  ---------- */

    private function parseTables(): array
    {
        $tables = [];

        // Todos elementos imediatos dentro de xs:choice são tabelas
        $tableNodes = $this->xp->query('//xs:element/xs:complexType/xs:choice/xs:element');
        /** @var \DOMElement $tableNode */
        foreach ($tableNodes as $tableNode) {
            $tableName = $tableNode->getAttribute('name');
            $tableName = strtoupper($tableName);
            $tables[$tableName] = [
                'fields'      => [],
                'constraints' => [],
                'RESTRICOES'  => [
                    'PRIMARIA' => [],
                    'UNICA'    => [],
                ],
            ];
            

            // Campos = xs:sequence/xs:element
            foreach ($this->xp->query('.//xs:sequence/xs:element', $tableNode) as $fieldNode) {
                $field = $this->parseField($fieldNode);
                $tables[$tableName]['fields'][] = $field;
            }
        }
        return $tables;
    }

    private function parseField(\DOMElement $fieldNode): array
    {
        // 1. Nome
        $name = $fieldNode->getAttribute('name');

        // 2. Tipo
        $type = $fieldNode->getAttribute('type');
        if ($type === '') {
            $rest = $this->xp->query('./xs:simpleType/xs:restriction', $fieldNode)->item(0);
            if ($rest instanceof \DOMElement) {
                $type = $rest->getAttribute('base');
            }
        }
        if ($type && str_contains($type, ':')) {
            [, $type] = explode(':', $type, 2);
        }

        // 3. Default
        $defaultAttr = $fieldNode->getAttribute('default');
        $default = $defaultAttr !== '' ? $defaultAttr : null;

        // 4. Caption / descrição
        $caption = $fieldNode->getAttributeNS('urn:schemas-microsoft-com:xml-msdata', 'Caption') ?: null;

        // 5. Restrições
        $restrictions = [];
        $restNode = $this->xp->query('./xs:simpleType/xs:restriction', $fieldNode)->item(0);
        if ($restNode) {
            foreach ($restNode->childNodes as $child) {
                if ($child instanceof \DOMElement) {
                    switch ($child->localName) {
                        case 'maxLength':
                            $restrictions['maxLength'] = (int) $child->getAttribute('value');
                            break;
                        case 'enumeration':
                            $restrictions['enum'][] = $child->getAttribute('value');
                            break;
                    }
                }
            }
        }

        return [
            'NOME'       => $name,
            'TIPO'       => $type,
            'PADRAO'     => $default,
            'DESCRICAO'  => $caption,
            'RESTRICOES' => $restrictions,
            'CHAVE'      => false,
        ];
    }

    /* ----------  Uniques & Primary Keys  ---------- */

    private function applyUniqueAndPrimaryKeys(array &$tables): void
    {
        foreach ($this->xp->query('//xs:unique') as $uniq) {
            /** @var \DOMElement $uniq */
            $selector = $uniq->getElementsByTagName('selector')->item(0)->getAttribute('xpath');
            if (!preg_match('#\\.//(\\w+)#', $selector, $m)) {
                continue;
            }

            $tableName = strtoupper($m[1]);
            $fields = [];
            foreach ($uniq->getElementsByTagName('field') as $f) {
                $fields[] = $f->getAttribute('xpath');
            }

            $isPrimary = $uniq->getAttributeNS('urn:schemas-microsoft-com:xml-msdata', 'PrimaryKey') === 'true';

            $keyName = $uniq->getAttribute('name');
            $type    = $isPrimary ? 'primary' : 'unique';

            // Estrutura interna (necessária para resolver keyrefs depois)
            $tables[$tableName]['constraints'][$type][$keyName] = $fields;

            // Estrutura pública
            if ($isPrimary) {
                $tables[$tableName]['RESTRICOES']['PRIMARIA'][] = $fields;
            } else {
                $tables[$tableName]['RESTRICOES']['UNICA'][] = $fields;
            }

            // Marca campo como CHAVE
            if ($isPrimary) {
                foreach ($fields as $fname) {
                    foreach ($tables[$tableName]['fields'] as &$fInfo) {
                        if ($fInfo['NOME'] === $fname) {
                            $fInfo['CHAVE'] = true;
                        }
                    }
                    unset($fInfo);
                }
            }
        }
    }

    /* ----------  Relacionamentos (FK)  ---------- */

    private function parseKeyRefs(array $tables): array
    {
        $relations = [];

        foreach ($this->xp->query('//xs:keyref') as $keyref) {
            /** @var \DOMElement $keyref */
            $refer = $keyref->getAttribute('refer');
            $selNode = $keyref->getElementsByTagName('selector')->item(0);
            $fromTable = $this->tableNameFromSelector($selNode->getAttribute('xpath'));

            $fromFields = $this->fieldsFromKey($keyref);
            $toInfo = $this->findUniqueByName($refer, $tables);

            if ($toInfo) {
                $relations[] = [
                    'DETABELA'   => $fromTable,
                    'DECAMPO'    => $fromFields,
                    'PARATABELA' => $toInfo['table'],
                    'PARACAMPO'  => $toInfo['fields'],
                ];
            }
        }
        return $relations;
    }

    private function tableNameFromSelector(string $selector): string
    {
        return preg_replace('#^\\.//(\\w+).*#', '$1', $selector);
    }

    private function fieldsFromKey(\DOMElement $keyLike): array
    {
        $fields = [];
        foreach ($keyLike->getElementsByTagName('field') as $f) {
            $fields[] = $f->getAttribute('xpath');
        }
        return $fields;
    }

    private function findUniqueByName(string $uniqueName, array $tables): ?array
    {
        foreach ($tables as $tName => $t) {
            if (isset($t['constraints']['primary'][$uniqueName])) {
                return ['table' => $tName, 'fields' => $t['constraints']['primary'][$uniqueName]];
            }
            if (isset($t['constraints']['unique'][$uniqueName])) {
                return ['table' => $tName, 'fields' => $t['constraints']['unique'][$uniqueName]];
            }
        }
        return null;
    }
}
