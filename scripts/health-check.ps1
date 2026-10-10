param([switch]$RequireBrokerPaper, [switch]$RequireBrokerOffline)

$ErrorActionPreference = "Stop"
$targets = @(
  @{ Name = "Web"; Url = "http://localhost:5088" },
  @{ Name = "API"; Url = "http://localhost:5089/health" },
  @{ Name = "Quant Engine"; Url = "http://localhost:5091/health" },
  @{ Name = "Broker Connector"; Url = "http://localhost:5092/health" }
)

$failed = 0
foreach ($target in $targets) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $target.Url -TimeoutSec 5
    if ($response.StatusCode -ne 200) { throw "HTTP $($response.StatusCode)" }
    Write-Host "[OK] $($target.Name) $($target.Url)"
  } catch {
    Write-Host "[FAIL] $($target.Name) $($target.Url) - $($_.Exception.Message)"
    $failed++
  }
}

if ($failed -eq 0) {
  $capabilities = Invoke-RestMethod -Uri "http://localhost:5092/paper/capabilities" -TimeoutSec 5
  if ($capabilities.canPlaceLiveOrders -ne $false -or $capabilities.canModifyLiveOrders -ne $false -or $capabilities.canCancelLiveOrders -ne $false) {
    Write-Host '[FAIL] All Live writes must be explicitly false.'
    $failed++
  }
  if ($RequireBrokerPaper -and -not $capabilities.canPlacePaperOrders) {
    Write-Host "[FAIL] Broker Connector does not satisfy Paper=true and Live=false capabilities."
    $failed++
  } elseif ($RequireBrokerPaper) {
    Write-Host "[OK] Broker Connector Paper writes are enabled and Live writes remain disabled."
  }
  if ($RequireBrokerOffline -and ($capabilities.canPlacePaperOrders -ne $false -or $capabilities.canModifyPaperOrders -ne $false -or $capabilities.canCancelPaperOrders -ne $false)) {
    Write-Host '[FAIL] Offline verification requires all external Paper writes to be false.'
    $failed++
  }
  if ($RequireBrokerOffline) {
    $brokerHealth = Invoke-RestMethod -Uri 'http://localhost:5092/health' -TimeoutSec 5
    if ($brokerHealth.status -ne 'OFFLINE') { Write-Host '[FAIL] Broker health must explicitly report OFFLINE.'; $failed++ }
    else { Write-Host '[OK] Broker OFFLINE; all external Paper and Live writes are disabled.' }
  }
}

if ($failed -gt 0) { exit 1 }
exit 0
