@echo off
setlocal EnableDelayedExpansion
title Orvix Desktop - Logs
chcp 65001 >nul
cd /d "%~dp0"

set "NEEDS_SETUP="
if not exist "node_modules\electron\package.json" set "NEEDS_SETUP=1"
if not exist "node_modules\.bin\electron.cmd" set "NEEDS_SETUP=1"
if not exist "node_modules\.bin\tsc.cmd" set "NEEDS_SETUP=1"
if not exist "node_modules\.bin\vite.cmd" set "NEEDS_SETUP=1"

if exist "node_modules\electron\package.json" (
  for /f "usebackq delims=" %%V in (`node -p "require('./package-lock.json').packages['node_modules/electron'].version"`) do set "EXPECTED_ELECTRON_VERSION=%%V"
  for /f "usebackq delims=" %%V in (`node -p "require('./node_modules/electron/package.json').version" 2^>nul`) do set "INSTALLED_ELECTRON_VERSION=%%V"
  if not defined EXPECTED_ELECTRON_VERSION set "NEEDS_SETUP=1"
  if not defined INSTALLED_ELECTRON_VERSION set "NEEDS_SETUP=1"
  if defined EXPECTED_ELECTRON_VERSION if defined INSTALLED_ELECTRON_VERSION if not "!EXPECTED_ELECTRON_VERSION!"=="!INSTALLED_ELECTRON_VERSION!" set "NEEDS_SETUP=1"
)

if exist "node_modules\electron\dist\electron.exe" if defined EXPECTED_ELECTRON_VERSION (
  for /f "usebackq delims=" %%V in (`node scripts\start-desktop.cjs --runtime-version 2^>nul`) do set "INSTALLED_ELECTRON_BINARY_VERSION=%%V"
  if defined INSTALLED_ELECTRON_BINARY_VERSION if not "!EXPECTED_ELECTRON_VERSION!"=="!INSTALLED_ELECTRON_BINARY_VERSION!" set "NEEDS_SETUP=1"
)

if defined NEEDS_SETUP (
  where npm >nul 2>&1
  if errorlevel 1 (
    echo Node.js is required for the first Orvix setup. Install Node.js and try again.
    pause
    exit /b 1
  )
  node scripts\start-desktop.cjs --check-running
  if errorlevel 1 (
    echo Orvix is already running with dependencies that need repair. Close Orvix, then run start.bat again.
    pause
    exit /b 1
  )
  echo Setting up Orvix dependencies from package-lock.json...
  call npm ci --include=dev
  if errorlevel 1 goto :failed
)

if not exist "dist\index.html" (
  echo Preparing Orvix for the first time...
  call npm run build
  if errorlevel 1 goto :failed
)

echo Starting Orvix desktop...
call npm run desktop
if errorlevel 1 goto :failed
exit /b 0

:failed
echo Orvix could not start. See the error above.
pause
exit /b 1
