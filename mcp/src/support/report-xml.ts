/**
 * XML de parâmetros de relatórios do RM (wsReport / GenerateReport) —
 * porte de www/api/src/Support/ReportXml.php (estrutura idêntica).
 */

import { escapeXmlQuotes } from './xml.js';

export function reportParameters(params: Record<string, string>): string {
    let blocks = '';

    for (const [name, rawValue] of Object.entries(params)) {
        const value = escapeXmlQuotes(rawValue);
        blocks += `
    <RptParameterReportPar>
        <Description>${name}</Description>
        <ParamName>${name}</ParamName>
        <Type xmlns:d3p1="http://schemas.datacontract.org/2004/07/System" xmlns:d3p2="-mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089-System-System.RuntimeType" i:type="d3p2:RuntimeType" xmlns:d3p3="-mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089-System-System.UnitySerializationHolder" z:FactoryType="d3p3:UnitySerializationHolder" xmlns:z="http://schemas.microsoft.com/2003/10/Serialization/">
        <Data xmlns:d4p1="http://www.w3.org/2001/XMLSchema" i:type="d4p1:string" xmlns="">System.String</Data>
        <UnityType xmlns:d4p1="http://www.w3.org/2001/XMLSchema" i:type="d4p1:int" xmlns="">4</UnityType>
        <AssemblyName xmlns:d4p1="http://www.w3.org/2001/XMLSchema" i:type="d4p1:string" xmlns="">mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089</AssemblyName>
        </Type>
        <Value xmlns:d3p1="http://www.w3.org/2001/XMLSchema" i:type="d3p1:string">${value}</Value>
        <Visible>true</Visible>
    </RptParameterReportPar>`;
    }

    return `<?xml version="1.0" encoding="utf-16"?>
    <ArrayOfRptParameterReportPar xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.totvs.com.br/RM/">${blocks}
    </ArrayOfRptParameterReportPar>`;
}
