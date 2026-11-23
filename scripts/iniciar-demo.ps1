# Arranca BusinessFlow Intelligence en modo demostración (todo local, sin Azure).
# Uso: doble clic en iniciar-demo.cmd, o:  powershell -ExecutionPolicy Bypass -File scripts\iniciar-demo.ps1
param([switch]$SinNavegador)
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

function Paso($n, $texto) { Write-Host "`n[$n/6] $texto" -ForegroundColor Cyan }
function Fallo($texto) { Write-Host "`nERROR: $texto" -ForegroundColor Red; Read-Host 'Pulsa Intro para cerrar'; exit 1 }
function Responde($url) { try { $null = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 2; $true } catch { $false } }
function AleatorioHex($bytes) { -join ((1..$bytes) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) }) }

Write-Host 'BusinessFlow Intelligence - modo demostracion' -ForegroundColor Green
Write-Host 'Todo se ejecuta en este equipo. No se usa Azure ni ningun servicio de pago.'

Paso 1 'Comprobando requisitos'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fallo 'Falta Node.js 22 o superior (https://nodejs.org).' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fallo 'Falta Docker Desktop (https://www.docker.com/products/docker-desktop).' }
Write-Host "  Node $(node -v) y Docker encontrados"

Paso 2 'Configuracion local (.env)'
if (-not (Test-Path .env)) {
  (Get-Content .env.example -Encoding UTF8) `
    -replace 'cambia_esta_clave_local', (AleatorioHex 12) `
    -replace 'cambia_este_secreto_de_al_menos_32_caracteres', (AleatorioHex 48) `
    -replace 'cambia_esta_clave_demo', (AleatorioHex 8) `
    -replace '^DEMO_MODE=false$', 'DEMO_MODE=true' | Set-Content .env -Encoding UTF8
  Write-Host '  .env creado con secretos aleatorios (no se sube a Git)'
} else { Write-Host '  .env ya existe' }

Paso 3 'Dependencias'
if (-not (Test-Path node_modules)) {
  npm install --no-fund --no-audit --loglevel=error
  if ($LASTEXITCODE -ne 0) { Fallo 'npm install ha fallado.' }
} else { Write-Host '  Dependencias ya instaladas' }

Paso 4 'Base de datos PostgreSQL (Docker)'
cmd /c "docker info >nul 2>&1"
if ($LASTEXITCODE -ne 0) {
  Write-Host '  Docker no esta en marcha: abriendo Docker Desktop...'
  $exe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path $exe) { Start-Process $exe } else { Fallo 'Abre Docker Desktop y vuelve a ejecutar este script.' }
  $espera = 0
  do { Start-Sleep 3; $espera += 3; cmd /c "docker info >nul 2>&1" } while ($LASTEXITCODE -ne 0 -and $espera -lt 180)
  if ($LASTEXITCODE -ne 0) { Fallo 'Docker no ha arrancado en 3 minutos.' }
}
cmd /c "docker compose up -d --wait db >nul 2>&1"
if ($LASTEXITCODE -ne 0) { Fallo 'No se ha podido arrancar PostgreSQL con Docker Compose.' }
Write-Host '  PostgreSQL listo en el puerto local 5433'

Paso 5 'Datos de demostracion y circuito Bronze - Silver - Gold'
npm run --silent preparar:demo
if ($LASTEXITCODE -ne 0) { Fallo 'No se han podido preparar los datos.' }

Paso 6 'Arrancando la API y la aplicacion web'
if (-not (Responde 'http://localhost:4000/api/salud')) {
  Start-Process powershell -ArgumentList '-NoExit', '-Command', "`$Host.UI.RawUI.WindowTitle = 'BusinessFlow - API'; Set-Location '$raiz'; npm run dev:api" -WindowStyle Minimized
}
if (-not (Responde 'http://localhost:5180')) {
  Start-Process powershell -ArgumentList '-NoExit', '-Command', "`$Host.UI.RawUI.WindowTitle = 'BusinessFlow - Web'; Set-Location '$raiz'; npm run dev:web" -WindowStyle Minimized
}
$espera = 0
while (-not ((Responde 'http://localhost:4000/api/salud') -and (Responde 'http://localhost:5180')) -and $espera -lt 90) { Start-Sleep 2; $espera += 2 }
if ($espera -ge 90) { Fallo 'La aplicacion no ha respondido a tiempo. Revisa las dos ventanas minimizadas.' }

Write-Host "`nLista: http://localhost:5180" -ForegroundColor Green
Write-Host 'En la pantalla de acceso pulsa "Entrar como Administracion" (no hace falta contrasena en modo demo).'
Write-Host 'Para parar: cierra las dos ventanas minimizadas y ejecuta detener-demo.cmd.'
if (-not $SinNavegador) { Start-Process 'http://localhost:5180' }
