# Auditoría técnica de seguridad — NEXO distribuible para VPS

Fecha: 5 de noviembre de 2026. Origen: ZIP de **28/10/2026**. Cobertura: inspección estática de aproximadamente 237 entradas (frontend estático, Node/Express, Prisma, PDFs, Docker, configuración), comparación con documentación oficial, endurecimiento básico y 18 pruebas locales. **No se han ejecutado contenedores ni ataques externos.** Estado: **apto para evaluación/pipeline, NO aprobación de producción**.

## Hallazgos corregidos en esta variante

| Riesgo y evidencia | Tratamiento aplicado | Validación posible |
|---|---|---|
| Nginx original `1.29-alpine`: rama anterior a parches críticos publicados en octubre de 2026 | Nueva base `nginx:1.30.6-alpine`; rebuild/escaneo recurrente por CI | Configuración inspeccionada; descarga/build pendiente CI |
| Construcción original de todos los servicios directamente en destino; VPS 2vCPU/4GB | GitHub Actions construye web/API/bootstrap; tres artefactos GHCR identificados por commit/digest; VPS hace pull | YAML estático; CI pendiente |
| Cuatro servicios de demostración (2 DB + 2 gateways) ocupan recursos innecesarios y pueden representar datos ficticios como reales | Compose VPS sin demos y `DATA_MODE=production` obligatorio | Test estático |
| Base de datos y API podrían publicarse por error en un despliegue improvisado | Redes `nexo_app` y `nexo_data` internas; red de salida `nexo_egress` solo para API y gateways HTTPS; único `nexo-web` sobre `app_edge` de Caddy; **ningún puerto host** | Test estático; comprobar `docker compose config` |
| Variables con credenciales en entornos Compose, legibles por herramientas Docker y potenciales logs | Docker secrets file mounts para JWT, URL DB, contraseñas y gateways; lector `*_FILE` previo a inicio de Node/Prisma | Test de lectura/errores de secretos; permisos host por validar |
| POST login sin límite visible de intentos | Límite temporal por cuenta en memoria + límite global por origen Caddy en Nginx | Test 429 y reinicio de contador |
| JWT sin restricciones explícitas de `alg`, `iss` y `aud`, expiración predeterminada 7 días | Firmar/verificar HS256, emisor/audiencia fijos y 8 h de duración para despliegue VPS | Inspección; prueba real con dependencias pendiente |
| Contraseñas nuevas sin máximo de bytes; correo de alta normalizado de forma desigual | Alta: 12 caracteres mínimo, 72 bytes máximo por semántica bcrypt; normalización de correo, longitud y forma; login con tope de entrada | Inspección; regresión de cuenta por probar |
| `req.query` de Express usa por defecto parser `qs` con historial de avisos | `app.set('query parser','simple')`; lockfile ya fija `qs@6.16.1` | Inspección y tests sin DB |
| Endpoint de APIs sin cabeceras suficientes ante variaciones de rutas y exposición de diagnósticos | `Cache-Control: no-store` en API y web, CSP/no-sniff/referrer; `/ready` no enrutable desde web; cabeceras HTTP y timeouts | Inspección y prueba HTTP pendiente |
| Recursos de la VPS sin límites explícitos en orquestador de producción | `mem_limit`, `pids_limit`, rootfs solo lectura, `no-new-privileges`, `cap_drop` web/API, red y volumen dedicados, rotación logs | YAML inspeccionado; consumo por medir |
| Adaptadores configurables podían aceptar IP HTTPS literales y nombres locales (riesgo por errores de configuración/SSRF) | Restringidos IP literales y sufijos locales en URL de gateway; HTTPS obligatorio | Tests puros; DNS rebinding aún requiere controles de red |
| Inicialización Prisma podía intentar generar cliente en rootfs read-only | `db push --skip-generate` solo en base inicial vacía, cliente construido en CI | Prueba docker+Postgres pendiente |

## Controles ya presentes que se preservaron

- Acceso autenticado por JWT y autorización específica por roles/proyectos en muchas rutas; comprobación de sesión contra usuario persistido.
- Archivos privados fuera del root estático y nombres de archivo aleatorios; validación inicial de firma PDF, límites de 10 MB; verificaciones adicionales de hash y ruta en controladores de documentos.
- Consentimientos/estados de IA por proyecto y modo de datos `production` diferente de `demo`, con rechazo si no se configura fuente real.
- Restricción de CORS por origen; CSP restrictiva para scripts estáticos; no dependencia de Node ni `npm install` en la imagen web.
- Evitar autoalteración del esquema y autoalta de administrador durante el arranque ordinario.

## Riesgos NO resueltos y criterios de bloqueo para producción

**P0 — Bloqueo funcional:** no se dispone de gateways registral y financiero reales, tokens/contratos ni pruebas de negocio; `DATA_MODE=production` no debe falsearse. El flujo completo requiere validación por clientes piloto y autorizaciones de tratamiento de datos.

**P0 — Dependencias y sistema operativo:** el sandbox no tiene Docker y `registry.npmjs.org` no resuelve (`EAI_AGAIN` en `npm audit`). No puedo afirmar 0 CVE ni medida de tamaño real. GH Actions está configurado para bloquear artefactos con resultados HIGH/CRITICAL corregibles de `npm audit` y Trivy, pero debe ejecutarse realmente y analizar también los avisos moderados y no corregidos. `Prisma 5.22.0` es antiguo; su actualización mayor exige una migración compatible con 51 modelos, pruebas reales y no se ha ejecutado a ciegas. Tampoco se certificó el SBOM.

**P0 — Base y migraciones:** no hay estrategia probada de migración versionada para datos existentes. `db push` inicial sobre DB *nueva* no equivale a ejecutar/aprobar las reglas SQL adicionales de `proyecto/prisma/sql`. Validar restricciones integradas, backup, restauración y consistencia antes de uso real.

**P1 — Upload/documentos:** aunque hay control de extensión, `mimetype`, firma, tamaño y almacén privado, la firma `%PDF-` no comprueba PDF completo ni ausencia de malware. Poppler procesa archivos no confiables; es fundamental mantenerlo parcheado, agregar antivirus/escaneo aislado, límites de cuotas y pruebas de PDF malicioso antes de exponer uploads a clientes no confiables. Los límites de memoria de contenedor mitigan el impacto pero no impiden todos los ataques.

**P1 — Autenticación:** la limitación por email vive en memoria de **un único proceso** y se reinicia tras reiniciar el contenedor; un atacante puede provocar bloqueo temporal dirigido. Se requiere rate limiting compartido/captcha/MFA/admin 2FA según el riesgo real. El JWT permanece en `sessionStorage` (no cookie HttpOnly), por lo que una XSS que eluda CSP puede robar tokens. No cambiar el mecanismo de sesión sin implementar pruebas de compatibilidad y CSRF. Rotación de JWT inválida sesiones viejas por diseño.

**P1 — Autorización multidominio:** inspección estática no demuestra ausencia de IDOR o de carreras entre cambios de representante/proyecto, altas, descargas y cambios de rol. Realizar test E2E con dos empresas, un representante antiguo, un consultor no asignado y roles malformados. Requiere prueba de carga/concurrencia contra DB y permisos por recurso, no solo tests de DOM.

**P1 — Entorno compartido:** no se verificó el Caddyfile real, `app_edge`, reglas de Caddy para host comodín, A/AAAA DNS, firewall, ni consumo de contenedores v4nex. No aplicar cambios al proxy sin revisión; no conectar API/DB a red compartida. `Docker` brinda aislamiento parcial, no una frontera idéntica a máquinas virtuales; proteger socket Docker, usuario deploy y actualizaciones del host.

**P1 — Retención/costos:** PDF y DB ocupan discos persistentes sin cuota por tenant garantizada; solo tamaño por archivo. Implementar límites por cliente, retención contractual, escaneos de malware, respaldo cifrado y prueba de restauración. Evitar logs con datos sensibles, minimizar y auditar acceso a documentos, configurar alertas de uso de disco y rate limiting de API.

**P1 — Salida hacia proveedores/IA:** el backend puede llamar gateways HTTPS configurados. Aun con bloqueo de IP literal, un DNS malicioso puede resolver a IP privada; aplicar reglas egress/resolución/allowlist de proveedores en firewall o egress proxy. No subir PDFs a Anthropic ni a otro proveedor sin las autorizaciones/documentos aplicables. La variante VPS deshabilita IA por defecto y no aloja Ollama, para no agotar la memoria del servidor.

**P2 — Supply chain:** en GitHub Actions se usan versiones de acciones identificadas por tags. Para cadena de suministro especialmente sensible, fijar SHA completos verificados, configurar reglas de protección de rama, revisión de dependencias, permisos mínimos de workflow y firma/verificación del digest antes de desplegar.

## Verificaciones realizadas

- Inspección de versiones resueltas en lockfile: Express `4.22.2`, `multer 2.5.0`, `qs 6.16.1`, `jsonwebtoken 9.0.3`, Prisma `5.22.0`.
- Validación de sintaxis JavaScript con Node 22 (API, Prisma y JS frontend), sin instalar `node_modules`.
- `node --test tests/frontend-unit.test.js tests/vps-security.test.js`: **18/18**, solo pruebas independientes de Docker/DB; no equivalen a pentest.
- Parseo estructural de YAML con PyYAML y verificación de contenido sin puertos de host ni demos.
- **No realizado:** `npm ci`, `npm audit` online, compilación de Docker, Trivy, ejecución de Postgres, pruebas de HTTPS, escaneo DAST, pruebas de consumo.

## Fuentes verificables

1. Nginx: avisos de versiones/seguridad hasta octubre 2026 — https://nginx.org/news.html
2. Docker: buenas prácticas de construcción — https://docs.docker.com/build/building/best-practices/
3. Docker: compilación multi-stage — https://docs.docker.com/get-started/docker-concepts/building-images/multi-stage-builds/
4. Docker: cache optimizado — https://docs.docker.com/build/cache/optimize/
5. Docker: secretos Compose — https://docs.docker.com/compose/how-tos/use-secrets/
6. Docker: Compose servicios/recursos — https://docs.docker.com/reference/compose-file/services/
7. Docker: procedencia y SBOM — https://docs.docker.com/build/ci/github-actions/attestations/
8. OWASP: autenticación y limitación de intentos — https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
9. OWASP: gestión de subida de archivos — https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
10. Express: historial de actualizaciones de seguridad — https://expressjs.com/en/advanced/security-updates/
11. Multer: avisos de DoS corregidos en 2.2/2.3 — https://github.com/expressjs/multer/security/advisories/GHSA-wc9g-mqfw-jrwm

**Dictamen:** infraestructura y código parcialmente endurecidos. **No es posible certificar que todas las vulnerabilidades estén encontradas o corregidas. La preparación de producción permanece BLOQUEADA** hasta superar pipeline, integración, pruebas de autorización, migración y restauración.


## Actualización de despliegue independiente — 05/11/2026

- Corregido **acoplamiento innecesario** con la red `app_edge` y el subdominio de v4nex. Nexo inicia por sus propias redes, y el enlace IPv6 es un overlay opcional.
- Agregado Nginx `listen [::]:8080 ipv6only=on`, separado de `listen 8080`, con IPv6 estática en red Docker ULA creada posteriormente. No se publica puerto host.
- Corregida validación del dominio: `FRONTEND_URL` ya no es obligatoria; si se define en producción debe ser origen HTTPS válido. No se habilita CORS de manera indiscriminada: producción usa solicitudes same-origin por /api/ en Nginx, sin cabeceras Access-Control-Allow-Origin.
- `DATA_MODE=production` permite iniciar sin proveedores externos **solo con integraciones explícitamente apagadas** (`REGISTRY_INTEGRATION_ENABLED=0`, `FINANCE_INTEGRATION_ENABLED=0`). Registro devuelve error tipado, finanzas devuelve NO_CONFIGURADO; ninguna usa datos simulados ni hace llamadas externas a proveedores inexistentes. Activar las integraciones obliga a TLS HTTPS, token real y base legal marcada como confirmada.
- Agregada prueba Docker real con PostgreSQL para GH Actions antes de publicar; no ejecutada en este entorno. Se requieren resultados del workflow para comprobar builds y funcionalidad real.
- 22 pruebas Node completadas localmente; aún no ejecutadas en contenedores. Sin Docker Engine ni acceso SSH/GHCR de publicación en esta sesión.
- La VPS solo necesita archivos Compose, variables y secretos: **el repositorio de código y el entorno de compilación NO se copian al servidor**.
- Riesgo pendiente: origen real del contenido para usuarios y lógica de permisos, migraciones adicionales (`prisma/sql`), seguridad de PDF, cobertura multiempresa, DAST, dependencias vulnerables y versionado de DB. Las pruebas unitarias y arranque no demuestran seguridad empresarial completa.
- La IPv6 generada es privada ULA en bridge; v4nex debe estar en el mismo Docker Engine y conectar su contenedor a la red, o usar una red enrutada. Si necesita IPv6 global directamente, no se garantiza la topología propuesta.
