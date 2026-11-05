#!/usr/bin/env bash
# Ejecutar en VPS una vez, después de desplegar y validar NEXO.
# Crea una red AISLADA de tránsito que luego podrá compartir v4nex.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -e .env.bridge ]; then
  echo 'Existe .env.bridge: no crear otra red para preservar direcciones.' >&2
  exit 2
fi
command -v docker >/dev/null || { echo 'Falta Docker' >&2; exit 3; }
command -v openssl >/dev/null || { echo 'Falta OpenSSL' >&2; exit 3; }
network='nexo_link_ipv6'
if docker network inspect "$network" >/dev/null 2>&1; then
  echo "La red $network ya existe. No se modifica ni se reutiliza sin verificar." >&2
  exit 4
fi
hex=$(openssl rand -hex 5)
# RFC4193 ULA: fdXX:XXXX:XXXX:1::/64; asignación estable ::80.
a="fd${hex:0:2}:${hex:2:4}:${hex:6:4}:1"
subnet="$a::/64"
address="$a::80"
# Si falla, no escribir .env.bridge ni alterar redes existentes.
docker network create --driver bridge --internal --ipv6 --subnet "$subnet" "$network" >/dev/null
umask 077
printf 'NEXO_SHARED_NETWORK=%s\nNEXO_IPV6_ADDRESS=%s\n' "$network" "$address" > .env.bridge
printf 'Red: %s\nSubred: %s\nIPv6 NEXO: %s\nPuerto: 8080\n' "$network" "$subnet" "$address"
