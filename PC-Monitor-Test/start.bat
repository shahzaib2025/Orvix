@echo off
cd /d "%~dp0"
if not exist "bin\PCMonitor.exe" call build.bat
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)
"bin\PCMonitor.exe" %*
if errorlevel 1 pause
