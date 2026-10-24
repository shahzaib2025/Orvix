param([Parameter(Mandatory=$true)][string]$StateDirectory, [ValidateSet('Capture','Check')][string]$Mode='Check')
$ErrorActionPreference='Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'construction-lock-native.cs') -ReferencedAssemblies 'System.dll','System.Xml.dll'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$elevated=([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($elevated) { throw 'Access must be checked from your normal Windows account, without administrator elevation.' }
$baselineFile=Join-Path $StateDirectory 'access-before.json'
if ($Mode -eq 'Check' -and !(Test-Path -LiteralPath $baselineFile)) {
    # A restored legacy lock may have no pre-lock normal-user receipt. Do not
    # invent an original baseline from current permissions or report success.
    @{version=1;id=(Split-Path $StateDirectory -Leaf);sid=$identity.User.Value;at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();status='attention';checked=0;issues=@(@{reason='baseline_missing';message='The original access record is missing, so automatic access verification is unavailable. Use the saved recovery journal if access remains restricted.'})} | ConvertTo-Json -Depth 10 -Compress
    exit 0
}
if ($Mode -eq 'Capture') {
    $request=Get-Content -LiteralPath (Join-Path $StateDirectory 'request.json') -Raw | ConvertFrom-Json
    $entries=@()
    foreach ($target in $request.targets) {
        [OrvixConstruction]::ValidateTarget($target,[string[]]$request.forbidden)
        $entries+=@([OrvixConstruction]::AccessProbe($target))
        if ([IO.Directory]::Exists($target)) { foreach ($item in Get-ChildItem -LiteralPath $target -Recurse -Force -ErrorAction Stop) {
            if ($entries.Count -ge 2000) { throw 'Choose a smaller folder (at most 2,000 entries).' }
            $entries+=@([OrvixConstruction]::AccessProbe($item.FullName))
        } }
    }
    if (@($entries | Where-Object { $_.identityError -ne 0 }).Count) { throw 'The original file identities could not be checked. Close busy files and try again.' }
    @{version=1;id=$request.id;sid=$identity.User.Value;at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();entries=$entries} | ConvertTo-Json -Depth 10 -Compress
} else {
    $baseline=Get-Content -LiteralPath $baselineFile -Raw | ConvertFrom-Json
    if ($baseline.version -ne 1 -or $baseline.sid -ne $identity.User.Value -or @($baseline.entries).Count -gt 2000) { throw 'The saved normal-user access baseline does not match this account.' }
    $issues=@()
    foreach ($entry in $baseline.entries) {
        $actual=[OrvixConstruction]::AccessProbe($entry.path)
        $code=if ($actual.identityError) { $actual.identityError } elseif ($actual.identity -ne $entry.identity) { -1 } elseif (($actual.readError -eq 0) -ne ($entry.readError -eq 0)) { $actual.readError } elseif (($actual.writeError -eq 0) -ne ($entry.writeError -eq 0)) { $actual.writeError } else { $null }
        if ($null -ne $code) {
            $reason=switch ($code) { 2 {'missing'} 3 {'missing'} 5 {'permission_denied'} 32 {'file_busy'} 33 {'file_busy'} -1 {'identity_changed'} 0 {'access_changed'} default {'access_check_failed'} }
            $issues+=@(@{path=$entry.path;reason=$reason;code=$code})
        }
    }
    @{version=1;id=$baseline.id;sid=$identity.User.Value;at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();status=$(if ($issues.Count) {'attention'} else {'verified'});checked=@($baseline.entries).Count;issues=$issues} | ConvertTo-Json -Depth 10 -Compress
}
