@echo off
setlocal
where.exe node.exe >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20 or newer, then try again.
  pause
  exit /b 1
)
rem Node owns its console, so Ctrl+C does not prompt to terminate a batch job.
start "Moa target tests" /D "%~dp0" node.exe "%~dp0tests\target-runner.mjs"
exit /b
