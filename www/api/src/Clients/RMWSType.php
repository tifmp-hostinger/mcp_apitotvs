<?php

declare(strict_types=1);

namespace FMP\RMApi\Clients;

/**
 * Endpoints SOAP (WSDL) expostos pelo TOTVS RM.
 */
enum RMWSType
{
    case DataServer;
    case Process;
    case Report;
    case SQLConsult;

    // Disponíveis no RM, sem uso atual nas integrações:
    case Message;
    case Educational;
    case Projects;
    case CRM;
    case Concept;
    case Movement;
    case Finance;
    case Health;
    case Incorporation;
    case VisualFormula;
    case TMessage;

    public function getUrlSuffix(): string
    {
        return match ($this) {
            RMWSType::DataServer    => '/wsDataServer/MEX?wsdl',
            RMWSType::Process       => '/wsProcess/MEX?wsdl',
            RMWSType::Report        => '/wsReport/MEX?wsdl',
            RMWSType::SQLConsult    => '/wsConsultaSQL/MEX?wsdl',
            RMWSType::Message       => '/wsTOTVSMessage/MEX?wsdl',
            RMWSType::Educational   => '/wsEdu/MEX?wsdl',
            RMWSType::Projects      => '/wsPrj/MEX?wsdl',
            RMWSType::CRM           => '/wsCRMAtendimento/MEX?wsdl',
            RMWSType::Concept       => '/wsConceito/MEX?wsdl',
            RMWSType::Movement      => '/wsMov/MEX?wsdl',
            RMWSType::Finance       => '/wsFin/MEX?wsdl',
            RMWSType::Health        => '/wsSau/MEX?wsdl',
            RMWSType::Incorporation => '/wsImb/MEX?wsdl',
            RMWSType::VisualFormula => '/wsFormulaVisual/MEX?wsdl',
            RMWSType::TMessage      => '/EAIService/MEX?wsdl',
        };
    }
}
