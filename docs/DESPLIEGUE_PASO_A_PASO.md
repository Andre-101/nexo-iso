# NEXO — desde código hasta VPS, sin tocar v4nex

**Versión de procedimiento:** 2026-11-05. **Origen de código:** NEXO 2026-10-28, no incorpora cambios posteriores que no estuvieran en el ZIP suministrado. Las imágenes todavía **no han sido construidas ni publicadas por ChatGPT** (sin Docker Engine ni acceso SSH a la VPS). Este proyecto se considera infraestructura de **pruebas técnicas / preproducción** hasta que finalicen las pruebas de negocio, seguridad, backups e integraciones autorizadas.

## Topología exacta

1. **PC Windows**: prueba local `http://localhost:8080`, Compose `name: nexo_local`. Puerto ligado **solo** a 127.0.0.1, por tanto no es accesible desde la LAN.
2. **GitHub**: repositorio privado que conserva el código y genera imágenes por GitHub Actions. Imágenes `ghcr.io/USUARIO/nexo-web`, `ghcr.io/USUARIO/nexo-api`, `ghcr.io/USUARIO/nexo-bootstrap`, `ghcr.io/USUARIO/nexo-db`. GHCR, NO los archivos Git, almacena los artefactos Docker.
3. **VPS**: en `/opt/nexo` solo `compose.vps.yaml`, los scripts, secretos y `.env.production`; recibe las imágenes preconstruidas por `docker pull`. Sin `docker build`, Node, npm, Prisma ni código fuente en el host. Tres servicios continuos: `web` (Nginx :8080), `api` (Node :3000), `db` (PostgreSQL interno). Un contenedor `bootstrap` solo se usa manualmente al inicializar. **Cero puertos publicados en host**.
4. **Red futura**: se crea una bridge Docker externa `nexo_link_ipv6`, con IPv6 ULA estática solo en `web`. **v4nex permanece independiente**. Cuando v4nex conecte uno de sus contenedores a esta red, usará `http://[IPv6_DE_NEXO]:8080`; el DNS, dominio, TLS y subdominio se gestionarán allí, no en Nexo. Una ULA `fdxx:` **no es IPv6 pública enrutable**: se comunica únicamente dentro de la red compartida.

> Si v4nex corre **en otra VPS/host**, una Docker bridge no alcanza: necesitaría conectividad enrutada (VPN de contenedores/WireGuard/overlay) o una IPv6 global del host y reglas de firewall. Este paquete supone **un único Docker Engine en el mismo VPS**.

## 0. Comprobar que las plataformas coinciden

- PC: Docker Desktop con motor Linux y Compose v2; Git; PowerShell; conexión a GitHub. **No se necesita Node en Windows**.
- VPS Linux: Docker Engine, Compose v2, OpenSSL, acceso SSH, 1–2 GB de almacenamiento libre adicional para pruebas iniciales como mínimo (revisar tamaño real de las imágenes), RAM suficiente tras cargar v4nex. **No borrar ninguna imagen, red ni volumen de v4nex**.
- Importante: la automatización compila por defecto para **linux/amd64**; comprobar la VPS **antes** de empezar. Si la VPS es arm64, hay que adaptar la matriz/build, no forzar imágenes amd64.

En VPS (solo consulta):

```bash
uname -m
docker version
docker compose version
docker info --format 'Arquitectura Docker: {{.Architecture}}'
free -h
df -h
docker system df
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

No continuar si Docker no responde, la VPS es arm64 y el pipeline sigue siendo amd64, o si el disco/RAM disponibles son insuficientes.

## 1. Prueba local en Windows (ANTES de publicar)

Extraer `NEXO_CODIGO_Y_BUILD_20261105.zip` en carpeta propia. En **PowerShell** abrir esa carpeta raíz (contiene `compose.local.yaml`):

```powershell
Copy-Item .env.local.example .env.local
.\scripts\prepare-local-secrets.ps1
docker compose --env-file .env.local -f compose.local.yaml config --quiet
docker compose --env-file .env.local -f compose.local.yaml --profile bootstrap build
```

El último comando **construye 4 imágenes locales** mediante Dockerfiles multi-stage, y puede tardar. Si falla, no continuar; enviar los logs del error, sin credenciales. **No usar `docker compose down -v`**: borra la base local Nexo.

Instalación de una **base nueva, vacía y exclusiva del proyecto local**:

```powershell
docker compose --env-file .env.local -f compose.local.yaml up -d --wait db
docker compose --env-file .env.local -f compose.local.yaml --profile bootstrap run --rm --no-deps bootstrap
docker compose --env-file .env.local -f compose.local.yaml up -d --wait api web
docker compose --env-file .env.local -f compose.local.yaml ps
```

Pruebas HTTP:

```powershell
curl.exe -i http://127.0.0.1:8080/healthz
curl.exe -i http://127.0.0.1:8080/health
curl.exe -i http://127.0.0.1:8080/
```

Esperado: `/healthz` HTTP 200 `ok`, `/health` HTTP 200 JSON, `/` HTTP 200 HTML. Abrir `http://localhost:8080/` y `http://localhost:8080/pages/login.html`. La API debe estar `healthy` y la DB `healthy`.

Opcional: crear el primer ADMIN **solo para la DB local `nexo_local_database`; no se transfiere a la VPS** (contraseña de al menos 16 caracteres, interactiva; **solo cuando la API ya esté iniciada**):

```powershell
docker compose --env-file .env.local -f compose.local.yaml --profile bootstrap run --rm --no-deps bootstrap node prisma/bootstrap-admin.js --interactive
```

Probar login en el navegador. Flujos registrales y financieros permanecen **desactivados**, sin datos ficticios. No interpretar el prototipo como entorno productivo.

Diagnóstico si algo falla:

```powershell
docker compose --env-file .env.local -f compose.local.yaml logs --tail=120 api web db
docker compose --env-file .env.local -f compose.local.yaml ps
docker stats --no-stream
```

Al finalizar:

```powershell
docker compose --env-file .env.local -f compose.local.yaml stop
```

`stop` mantiene volúmenes y datos para la siguiente prueba. Si se necesita otro puerto local, cambiar `NEXO_LOCAL_PORT` en `.env.local`, no el 8080 interno.

## 2. Subir el **código** a GitHub y generar las **imágenes** en GHCR

1. Utilizar el repositorio independiente `Andre-101/nexo-iso` (público). No usar el repositorio de v4nex. Preferir repositorio privado antes de cargar código de producción, tras revisar el contenido.
2. Desde la raíz extraída de Nexo, comprobar que `git status` NO incluye `.env.local`, `.local-secrets`, `.env.production`, `.env.bridge`, tokens, volúmenes, logs ni datos reales. Git las ignora en `.gitignore`.
3. Si es un repositorio nuevo, ejecutar en PowerShell (sustituir URL real):

```powershell
git init
git add .
git status --short
git commit -m "Nexo: pruebas locales, imágenes optimizadas y despliegue IPv6 independiente"
git branch -M main
git remote add origin https://github.com/Andre-101/nexo-iso.git
git push -u origin main
```

Si el repositorio ya existe y tiene cambios, **no ejecutar `git init` ni forzar `push`**: crear una rama y revisar las diferencias antes de fusionar.

4. En GitHub → Actions → **NEXO | Auditar y publicar imágenes VPS** → `Run workflow` desde la rama revisada.
5. El pipeline ejecuta: validación JS, 22 pruebas locales sin DB, `npm ci`, `npm audit --omit=dev --audit-level=high`, construcción y prueba con PostgreSQL, escaneo Trivy de imágenes (incluyendo PostgreSQL) y publicación en GHCR de `web`, `api`, `bootstrap` y `db` **solo después** de superar los controles.
6. Revisar que todos los jobs estén **verdes**; no sustituir imágenes ni reducir la seguridad para evitar un fallo. GHCR vincula los paquetes con el repositorio que ejecutó el workflow. No se requiere PAT de publicación en Actions: usa `GITHUB_TOKEN` con `packages: write`.
7. Copiar el SHA completo de 40 caracteres del commit. Los nombres son:

```text
ghcr.io/USUARIO/nexo-web:sha-COMMIT_SHA
ghcr.io/USUARIO/nexo-api:sha-COMMIT_SHA
ghcr.io/USUARIO/nexo-bootstrap:sha-COMMIT_SHA
ghcr.io/USUARIO/nexo-db:sha-COMMIT_SHA
```

Los tres `USUARIO` deben estar en minúsculas. Cuando GHCR muestre digests verificados, es preferible sustituir posteriormente los tags por `@sha256:...` para inmovilidad del despliegue.

**Privacidad:** el repositorio y los paquetes pueden ser privados. La VPS necesita un token separado **solo lectura (`read:packages`)** para descargar de GHCR. Nunca copiar su PAT de escritura ni `GITHUB_TOKEN` a la VPS. Si GHCR devuelve `denied`, revisar permisos del paquete y acceso al repositorio.

## 3. Transferir a VPS SOLAMENTE configuración (no código ni SDKs)

Extraer `NEXO_VPS_SOLO_DESPLIEGUE_20261105.zip`. Subirlo por SSH/SCP, por ejemplo:

```powershell
scp .\NEXO_VPS_SOLO_DESPLIEGUE_20261105.zip usuario@HOST_VPS:/tmp/nexo-vps.zip
```

En la VPS (Linux):

```bash
sudo mkdir -p /opt/nexo
sudo chown "$USER":"$USER" /opt/nexo
unzip -oq /tmp/nexo-vps.zip -d /opt/nexo
cd /opt/nexo
cp .env.vps.example .env.production
chmod 600 .env.production
bash scripts/prepare-vps-secrets.sh /opt/nexo/secrets
nano .env.production
```

Editar en `.env.production` las cuatro imágenes GHCR con usuario y SHA **reales**. Conservar ruta de secretos `/opt/nexo/secrets`. No poner credenciales en el `.env`. Los secretos generados son SOLO de Nexo (DB, URL de DB, JWT), no se toman de v4nex. Respaldarlos de forma segura: perder DB password o JWT puede bloquear accesos; cambiar JWT invalida sesiones.

### Autenticación de GHCR, si las imágenes son privadas

En la VPS, introduzca el usuario y PAT **read:packages** de forma interactiva, sin mostrar el PAT en el historial de comandos:

```bash
read -rp 'GitHub usuario: ' GH_USER
read -rsp 'Token GHCR solo lectura: ' GHCR_TOKEN; echo
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GH_USER" --password-stdin
unset GHCR_TOKEN
```

Docker puede conservar credenciales en `~/.docker/config.json`: proteger el usuario Linux y permisos de ese fichero o configurar un credential helper. El usuario deploy debe tener acceso explícito a Docker (el grupo `docker` equivale a privilegios de root sobre el host); no concederlo indiscriminadamente.

## 4. Iniciar Nexo en la VPS, totalmente separado de v4nex

Antes de ejecutar, inspeccionar las decisiones de seguridad:

```bash
cd /opt/nexo
docker compose --env-file .env.production -f compose.vps.yaml config --quiet
```

Descargar imágenes GHCR (sin compilarlas en VPS), incluyendo PostgreSQL y bootstrap:

```bash
docker compose --env-file .env.production -f compose.vps.yaml --profile bootstrap pull
```

Preparar el esquema **solo si la base de Nexo es nueva** (este paso NO crea el ADMIN):

```bash
docker compose --env-file .env.production -f compose.vps.yaml up -d --wait db
docker compose --env-file .env.production -f compose.vps.yaml --profile bootstrap run --rm --no-deps bootstrap
docker compose --env-file .env.production -f compose.vps.yaml up -d --wait api web
docker compose --env-file .env.production -f compose.vps.yaml ps
```

Validar desde **dentro** del contenedor antes de conectar redes externas:

```bash
docker compose --env-file .env.production -f compose.vps.yaml exec -T web wget -q -O - http://127.0.0.1:8080/healthz
docker compose --env-file .env.production -f compose.vps.yaml exec -T web wget -q -O - http://127.0.0.1:8080/health
docker compose --env-file .env.production -f compose.vps.yaml logs --tail=80 api web db
docker stats --no-stream
df -h
```

Esperado: `ok`, JSON de API, contenedores sanos; uso de recursos dentro de la RAM libre. La API aún no tiene integración registral/financiera habilitada y **no imita respuestas reales**. Tampoco hay acceso público a Nexo todavía.

Crear primer ADMIN de Nexo cuando API esté sana, **solo una vez**. El ADMIN queda en el volumen **`nexo_database`** de PostgreSQL, no en la imagen ni en GHCR:

```bash
docker compose --env-file .env.production -f compose.vps.yaml --profile bootstrap run --rm --no-deps bootstrap node prisma/bootstrap-admin.js --interactive
```

El alta exige correo y contraseña introducidos por terminal, y comprueba el login API al terminar. Si ya hay ADMIN no crear otro por bootstrap.

**No ejecutar:** `docker compose down -v`, `docker system prune`, `docker volume prune`, recreación de redes v4nex, borrado de `/opt/nexo/secrets`, ni migraciones Prisma automáticas en DB con datos.

## 5. Obtener IPv6 y puerto internos estables (SIN configurar v4nex)

Con Nexo sano y la VPS con soporte de IPv6 en redes Docker:

```bash
cd /opt/nexo
bash scripts/setup-ipv6-network.sh
cat .env.bridge
```

El script crea **una nueva red externa Docker**, no modifica las de v4nex, y guarda en `.env.bridge`:

```text
NEXO_SHARED_NETWORK=nexo_link_ipv6
NEXO_IPV6_ADDRESS=fdXX:XXXX:XXXX:1::80
```

`fdXX...` es solo un **ejemplo**: el script genera su propio prefijo IPv6 aleatorio y comprueba que la red no existía. **No volver a ejecutar el script para otra dirección.** Si hay una colisión o Docker rechaza IPv6, revisar el estado; no cambiar redes del host ciegamente.

Agregar **solo web** a la nueva red externa:

```bash
docker compose --env-file .env.production --env-file .env.bridge -f compose.vps.yaml -f compose.bridge-ipv6.yaml config --quiet
docker compose --env-file .env.production --env-file .env.bridge -f compose.vps.yaml -f compose.bridge-ipv6.yaml up -d --no-build --no-deps web
. ./.env.bridge
docker compose --env-file .env.production --env-file .env.bridge -f compose.vps.yaml -f compose.bridge-ipv6.yaml exec -T web wget -q -O - "http://[${NEXO_IPV6_ADDRESS}]:8080/healthz"
```

**Entregar después a v4nex únicamente:**

- **IPv6 interna**: valor exacto de `NEXO_IPV6_ADDRESS` (`fd...::80`).
- **Puerto de servicio**: `8080` (HTTP sin TLS dentro de la red aislada).

v4nex deberá conectar su *contenedor* a la red externa `nexo_link_ipv6` para alcanzar esa IPv6. No modificar v4nex desde este procedimiento. Si v4nex solo acepta IPv6 **global** y no ULA Docker, este método no es compatible sin una VPN/red enrutable; averiguarlo antes de configurar el proxy.

No habilitar puertos públicos, ni 3000, ni 5432, ni 8080: el acceso público lo proveerá v4nex en su propio momento. El frontend sí escucha IPv4 e IPv6 en el 8080 **del contenedor**.

## 6. Verificaciones y siguientes fases

- Medir: `docker stats --no-stream`, `docker system df`, `df -h`, `free -h`, logs. Los límites 96/768/512 MiB **no son valores de consumo real**.
- Confirmar que Nexo y v4nex son stacks distintos; Nexo no publica puertos (`docker compose ... config`). Base/archivos permanecen en sus propios volúmenes Docker.
- Antes de exposición a usuarios reales: probar autenticación completa, roles, aislamiento entre empresas, uploads maliciosos, limitación de carga/DoS, operaciones transaccionales y base de datos, recuperación de backup; habilitar proveedores reales y documentar tratamiento de datos.
- Para nuevas versiones, solo cambiar digests GHCR, respaldo previo y `docker compose pull` + `up -d --no-build`; **no ejecutar Prisma db push sobre base existente** ni borrar volúmenes.
- `nginx:1.30.6-alpine` corrige vulnerabilidades divulgadas en octubre de 2026, pero las imágenes y dependencias deben mantenerse actualizadas mediante CI/Trivy.

## Referencias oficiales

- Docker Compose redes compartidas: https://docs.docker.com/compose/how-tos/networking/
- Docker IPv6 bridge: https://docs.docker.com/engine/daemon/ipv6/
- Compose variable interpolation/múltiples env: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/
- Docker Compose secrets: https://docs.docker.com/compose/how-tos/use-secrets/
- Docker multi-stage: https://docs.docker.com/build/building/multi-stage/
- Docker build multi-platform: https://docs.docker.com/build/building/multi-platform/
- GitHub GHCR / permisos de tokens: https://docs.github.com/es/packages/working-with-a-github-packages-registry/working-with-the-container-registry
- GitHub Actions publicación: https://docs.github.com/en/packages/managing-github-packages-using-github-actions-workflows/publishing-and-installing-a-package-with-github-actions
- Nginx versiones: https://nginx.org/news.html


## Corrección 2026-11-05: error de tmpfs y momento exacto de ADMIN

El primer comando de bootstrap (`run --rm --no-deps bootstrap`, sin comando adicional) **solo crea/verifica el esquema**, ejecutando `src/ops/init-schema.js`; no crea cuentas. El error `invalid mount path: 'nosuid'` se evitó simplificando los montajes temporales de los servicios a `:size=...` sin lista de opciones que el Docker Compose del usuario interpretó mal. Docker monta tmpfs con protecciones `noexec,nosuid,nodev` por defecto.

**Primera instalación**: `up --wait db` → `run bootstrap` (esquema) → `up --wait api web` → `run bootstrap node prisma/bootstrap-admin.js --interactive` (credenciales) → verificar inicio de sesión. En el entorno local, el volumen es `nexo_local_database`; en VPS, `nexo_database`. No existe replicación automática entre ambos. `docker compose down -v` **elimina el volumen**: nunca utilizarlo con datos que se deben preservar.

No colocar contraseñas de administrador en GitHub, Dockerfile, `.env` o argumentos de consola. El runner de CI, si ejecuta prueba de alta ADMIN, utiliza una cuenta de prueba aleatoria en una base efímera de Actions; no crea la cuenta real de la VPS.

**Lanzadores opcionales incluidos:** `scripts/create-admin-local.ps1` para Windows y `scripts/create-admin-vps.sh` para Linux; ambos requieren una terminal interactiva y que la API ya funcione. No cambian datos ni vuelven a crear un ADMIN existente.


## Incidente CVE `gosu` en imagen oficial PostgreSQL (5-nov-2026)

El workflow inicial falló en `scan-database`: Trivy detectó 26 avisos (25 HIGH, 1 CRITICAL)
correspondientes a la biblioteca estándar de Go compilada en `/usr/local/bin/gosu` v1.19 de
la imagen oficial `postgres:16-alpine`. Alpine no registró CVE en ese escaneo. El proyecto
gosu advierte que muchas alertas de biblioteca estándar no son alcanzables y recomienda
verificar alcance antes de considerar explotables los CVE.

NEXO conserva PostgreSQL 16 y su `docker-entrypoint.sh`, pero genera una imagen derivada
`nexo-db` con `su-exec` (C, repositorio oficial de paquetes Alpine) sustituyendo el binario
`gosu`. El nombre `gosu` permanece como enlace a `su-exec` para compatibilidad con
el entrypoint de PostgreSQL. `scan-database` construye y audita **esa misma variante**, y
`smoke-local` repite la inicialización, login ADMIN y persistencia tras reinicio.

- No ejecutar `docker compose down -v` ni cambiar la versión mayor de PostgreSQL.
- La sustitución es de **binario auxiliar**, no convierte ni elimina datos.
- La imagen se considera aprobada solo cuando build, escaneo Trivy y smoke real pasen.
- En VPS: añadir `NEXO_DB_IMAGE=ghcr.io/USUARIO/nexo-db:sha-SHA` a `.env.production`.
- Los primeros tests se ejecutan por Pull Request sin publicar en GHCR; la publicación
  exige lanzar manualmente el workflow en la rama `main` después de fusionar.
