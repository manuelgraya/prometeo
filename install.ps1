# Instala o actualiza PROMETEO en Windows. En PowerShell:
#   powershell -ExecutionPolicy ByPass -c "irm https://github.com/manuelgraya/prometeo/releases/latest/download/install.ps1 | iex"
#
# Deja PROMETEO en %LOCALAPPDATA%\Prometeo y el comando `prometeo` en %USERPROFILE%\.local\bin.
# Al actualizar conserva los proyectos, los ajustes, los modelos de voz y el entorno de Python.
# Variables opcionales: PROMETEO_ZIP (zip local en vez de descargarlo) y PROMETEO_DESTINO (carpeta).
# (Solo ASCII a proposito: PowerShell 5 lee mal las tildes de un script descargado.)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # sin la barra de progreso, Invoke-WebRequest es mucho mas rapido
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Repo = 'manuelgraya/prometeo'
$ZipUrl = "https://github.com/$Repo/releases/latest/download/prometeo-windows.zip"
$Destino = if ($env:PROMETEO_DESTINO) { $env:PROMETEO_DESTINO } else { Join-Path $env:LOCALAPPDATA 'Prometeo' }
$Bin = Join-Path $HOME '.local\bin'

function Paso($msg) { Write-Host "> $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "OK $msg" -ForegroundColor Green }
function Aviso($msg) { Write-Host "! $msg" -ForegroundColor Yellow }

# 1. uv (trae su propio Python: no hace falta instalar Python)
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Paso 'Instalando uv...'
    Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
}
if ($env:Path -notlike "*$Bin*") { $env:Path = "$Bin;$env:Path" }
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'No se encuentra uv tras instalarlo. Abre una terminal nueva y repite.' }

# 2. No actualizar con PROMETEO abierto: Windows bloquea los archivos en uso
if (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) {
    throw 'PROMETEO esta en marcha (puerto 8765). Cierralo con Ctrl+C y vuelve a ejecutar el instalador.'
}

# 3. Descargar y descomprimir la release
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("prometeo-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    $zip = $env:PROMETEO_ZIP
    if (-not $zip) {
        Paso "Descargando la ultima version de PROMETEO..."
        $zip = Join-Path $tmp 'prometeo.zip'
        Invoke-WebRequest -UseBasicParsing -Uri $ZipUrl -OutFile $zip
    }
    $nuevo = Join-Path $tmp 'app'
    Expand-Archive -Path $zip -DestinationPath $nuevo
    $version = (Get-Content (Join-Path $nuevo 'release.json') -Raw | ConvertFrom-Json).version

    # 4. Copiar encima. Solo se borran carpetas que son 100 % de la app; nunca projects\,
    #    settings.local.json, backend\models, backend\cache, backend\.venv ni agent\ (audios de FAQ grabados).
    $existia = Test-Path (Join-Path $Destino 'release.json')
    Paso ("{0} PROMETEO {1} en {2}" -f $(if ($existia) { 'Actualizando' } else { 'Instalando' }), $version, $Destino)
    New-Item -ItemType Directory -Force -Path $Destino | Out-Null
    foreach ($d in 'bin', 'backend\app', 'frontend', 'scripts') {
        $p = Join-Path $Destino $d
        if (Test-Path $p) { Remove-Item -Recurse -Force $p }
    }
    robocopy $nuevo $Destino /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy fallo con el codigo $LASTEXITCODE" }
} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

# 5. Dependencias de Python, modelos de voz y comando `prometeo`
$prometeo = Join-Path $Destino 'bin\prometeo.cmd'
Paso 'Instalando dependencias (la primera vez tarda unos minutos)...'
Push-Location (Join-Path $Destino 'backend')
try { uv sync --locked --inexact; if ($LASTEXITCODE -ne 0) { throw 'uv sync fallo' } } finally { Pop-Location }
& $prometeo models
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron descargar los modelos de voz' }
& $prometeo install
if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar el comando prometeo' }

# 6. Claude Code: PROMETEO usa tu suscripcion de Claude (claude login)
Ok "PROMETEO $version instalado."
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Aviso 'Falta Claude Code. Instalalo y entra con tu cuenta:'
    Write-Host '    irm https://claude.ai/install.ps1 | iex'
    Write-Host '    claude login'
} elseif (-not (Test-Path (Join-Path $HOME '.claude\.credentials.json'))) {
    Aviso 'Entra con tu cuenta de Claude:  claude login'
}
Write-Host ''
Write-Host 'Abre una terminal nueva y ejecuta:  prometeo --open'
Write-Host 'Comprueba que todo esta bien con:   prometeo doctor'
