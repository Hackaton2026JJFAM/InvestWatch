# Restart lokalnego stosu InvestWatch bez Dockera.
# Uzycie (z katalogu repo):  powershell -ExecutionPolicy Bypass -File tools\devstack\restart.ps1 [-ResetDb]
# Logi: .devdata\logs\<serwis>.log
param([switch]$ResetDb)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$logs = Join-Path $root '.devdata\logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$py = Join-Path $root '.venv\Scripts\python.exe'

function Stop-Port([int]$port) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) { Stop-Process -Id $c.OwningProcess -Force -Confirm:$false -ErrorAction SilentlyContinue }
}

function Start-Svc($name, $exe, $argList, $dir) {
  $out = Join-Path $logs "$name.log"
  $err = Join-Path $logs "$name.err.log"
  Start-Process -FilePath $exe -ArgumentList $argList -WorkingDirectory $dir -WindowStyle Hidden `
    -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
}

function Wait-Url($name, $url, [int]$seconds = 60) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $url | Out-Null; Write-Host "  OK   $name ($url)"; return $true } catch { Start-Sleep -Milliseconds 700 }
  }
  Write-Host "  BLAD $name - zobacz .devdata\logs\$name.err.log" -ForegroundColor Red
  return $false
}

Write-Host 'Zatrzymywanie serwisow...'
5173, 4000, 8002, 8001 | ForEach-Object { Stop-Port $_ }

if ($ResetDb) {
  Stop-Port 5433
  Get-Process postgres -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false
  Start-Sleep -Seconds 2
  Remove-Item -Recurse -Force (Join-Path $root '.devdata\pg') -ErrorAction SilentlyContinue -Confirm:$false
}

$dbUp = [bool](Get-NetTCPConnection -LocalPort 5433 -State Listen -ErrorAction SilentlyContinue)
if (-not $dbUp) {
  Write-Host 'Start PostgreSQL :5433'
  Start-Svc 'postgres' 'node' 'start-db.mjs' (Join-Path $root 'tools\devstack')
  $deadline = (Get-Date).AddSeconds(60)
  while (-not (Get-NetTCPConnection -LocalPort 5433 -State Listen -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
} else { Write-Host 'PostgreSQL :5433 juz dziala (pomijam; -ResetDb tworzy baze od zera)' }

Write-Host 'Start serwisow...'
Start-Svc 'scraper' $py '-m uvicorn app.main:app --port 8001' (Join-Path $root 'services\scraper')
Start-Svc 'analyzer' $py '-m uvicorn app.main:app --port 8002' (Join-Path $root 'services\analyzer')
$null = Wait-Url 'scraper' 'http://127.0.0.1:8001/health'
$null = Wait-Url 'analyzer' 'http://127.0.0.1:8002/health'

$env:DATABASE_URL = 'postgres://investwatch:investwatch@localhost:5433/investwatch'
$env:REDIS_URL = 'memory'
$env:SAMPLES_DIR = (Join-Path $root 'data\samples')
$env:SEED_DEMO = 'true'
Start-Svc 'backend' 'node' 'src/index.js' (Join-Path $root 'services\backend')
$null = Wait-Url 'backend' 'http://127.0.0.1:4000/api/health'

Start-Svc 'frontend' 'node' 'node_modules/vite/bin/vite.js --port 5173 --strictPort' (Join-Path $root 'services\frontend')
$null = Wait-Url 'frontend' 'http://localhost:5173/'

Write-Host ''
Write-Host 'Dashboard: http://localhost:5173' -ForegroundColor Green
