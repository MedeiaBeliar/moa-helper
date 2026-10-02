@echo off
setlocal
where.exe node.exe >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20 or newer, then try again.
  pause
  exit /b 1
)
rem Run Node in its own console, so Ctrl+C has no active batch job to terminate.
start "Moa helper" /D "%~dp0" node.exe "%~dp0server.mjs"
exit /b
