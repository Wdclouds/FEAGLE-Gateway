@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\feagle.ps1" %*
exit /b %errorlevel%
