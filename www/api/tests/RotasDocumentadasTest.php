<?php

declare(strict_types=1);

/**
 * Guarda-corpo da convenção do CLAUDE.md: toda rota registrada em
 * config/routes.php precisa de entrada correspondente no array `endpoints`
 * de public/docs.html. Antes deste teste a sincronia era 100% manual.
 *
 * Registra as rotas num Slim App real (precisa do vendor/); em ambiente sem
 * vendor o teste é pulado — os demais testes não dependem dele.
 */

if (!class_exists(\Slim\Factory\AppFactory::class)) {
    skip('RotasDocumentadas', 'Slim indisponível (rode composer install para habilitar este teste)');
    return;
}

$app = \Slim\Factory\AppFactory::create();
(require __DIR__ . '/../config/routes.php')($app);

$rotas = [];
foreach ($app->getRouteCollector()->getRoutes() as $rota) {
    foreach ($rota->getMethods() as $metodo) {
        $rotas[] = strtoupper($metodo) . ' ' . $rota->getPattern();
    }
}

$docsHtml = (string) file_get_contents(__DIR__ . '/../public/docs.html');
preg_match_all('/method:"(?<m>[A-Z]+)"\s*,\s*path:"(?<p>[^"]+)"/', $docsHtml, $matches, PREG_SET_ORDER);

$documentadas = [];
foreach ($matches as $m) {
    $documentadas[] = $m['m'] . ' ' . $m['p'];
}

check('docs.html tem entradas parseáveis', count($documentadas) > 0);

foreach ($rotas as $rota) {
    check("rota documentada no docs.html: {$rota}", in_array($rota, $documentadas, true));
}

// Sentido inverso: docs.html não deve anunciar rota que não existe mais.
foreach ($documentadas as $doc) {
    check("entrada do docs.html existe em routes.php: {$doc}", in_array($doc, $rotas, true));
}
