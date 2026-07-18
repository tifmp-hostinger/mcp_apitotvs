<?php

declare(strict_types=1);

use FMP\RMApi\Clients\RMSoapClient;
use FMP\RMApi\Controllers\SSOController;
use FMP\RMApi\Helpers\Crypto;
use FMP\RMApi\Services\AlunoService;
use FMP\RMApi\Services\BaixaService;
use FMP\RMApi\Services\BolsaService;
use FMP\RMApi\Services\CfoService;
use FMP\RMApi\Services\ConsultaService;
use FMP\RMApi\Services\ContratoService;
use FMP\RMApi\Services\InscricaoService;
use FMP\RMApi\Services\LancamentoService;
use FMP\RMApi\Services\LogService;
use FMP\RMApi\Services\MatriculaService;
use FMP\RMApi\Services\PessoaService;
use Psr\Container\ContainerInterface;

return [

    RMSoapClient::class => function (ContainerInterface $c) {
        $rm = $c->get('rm');
        return new RMSoapClient($rm['ws_url'], $rm['ws_user'], $rm['ws_password']);
    },

    Crypto::class => function (ContainerInterface $c) {
        $app = $c->get('app');
        return new Crypto($app['crypto']['method'], $app['crypto']['key']);
    },

    AlunoService::class => fn(ContainerInterface $c) => new AlunoService(
        $c->get(RMSoapClient::class),
        $c->get(ConsultaService::class),
        $c->get('rm'),
        $c->get(Crypto::class)
    ),

    CfoService::class => fn(ContainerInterface $c) => new CfoService(
        $c->get(RMSoapClient::class),
        $c->get(ConsultaService::class),
        $c->get('rm')
    ),

    MatriculaService::class => fn(ContainerInterface $c) => new MatriculaService(
        $c->get(RMSoapClient::class),
        $c->get(ConsultaService::class),
        $c->get('rm')
    ),

    BaixaService::class => fn(ContainerInterface $c) => new BaixaService(
        $c->get(RMSoapClient::class),
        $c->get(ConsultaService::class),
        $c->get('rm')
    ),

    BolsaService::class => fn(ContainerInterface $c) => new BolsaService(
        $c->get(RMSoapClient::class),
        $c->get(ConsultaService::class),
        $c->get('rm')
    ),

    ContratoService::class => fn(ContainerInterface $c) => new ContratoService(
        $c->get(RMSoapClient::class),
        $c->get(ConsultaService::class),
        $c->get('rm')
    ),

    InscricaoService::class => fn(ContainerInterface $c) => new InscricaoService(
        $c->get(ConsultaService::class),
        $c->get(PessoaService::class),
        $c->get(AlunoService::class),
        $c->get(MatriculaService::class),
        $c->get(BolsaService::class),
        $c->get(LancamentoService::class),
        $c->get(LogService::class),
        $c->get(Crypto::class),
        $c->get('rm')
    ),

    SSOController::class => fn(ContainerInterface $c) => new SSOController(
        $c->get(Crypto::class),
        $c->get('rm')
    ),
];
