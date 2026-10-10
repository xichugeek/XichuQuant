param(
  [Parameter(Mandatory)][ValidatePattern('^XichuQuantPhaseBTest_[A-Za-z0-9_]+$')][string]$TestDatabase,
  [ValidateSet('Prepare', 'Seed', 'Integration', 'Browser')][string]$Step = 'Prepare'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
. (Join-Path $PSScriptRoot 'operations-common.ps1')
$taskConfig = Get-XichuDatabaseConfig -RootPath $taskRoot
if ($taskConfig.Database -eq $TestDatabase) { throw 'Test and business databases must differ.' }
$taskLine = Get-Content -LiteralPath (Join-Path $taskRoot '.env') | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
$taskUrl = ($taskLine -replace '^DATABASE_URL=', '').Trim().Trim('"')
if ([regex]::Matches($taskUrl, '(?i)(?:^|;)database=[^;]*').Count -ne 1) { throw 'Database URL must have exactly one database field.' }
$env:DATABASE_URL = [regex]::Replace($taskUrl, '(?i)(^|;)database=[^;]*', ('$1database=' + $TestDatabase))
if ([regex]::Match($env:DATABASE_URL, '(?i)(?:^|;)database=([^;]*)').Groups[1].Value -ne $TestDatabase) { throw 'Isolated target verification failed.' }
$env:SEED_DEMO_CONFIRM = 'CREATE_FICTIONAL_DEMO'
if (-not $env:SEED_ADMIN_PASSWORD) { $env:SEED_ADMIN_PASSWORD = "Synthetic-$([guid]::NewGuid())!" }
$env:BROKER_CONNECTOR_MODE = 'OFFLINE'
$env:BROKER_CONNECTOR_ENVIRONMENT = 'DISABLED'
$env:IBKR_PAPER_ACCOUNT_ID = ''
$env:BROKER_PAPER_ACCOUNT_HASH_ALLOWLIST = ''
$env:IBKR_TWS_API_READ_ONLY = 'true'
$env:XICHURISK_DATA_MODE = 'DEMO'
$env:NEXT_PUBLIC_DATA_MODE = 'DEMO'
if ($Step -eq 'Prepare') {
  Invoke-XichuSqlcmd -Config $taskConfig -Query "IF DB_ID('$TestDatabase') IS NULL CREATE DATABASE [$TestDatabase];" | Out-Null
  pnpm db:deploy
} elseif ($Step -eq 'Seed') {
  pnpm db:seed
} elseif ($Step -eq 'Integration') {
  pnpm exec tsx --tsconfig apps/api/tsconfig.json --test tests/integration/phase-b.integration.test.ts
} else {
  # Do not accidentally reuse services connected to a business database.
  foreach ($taskPort in @(5088, 5089, 5091, 5092)) {
    if (Get-NetTCPConnection -State Listen -LocalPort $taskPort -ErrorAction SilentlyContinue) {
      throw "Port $taskPort is already occupied. Stop it explicitly before isolated browser verification."
    }
  }
  pnpm exec playwright test --config playwright.phase-b.config.ts
}
exit $LASTEXITCODE
