/**
 * Exceções de negócio — porte fiel de www/api/src/Exceptions/*.
 *
 * A semântica dos envelopes de erro da API é preservada nas tools:
 *  - RMError         → envelope com operacao, dataserver, retorno_rm (HTTP 502 na API)
 *  - FluxoError      → envelope com etapa, detalhe, etapas_concluidas (422)
 *  - ValidationError → envelope com detalhe (422)
 */

export interface Etapa {
    etapa: string;
    status: string;
    detalhe: string;
}

/** Falha de comunicação/negócio retornada pelo TOTVS RM (ex-RMException). */
export class RMError extends Error {
    constructor(
        message: string,
        public readonly operacao: string = '',
        public readonly dataServer: string = '',
        public readonly contexto: Record<string, string | number> = {},
        public readonly xmlEnviado: string | null = null,
        public readonly xmlRetornado: string | null = null,
        public readonly retornoRm: string | null = null,
        public readonly soapFault: { faultcode?: string; faultstring?: string } | null = null
    ) {
        super(message);
        this.name = 'RMError';
    }

    toEnvelope(debug = false): Record<string, unknown> {
        const out: Record<string, unknown> = {
            operacao: this.operacao,
            dataserver: this.dataServer,
            retorno_rm: this.retornoRm ?? this.message,
        };
        if (debug) {
            out.debug = {
                contexto: this.contexto,
                xml_enviado: this.xmlEnviado,
                xml_retornado: this.xmlRetornado,
                soap_fault: this.soapFault,
            };
        }
        return out;
    }
}

/** Falha de negócio numa etapa de fluxo orquestrado (ex-FluxoException). */
export class FluxoError extends Error {
    public etapasConcluidas: Etapa[] = [];

    constructor(
        public readonly entity: string,
        public readonly userFeedback: string,
        public readonly logMessage: string,
        public readonly payload: unknown,
        public readonly causa: Error | null = null
    ) {
        super(userFeedback);
        this.name = 'FluxoError';
    }

    rmError(): RMError | null {
        return this.causa instanceof RMError ? this.causa : null;
    }
}

/** Falha de validação dos dados de entrada (ex-ValidationException). */
export class ValidationError extends Error {
    public etapasConcluidas: Etapa[] = [];
    public entity = 'Validação dos Dados';

    constructor(
        public readonly userFeedback: string,
        public readonly logMessage: string,
        public readonly payload: unknown
    ) {
        super(userFeedback);
        this.name = 'ValidationError';
    }
}
