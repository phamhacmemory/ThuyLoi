@echo off
setlocal
title Bong Bot AIoT - Preview
pushd "%~dp0" || exit /b 1
if not exist "runtime\win-x64\node.exe" (
  echo Thieu Node.js portable. Hay giai nen toan bo file ZIP truoc.
  pause
  exit /b 1
)
"runtime\win-x64\node.exe" "server\preview.mjs"
if errorlevel 1 pause
popd
