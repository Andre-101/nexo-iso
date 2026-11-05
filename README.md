# NEXO — build local → GHCR → VPS independiente → futura IPv6 interna

**Código de origen:** ZIP NEXO del 28/10/2026. Esta variante modifica el paquete optimizado 05/11/2026, pero **no contiene avances posteriores** que no estuvieran en el ZIP fuente.

**Manual principal:** `docs/DESPLIEGUE_PASO_A_PASO.md`. Seguirlo en orden.

- `compose.local.yaml`: Docker Desktop Linux (localhost:8080), compila las imágenes.
- `compose.vps.yaml`: despliegue de imágenes existentes GHCR, sin puertos host ni v4nex.
- `compose.bridge-ipv6.yaml`: añade únicamente frontend a una red externa IPv6 bajo control del usuario, después de verificar Nexo.
- `compose.integrations.yaml`: gateways reales, opcionales, solo cuando se disponga de contratos y tokens.
- `compose.vps.ai.yaml`: proveedor de IA opcional (desactivado por defecto).
- `.github/workflows/vps-images.yml`: smoke con Postgres + pruebas y escáneres antes de publicar en GHCR.
- `scripts/prepare-local-secrets.ps1`, `scripts/prepare-local-secrets.sh`: claves locales nuevas, sin sobrescribir.
- `scripts/prepare-vps-secrets.sh`: claves solo de Nexo, sin sobrescribir.
- `scripts/setup-ipv6-network.sh`: nueva red compartida solo al final.

**Seguridad:** sin dependencias de Caddy, dominio ni v4nex; no usa datos sintéticos en modo production; puerto frontend interno 8080 IPv4+IPv6; API y DB internos; no se monta docker.sock; secretos fuera de Git.

**No equivale a producción certificada:** dependencias/OS deben pasar `npm audit`/Trivy con red, Docker y pruebas de flujos multiempresa, uploads PDF, backups y proveedores, además de revisión legal.

Para validar JS sin Docker (si Node 22 está disponible): `node --test tests/frontend-unit.test.js tests/vps-security.test.js`. Para probar de verdad, seguir el manual con Docker.
