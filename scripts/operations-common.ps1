Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Read-XichuEnvironment {
  param([Parameter(Mandatory)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'Environment file is missing. Copy .env.example and configure it locally.' }
  $values = @{}
  foreach ($raw in Get-Content -LiteralPath $Path) {
    $line = $raw.Trim()
    if (-not $line -or $line.StartsWith('#')) { continue }
    if ($line -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { throw 'Invalid environment assignment. Values are never evaluated as shell commands.' }
    $key = $Matches[1]; $value = $Matches[2].Trim()
    if ($values.ContainsKey($key)) { throw "Duplicate environment key: $key" }
    if ($value.StartsWith('"') -or $value.StartsWith("'")) {
      if ($value.Length -lt 2 -or $value.Substring($value.Length - 1) -ne $value.Substring(0,1)) { throw "Unclosed environment quote: $key" }
      $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$key] = $value
  }
  return $values
}

function Import-XichuEnvironment {
  param([Parameter(Mandatory)][string]$Path)
  $values = Read-XichuEnvironment -Path $Path
  foreach ($key in $values.Keys) { [Environment]::SetEnvironmentVariable($key, $values[$key], 'Process') }
  $env:XICHURISK_ENV_ISOLATED = 'true'
  # Windows PowerShell removes empty env values. Preserve the names for Node before
  # Prisma tries to fill missing variables from the developer's root .env.
  $env:XICHURISK_EMPTY_ENV_KEYS = ConvertTo-Json -InputObject @($values.Keys | Where-Object { $values[$_] -eq '' }) -Compress
  return $values
}

function Protect-XichuOutput {
  param([string]$Text)
  foreach ($entry in Get-ChildItem Env:) {
    if ($entry.Name -match 'PASSWORD|SECRET|TOKEN|API_KEY|PEPPER|ACCOUNT_ID|ALLOWLIST|DATABASE_URL' -and $entry.Value.Length -ge 4) {
      $Text = $Text.Replace($entry.Value, '[REDACTED]')
    }
  }
  $passwordMatch = [regex]::Match([string]$env:DATABASE_URL, '(?i)(?:password|pwd)=([^;]+)')
  if ($passwordMatch.Success) { $Text = $Text.Replace($passwordMatch.Groups[1].Value, '[REDACTED]').Replace([uri]::UnescapeDataString($passwordMatch.Groups[1].Value), '[REDACTED]') }
  return $Text
}

function Invoke-XichuCommand {
  param([Parameter(Mandatory)][string]$Command, [string[]]$Arguments = @())
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $Command @Arguments 2>&1 | ForEach-Object { Write-Host (Protect-XichuOutput -Text ([string]$_)) }
    $commandExitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousPreference }
  if ($commandExitCode -ne 0) { throw "Command failed ($Command), exit code $commandExitCode. See the redacted output above." }
}

function Get-XichuDatabaseConfig {
  param([string]$RootPath, [string]$EnvFile)

  $envPath = if ($EnvFile) { $EnvFile } else { Join-Path $RootPath '.env' }
  $values = Read-XichuEnvironment -Path $envPath
  if (-not $values.ContainsKey('DATABASE_URL')) { throw 'Environment file does not contain DATABASE_URL.' }
  $url = $values['DATABASE_URL']
  foreach ($field in @('database','user','password')) {
    if ([regex]::Matches($url, "(?i)(?:^|;)$field=").Count -ne 1) { throw "DATABASE_URL must contain exactly one $field parameter." }
  }
  if ($url -like '*INVALID_EXAMPLE*') { throw "DATABASE_URL still contains an invalid placeholder." }
  $pattern = '^sqlserver://(?<host>[^:;]+):(?<port>\d+);database=(?<database>[^;]+);user=(?<user>[^;]+);password=(?<password>[^;]+);'
  $urlMatch = [regex]::Match($url, $pattern)
  if (-not $urlMatch.Success) {
    throw "DATABASE_URL format is unsupported. Connection parameters will not be guessed."
  }
  $databaseName = $urlMatch.Groups['database'].Value
  if ($databaseName -notmatch '^[A-Za-z0-9_]+$') { throw "Database name contains unsafe characters." }
  return [pscustomobject]@{
    Database = $databaseName
    Host = $urlMatch.Groups['host'].Value
    Password = [uri]::UnescapeDataString($urlMatch.Groups['password'].Value)
    Port = $urlMatch.Groups['port'].Value
    Server = "$($urlMatch.Groups['host'].Value),$($urlMatch.Groups['port'].Value)"
    User = $urlMatch.Groups['user'].Value
  }
}

function Invoke-XichuSqlcmd {
  param(
    [Parameter(Mandatory)]$Config,
    [Parameter(Mandatory)][string]$Query
  )
  $sqlcmd = Get-Command sqlcmd -ErrorAction SilentlyContinue
  if (-not $sqlcmd) { throw "sqlcmd was not found. Install Microsoft SQL Server command-line utilities." }
  $previousPassword = $env:SQLCMDPASSWORD
  try {
    $env:SQLCMDPASSWORD = $Config.Password
    $result = & $sqlcmd.Source -S $Config.Server -U $Config.User -d master -b -h -1 -W -Q $Query
    if ($LASTEXITCODE -ne 0) {
      throw "sqlcmd failed with exit code $LASTEXITCODE. Check connectivity, permissions and the selected database."
    }
    return $result
  } finally {
    $env:SQLCMDPASSWORD = $previousPassword
  }
}

function Write-XichuOperationAudit {
  param(
    [string]$ApiUrl = "http://localhost:5089",
    [Parameter(Mandatory)][string]$Operation,
    [Parameter(Mandatory)][string]$TargetDatabase,
    [Parameter(Mandatory)][string]$Status,
    [string]$Reference,
    [string]$Verification,
    [string]$ErrorMessage
  )
  $body = @{
    actorId = "$env:USERNAME@local-operations"
    operation = $Operation
    targetDatabase = $TargetDatabase
    status = $Status
  }
  if ($Reference) { $body.backupReference = $Reference }
  if ($Verification) { $body.verificationJson = $Verification }
  if ($ErrorMessage) { $body.errorMessage = $ErrorMessage }
  try {
    Invoke-RestMethod -Method Post -Uri "$ApiUrl/paper-execution/backup-runs" -ContentType "application/json" -Body ($body | ConvertTo-Json -Compress) -TimeoutSec 5 | Out-Null
  } catch {
    Write-Warning "API is unavailable; the operation result was not written to the UI audit table."
  }
}
