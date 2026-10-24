$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
. (Join-Path $project 'electron\construction-lock.ps1') -StateDirectory $project -Mode Library
$checkRoot=Join-Path $project ('scratch\construction-lock-safe-'+[Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $checkRoot -Force | Out-Null
$folder=Join-Path $checkRoot "test folder's contents"
$nested=Join-Path $folder 'nested'
New-Item -ItemType Directory -Path $nested -Force | Out-Null
$file=Join-Path $nested 'draft.txt'
[IO.File]::WriteAllText($file,'construction test')
$protectedAcl=[OrvixConstruction]::Security($nested,$false)
$protectedAcl.SetAccessRuleProtection($true,$true)
[IO.Directory]::SetAccessControl($nested,$protectedAcl)
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$entries=[OrvixConstruction]::Entries([string[]]@($folder))
$snapshots=@{}; foreach ($entry in $entries) { $snapshots[$entry]=[OrvixConstruction]::Snapshot($entry,$false) }
$held=New-Object 'System.Collections.Generic.List[Microsoft.Win32.SafeHandles.SafeFileHandle]'
function Check([bool]$ok,[string]$message) { if (!$ok) { throw $message }; Write-Output ('PASS: '+$message) }
function Access-Check([string]$mode) {
    # Use a fresh Windows PowerShell process: Library mode above has already loaded
    # the type and would otherwise hide missing compiler assembly references.
    $result=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $project 'electron\construction-access.ps1') -StateDirectory $accessState -Mode $mode
    if ($LASTEXITCODE -ne 0) { throw ('Fresh-process access '+$mode+' failed.') }
    return ($result -join "`n")
}
function Denied([scriptblock]$operation,[string]$message) {
    $rejected=$false; try { & $operation | Out-Null } catch { $rejected=$true }
    Check $rejected $message
}
function Restore-All {
    foreach ($entry in $entries) { [OrvixConstruction]::Restore($entry,$snapshots[$entry],$false) }
    foreach ($handle in $held) { $handle.Dispose() }; $held.Clear()
}
function Permission-Signature([string]$sddl) {
    $acl=New-Object Security.AccessControl.FileSecurity
    $acl.SetSecurityDescriptorSddlForm($sddl,[Security.AccessControl.AccessControlSections]::Access)
    $rights=@{}
    foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
        $key="$($rule.IdentityReference.Value)|$($rule.AccessControlType)|$($rule.InheritanceFlags)|$($rule.PropagationFlags)|$($rule.IsInherited)"
        $rights[$key]=[int]$rights[$key] -bor [int]$rule.FileSystemRights
    }
    # Windows can collapse redundant allow ACEs when it recalculates inheritance.
    # Every account, allow/deny mask, inheritance scope and protected flag must match.
    return [string]$acl.AreAccessRulesProtected+';'+(($rights.Keys | Sort-Object | ForEach-Object { $_+'='+$rights[$_] }) -join ';')
}
try {
    $accessState=Join-Path $checkRoot 'access-check';New-Item -ItemType Directory -Path $accessState | Out-Null
    [IO.File]::WriteAllText((Join-Path $accessState 'request.json'),(@{id='native-access-fixture';targets=@($folder);forbidden=@()}|ConvertTo-Json))
    $missing=(Access-Check 'Check') | ConvertFrom-Json
    Check ($missing.status -eq 'attention' -and $missing.checked -eq 0 -and $missing.issues[0].reason -eq 'baseline_missing') 'a missing original access record remains attention without a false success or a raw PowerShell error'
    $capture=Access-Check 'Capture'
    Check ((($capture | ConvertFrom-Json).entries.Count) -gt 0) 'access capture compiles independently in a fresh Windows PowerShell process'
    [IO.File]::WriteAllText((Join-Path $accessState 'access-before.json'),$capture)
    $journalTarget=Join-Path $checkRoot 'replacement.json'
    $journalSource=$journalTarget+'.tmp'
    [IO.File]::WriteAllText($journalTarget,'old')
    for ($iteration=1; $iteration -le 3; $iteration++) {
        [IO.File]::WriteAllText($journalSource,'new-'+$iteration)
        [OrvixConstruction]::ReplaceJournal($journalSource,$journalTarget)
        Check ([IO.File]::ReadAllText($journalTarget) -eq 'new-'+$iteration) ('atomic journal replacement works without an invalid backup path: '+$iteration)
    }
    $opened=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
    try { Denied { [OrvixConstruction]::Probe($file) } 'preflight rejects an already-open file' } finally { $opened.Dispose() }
    Denied { [OrvixConstruction]::ValidateTarget('C:\Windows',[string[]]@($env:windir)) } 'native helper rejects system paths'
    Denied { [OrvixConstruction]::ValidateTarget('C:\',[string[]]@()) } 'native helper rejects drive roots'
    Denied { [OrvixConstruction]::ValidateTarget($file+':hidden',[string[]]@()) } 'native helper rejects alternate streams'
    [OrvixConstruction]::ValidateTarget($file,[string[]]@())
    $alias=Join-Path $checkRoot 'hard-link.txt'
    New-Item -ItemType HardLink -Path $alias -Value $file | Out-Null
    try { Denied { $unexpected=[OrvixConstruction]::Guard($file); $unexpected.Dispose() } 'hard-linked files cannot affect an unselected alias' } finally { [IO.File]::Delete($alias) }
    foreach ($entry in $entries) { [OrvixConstruction]::Probe($entry); $held.Add([OrvixConstruction]::Guard($entry)) }
    foreach ($entry in $entries) { [OrvixConstruction]::Restrict($entry,$sid,'read_write',$false) }
    $blockedProbe=[OrvixConstruction]::AccessProbe($file)
    Check ($blockedProbe.readError -eq 5 -and $blockedProbe.writeError -eq 5) 'non-mutating access probes report permission denial while locked'
    Denied { [IO.File]::ReadAllText($file) } 'new reads of a nested file are denied'
    Denied { [IO.File]::WriteAllText($file,'must not write') } 'new writes are denied'
    Denied { [IO.Directory]::GetFileSystemEntries($folder) } 'folder enumeration is denied'
    Denied { [IO.File]::WriteAllText((Join-Path $nested 'new.txt'),'new') } 'creation inside a protected folder is denied'
    Denied { [IO.File]::Delete($file) } 'deletion is denied even when the parent grants delete-child'
    Denied { [IO.Directory]::Move($folder,$folder+'-renamed') } 'protected folder rename is denied'
    $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("try { [IO.File]::ReadAllText('"+$file.Replace("'","''")+"') | Out-Null; exit 0 } catch { exit 7 }"))
    & powershell.exe -NoProfile -EncodedCommand $encoded
    Check ($LASTEXITCODE -eq 7) 'a separate normal Windows process is also denied'
    Restore-All
    $verified=(Access-Check 'Check') | ConvertFrom-Json
    Check ($verified.status -eq 'verified' -and $verified.checked -eq $entries.Count) 'the normal-user recovery probe verifies every original entry after restoration'
    $busyHandle=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
    try { $busyProbe=[OrvixConstruction]::AccessProbe($file);Check ($busyProbe.readError -eq 32) 'access checks distinguish a busy file from denied permissions' } finally { $busyHandle.Dispose() }
    foreach ($entry in $entries) {
        $actual=[OrvixConstruction]::Snapshot($entry,$false)
        Check ((Permission-Signature $actual) -eq (Permission-Signature $snapshots[$entry])) ('original access rights and inheritance protection restored: '+[IO.Path]::GetFileName($entry))
    }
    Check ([IO.File]::ReadAllText($file) -eq 'construction test') 'file contents survived the lock and restoration'
    foreach ($entry in $entries) { $held.Add([OrvixConstruction]::Guard($entry)) }
    foreach ($entry in $entries) { [OrvixConstruction]::Restrict($entry,$sid,'write',$false) }
    Check ([IO.File]::ReadAllText($file) -eq 'construction test') 'write-only protection permits reading'
    Check ([IO.Directory]::GetFileSystemEntries($folder).Count -gt 0) 'write-only protection permits folder enumeration'
    Denied { [IO.File]::WriteAllText($file,'must not write') } 'write-only protection denies modification'
    Restore-All
    [IO.File]::WriteAllText($file,'after unlock')
    Check ([IO.File]::ReadAllText($file) -eq 'after unlock') 'writes succeed again after unlock'
    $escaped=[Security.SecurityElement]::Escape($file)
    $event="<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><EventID>4656</EventID><Keywords>0x8010000000000000</Keywords><EventRecordID>42</EventRecordID><TimeCreated SystemTime='2026-10-02T01:00:00Z'/></System><EventData><Data Name='SubjectUserSid'>$sid</Data><Data Name='ObjectName'>$escaped</Data><Data Name='ProcessName'>C:\Windows\explorer.exe</Data><Data Name='AccessMask'>0x1</Data></EventData></Event>"
    $attempt=[OrvixConstruction]::AttemptFromXml($event,$sid,[string[]]@($folder),'test-lock')
    Check ($null -ne $attempt -and $attempt.id -eq 'test-lock-42' -and $attempt.path -eq $file) 'Windows 4656 failure payload identifies the protected path and application'
    Check ($null -eq [OrvixConstruction]::AttemptFromXml($event.Replace('0x8010000000000000','0x8020000000000000'),$sid,[string[]]@($folder),'test-lock')) 'successful access events are ignored'
    Check ($null -eq [OrvixConstruction]::AttemptFromXml($event,$sid+'-other',[string[]]@($folder),'test-lock')) 'other Windows accounts are ignored'
    Check ($null -eq [OrvixConstruction]::AttemptFromXml($event,$sid,[string[]]@($folder+'other'),'test-lock')) 'neighboring folder paths are ignored'
    Check ($null -eq [OrvixConstruction]::AttemptFromXml($event.Replace('<EventID>4656','<EventID>4663'),$sid,[string[]]@($folder),'test-lock')) '4663 events are not mistaken for denied access'
    $checkpoint=Join-Path $checkRoot 'checkpoint-loader'
    New-Item -ItemType Directory -Path $checkpoint | Out-Null
    [IO.File]::WriteAllText((Join-Path $checkpoint 'original.json'),(@{version=1;id='safe-test';entries=@(@{path=$file;sddl=$snapshots[$file]})} | ConvertTo-Json -Depth 5))
    [IO.File]::WriteAllText((Join-Path $checkpoint 'manifest.json'),(@{version=1;id='safe-test';status='recovery_required'} | ConvertTo-Json))
    $loaded=Read-ConstructionCheckpoint $checkpoint
    Check ($loaded.entries.Count -eq 1 -and $loaded.entries[0].sddl -eq $snapshots[$file]) 'lightweight recovery status loads the saved original permissions'
    [IO.File]::WriteAllText((Join-Path $checkpoint 'manifest.json'),'{broken')
    $loaded=Read-ConstructionCheckpoint $checkpoint
    Check ($loaded.entries.Count -eq 1 -and $loaded.id -eq 'safe-test') 'corrupt live checkpoint recovers from the immutable original'
    [IO.File]::WriteAllText((Join-Path $checkpoint 'manifest.json'),(@{version=1;id='different-lock';status='recovery_required'} | ConvertTo-Json))
    Denied { Read-ConstructionCheckpoint $checkpoint } 'mismatched original permission backups cannot be restored'
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    $principal=New-Object Security.Principal.WindowsPrincipal($identity)
    if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        $session=Join-Path $checkRoot ([Guid]::NewGuid().ToString())
        New-Item -ItemType Directory -Path $session | Out-Null
        [IO.File]::WriteAllText((Join-Path $session 'request.json'),(@{version=1;id=(Split-Path $session -Leaf);targets=@($folder);mode='read_write';durationMinutes=1;sid=$sid;forbidden=@()} | ConvertTo-Json))
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $project 'electron\construction-lock.ps1') -StateDirectory $session -Mode Work
        $result=Get-Content -LiteralPath (Join-Path $session 'manifest.json') -Raw | ConvertFrom-Json
        Check ($result.status -eq 'failed' -and $result.error) 'production helper fails before changing permissions when audit privilege is unavailable'
        Check ([IO.File]::ReadAllText($file) -eq 'after unlock') 'failed production activation leaves disposable files accessible'
    }
    Write-Output 'No administrator elevation, Security-log changes or personal files were used by this test.'
} finally {
    # Cleanup is permitted only after original descriptors are restored and the path is verified.
    Restore-All
    $resolved=[IO.Path]::GetFullPath($checkRoot)
    $scratch=[IO.Path]::GetFullPath((Join-Path $project 'scratch'))+'\'
    if (!$resolved.StartsWith($scratch,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup path.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
