# Despliegue de NEXO en la VPS de v4nex — 5 de noviembre de 2026

## Alcance y advertencia fundamental

Esta es una **distribución de despliegue endurecida** derivada únicamente del ZIP `NEXO_FRONTEND_AUTONOMO_PROCESOS_20261028(1).zip` (28 de octubre). No contiene ni incorpora correcciones posteriores del frontend/backend del 2 de noviembre. **No sustituir silenciosamente la rama o instalación más reciente.** Esta entrega NO fue desplegada en la VPS: no existe acceso SSH ni se conoce el consumo real actual de sus otros contenedores. La revisión estática pasa, pero el build Docker, `npm audit` y el escaneo de CVE deben completar el pipeline GHCR antes del primer despliegue público.

Contexto de infraestructura comunicado previamente (puede haber cambiado): Hetzner CX23, Ubuntu 24.04, x86_64, **2 vCPU, 4 GB RAM, ~40 GB SSD**; ruta del sistema existente `/opt/v4nex/app`, Caddy `app-caddy-1` en red Docker `app_edge`, publicado en 80/443, otros servicios en uso, SSH `deploy` puerto `49222`. Se reutiliza únicamente la red pública existente. **No se toca** `/opt/v4nex/app`, sus volúmenes, su proxy o su `.env.production` de forma automática.

**Bloqueo comercial/técnico:** `DATA_MODE=production` impone gateways **HTTPS reales y autorizados** para registro empresarial y finanzas, más tokens y base legal confirmada. Hasta disponer de ambos y probarlos, no se debe habilitar acceso público. Se eliminan los 4 servicios de demostración en la variante VPS; por tanto, **no se usa `demo` como sustituto de producción**. Ninguna API externa se inventa ni se conecta en el paquete.

## Arquitectura propuesta

```text
Internet HTTPS (80/443 existentes)
           |
     Caddy v4nex (ya funcionando)
           | red externa app_edge, único punto público
       nexo-web (NGINX estable, archivos estáticos, sin Node)
           | red interna nexo_app
       nexo-api (Node 22 LTS, Prisma, Poppler, sin puerto host)
           | red egress (salida HTTPS, sin puertos publicados) -> gateways externos
           | red interna nexo_data
       nexo-db (PostgreSQL 16 Alpine, volumen exclusivo)

GitHub Actions [fuera de la VPS]
   -> tests + npm audit + build multi-stage + Trivy
   -> imágenes GHCR etiquetadas por SHA
   -> VPS: docker compose pull && up (NO build)
```

Cota de memoria configurada: **96 MiB web + 768 MiB API + 512 MiB DB = 1376 MiB de máximos**, no memoria reservada ni consumo medido. El bootstrap puede usar hasta 640 MiB, solo de manera puntual. Hay **2 contenedores de aplicación + 1 base PostgreSQL**, en lugar de iniciar también las bases y adaptadores de demostración. La red `egress` (bridge NAT, sin publicación de puertos) permite a la API comunicarse con gateways HTTPS externos; la red de DB permanece interna. La API mantiene Poppler por los análisis de PDF; quitarlo rompe funciones. Prisma CLI no entra a la imagen normal: se aísla en una imagen de bootstrap temporal.

## Paso A. Construir fuera del servidor

1. Subir la carpeta `NEXO/` como raíz de un **repositorio privado** GitHub, con `.github/workflows/vps-images.yml`. Nunca subir `secrets`, `.env.production`, backups, PDFs empresariales, llaves, tokens ni bases de datos.
2. En GitHub → **Actions → NEXO | Auditar y publicar imágenes VPS → Run workflow**. No hay autodespliegue a producción, solo generación de imágenes. Se ejecutan pruebas de sintaxis y 18 tests estáticos/funcionales sin DB, `npm audit --omit=dev --audit-level=high`, 3 builds en runner y Trivy (HIGH/CRITICAL corregibles bloquean publicación). Se publica **web**, **api** y **bootstrap** en `ghcr.io/PROPIETARIO/nexo-...:sha-SHA_DEL_COMMIT`; se adjuntan SBOM y procedencia.
3. **Si cualquiera de estas fases falla, detener despliegue**. Ajustar versión vulnerable en el repositorio y regenerar correctamente `package-lock.json` en una máquina con npm; no editar números del lockfile a mano ni ejecutar una actualización mayor de Prisma a ciegas. No se ha comprobado una compilación local porque este entorno no tiene Docker ni salida a npmjs.org.
4. Hacer que las imágenes sean visibles para la VPS (GHCR package público si no contienen secretos, o autenticación de solo lectura con token de mínimo alcance; no usar un token con privilegios de escritura en el servidor). Las imágenes no incluyen `.env` ni documentos privados.
5. Registrar los **tres nombres exactos y sus digests `@sha256:...`**, obtenidos tras publicar. Preferir digests inmutables en `.env.production`; los tags `sha-commit` también permiten reproducir el origen, pero los tags pueden moverse.

## Paso B. Preparar recursos exclusivos en la VPS

**Antes de ejecutar cambios**, medir el estado real: `free -h`, `df -h`, `docker stats --no-stream`, `docker system df`, `docker network inspect app_edge`, `docker ps`. Si el nombre de la red externa no existe o no corresponde al Caddy vigente, **detenerse**; no crear una red homónima ni recrear las redes de v4nex. No tocar volúmenes de la aplicación anterior.

Instalar la nueva distribución en **`/opt/nexo`**, por ejemplo mediante Git checkout o transferencia únicamente de archivos de código/configuración. No transferir ningún secreto existente de v4nex:

```bash
mkdir -p /opt/nexo
# Transferir/copiar aquí el contenido de NEXO/ (NO copiar .env.production anterior)
cd /opt/nexo
cp .env.vps.example .env.production
chmod 600 .env.production
bash scripts/prepare-vps-secrets.sh /opt/nexo/secrets
```

El script solo crea `db_password`, `database_url` y `jwt_secret` cuando **no existen**. Genera claves criptográficamente aleatorias con OpenSSL, no las imprime y no modifica las anteriores. **El directorio de secretos debe ser 0700, no publicable, y los archivos 0444 dentro del directorio 0700**: en Docker Compose no-Swarm se montan archivos del host con sus permisos originales; esta combinación evita acceso de otros usuarios no privilegiados al directorio del host y permite lectura a los procesos sin root de los contenedores. Si políticas de su organización requieren un Secret Store, sustituir el mecanismo antes de producción.

Crear manualmente `registry_token` y `finance_token` con credenciales **reales** de sus respectivos gateways (no generar tokens aleatorios que ningún proveedor reconoce). Para cada archivo creado dentro de `/opt/nexo/secrets`, ejecutar `chmod 0444` y mantener `chmod 0700 /opt/nexo/secrets`; los permisos del directorio host son el límite de acceso. No introducir tokens dentro del archivo `.env.production`, la imagen, Caddyfile, Git o logs. Mantener mecanismos de rotación: archivos de secreto nuevos + reinicio controlado de los contenedores afectados.

Completar **sin marcadores ficticios** `.env.production` con las 3 imágenes digest, `FRONTEND_URL=https://consultoria.v4nex.com` (o subdominio libre real), URLs HTTPS registral y financiera, y `REGISTRY_LEGAL_BASIS_CONFIRMED=1` y `FINANCE_LEGAL_BASIS_CONFIRMED=1` **únicamente después** de confirmar los contratos/autorizaciones y hacer las verificaciones. `AI_ENABLED=0` debe permanecer en cero inicialmente. La aplicación valida estas condiciones y falla cerrada cuando faltan.

Validar sin modificar recursos:

```bash
docker compose --env-file .env.production -f compose.vps.yaml config --quiet
docker network inspect app_edge
```

## Paso C. Primera instalación: solamente base nueva

**Hacer esto únicamente para una base exclusiva de NEXO, VACÍA, tras verificar el nombre del volumen.** No reutilizar la base de v4nex. El bootstrap existente usa Prisma `db push` solo al detectar que la base está vacía; NO sustituye migraciones versionadas ni una estrategia de rollback en entornos con datos reales. Los SQL de integridad adicionales del proyecto requieren revisión aparte antes de certificar que el esquema es completo.

```bash
cd /opt/nexo
docker compose --env-file .env.production -f compose.vps.yaml up -d db
docker compose --env-file .env.production -f compose.vps.yaml --profile bootstrap run --rm bootstrap
# Confirmar salida de inicialización y esquema completo ANTES del paso siguiente.
docker compose --env-file .env.production -f compose.vps.yaml up -d api web
docker compose --env-file .env.production -f compose.vps.yaml ps
```

**Solo tras verificar que la API está sana**, crear interactivamente el primer ADMIN. No se crea contraseña predeterminada, y no se imprime el JWT:

```bash
docker compose --env-file .env.production -f compose.vps.yaml --profile bootstrap run --rm -it bootstrap node prisma/bootstrap-admin.js --interactive
```

El bootstrap no se ejecuta automáticamente en los siguientes despliegues; tiene que usarse manualmente para instalación inicial. El comando interactivo exige una contraseña de al menos 16 caracteres y máximo 72 bytes UTF‑8. No utilizar `--profile demo`, `down -v`, `volume prune` o `docker system prune -a` en el servidor compartido.

## Paso D. Integrar Caddy existente sin perturbar v4nex

Verificar primero desde un contenedor **que ya pertenezca a la misma red `app_edge`** que `http://nexo-web:8080/healthz` responde `ok` (Caddy puede hacerlo si dispone de wget/curl, pero no instalar herramientas permanentemente en él). En el Caddyfile **existente**, integrar UNA sola regla para el host elegido, verificando que no colisione con el manejo actual de `*.v4nex.com`:

```caddyfile
consultoria.v4nex.com {
    encode zstd gzip
    reverse_proxy nexo-web:8080
}
```

**No reemplazar** el Caddyfile existente con ese bloque: es un ejemplo de integración. Hacer copia del archivo de configuración, revisar su estructura actual, validar la configuración con `caddy validate` dentro del contenedor operativo y solo entonces `caddy reload`, sin `docker compose down` de v4nex. Mantener el HTTPS administrado por Caddy. No publicar `3000`, `5432` o `8080`, no crear un segundo Caddy, y no cambiar las reglas del firewall existentes para 80/443/SSH.

DNS: verificar que el subdominio elegido realmente resuelve hacia el servidor. Suponer que el comodín DNS ya cubre el subdominio no sustituye el chequeo con `dig` y `curl`. Antes de presentar el servicio a clientes, revisar certificados, HTTPS, CSP, CORS y exposición de rutas con un navegador y un escáner desde el exterior.

## Paso E. Verificaciones obligatorias y monitorización

```bash
docker compose --env-file .env.production -f compose.vps.yaml ps
docker compose --env-file .env.production -f compose.vps.yaml logs --tail=60 web api db
docker stats --no-stream
df -h
curl -fsSI https://consultoria.v4nex.com/
```

Verificar flujo completo con cuentas de **prueba**: login ADMIN; alta y roles; vinculación registral real; creación de proyecto; cuestionario del representante; acceso de consultor asignado; aislamiento entre dos empresas; alta/descarga y revisión de PDF; expiración y revocación JWT; error de proveedor; backups/restore; rechazo de URL externa no autorizada y de un archivo malformado. Validar las operaciones reales contra los gateways autorizados: la presencia de un contenedor saludable **no implica** que esos servicios empresariales funcionen.

Se aconseja guardar mediciones de `docker stats` y `docker system df` antes y después del despliegue. Log rotation limitada a 5 MB × 3 por contenedor (sin garantía de que los logs de todas las demás aplicaciones estén controlados). Establecer alertas de disco, memoria, disponibilidad, autenticación anómala, errores de gateways y consumo de tokens API.

## Actualización y rollback

1. Construir de nuevo en GitHub Actions, confirmar auditoría y guardar nuevos digests.
2. Respaldar DB y PDFs y comprobar restauración **antes** de cambios de esquema. No ejecutar `db push` para migrar una base ya existente; diseñar migraciones revisadas/aplicadas por separado.
3. Cambiar **solo** `NEXO_*_IMAGE` en `/opt/nexo/.env.production`, preservando todos los secretos y `.env.production` de v4nex.
4. `docker compose --env-file .env.production -f compose.vps.yaml pull` y `docker compose --env-file .env.production -f compose.vps.yaml up -d --no-build`.
5. Confirmar salud y flujos. Si solo cambió código compatible con el esquema, restaurar los digests previos y repetir `up -d`; un rollback de esquema/datos requiere un plan independiente.

## Qué NO cubre esta entrega

- No se accedió al VPS, su Caddyfile, variables, DNS, bases ni certificados reales.
- No se puede afirmar que los proveedores registral y financiero estén disponibles ni que el flujo de cliente final sea estable en producción.
- No hay pruebas de intrusión, DAST, pruebas de concurrencia multiusuario ni evidencia de restauración de backups.
- No se midió tamaño de las imágenes construidas ni el consumo real del servidor. El presupuesto de RAM es una **cota configurada**, no un benchmark.
- Las garantías de seguridad absolutas no son alcanzables. Véase `AUDITORIA_CIBERSEGURIDAD.md`.
