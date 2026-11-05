# Windows PowerShell 5.1/7+: no sobrescribe contraseñas previas.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dir = Join-Path $root '.local-secrets'
New-Item -Path $dir -ItemType Directory -Force | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
function HexRandom([int]$bytes) {
    $data = New-Object byte[] $bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($data) } finally { $rng.Dispose() }
    return [System.BitConverter]::ToString($data).Replace('-', '').ToLowerInvariant()
}
function Write-Once([string]$name,[string]$value) {
    $target = Join-Path $dir $name
    if (-not [System.IO.File]::Exists($target)) {
        $stream = New-Object System.IO.FileStream($target, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
        try {
            $raw = $utf8.GetBytes($value + "`n")
            $stream.Write($raw,0,$raw.Length)
        } finally { $stream.Dispose() }
        Write-Host "Generado: $name"
    } else { Write-Host "Conservado: $name" }
}
Write-Once 'db_password' (HexRandom 32)
Write-Once 'jwt_secret' (HexRandom 48)
$pass = ([System.IO.File]::ReadAllText((Join-Path $dir 'db_password'))).Trim()
if ($pass -notmatch '^[0-9a-f]{64}$') { throw 'db_password no tiene el formato esperado; revisión manual necesaria.' }
Write-Once 'database_url' "postgresql://nexo:$pass@db:5432/nexo?schema=public"
Write-Host 'Listo. Los archivos en .local-secrets no se deben subir a Git.'
