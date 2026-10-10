. (Join-Path $PSScriptRoot 'operations-common.ps1')

function Test-XichuLocalEnvironment {
  param([Parameter(Mandatory)][string]$EnvFile, [switch]$SkipDatabase)
  $os = Get-CimInstance Win32_OperatingSystem
  if ($os.OSArchitecture -notmatch '64' -or [version]$os.Version -lt [version]'10.0') { throw 'Windows 10/11 or Server x64 is required.' }
  $nodeVersion = (& node --version).TrimStart('v')
  if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion -lt [version]'22.12.0') { throw 'Node.js >= 22.12.0 is required.' }
  if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) { throw 'Corepack is required; install it for the supported Node version.' }
  $pnpmVersion = (& corepack pnpm --version).Trim()
  if ($LASTEXITCODE -ne 0 -or $pnpmVersion -ne '11.9.0') { throw 'Use the packageManager version in package.json: pnpm 11.9.0.' }
  $python = if (Get-Command py -ErrorAction SilentlyContinue) { & py -3.12 -c 'import sys; print(sys.executable)' } else { & python -c 'import sys; assert sys.version_info[:2] == (3,12); print(sys.executable)' }
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath ([string]$python))) { throw 'Install Python 3.12 x64; check py -3.12 --version.' }
  $values = Import-XichuEnvironment -Path $EnvFile
  foreach ($key in @('DATABASE_URL','JWT_SECRET','BROKER_ACCOUNT_HASH_PEPPER')) {
    if (-not $values.ContainsKey($key) -or $values[$key] -match 'INVALID_EXAMPLE' -or $values[$key].Length -lt 16) { throw "Configure $key in the selected environment file; values are not printed." }
  }
  if ($env:SESSION_TTL_HOURS -and ($env:SESSION_TTL_HOURS -notmatch '^\d+(\.\d+)?$' -or [double]$env:SESSION_TTL_HOURS -lt 1 -or [double]$env:SESSION_TTL_HOURS -gt 24)) { throw 'SESSION_TTL_HOURS must be between 1 and 24.' }
  if ($env:BROKER_CONNECTOR_MODE -notin @('OFFLINE','MOCK','READ_ONLY_LIVE','IBKR_PAPER')) { throw 'BROKER_CONNECTOR_MODE is invalid; do not guess broker connectivity.' }
  foreach ($key in @('REQUIRE_HTTPS','IBKR_TWS_API_READ_ONLY','PUBLIC_DEMO_READ_ONLY')) {
    $value = [Environment]::GetEnvironmentVariable($key, 'Process')
    if ($value -and $value -cnotin @('true','false')) { throw "$key must be exactly true or false." }
  }
  $config = Get-XichuDatabaseConfig -RootPath (Split-Path -Parent $PSScriptRoot) -EnvFile $EnvFile
  if (-not $SkipDatabase) {
    $version = @(Invoke-XichuSqlcmd -Config $config -Query "SET NOCOUNT ON; SELECT CONVERT(varchar(10),SERVERPROPERTY('ProductMajorVersion'));" | Where-Object { $_.Trim() -match '^\d+$' })
    if ($version.Count -ne 1 -or [int]$version[0].Trim() -lt 15) { throw 'SQL Server 2019 or later with SQL authentication and sqlcmd is required.' }
  }
  Write-Host "[OK] Windows x64; Node $nodeVersion; pnpm $pnpmVersion; Python 3.12; selected database configuration verified."
  return [pscustomobject]@{ Config=$config; Python=([string]$python).Trim(); Values=$values }
}
