# Bounded controlled-test monitor: DVIR handoff seven-transition state machine.
# Does not log secrets. Terminals: PASS / FAIL_* / TIMEOUT
param(
  [string]$Serial = "R5CX15HEGQB",
  [int]$TimeoutSec = 120
)

$ErrorActionPreference = "Continue"
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$state = [ordered]@{
  suite_request = $false
  suite_open = $false
  equip_boot = $false
  equip_received = $false
  equip_parsed = $false
  equip_auth = $false
  equip_auth_result = ""
  equip_route = $false
  equip_fallback = $false
  fallback_dest = ""
}

function Show-State([string]$msg) {
  Write-Output ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg)
}

Show-State "START serial=$Serial timeout=${TimeoutSec}s"
Show-State "Waiting for [Suite-DVIR] / [eQuip-DVIR] lifecycle lines..."

adb -s $Serial logcat -v threadtime -b main 2>&1 | ForEach-Object {
  $line = $_
  if ($line -notmatch '\[Suite-DVIR\]|\[eQuip-DVIR\]') { return }

  Write-Output $line

  if ($line -match 'dvir\.handoff\.request') { $state.suite_request = $true }
  if ($line -match 'dvir\.handoff\.open' -and $line -match 'success=1') { $state.suite_open = $true }
  if ($line -match 'app\.boot') { $state.equip_boot = $true }
  if ($line -match 'dvir\.handoff\.received') { $state.equip_received = $true }
  if ($line -match 'dvir\.handoff\.parsed') {
    $state.equip_parsed = $true
    if ($line -match 'ok=0') {
      Show-State "TERMINAL FAIL: parse rejection"
      exit 2
    }
  }
  if ($line -match 'dvir\.handoff\.auth') {
    $state.equip_auth = $true
    if ($line -match 'result=([a-z_]+)') { $state.equip_auth_result = $Matches[1] }
    if ($line -match 'result=rejected|result=error') {
      Show-State "TERMINAL FAIL: auth rejection/error result=$($state.equip_auth_result)"
      exit 3
    }
  }
  if ($line -match 'dvir\.route\.enter' -and $line -match 'phase=(pre_trip|post_trip)') {
    $state.equip_route = $true
    if ($state.equip_auth -and $state.equip_auth_result -eq 'ok') {
      Show-State "TERMINAL PASS: intended DVIR route reached with accepted auth"
      exit 0
    }
    # Route enter without auth ok is not yet terminal PASS (may still fallback)
  }
  if ($line -match 'dvir\.handoff\.fallback') {
    $state.equip_fallback = $true
    if ($line -match 'destination=([a-z]+)') { $state.fallback_dest = $Matches[1] }
    if ($state.fallback_dest -eq 'login') {
      Show-State "TERMINAL FAIL: login fallback"
      exit 4
    }
  }

  if ((Get-Date) -gt $deadline) {
    Show-State "TERMINAL TIMEOUT: no PASS/FAIL within ${TimeoutSec}s"
    $state.GetEnumerator() | ForEach-Object { Write-Output ("  {0}={1}" -f $_.Key, $_.Value) }
    exit 5
  }
}
