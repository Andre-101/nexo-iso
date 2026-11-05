# Incidente GitHub Actions scan-database (2026-11-05)

- Ejecución: https://github.com/Andre-101/nexo-iso/actions/runs/42091778069
- Resultado: `security-and-tests` y `smoke-local` aprobados, `publish` omitido.
- Trivy sobre `postgres:16-alpine` (Alpine 3.24.3): 0 hallazgos del SO; 26 en
  `/usr/local/bin/gosu` (biblioteca Go v1.24.6): 25 HIGH, 1 CRITICAL.
- No es correcto concluir que todos sean explotables: los mantenedores de gosu
  señalan que el escaneo de bibliotecas detecta funciones no alcanzables.
- Mitigación de producto: `infra/Dockerfile.postgres.vps` deriva de la imagen
  oficial PostgreSQL 16 y sustituye el binario gosu por el programa `su-exec`
  (C, paquete Alpine), manteniendo su interfaz de ejecución y entrada oficial.
- Cambios de CI: construir la variante `nexo-db:scan`, verificar cambio de UID,
  analizar con Trivy la imagen resultante, hacer smoke de la misma imagen, y
  publicar `nexo-db` en GHCR con la misma etiqueta SHA que web/API/bootstrap.
- La base de datos es persistente en el volumen `database`, no en la imagen.
  La modificación NO incluye `down -v`, cambio de versión mayor de PostgreSQL,
  reseteo de secretos ni bootstrap ADMIN adicional.
- Estado: revisión estática + 26 pruebas Node OK. Pendiente verificación de
  Docker en GitHub Actions y escaneo real de la imagen final, antes de desplegar.

Referencias:
- https://github.com/tianon/gosu/security
- https://github.com/ncopa/su-exec
- https://github.com/docker-library/postgres/blob/master/docker-entrypoint.sh
