#!/usr/bin/env bash
# Ejecutar únicamente en la VPS; NO imprime secretos ni sobrescribe los existentes.
set -euo pipefail
secret_dir="${1:-/opt/nexo/secrets}"
if [[ ! "$secret_dir" = /* ]] || [[ "$secret_dir" == *'..'* ]]; then
  echo 'La ruta de secretos debe ser absoluta y no contener ..' >&2; exit 2
fi
command -v openssl >/dev/null || { echo 'Se requiere openssl (VPS Ubuntu).' >&2; exit 3; }
umask 077
mkdir -p -- "$secret_dir"
chmod 0700 -- "$secret_dir"
create_hex() {
  local path="$secret_dir/$1"
  if [[ ! -e "$path" ]]; then
    openssl rand -hex "$2" > "$path"
    chmod 0444 -- "$path"  # Docker Compose monta el archivo sin cambiar el modo.
    echo "Generado: $1"
  else
    echo "Conservado sin alterar: $1"
  fi
}
create_hex db_password 32
create_hex jwt_secret 48
if [[ ! -e "$secret_dir/database_url" ]]; then
  # db_password generada por el script solo contiene caracteres hexadecimales URL-safe.
  db_password="$(cat "$secret_dir/db_password")"
  if [[ ! "$db_password" =~ ^[0-9a-f]{64}$ ]]; then
    echo 'db_password no contiene 64 hex. No construir database_url automáticamente.' >&2; exit 4
  fi
  printf 'postgresql://nexo:%s@db:5432/nexo?schema=public\n' "$db_password" > "$secret_dir/database_url"
  chmod 0444 -- "$secret_dir/database_url"
  echo 'Generado: database_url'
else
  echo 'Conservado sin alterar: database_url'
fi
cat <<'TXT'
Faltan credenciales reales de registro y finanzas: crear registry_token y finance_token
manualmente SOLO cuando se tenga autorización; directorio 0700 y archivos 0444.
NO habilite la aplicación pública mientras falten estos proveedores y sus permisos.
TXT
