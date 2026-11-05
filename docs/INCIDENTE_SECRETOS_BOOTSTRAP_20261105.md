# Incidente: precarga de secretos heredados durante bootstrap (05-11-2026)

## Situación comprobada

En `compose.local.yaml`, `DATABASE_URL_FILE` y `JWT_SECRET_FILE` apuntan a montajes Docker de `/run/secrets`. El Dockerfile del servicio `bootstrap` define `NODE_OPTIONS=--require=/app/src/config/load-secrets.js`. Durante el primer arranque, `init-schema.js` lee la base vacía y lanza procesos Node adicionales para `prisma db push` y `prisma/seed.js`.

Antes de esta corrección, `spawnSync` pasaba `env:process.env` directamente. La precarga del padre ya había asignado `DATABASE_URL` en ese objeto, pero seguía presente `DATABASE_URL_FILE`. Al ejecutar la segunda precarga en el hijo, el cargador seguro rechazó la combinación, arrojando `DATABASE_URL: no combinar valor directo con *_FILE.`. La API quedó *unhealthy* porque faltaban tablas.

## Corrección

La función `environmentForChild()` devuelve una **copia** del entorno para procesos secundarios, eliminando los indicadores `*_FILE` únicamente para los secretos que **ya fueron cargados** en `process.env`. Se usa exclusivamente en los procesos secundarios de inicialización. El cargador sigue rechazando configuraciones con ambas variables en el arranque inicial. Se añadió una prueba automática de regresión con un proceso Node real.

## Aplicación en Windows PowerShell

1. Desde la carpeta `NEXO`, extrae el parche sin borrar `.env.local`, `.local-secrets` o los volúmenes.
2. Reconstruye **solo** la imagen `bootstrap`, pues la corrección modifica su código dentro de la imagen:

```powershell
docker compose --env-file .env.local -f compose.local.yaml --profile bootstrap build bootstrap
```

3. Ejecuta una inicialización segura (no borra datos ni recrea el volumen):

```powershell
docker compose --env-file .env.local -f compose.local.yaml up -d --wait db
docker compose --env-file .env.local -f compose.local.yaml --profile bootstrap run --rm --no-deps bootstrap
```

4. Si informa `Base preparada sin usuarios predeterminados`, inicia el resto:

```powershell
docker compose --env-file .env.local -f compose.local.yaml up -d --wait api web
```

5. Solo entonces crea el ADMIN local:

```powershell
.\scripts\create-admin-local.ps1
```

Si el paso 3 encuentra tablas existentes pero incompletas, **no las borres**. Conserva el registro de error y pide revisión antes de reintentar. Si la API queda unhealthy, inspecciona `docker compose --env-file .env.local -f compose.local.yaml logs --tail=100 api` (revisa el registro antes de compartir por si incluyera datos privados).

## Persistencia

La cuenta creada se guarda en el volumen Docker `nexo_local_database` mediante la base `nexo` en PostgreSQL, no en la imagen ni en el proceso `bootstrap`. La VPS tiene su propia base y requiere un ADMIN creado por separado. Evita `docker compose down -v`, `docker volume prune` y `docker compose rm -v` al depurar.
