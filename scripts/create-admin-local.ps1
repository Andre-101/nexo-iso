# Crear ADMIN inicial exclusivamente en la DB local de Nexo.
# Ejecutar cuando API+web estén saludables. No imprime contraseña.
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not (Test-Path '.env.local')) { throw 'Primero prepare .env.local y los secretos locales.' }
Write-Host 'Alta ADMIN local. No se crea ADMIN en VPS; la base local es independiente.'
& docker compose --env-file .env.local -f compose.local.yaml --profile bootstrap run --rm --no-deps bootstrap node prisma/bootstrap-admin.js --interactive
if ($LASTEXITCODE -ne 0) { throw 'Alta ADMIN local fallo; consulte mensaje anterior y estado de API.' }
