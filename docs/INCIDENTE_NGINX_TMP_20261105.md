# Nexo — reparación de Nginx sin privilegios (2026-11-05)

## Síntoma
`mkdir() "/var/cache/nginx/client_temp" failed (13: Permission denied)`; API y PostgreSQL saludables.

## Causa confirmada
El Compose monta `/var/cache/nginx` como tmpfs en tiempo de ejecución. El montaje oculta
los permisos concedidos a UID 101 durante la construcción de la imagen, por lo que
Nginx no puede crear su directorio temporal como usuario no privilegiado.

## Corrección
- `infra/nginx.vps.conf`: todas las rutas temporales HTTP usan `/tmp` y mantiene `pid /tmp/nginx.pid`.
- `compose.local.yaml` / `compose.vps.yaml`: elimina el tmpfs innecesario en `/var/cache/nginx`; conserva `/tmp:size=32m`.
- `tests/vps-security.test.js`: prueba estática de regresión.

## Uso en Windows PowerShell
Desde `...\NEXO`:

```powershell
Expand-Archive -Path "$env:USERPROFILE\Downloads\NEXO_PARCHE_NGINX_TMP_20261105.zip" -DestinationPath . -Force
docker compose --env-file .env.local -f compose.local.yaml config --quiet
docker compose --env-file .env.local -f compose.local.yaml build web
docker compose --env-file .env.local -f compose.local.yaml up -d --no-deps --force-recreate web
docker compose --env-file .env.local -f compose.local.yaml ps
```

Se recrea solo `web`. No usar `down -v` ni eliminar volúmenes. El nuevo `up --no-deps`
no toca la API ni PostgreSQL. Si web continúa fallando, recoger:
`docker compose --env-file .env.local -f compose.local.yaml logs --tail=60 web`.

Cuando todo esté sano, crear ADMIN por `./scripts/create-admin-local.ps1`.
Nunca ejecutar la creación del ADMIN en el runner; solo en cada instalación.
