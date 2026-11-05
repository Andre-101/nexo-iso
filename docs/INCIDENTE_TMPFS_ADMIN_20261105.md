# Incidente 2026-11-05: Compose tmpfs, API y primer ADMIN

## Evidencia
- Build local: 3/3 imágenes construidas.
- DB: contenedor `nexo_local-db-1` healthy; volumen `nexo_local_database` creado.
- Bootstrap de esquema: aborta `invalid mount path: 'nosuid'` antes de ejecutar `init-schema.js`.
- API: unhealthy, esperable si faltan tablas del esquema. Su causa definitiva requiere revisar logs tras reparar el bootstrap.

## Cambio implementado
- Los montajes tmpfs usaban cadenas `rw,noexec,nosuid,size=...` que el daemon del usuario interpretó como rutas separadas.
- Se sustituyeron por `:size=...` manteniendo las protecciones por defecto del runtime Docker (`nosuid`, `noexec`, `nodev`).
- Se retiró `-it` del comando `docker compose run` para la creación interactiva del ADMIN.
- El workflow crea un ADMIN efímero en el runner, comprueba login y comprueba la persistencia tras reiniciar PostgreSQL. El runner NO crea cuentas en producción.

## Cronología del primer despliegue
1. `up -d --wait db`: volumen DB persistente.
2. `--profile bootstrap run --rm --no-deps bootstrap`: inicializa/verifica schema, sin usuarios.
3. `up -d --wait api web`: carga aplicación.
4. `--profile bootstrap run --rm --no-deps bootstrap node prisma/bootstrap-admin.js --interactive`: registra ADMIN en la tabla `Usuario` del volumen DB.
5. Verifica login. En la VPS se repite la creación inicial contra el volumen `nexo_database`.

## Restricciones
No ejecutar `down -v` ni `docker volume prune`; no borrar secretos ni recrear una base distinta. Si se usan los ZIP corregidos, sustituir archivos de configuración dentro de la carpeta actual, preservando `.env.local` y `.local-secrets` originales.
