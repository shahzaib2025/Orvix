$ErrorActionPreference='Stop'
$directory=$PSScriptRoot
try {
    try { $journal=Get-Content -LiteralPath (Join-Path $directory 'manifest.json') -Raw | ConvertFrom-Json } catch { $journal=@{status='recovery_required'} }
    if ($journal.status -ne 'unlocked') {
        $helper=Join-Path $directory 'construction-lock.ps1'
        $command="& '"+$helper.Replace("'","''")+"' -StateDirectory '"+$directory.Replace("'","''")+"' -Mode Recover; if (`$LASTEXITCODE) { exit `$LASTEXITCODE }"
        $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $process=Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -Wait -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',$encoded)
        if ($process.ExitCode -ne 0) { throw 'Windows could not confirm restoration. Keep this recovery folder and inspect helper.log.' }
    }
    $result=& (Join-Path $directory 'construction-access.ps1') -StateDirectory $directory -Mode Check | ConvertFrom-Json
    $json=$result | ConvertTo-Json -Depth 10 -Compress
    $file=Join-Path $directory 'access-after.json'; $stream=[IO.File]::Open($file+'.tmp',[IO.FileMode]::Create)
    try { $bytes=[Text.UTF8Encoding]::new($false).GetBytes($json);$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true) } finally { $stream.Dispose() }
    Move-Item -LiteralPath ($file+'.tmp') -Destination $file -Force
    Add-Type -AssemblyName PresentationFramework
    $message=if ($result.status -eq 'verified') {'Your original access is restored and checked. No file content was changed by recovery.'} else {'Permissions were restored, but some access checks need attention: '+(($result.issues | ForEach-Object { $_.path+': '+$_.reason }) -join "`n")}
    [Windows.MessageBox]::Show($message,'Orvix file recovery') | Out-Null
} catch { Add-Type -AssemblyName PresentationFramework; [Windows.MessageBox]::Show($_.Exception.Message+"`nRecovery records: "+$directory,'Orvix recovery needs attention') | Out-Null; exit 1 }
