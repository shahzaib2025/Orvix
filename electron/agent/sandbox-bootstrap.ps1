$ErrorActionPreference = 'Stop'
$inputRoot = 'C:\OrvixInput'
$outputRoot = 'C:\OrvixOutput'
$workRoot = 'C:\OrvixWork'
$result = @{ exitCode = 1; output = ''; changes = @(); skippedLarge = $false }

function Is-Excluded([string]$relative) {
  foreach ($part in (($relative -replace '\\', '/') -split '/')) {
    $name = $part.ToLowerInvariant()
    if ($name -in @('.git', 'node_modules', 'dist', 'build', 'release', 'coverage', 'target', '.next', '.cache', '.ssh', '.aws', '.gnupg', '.config', 'id_rsa', 'id_ed25519', 'id_ecdsa', 'secrets.json', 'secrets.yaml', 'secrets.yml')) { return $true }
    if ($name -match '^\.env(\.|$)' -or $name -match '\.(pem|pfx|p12|keystore)$') { return $true }
  }
  return $false
}

try {
  $request = Get-Content -LiteralPath (Join-Path $inputRoot 'request.json') -Raw | ConvertFrom-Json
  New-Item -ItemType Directory -Force -Path $workRoot | Out-Null
  & robocopy.exe (Join-Path $inputRoot 'source') $workRoot /E /COPY:DAT /R:0 /W:0 /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "Could not stage project in sandbox (robocopy exit $LASTEXITCODE)." }
  $baseline = @{}
  $saved = Get-Content -LiteralPath (Join-Path $inputRoot 'baseline.json') -Raw | ConvertFrom-Json
  foreach ($property in $saved.PSObject.Properties) { $baseline[$property.Name] = $property.Value }
  $relativeCwd = [string]$request.cwd -replace '/', '\'
  $cwd = [IO.Path]::GetFullPath((Join-Path $workRoot $relativeCwd))
  if (-not ($cwd -eq $workRoot -or $cwd.StartsWith($workRoot + '\', [StringComparison]::OrdinalIgnoreCase))) { throw 'Working directory escaped sandbox workspace.' }
  if (-not (Test-Path -LiteralPath $cwd -PathType Container)) { throw 'Working directory is unavailable in sandbox.' }
  $env:PATH = "${inputRoot}\tools;$env:PATH"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes([string]$request.command))
  $stdout = Join-Path $outputRoot 'stdout.txt'
  $stderr = Join-Path $outputRoot 'stderr.txt'
  $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) -WorkingDirectory $cwd -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $deadline = [DateTime]::UtcNow.AddSeconds(180)
  while (-not $process.HasExited) {
    if (Test-Path -LiteralPath (Join-Path $outputRoot 'cancel.flag')) {
      & taskkill.exe /PID $process.Id /T /F | Out-Null
      $result.exitCode = 130
      break
    }
    if ([DateTime]::UtcNow -ge $deadline) {
      & taskkill.exe /PID $process.Id /T /F | Out-Null
      $result.exitCode = 124
      break
    }
    Start-Sleep -Milliseconds 500
    $process.Refresh()
  }
  if ($process.HasExited -and $result.exitCode -eq 1) { $result.exitCode = [int]$process.ExitCode }
  $combined = ((Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue) + "`n" + (Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue))
  $result.output = $combined

  $seen = @{}
  $queue = [Collections.Generic.Queue[string]]::new()
  $queue.Enqueue($workRoot)
  while ($queue.Count -gt 0) {
    $directory = $queue.Dequeue()
    foreach ($entry in (Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop)) {
      if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
      $relative = $entry.FullName.Substring($workRoot.Length).TrimStart('\') -replace '\\', '/'
      if (Is-Excluded $relative) { continue }
      if ($entry.PSIsContainer) { $queue.Enqueue($entry.FullName); continue }
      $seen[$relative] = $true
      if ($entry.Length -gt 1048576) { $result.skippedLarge = $true; continue }
      $digest = (Get-FileHash -LiteralPath $entry.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($baseline.ContainsKey($relative) -and $baseline[$relative] -eq $digest) { continue }
      $destination = Join-Path (Join-Path $outputRoot 'files') ($relative -replace '/', '\')
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
      Copy-Item -LiteralPath $entry.FullName -Destination $destination -Force
      $result.changes += @{ relative = $relative; kind = 'written'; afterHash = $digest }
    }
  }
  foreach ($relative in $baseline.Keys) {
    if (-not $seen.ContainsKey($relative) -and -not (Is-Excluded $relative)) {
      $result.changes += @{ relative = $relative; kind = 'deleted'; afterHash = $null }
    }
  }
} catch {
  $result.exitCode = 1
  $result.output = "Sandbox runner error: $($_.Exception.Message)"
}

try {
  $json = $result | ConvertTo-Json -Depth 6 -Compress
  $temporary = Join-Path $outputRoot 'result.json.tmp'
  $final = Join-Path $outputRoot 'result.json'
  [IO.File]::WriteAllText($temporary, $json, [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $final -Force
} finally {
  Start-Sleep -Seconds 2
  & shutdown.exe /s /t 0 /f | Out-Null
}
