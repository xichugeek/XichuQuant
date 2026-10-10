param(
  [switch]$ValidateOnly,
  [string]$ApiUrl = "http://localhost:5089",
  [string]$EnvFile = '.env',
  [switch]$SkipApiAudit,
  [switch]$PruneExpired
)

. (Join-Path $PSScriptRoot "operations-common.ps1")
$rootPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$config = Get-XichuDatabaseConfig -RootPath $rootPath -EnvFile $EnvFile

if ($ValidateOnly) {
  if (-not (Get-Command sqlcmd -ErrorAction SilentlyContinue)) { throw "sqlcmd is unavailable." }
  Write-Host "[OK] Backup script, sqlcmd, and database configuration passed validation."
  exit 0
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$fileName = "$($config.Database)_$stamp.bak"
$database = $config.Database
$query = @"
SET NOCOUNT ON;
DECLARE @dir nvarchar(4000)=CONVERT(nvarchar(4000), SERVERPROPERTY('InstanceDefaultBackupPath'));
IF @dir IS NULL THROW 51000, 'SQL Server default backup path is unavailable', 1;
IF RIGHT(@dir,1) NOT IN ('\','/') SET @dir=@dir+'\';
DECLARE @file nvarchar(4000)=@dir+N'$fileName';
BACKUP DATABASE [$database] TO DISK=@file WITH COPY_ONLY, CHECKSUM, INIT, STATS=10;
RESTORE VERIFYONLY FROM DISK=@file WITH CHECKSUM;
SELECT @file;
"@

try {
  Write-Host "[XichuQuant] Creating a SQL Server COPY_ONLY + CHECKSUM backup..."
  $output = Invoke-XichuSqlcmd -Config $config -Query $query
  $reference = ($output | Where-Object { $_ -match '\.bak\s*$' } | Select-Object -Last 1).Trim()
  if (-not $reference) { throw "Backup completed but the server-side reference was not returned." }
  $freeGb = -1
  $minimumFreeGb = if ($env:XICHURISK_BACKUP_MIN_FREE_GB) { [decimal]$env:XICHURISK_BACKUP_MIN_FREE_GB } else { 10 }
  $retentionDays = if ($env:XICHURISK_BACKUP_RETENTION_DAYS) { [int]$env:XICHURISK_BACKUP_RETENTION_DAYS } else { 14 }
  if ($retentionDays -lt 7 -or $retentionDays -gt 365) { throw "Backup retention must be between 7 and 365 days." }
  $removed = 0
  $locallyAccessible = $false
  try { $locallyAccessible = Test-Path -LiteralPath $reference -ErrorAction Stop } catch { $locallyAccessible = $false }
  if ($locallyAccessible) {
    $backupDirectory = [System.IO.Path]::GetFullPath((Split-Path -Parent $reference))
    $driveName = ([System.IO.Path]::GetPathRoot($backupDirectory)).TrimEnd('\').TrimEnd(':')
    $drive = Get-PSDrive -Name $driveName -ErrorAction SilentlyContinue
    if ($drive) { $freeGb = [math]::Round($drive.Free / 1GB, 2) }
    if ($PruneExpired) { Get-ChildItem -LiteralPath $backupDirectory -Filter "${database}_*.bak" -File |
      Where-Object { $_.LastWriteTimeUtc -lt (Get-Date).ToUniversalTime().AddDays(-$retentionDays) } |
      ForEach-Object {
        $candidate = [System.IO.Path]::GetFullPath($_.FullName)
        if ((Split-Path -Parent $candidate) -eq $backupDirectory -and $_.Name -match "^$([regex]::Escape($database))_\d{8}_\d{6}\.bak$") {
          Remove-Item -LiteralPath $candidate
          $removed++
        }
      } }
  } else {
    Write-Warning "Server-side backup directory is not locally accessible; apply the documented server retention job."
  }
  $verification = @{ checksum = $true; copyOnly = $true; freeGb = $freeGb; removedExpiredBackups = $removed; restoreVerifyOnly = $true; retentionDays = $retentionDays } | ConvertTo-Json -Compress
  if (-not $SkipApiAudit) { Write-XichuOperationAudit -ApiUrl $ApiUrl -Operation "BACKUP" -TargetDatabase $database -Status "VERIFIED" -Reference $reference -Verification $verification }
  Write-Host "[OK] Backup and RESTORE VERIFYONLY passed. Server-side file: $reference"
  Write-Host "[INFO] Retention: $retentionDays days; expired backups removed: $removed; free space: $freeGb GB"
  if ($freeGb -ge 0 -and $freeGb -lt $minimumFreeGb) {
    Write-Warning "SQL Server volume free space is below the $minimumFreeGb GB safety threshold."
  }
} catch {
  if (-not $SkipApiAudit) { Write-XichuOperationAudit -ApiUrl $ApiUrl -Operation "BACKUP" -TargetDatabase $database -Status "FAILED" -ErrorMessage $_.Exception.Message }
  throw
}
