@echo off
setlocal
set "DRSAI_HOME=C:\P3\profile"
set "OPENDRSAI_GATEWAY_PORT=28643"
set "OPENDRSAI_ELECTRON_USER_DATA=C:\P3\profile\electron-user-data"
set "PYTHONPATH=C:\OpenDrSaiPackage\regression\src"
set "P3_DEVELOPER_SWITCH="
if /I "%~1"=="--developer-bypass" set "P3_DEVELOPER_SWITCH=-DeveloperBypass"
"C:\Program Files\OpenDrSai\drsai-agent\venv\Scripts\python.exe" "C:\OpenDrSaiPackage\regression\run_regression.py" --root "C:\OpenDrSaiPackage\regression" desktop-run --suite p3-desktop --output "C:\P3\evidence\results" --execution-id "p3-sandbox-current-source" --transport-command powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\OpenDrSaiPackage\run-p3-packaged-desktop-e2e.ps1" -CaseId __P3_CASE_ID__ -VerifyModelConnection %P3_DEVELOPER_SWITCH%
exit /b %ERRORLEVEL%
