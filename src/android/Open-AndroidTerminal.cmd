@echo off
setlocal
powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\scripts\android\Invoke-Android.ps1" -Action Shell %*
