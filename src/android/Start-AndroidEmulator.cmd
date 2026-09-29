@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\scripts\android\Invoke-Android.ps1" -Action Emulator %*
if errorlevel 1 pause
