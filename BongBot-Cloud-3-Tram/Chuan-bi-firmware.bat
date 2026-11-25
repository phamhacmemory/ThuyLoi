@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Khong tim thay Node.js. Cai Node.js 22 tro len truoc.
  pause
  exit /b 1
)
node "%~dp0prepare-firmware.mjs"
set "firmware_result=%errorlevel%"
pause
exit /b %firmware_result%
