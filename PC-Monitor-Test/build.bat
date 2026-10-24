@echo off
setlocal
cd /d "%~dp0"
if not exist bin mkdir bin
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo Windows .NET Framework C# compiler was not found.
  exit /b 1
)
"%CSC%" /nologo /optimize+ /platform:x64 /target:exe /codepage:65001 /out:"bin\PCMonitor.Fast.exe" /r:System.Core.dll /r:System.Runtime.dll /r:System.Management.dll /r:System.Web.Extensions.dll /r:System.Runtime.WindowsRuntime.dll /r:System.Drawing.dll /r:"%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\WPF\UIAutomationClient.dll" /r:"%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\WPF\UIAutomationTypes.dll" /r:"%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\WPF\WindowsBase.dll" src\*.cs
if errorlevel 1 exit /b 1
echo Built PC Monitor demo.
