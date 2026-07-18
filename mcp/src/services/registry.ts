/**
 * Container de dependências — equivalente ao config/dependencies.php da API:
 * instancia o cliente SOAP e todos os services uma única vez.
 */

import type { Config } from '../config.js';
import { RMSoapClient } from '../rm/soap-client.js';
import { SsoCrypto } from '../support/sso-crypto.js';
import { ConsultaService } from './consulta.js';
import { PessoaService } from './pessoa.js';
import { AlunoService } from './aluno.js';
import { CfoService } from './cfo.js';
import { MatriculaService } from './matricula.js';
import { BolsaService } from './bolsa.js';
import { LancamentoService } from './lancamento.js';
import { BaixaService } from './baixa.js';
import { ContratoService } from './contrato.js';
import { LogService } from './log.js';
import { InscricaoService } from './inscricao.js';
import { RMService } from './rm.js';

export interface Services {
    soap: RMSoapClient;
    crypto: SsoCrypto;
    consulta: ConsultaService;
    pessoa: PessoaService;
    aluno: AlunoService;
    cfo: CfoService;
    matricula: MatriculaService;
    bolsa: BolsaService;
    lancamento: LancamentoService;
    baixa: BaixaService;
    contrato: ContratoService;
    log: LogService;
    inscricao: InscricaoService;
    rm: RMService;
}

export function buildServices(cfg: Config): Services {
    const soap = new RMSoapClient(cfg.rm.wsUrl, cfg.rm.wsUser, cfg.rm.wsPassword, cfg.rm.timeoutMs);
    const crypto = new SsoCrypto(cfg.rm.cryptoKey);
    const consulta = new ConsultaService(soap);
    const pessoa = new PessoaService(soap, consulta);
    const aluno = new AlunoService(soap, consulta, cfg.rm, crypto);
    const cfo = new CfoService(soap, consulta, cfg.rm);
    const matricula = new MatriculaService(soap, consulta, cfg.rm);
    const bolsa = new BolsaService(soap, consulta, cfg.rm);
    const lancamento = new LancamentoService(soap, consulta);
    const baixa = new BaixaService(soap, consulta, cfg.rm);
    const contrato = new ContratoService(soap, consulta, cfg.rm);
    const log = new LogService(soap);
    const inscricao = new InscricaoService(
        consulta, pessoa, aluno, matricula, bolsa, lancamento, log, crypto, cfg.rm
    );
    const rm = new RMService(soap);

    return {
        soap, crypto, consulta, pessoa, aluno, cfo, matricula,
        bolsa, lancamento, baixa, contrato, log, inscricao, rm,
    };
}
