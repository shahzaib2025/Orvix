param([Parameter(Mandatory=$true)][string]$StateDirectory, [ValidateSet('Work','Recover','Library')][string]$Mode='Work')
$ErrorActionPreference='Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'construction-lock-native.cs') -ReferencedAssemblies 'System.dll','System.Xml.dll'
function Read-ConstructionCheckpoint([string]$directory) {
    try { $saved=Get-Content -LiteralPath (Join-Path $directory 'manifest.json') -Raw | ConvertFrom-Json }
    catch { $saved=Get-Content -LiteralPath (Join-Path $directory 'original.json') -Raw | ConvertFrom-Json }
    if ($saved.PSObject.Properties.Name -notcontains 'entries') {
        $original=Get-Content -LiteralPath (Join-Path $directory 'original.json') -Raw | ConvertFrom-Json
        if ($original.id -ne $saved.id -or $original.version -ne 1) { throw 'The original permission checkpoint does not match this lock.' }
        $saved | Add-Member -NotePropertyName entries -NotePropertyValue @($original.entries)
    }
    return $saved
}
if ($Mode -eq 'Library') { return }
$lockId=Split-Path $StateDirectory -Leaf
if ($lockId -notmatch '^[0-9a-f-]{36}$') { throw 'Invalid lock journal directory.' }
$mutex=New-Object System.Threading.Mutex($false,('Global\OrvixConstructionLock-'+$lockId))
try { $ownsMutex=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $ownsMutex=$true }
if (!$ownsMutex) { $mutex.Dispose(); exit 2 }
$utf8=New-Object System.Text.UTF8Encoding($false)
$manifestPath=Join-Path $StateDirectory 'manifest.json'
$guards=New-Object 'System.Collections.Generic.List[Microsoft.Win32.SafeHandles.SafeFileHandle]'
$journal=$null
function Save-Journal {
    $journal.updatedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $temp=$manifestPath+'.tmp'
    # Keep the live status small; original.json already holds all permission descriptors.
    $payload=if ([IO.File]::Exists((Join-Path $StateDirectory 'original.json'))) { $journal | Select-Object -Property * -ExcludeProperty entries } else { $journal }
    $bytes=$utf8.GetBytes(($payload | ConvertTo-Json -Depth 12 -Compress))
    $stream=New-Object IO.FileStream($temp,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    if ([IO.File]::Exists($manifestPath)) { [OrvixConstruction]::ReplaceJournal($temp,$manifestPath) } else { [IO.File]::Move($temp,$manifestPath) }
}
function Restore-Lock {
    $journal.status='restoring'
    # Permission restoration must proceed even when the journal disk becomes unwritable.
    try { Save-Journal } catch { Write-Warning ('Recovery checkpoint: '+$_.Exception.Message) }
    $errors=@()
    # Parents first removes inherited restrictions before restoring explicit child descriptors.
    foreach ($entry in $journal.entries) {
        try {
            if ($entry.PSObject.Properties.Name -contains 'identity' -and [OrvixConstruction]::AccessProbe($entry.path).identity -ne $entry.identity) { throw 'File identity changed. Recovery will not modify a replacement file.' }
            [OrvixConstruction]::Restore($entry.path,$entry.sddl,$true)
        } catch { $errors += "$($entry.path): $($_.Exception.Message)" }
    }
    foreach ($guard in $guards) { $guard.Dispose() }
    $guards.Clear()
    if ($null -ne $journal.auditBefore -and $null -ne $journal.auditApplied) {
        try {
            # Do not overwrite policy changes made by an administrator during this lock.
            if ([OrvixConstruction]::AuditFlags() -eq $journal.auditApplied) { [OrvixConstruction]::SetAuditFlags([uint32]$journal.auditBefore) }
        } catch { $errors += "Audit policy: $($_.Exception.Message)" }
    }
    $journal.status=if ($errors.Count) { 'recovery_required' } else { 'unlocked' }
    $journal.auditHealth='stopped'
    $journal.error=if ($errors.Count) { $errors -join "`n" } else { $journal.error }
    Save-Journal
}
try {
    [OrvixConstruction]::EnableAuditPrivilege()
    if ($Mode -eq 'Recover') {
        $saved=Read-ConstructionCheckpoint $StateDirectory
        if ($saved.status -eq 'unlocked' -or $saved.status -eq 'failed') { exit 0 }
        $original=Get-Content -LiteralPath (Join-Path $StateDirectory 'request.json') -Raw | ConvertFrom-Json
        if ($saved.version -ne 1 -or $saved.id -ne $lockId -or $original.id -ne $lockId -or @($saved.entries).Count -gt 2000) { throw 'Invalid recovery journal.' }
        $forbidden=@($env:windir,$env:ProgramFiles,${env:ProgramFiles(x86)},$env:ProgramData,(Join-Path $env:USERPROFILE 'AppData')) + @($original.forbidden)
        foreach ($entry in $saved.entries) {
            [OrvixConstruction]::ValidateTarget($entry.path,[string[]]$forbidden)
            $valid=$false; foreach ($target in $original.targets) { if ([OrvixConstruction]::Within($entry.path,$target)) { $valid=$true } }
            if (!$valid) { throw 'A journal entry is outside the selected targets.' }
        }
        $journal=$saved
        Restore-Lock; exit 0
    }
    $request=Get-Content -LiteralPath (Join-Path $StateDirectory 'request.json') -Raw | ConvertFrom-Json
    if (Test-Path -LiteralPath (Join-Path $StateDirectory 'unlock')) { throw 'Activation was cancelled before permissions changed.' }
    if (Test-Path -LiteralPath (Join-Path $StateDirectory 'original.json')) { throw 'This journal already contains an original checkpoint. Use Recover instead of reactivating it.' }
    if ($request.version -ne 1 -or $request.sid -notmatch '^S-1-5-21-\d+-\d+-\d+-\d+$' -or $request.durationMinutes -lt 1 -or $request.durationMinutes -gt 480 -or @($request.targets).Count -lt 1 -or @($request.targets).Count -gt 12) { throw 'Invalid construction lock request.' }
    [OrvixConstruction]::Rights($request.mode) | Out-Null
    $forbidden=@($env:windir,$env:ProgramFiles,${env:ProgramFiles(x86)},$env:ProgramData,(Join-Path $env:USERPROFILE 'AppData')) + @($request.forbidden)
    foreach ($target in $request.targets) { [OrvixConstruction]::ValidateTarget($target,[string[]]$forbidden) }
    for ($a=0; $a -lt $request.targets.Count; $a++) { for ($b=$a+1; $b -lt $request.targets.Count; $b++) {
        if ([OrvixConstruction]::Within($request.targets[$a],$request.targets[$b]) -or [OrvixConstruction]::Within($request.targets[$b],$request.targets[$a])) { throw 'Select distinct, non-overlapping targets.' }
    } }
    $entries=[OrvixConstruction]::Entries([string[]]$request.targets)
    $accessBefore=Get-Content -LiteralPath (Join-Path $StateDirectory 'access-before.json') -Raw | ConvertFrom-Json
    if ($accessBefore.id -ne $request.id -or $accessBefore.sid -ne $request.sid -or @($accessBefore.entries).Count -ne @($entries).Count) { throw 'The folder changed after its access check. Review it and activate again.' }
    $accessByPath=@{}; foreach ($item in $accessBefore.entries) { $accessByPath[$item.path]=$item.identity }
    $journal=[pscustomobject]@{version=1;id=$request.id;targets=@($request.targets);mode=$request.mode;status='preparing';expiresAt=0;updatedAt=0;error=$null;entries=@();auditBefore=$null;auditApplied=$null;attempts=@();auditHealth='starting'}
    # Snapshot every descriptor durably before changing any permission.
    foreach ($entry in $entries) {
        [OrvixConstruction]::Probe($entry)
        $guards.Add([OrvixConstruction]::Guard($entry))
        if ($accessByPath[$entry] -ne [OrvixConstruction]::AccessProbe($entry).identity) { throw 'A selected file changed identity after review. No restriction was applied.' }
        $journal.entries += [pscustomobject]@{path=$entry;sddl=[OrvixConstruction]::Snapshot($entry,$true);identity=[OrvixConstruction]::AccessProbe($entry).identity}
    }
    $journal.auditBefore=[OrvixConstruction]::AuditFlags()
    $journal.auditApplied=([uint32]$journal.auditBefore -band 1) -bor 2
    Save-Journal
    $originalPath=Join-Path $StateDirectory 'original.json'
    $originalBytes=[IO.File]::ReadAllBytes($manifestPath)
    $originalStream=[IO.File]::Open($originalPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $originalStream.Write($originalBytes,0,$originalBytes.Length);$originalStream.Flush($true) } finally { $originalStream.Dispose() }
    $readBack=Get-Content -LiteralPath $originalPath -Raw | ConvertFrom-Json
    if ($readBack.id -ne $request.id -or @($readBack.entries).Count -ne @($entries).Count -or [Convert]::ToBase64String([IO.File]::ReadAllBytes($originalPath)) -ne [Convert]::ToBase64String($originalBytes)) { throw 'The original recovery checkpoint failed validation. No restriction was applied.' }
    [OrvixConstruction]::SetAuditFlags([uint32]$journal.auditApplied)
    $latest=Get-WinEvent -LogName Security -MaxEvents 1
    $cursor=[long]$latest.RecordId
    $applied=0
    foreach ($entry in $entries) {
        [OrvixConstruction]::Restrict($entry,$request.sid,$request.mode,$true)
        $applied++
        if ($applied % 20 -eq 0) { Save-Journal }
    }
    $journal.expiresAt=[DateTimeOffset]::UtcNow.AddMinutes($request.durationMinutes).ToUnixTimeMilliseconds()
    $journal.status='active'; $journal.auditHealth='watching'; Save-Journal
    $started=[DateTime]::UtcNow; $gapDetected=$false
    while ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $journal.expiresAt) {
        if (Test-Path -LiteralPath (Join-Path $StateDirectory 'unlock')) { break }
        $heartbeat=Join-Path $StateDirectory 'heartbeat'
        $lastBeat=if (Test-Path -LiteralPath $heartbeat) { [IO.File]::GetLastWriteTimeUtc($heartbeat) } else { $started }
        if (([DateTime]::UtcNow-$lastBeat).TotalSeconds -gt 60) { $journal.error='Orvix stopped responding; access restored automatically.'; break }
        try {
            $latest=Get-WinEvent -LogName Security -MaxEvents 1
            if ([long]$latest.RecordId -lt $cursor) { $cursor=0; $gapDetected=$true }
            $records=@(Get-WinEvent -LogName Security -FilterXPath "*[System[(EventID=4656) and (EventRecordID > $cursor)]]" -MaxEvents 500 -ErrorAction Stop)
            # A busy security log must never be reported as fully observed if a batch overflowed.
            $journal.auditHealth=if ($records.Count -eq 500) { 'busy: some access attempts may have been missed' } elseif ($gapDetected) { 'gap detected: the Windows Security log was cleared' } else { 'watching' }
            foreach ($record in ($records | Sort-Object RecordId)) {
                $cursor=[Math]::Max($cursor,[long]$record.RecordId)
                $attempt=[OrvixConstruction]::AttemptFromXml($record.ToXml(),$request.sid,[string[]]$request.targets,$lockId)
                if ($null -eq $attempt) { continue }
                $journal.attempts=@($journal.attempts)+@($attempt)
                $journal.attempts=@($journal.attempts | Select-Object -Last 50)
            }
            if (([OrvixConstruction]::AuditFlags() -band 2) -eq 0) { $journal.auditHealth='unavailable: Windows failure auditing was disabled' }
        } catch {
            if ($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*') { $journal.auditHealth='unavailable: '+$_.Exception.Message }
            else { $journal.auditHealth=if ($gapDetected) { 'gap detected: the Windows Security log was cleared' } else { 'watching' } }
        }
        if (([OrvixConstruction]::AuditFlags() -band 2) -eq 0) { $journal.auditHealth='unavailable: Windows failure auditing was disabled' }
        Save-Journal
        Start-Sleep -Seconds 1
    }
    Restore-Lock
} catch {
    $failure=$_.Exception.Message
    if ($null -ne $journal) {
        $journal.error=$failure
        try { Restore-Lock } catch { $journal.status='recovery_required'; $journal.error=$failure+'; restoration: '+$_.Exception.Message; Save-Journal }
    } else {
        if ([IO.File]::Exists($manifestPath)) { Write-Error $failure -ErrorAction Continue; exit 1 }
        $journal=[pscustomobject]@{version=1;id='';targets=@();mode='read_write';status='failed';expiresAt=0;updatedAt=0;error=$failure;entries=@();auditBefore=$null;auditApplied=$null;attempts=@();auditHealth='unavailable'}
        Save-Journal
    }
    exit 1
} finally { foreach ($guard in $guards) { $guard.Dispose() }; if ($ownsMutex) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
