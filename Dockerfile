FROM php:8.3-apache

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        git unzip curl \
        libxml2-dev \
        libcurl4-openssl-dev; \
    docker-php-ext-install -j"$(nproc)" curl soap; \
    rm -rf /var/lib/apt/lists/*

# Ajuste de runtime do PHP (perfil de produção):
#  - memory_limit: teto por requisição (o WSDL do wsDataServer do RM é grande).
#  - timeouts em 300s: processos lentos do RM não são abortados no meio.
#    OBS: 300s casa com o timeout de 300000ms do nó HTTP do n8n.
#  - logs no stderr: qualquer fatal/segfault aparece nos logs do EasyPanel.
RUN { \
      echo 'memory_limit = 256M'; \
      echo 'max_execution_time = 300'; \
      echo 'max_input_time = 300'; \
      echo 'default_socket_timeout = 300'; \
      echo 'post_max_size = 20M'; \
      echo 'upload_max_filesize = 20M'; \
      echo 'log_errors = On'; \
      echo 'display_errors = Off'; \
      echo 'error_reporting = E_ALL'; \
      echo 'error_log = /dev/stderr'; \
    } > "$PHP_INI_DIR/conf.d/zz-app.ini"

# Apache:
#  - Timeout 300s: acompanha os processos lentos do RM.
#    (NÃO usar ProxyTimeout aqui: depende do mod_proxy, que não está
#     habilitado nesta imagem, e quebraria a inicialização do Apache.)
#  - MaxRequestWorkers limitado: cada worker (prefork) pode usar até o
#    memory_limit, então workers x memory_limit precisa caber na RAM do
#    container. Com 256M e 8 workers = ~2GB de pico. Ajuste se der mais RAM.
RUN { \
      echo 'Timeout 300'; \
    } > /etc/apache2/conf-available/zz-timeout.conf \
 && a2enconf zz-timeout \
 && { \
      echo '<IfModule mpm_prefork_module>'; \
      echo '    StartServers 2'; \
      echo '    MinSpareServers 2'; \
      echo '    MaxSpareServers 6'; \
      echo '    MaxRequestWorkers 8'; \
      echo '    MaxConnectionsPerChild 500'; \
      echo '</IfModule>'; \
    } > /etc/apache2/mods-available/mpm_prefork.conf

# Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

RUN a2enmod rewrite headers

WORKDIR /var/www/html

# COPIA CORRETA
COPY www/api/ /var/www/html/

# instala dependências (evita erro de vendor)
RUN composer install --no-dev --optimize-autoloader

ENV APACHE_DOCUMENT_ROOT=/var/www/html/public

RUN sed -ri -e 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' \
    /etc/apache2/sites-available/*.conf

RUN printf "\n<Directory /var/www/html/public>\n\
    AllowOverride All\n\
    Require all granted\n\
</Directory>\n" >> /etc/apache2/apache2.conf