param([string]$Electron = '', [switch]$Quick)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Electron) { $Electron = Join-Path $root 'node_modules\electron\dist\electron.exe' }
if ((Get-FileHash -LiteralPath $Electron -Algorithm SHA256).Hash -ne 'F9D584073947EC9B1027278DAD35BE0E6FE0443F954A8448E9B0B3D34ECEEC1B') {
  throw 'The development Electron runtime differs from its original 42.5.0 archive. Restore or explicitly validate the runtime before resource measurements.'
}
$out = Join-Path $root 'scratch'
[void](New-Item -ItemType Directory -Force -Path $out)
$report = Join-Path $out 'desktop-bar-native.json'
Remove-Item -LiteralPath $report -Force -ErrorAction SilentlyContinue
$env:ORVIX_DESKTOP_BAR_REPORT = $report
$env:ELECTRON_RUN_AS_NODE = $null
$arguments = @('"' + (Join-Path $PSScriptRoot 'check_desktop_bar_native.cjs') + '"')
if (-not $Quick) { $arguments += '--performance' }
$child = Start-Process -FilePath $Electron -ArgumentList $arguments -WorkingDirectory $root -PassThru -RedirectStandardOutput (Join-Path $out 'desktop-bar-native-log.txt') -RedirectStandardError (Join-Path $out 'desktop-bar-native-errors.txt')
# Cache the process handle before exit so Windows PowerShell can retain ExitCode.
$null = $child.Handle
$logical = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
$samples = @()
$previous = @{}
$lastTime = [Diagnostics.Stopwatch]::GetTimestamp()
$lastStage = 'startup'
$watch = [Diagnostics.Stopwatch]::StartNew()
try {
  while (-not $child.HasExited) {
    if ($watch.Elapsed.TotalSeconds -gt 300) { throw 'Native desktop bar checks exceeded five minutes.' }
    Start-Sleep -Seconds 1
    $processes = @(Get-CimInstance Win32_Process)
    $ids = @($child.Id)
    for ($depth = 0; $depth -lt 5; $depth++) { $ids += @($processes | Where-Object { $ids -contains $_.ParentProcessId } | Select-Object -ExpandProperty ProcessId) }
    $current = @{}
    $private = 0.0
    foreach ($id in ($ids | Select-Object -Unique)) {
      $p = Get-Process -Id $id -ErrorAction SilentlyContinue
      if ($p) {
        $current[$id] = [double]$p.CPU
        $private += $p.PrivateMemorySize64 / 1MB
        $p.Dispose()
      }
    }
    $now = [Diagnostics.Stopwatch]::GetTimestamp()
    $seconds = ($now - $lastTime) / [double][Diagnostics.Stopwatch]::Frequency
    $cpu = 0.0
    foreach ($id in $current.Keys) {
      if ($previous.ContainsKey($id)) { $cpu += [Math]::Max(0, $current[$id] - $previous[$id]) / $seconds / $logical * 100 }
      elseif ($previous.Count) { $cpu += $current[$id] / $seconds / $logical * 100 }
    }
    $stage = 'startup'
    if (Test-Path -LiteralPath ($report + '.stage.json')) {
      try { $state = Get-Content -Raw ($report + '.stage.json') | ConvertFrom-Json; if ($state.pid -eq $child.Id) { $stage = $state.stage } } catch {}
    }
    $samples += [pscustomobject]@{ Stage = $(if ($stage -eq $lastStage) { $stage } else { 'transition' }); CPUPercent = [Math]::Round($cpu, 3); PrivateMB = [Math]::Round($private, 1); Processes = $current.Count; Seconds = [Math]::Round($seconds, 3) }
    $previous = $current; $lastTime = $now; $lastStage = $stage
  }
  $child.WaitForExit()
  $native = if (Test-Path -LiteralPath $report) { Get-Content -Raw $report | ConvertFrom-Json } else { [pscustomobject]@{ passed = $false; failure = 'The native process exited without writing its report.' } }
  if (-not $native.passed -or $native.processId -ne $child.Id -or $child.ExitCode -ne 0) {
    [pscustomobject]@{ Native = $native; Samples = $samples } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $out 'desktop-bar-resources-failed.json')
    throw "Native checks failed (exit $($child.ExitCode)): $($native.failure)"
  }
  $summary = foreach ($stage in @('baseline', 'enabling', 'collapsed', 'expanding', 'expanded', 'off')) {
    $values = @($samples | Where-Object Stage -eq $stage)
    if ($values.Count) {
      [pscustomobject]@{ Stage = $stage; Samples = $values.Count; DurationSeconds = [Math]::Round(($values | Measure-Object Seconds -Sum).Sum, 1); AverageCPUPercent = [Math]::Round(($values | Measure-Object CPUPercent -Average).Average, 3); PeakCPUPercent = ($values | Measure-Object CPUPercent -Maximum).Maximum; AveragePrivateMB = [Math]::Round(($values | Measure-Object PrivateMB -Average).Average, 1); PeakPrivateMB = ($values | Measure-Object PrivateMB -Maximum).Maximum }
    }
  }
  $baseline = $summary | Where-Object Stage -eq 'baseline'
  foreach ($entry in $summary) {
    $entry | Add-Member -NotePropertyName AddedPrivateMB -NotePropertyValue ([Math]::Round($entry.AveragePrivateMB - $baseline.AveragePrivateMB, 1))
  }
  $targetFailure = ''
  if (-not $Quick) {
    foreach ($stage in @('collapsed', 'expanded')) {
      $value = $summary | Where-Object Stage -eq $stage
      if (-not $value -or $value.DurationSeconds -lt 55 -or $value.PeakCPUPercent -ge 5 -or $value.AddedPrivateMB -gt 200) { $targetFailure = "Resource target not met in $stage. See scratch/desktop-bar-resources.json." }
    }
  }
  $result = [pscustomobject]@{ Passed = -not [bool]$targetFailure; NativeCheckCount = $native.checks.Count; RuntimeHash = (Get-FileHash -LiteralPath $Electron -Algorithm SHA256).Hash; Stages = @($summary); Samples = $samples }
  $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $out 'desktop-bar-resources.json')
  if ($targetFailure) { throw $targetFailure }
  $summary | ConvertTo-Json -Compress
} finally {
  $env:ORVIX_DESKTOP_BAR_REPORT = $null
  if (-not $child.HasExited) {
    [void]$child.CloseMainWindow()
    if (-not $child.WaitForExit(3000)) { & taskkill.exe /PID $child.Id /T /F | Out-Null }
  }
}
