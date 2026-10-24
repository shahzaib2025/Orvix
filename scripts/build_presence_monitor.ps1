$ErrorActionPreference = 'Stop'
$taskProjectRoot = Split-Path -Parent $PSScriptRoot
$taskMonitorRoot = Join-Path $taskProjectRoot 'PC-Monitor-Test'
$taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$taskFramework = Split-Path -Parent $taskCompiler
$taskOutput = Join-Path $taskMonitorRoot 'bin\PCMonitor.Presence.exe'
$taskSources = @(Get-ChildItem -LiteralPath (Join-Path $taskMonitorRoot 'src') -Filter '*.cs' | ForEach-Object FullName)
$taskArguments = @('/nologo','/optimize+','/platform:x64','/target:exe','/codepage:65001',('/out:' + $taskOutput),'/r:System.Core.dll','/r:System.Runtime.dll','/r:System.Management.dll','/r:System.Web.Extensions.dll','/r:System.Runtime.WindowsRuntime.dll','/r:System.Drawing.dll',('/r:' + (Join-Path $taskFramework 'WPF\UIAutomationClient.dll')),('/r:' + (Join-Path $taskFramework 'WPF\UIAutomationTypes.dll')),('/r:' + (Join-Path $taskFramework 'WPF\WindowsBase.dll')))
& $taskCompiler @taskArguments @taskSources
if ($LASTEXITCODE -ne 0) { throw 'Presence monitor compilation failed.' }
Write-Output 'Built PCMonitor.Presence.exe'
