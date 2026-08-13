@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0collect-p3-windows-sandbox-diagnostics.ps1"
exit /b %ERRORLEVEL%
