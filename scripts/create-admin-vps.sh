#!/usr/bin/env bash
# Alta ADMIN exclusiva de la VPS, luego de schema + API y web saludables.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env.production ]] || { echo 'Falta .env.production' >&2; exit 2; }
[[ -t 0 ]] || { echo 'Conectese a una terminal interactiva (SSH -t).' >&2; exit 2; }
echo 'Alta ADMIN en la base Nexo VPS. No se modifican credenciales existentes.'
docker compose --env-file .env.production -f compose.vps.yaml --profile bootstrap   run --rm --no-deps bootstrap node prisma/bootstrap-admin.js --interactive
