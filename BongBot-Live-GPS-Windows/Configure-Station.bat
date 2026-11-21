@echo off
setlocal
title Bong Bot AIoT - ESP32
pushd "%~dp0" || exit /b 1
if not exist "runtime\win-x64\node.exe" (
  echo Hay giai nen toan bo ZIP truoc.
  pause
  exit /b 1
)
"runtime\win-x64\node.exe" "server\configure-station.mjs"
set "TASK_EXIT=%ERRORLEVEL%"
pause
popd
exit /b %TASK_EXIT%
