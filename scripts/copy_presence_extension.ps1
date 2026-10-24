$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $projectRoot 'PC-Monitor-Test\extension'
$packageRoot = Join-Path $projectRoot 'scratch\presence-package-final\win-unpacked'
if (!(Test-Path -LiteralPath (Join-Path $packageRoot 'Orvix.exe'))) { throw 'Packaged executable is missing.' }
$destinationRoot = Join-Path $packageRoot 'resources\PC-Monitor-Test\extension'
[System.IO.Directory]::CreateDirectory($destinationRoot) | Out-Null
foreach ($sourceFile in Get-ChildItem -LiteralPath $sourceRoot -File) {
    $destinationFile = Join-Path $destinationRoot $sourceFile.Name
    for ($attempt = 1; $attempt -le 10; $attempt++) {
        try {
            Copy-Item -LiteralPath $sourceFile.FullName -Destination $destinationFile -Force
            if ((Get-FileHash -LiteralPath $sourceFile.FullName).Hash -ne (Get-FileHash -LiteralPath $destinationFile).Hash) { throw 'Resource copy hash mismatch.' }
            break
        } catch {
            if ($attempt -eq 10) { throw }
            Start-Sleep -Milliseconds 500
        }
    }
}
Write-Output 'Extension resources copied and matched to source.'
