param(
  [Parameter(Mandatory = $true)][int]$RootProcessId,
  [ValidateRange(5, 300)][int]$Seconds = 30,
  [string]$Label = 'Observed activity; window state was not controlled',
  [string]$OutputPath = ''
)
$ErrorActionPreference = 'Stop'
$rootProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$RootProcessId"
if (-not $rootProcess -or $rootProcess.Name -notmatch '^(Orvix|electron)\.exe$') { throw 'Choose the main Orvix Electron process ID.' }
if ($rootProcess.CommandLine -match '--type=') { throw 'Choose the main process, not a renderer or GPU child.' }
$creation = $rootProcess.CreationDate
$cores = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
$watch = [Diagnostics.Stopwatch]::StartNew()
$previous = @{}
$samples = @()
$roles = @{}
while ($watch.Elapsed.TotalSeconds -le $Seconds) {
  $processes = @(Get-CimInstance Win32_Process)
  $stillRoot = $processes | Where-Object ProcessId -eq $RootProcessId
  if (-not $stillRoot -or $stillRoot.CreationDate -ne $creation) { break }
  $ids = @($RootProcessId)
  for ($depth = 0; $depth -lt 8; $depth++) {
    $children = @($processes | Where-Object { $ids -contains $_.ParentProcessId -and $ids -notcontains $_.ProcessId } | Select-Object -ExpandProperty ProcessId)
    if (-not $children.Count) { break }
    $ids += $children
  }
  $time = $watch.Elapsed.TotalSeconds
  $current = @{}
  $cpu = 0.0
  $memory = 0.0
  $observed = @()
  foreach ($taskPid in $ids) {
    $p = Get-Process -Id $taskPid -ErrorAction SilentlyContinue
    if (-not $p) { continue }
    try {
      $entry = $processes | Where-Object ProcessId -eq $taskPid | Select-Object -First 1
      $key = "$taskPid/$($entry.CreationDate.Ticks)"
      $total = $p.TotalProcessorTime.TotalSeconds
      $role = if ($taskPid -eq $RootProcessId) { 'main' } elseif ($entry.CommandLine -match '--type=([^ ]+)') { $Matches[1] } else { $entry.Name }
      if ($entry.CommandLine -match '--utility-sub-type=([^ ]+)') { $role = $Matches[1] }
      $percent = if ($previous.ContainsKey($key)) { [Math]::Max(0, $total - $previous[$key].CPU) / [Math]::Max(.001, $time - $previous[$key].Time) / $cores * 100 } else { 0 }
      $privateMB = $p.PrivateMemorySize64 / 1MB
      $current[$key] = @{ CPU = $total; Time = $time }
      $cpu += $percent; $memory += $privateMB
      $roles[$key] = [pscustomobject]@{ PID = $taskPid; Role = $role }
      $observed += [pscustomobject]@{ PID = $taskPid; Role = $role; CPUPercent = [Math]::Round($percent, 3); PrivateMB = [Math]::Round($privateMB, 1) }
    } catch [System.InvalidOperationException] { } finally { $p.Dispose() }
  }
  if ($previous.Count) { $samples += [pscustomobject]@{ Seconds = [Math]::Round($time, 2); CPUPercent = [Math]::Round($cpu, 3); PrivateMB = [Math]::Round($memory, 1); Processes = $observed } }
  $previous = $current
  Start-Sleep -Seconds 1
}
if (-not $samples.Count) { throw 'The process ended before a resource sample could be collected.' }
$summary = [pscustomobject]@{
  Label = $Label; RootProcessId = $RootProcessId; DurationSeconds = [Math]::Round($watch.Elapsed.TotalSeconds, 1)
  AverageCPUPercent = [Math]::Round(($samples | Measure-Object CPUPercent -Average).Average, 3)
  PeakCPUPercent = ($samples | Measure-Object CPUPercent -Maximum).Maximum
  AveragePrivateMB = [Math]::Round(($samples | Measure-Object PrivateMB -Average).Average, 1)
  PeakPrivateMB = ($samples | Measure-Object PrivateMB -Maximum).Maximum
  Note = 'Read-only tree sampling, normalized by logical CPU count. New child CPU begins at its first observation. No UI, feature or process state was changed.'
}
if ($OutputPath) { [pscustomobject]@{ Summary = $summary; Processes = @($roles.Values); Samples = $samples } | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $OutputPath }
$summary | ConvertTo-Json -Compress
