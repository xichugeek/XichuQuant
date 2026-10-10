param([ValidateSet('Development','Production')][string]$Mode = 'Production', [string]$EnvFile = '.env', [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
. (Join-Path $PSScriptRoot 'local-environment.ps1')
$manifest = $null
try {
  $local = Test-XichuLocalEnvironment -EnvFile $EnvFile
  foreach ($port in @(5088,5089,5091,5092)) {
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw "Port $port is occupied. Stop the owning application explicitly; no process was terminated." }
  }
  if (-not (Test-Path -LiteralPath 'node_modules') -or -not (Test-Path -LiteralPath 'apps/quant-engine/.venv/Scripts/python.exe')) { throw 'Run setup.cmd with the same -EnvFile first.' }
  $env:API_HOST = '127.0.0.1'
  $env:BROKER_CONNECTOR_HOST = '127.0.0.1'
  $env:NEXT_TELEMETRY_DISABLED = '1'
  Invoke-XichuCommand -Command 'corepack' -Arguments @('pnpm','db:generate')
  Invoke-XichuCommand -Command 'corepack' -Arguments @('pnpm','exec','prisma','migrate','status','--schema','database/prisma/schema.prisma')
  Write-Host '[INFO] No migration, Seed or external order is executed by startup.'
  Write-Host '[XichuQuant WEB] http://localhost:5088; stop with Ctrl+C, or stop-dev.cmd after saving work.'
  New-Item -ItemType Directory -Path 'logs' -Force | Out-Null
  $manifest = Join-Path (Get-Location).Path 'logs/local-runtime.json'
  @{ pid=$PID; startedAt=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o'); root=(Get-Location).Path } | ConvertTo-Json | Set-Content -LiteralPath $manifest -Encoding utf8
  if ($Mode -eq 'Production') {
    $env:NODE_ENV = 'production'
    if (-not $SkipBuild) { Invoke-XichuCommand -Command 'corepack' -Arguments @('pnpm','build') }
    Invoke-XichuCommand -Command 'corepack' -Arguments @('pnpm','start:prod')
  } else {
    $env:NODE_ENV = 'development'
    Write-Host '[WARNING] Development mode is for local debugging and does not provide production authentication.'
    Invoke-XichuCommand -Command 'corepack' -Arguments @('pnpm','dev')
  }
} catch { Write-Host ('[ERROR] ' + (Protect-XichuOutput -Text $_.Exception.Message)); exit 1 }
finally {
  if ($manifest -and (Test-Path -LiteralPath $manifest)) {
    $owner = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
    if ($owner.pid -eq $PID) { Remove-Item -LiteralPath $manifest }
  }
}
