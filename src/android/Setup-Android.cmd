@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\scripts\android\Setup-AndroidEnvironment.ps1" %*
set "setupExit=%errorlevel%"
if not "%setupExit%"=="0" echo Setup did not finish. Read the error above.
pause
exit /b %setupExit%
