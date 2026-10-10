$ErrorActionPreference = "Stop"
$rootPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$ports = @(5088, 5089, 5091, 5092)
$stopped = @()

# Stop only descendants of a verified launcher from this workspace. This also stops
# watch supervisors before their children, so they cannot restart a just-stopped API.
$manifest = Join-Path $rootPath 'logs/local-runtime.json'
if (Test-Path -LiteralPath $manifest) {
  $owner = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
  $launcher = Get-Process -Id $owner.pid -ErrorAction SilentlyContinue
  $launcherInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$($owner.pid)" -ErrorAction SilentlyContinue
  if ($launcher -and $launcherInfo -and $owner.root -eq $rootPath -and
      $launcher.StartTime.ToUniversalTime().ToString('o') -eq $owner.startedAt -and
      $launcherInfo.CommandLine -like "*$rootPath*start-local.ps1*") {
    $all = @(Get-CimInstance Win32_Process)
    $ids = @([int]$owner.pid)
    for ($index=0; $index -lt $ids.Count; $index++) { $ids += @($all | Where-Object { $_.ParentProcessId -eq $ids[$index] } | ForEach-Object { [int]$_.ProcessId }) }
    foreach ($id in $ids) { Stop-Process -Id $id -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $manifest
    Write-Host '[OK] Stopped the recorded local launcher and its service descendants; no database or broker cancellation was performed.'
    exit 0
  }
  throw 'Runtime ownership could not be verified. Use Ctrl+C in the original launcher; no process was stopped.'
}

foreach ($port in $ports) {
  $connections = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  foreach ($connection in $connections) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)" -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    $commandLine = [string]$process.CommandLine
    if ($commandLine -notlike "*$rootPath*") {
      Write-Warning "Port $port belongs to out-of-workspace PID $($process.ProcessId); it was not stopped."
      continue
    }
    Stop-Process -Id $process.ProcessId -Force
    $stopped += "$port/PID=$($process.ProcessId)"
  }
}

if ($stopped.Count -eq 0) {
  Write-Host "[XichuQuant] No service process owned by this workspace was found."
} else {
  Write-Host "[XichuQuant] Stopped: $($stopped -join ', ')"
}
