param([switch]$Applications)
$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path -Parent $PSScriptRoot
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$wpfPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\WPF'
$monitorPath = Join-Path $workspacePath 'PC-Monitor-Test\bin\PCMonitor.next.exe'
$fixturePath = Join-Path $workspacePath 'PC-Monitor-Test\bin\DesktopControlFixture.exe'
$sources = Get-ChildItem -LiteralPath (Join-Path $workspacePath 'PC-Monitor-Test\src') -Filter '*.cs' | ForEach-Object FullName
& $compilerPath /nologo /platform:x64 /target:exe /codepage:65001 "/out:$monitorPath" /r:System.Core.dll /r:System.Runtime.dll /r:System.Management.dll /r:System.Web.Extensions.dll /r:System.Runtime.WindowsRuntime.dll /r:System.Drawing.dll "/r:$wpfPath\UIAutomationClient.dll" "/r:$wpfPath\UIAutomationTypes.dll" "/r:$wpfPath\WindowsBase.dll" $sources
if ($LASTEXITCODE -ne 0) { throw 'PC Monitor compilation failed.' }
& $compilerPath /nologo /platform:x64 /target:exe /codepage:65001 "/out:$fixturePath" "/r:$monitorPath" /r:System.Core.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'DesktopControlFixture.cs')
if ($LASTEXITCODE -ne 0) { throw 'Desktop fixture compilation failed.' }
if ($Applications) { & $fixturePath --apps } else { & $fixturePath }
if ($LASTEXITCODE -ne 0) { throw 'Native desktop checks failed.' }
