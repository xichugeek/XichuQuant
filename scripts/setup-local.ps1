param(
  [string]$EnvFile = '.env', [switch]$CheckOnly, [switch]$InitializeDatabase,
  [string]$ExpectedDatabase, [switch]$Demo, [switch]$CreateAdmin
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
. (Join-Path $PSScriptRoot 'local-environment.ps1')
try {
  if (-not (Test-Path -LiteralPath $EnvFile)) {
    Copy-Item -LiteralPath '.env.example' -Destination $EnvFile -ErrorAction Stop
    throw 'Created an example environment file. Configure local values before rerunning setup; no dependencies or database records changed.'
  }
  $local = Test-XichuLocalEnvironment -EnvFile $EnvFile
  if ($CheckOnly) { exit 0 }
  Invoke-XichuCommand -Command 'corepack' -Arguments @('pnpm','install','--frozen-lockfile')
  $venv = 'apps/quant-engine/.venv/Scripts/python.exe'
  if (-not (Test-Path -LiteralPath $venv)) { Invoke-XichuCommand -Command $local.Python -Arguments @('-m','venv','apps/quant-engine/.venv') }
  Invoke-XichuCommand -Command $venv -Arguments @('-c','import sys; assert sys.version_info[:2] == (3,12)')
  Invoke-XichuCommand -Command $venv -Arguments @('-m','pip','install','-r','apps/quant-engine/requirements-dev.txt','--timeout','30','--retries','2')
  Invoke-XichuCommand -Command 'corepack' -Arguments @('pnpm','db:generate')
  if ($InitializeDatabase) {
    $database = $local.Config.Database
    if (-not $ExpectedDatabase -or $ExpectedDatabase -cne $database) { throw 'Initialization requires -ExpectedDatabase matching the selected database exactly.' }
    if ($database -notmatch '^XichuQuant(Local|Demo|PhaseBTest)_[A-Za-z0-9_]+$') { throw 'Initialization accepts only a dedicated XichuQuantLocal_*, XichuQuantDemo_* or XichuQuantPhaseBTest_* database.' }
    $query = "IF DB_ID(N'$database') IS NULL CREATE DATABASE [$database];"
    Invoke-XichuSqlcmd -Config $local.Config -Query $query | Out-Null
    $tableCount = @(Invoke-XichuSqlcmd -Config $local.Config -Query "SET NOCOUNT ON; SELECT COUNT(*) FROM [$database].sys.tables;" | Where-Object { $_.Trim() -match '^\d+$' })
    if ($tableCount.Count -ne 1 -or [int]$tableCount[0].Trim() -ne 0) { throw 'Initialization refuses a nonempty database. Apply reviewed migrations separately after a verified backup.' }
    Invoke-XichuCommand -Command 'corepack' -Arguments @('pnpm','db:deploy')
  }
  if ($Demo) {
    if ($env:SEED_DEMO_CONFIRM -ne 'CREATE_FICTIONAL_DEMO') { throw 'Demo requires explicit SEED_DEMO_CONFIRM=CREATE_FICTIONAL_DEMO.' }
    Invoke-XichuCommand -Command 'corepack' -Arguments @('pnpm','db:seed')
  } elseif ($CreateAdmin) {
    Invoke-XichuCommand -Command 'corepack' -Arguments @('pnpm','exec','tsx','database/prisma/bootstrap-admin.ts')
  }
  Write-Host '[OK] Setup completed. No Seed, reset, broker connection or database migration runs unless explicitly requested.'
} catch { Write-Host ('[ERROR] ' + (Protect-XichuOutput -Text $_.Exception.Message)); exit 1 }
