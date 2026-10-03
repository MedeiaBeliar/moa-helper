@echo off
setlocal
where.exe node.exe >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20 or newer, then try again.
  pause
  exit /b 1
)
rem Run in a Node-owned console without a configuration menu or nested batch.
start "Moa 500k tests" /D "%~dp0" node.exe "%~dp0tests\500k-runner.mjs"
exit /b
