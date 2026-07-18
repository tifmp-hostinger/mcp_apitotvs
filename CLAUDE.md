# Convenções do projeto (api-totvs)

API REST em Slim/PHP que integra com o TOTVS RM via SOAP. App servida na raiz
(`setBasePath('')`) — rotas são `/pessoas`, `/financeiro/baixas` etc., **sem** `/api`.

## Ao criar/alterar uma rota, atualize SEMPRE (mesma alteração):

1. **`www/api/config/routes.php`** — a rota em si.
2. **`www/api/public/docs.html`** — adicione a entrada no array `endpoints`
   (objeto `{g, method, path, desc, hint?, params?, query?, body?}`), no grupo
   correspondente. **Não deixe rota fora do docs.** É a referência interativa
   servida em produção.
3. **`www/api/API.md`** — documente a rota (tabela/seção do domínio).
4. **`www/api/config/dependencies.php`** — DI do controller/serviço, se novo.
5. **`www/api/src/Support/RouteCatalog.php`** — SÓ existe na branch do painel
   (`claude/api-route-control-ui-*`), não na `main`. Atualize apenas quando
   estiver trabalhando nessa branch.

## URL base
Domínio de produção: **https://api-totvs.fmp.edu.br** (valor default do campo
"URL base" no `docs.html`). Ao mudar o domínio, ajuste o `value` do `#base`.

## Ambiente de teste local
Sem `ext-soap` no CLI desta sessão: chamadas ao RM falham com 502
("Class SoapClient not found") — isso NÃO indica bug de rota/DI, apenas ausência
da extensão. Valide builder de XML, validações e wiring localmente; a execução
real do RM confirma-se no deploy (Docker tem `ext-soap`).

Servidor de dev (serve estáticos de `public/` + Slim):
`php -S 127.0.0.1:8099 -t public router-dev.php` (crie o `router-dev.php` se não
existir na branch).
