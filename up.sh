#!/bin/bash
set -euo pipefail

# Em caso de erro, exibe uma mensagem e aborta o script
trap 'echo "Erro no script. Abortando." && exit 1' ERR

# Obtém o diretório onde o script está localizado
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# Define o nome da stack como o nome da pasta onde o script se encontra
STACK_NAME="$(basename "$SCRIPT_DIR")"

IMAGE_TAG="checkout:latest"
DOCKERFILE_PATH="$SCRIPT_DIR/Dockerfile"

if [[ -f "$DOCKERFILE_PATH" ]]; then

  echo "Construindo imagem com tag: $IMAGE_TAG"
  docker build -t "$IMAGE_TAG" "$SCRIPT_DIR"
else
  echo "Nenhum Dockerfile encontrado em: $SCRIPT_DIR"
  echo "Pulando etapa de build da imagem."
fi

docker network create --driver overlay main_network || echo "Rede main_network já criada"
docker stack rm "$STACK_NAME"
docker stack deploy -c docker-compose.yml "$STACK_NAME" --detach=false
