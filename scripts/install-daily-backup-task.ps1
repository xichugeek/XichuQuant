param(
  [string]$At = "02:30",
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
$rootPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$backupScript = Join-Path $PSScriptRoot "backup-database.ps1"
if ($At -notmatch '^([01]\d|2[0-3]):[0-5]\d$') { throw "Time must use HH:mm in 24-hour format." }
if (-not (Test-Path -LiteralPath $backupScript)) { throw "Backup script is missing." }
if ($ValidateOnly) {
  Write-Host "[OK] Daily backup task is valid: $At, workspace $rootPath"
  exit 0
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$backupScript`""
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "XichuQuant-Daily-SqlBackup" -Description "XichuQuant SQL Server COPY_ONLY CHECKSUM backup and verification" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "[OK] Daily backup task installed for $At. It runs under the current Windows account."
