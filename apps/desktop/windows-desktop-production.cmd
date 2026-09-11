@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM  OpenDrSai Windows Desktop - Production Launcher
REM  Uses production HepAI/OIDC endpoints and an isolated prod home.
REM  Delegates bootstrap and launch to windows\scripts\dev.ps1.
REM ============================================================

REM Resolve script directory and repository root.
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%..\.."
set "REPO_ROOT=%CD%"
popd

REM --- Production runtime/profile isolation ---
set "DRSAI_REPO=%REPO_ROOT%"
set "DRSAI_HOME=%USERPROFILE%\.drsai-prod"
set "OPENDRSAI_LAUNCH_HOME=%DRSAI_HOME%"
set "OPENDRSAI_DEV_HOME=%DRSAI_HOME%"
set "OPENDRSAI_RUNTIME_ROOT=%DRSAI_HOME%\drsai-agent"
set "OPENDRSAI_DESKTOP_DEV=0"
set "OPENDRSAI_DESKTOP_LAUNCH_MODE=production"
set "VITE_OPENDRSAI_LAUNCH_MODE=production"
set "OPENDRSAI_ACTIVE_PLATFORM=production"
set "OPENDRSAI_OIDC_ONLY=1"
set "VITE_OPENDRSAI_OIDC_ONLY=1"
set "OPENDRSAI_DEBUG_HTTP=0"

REM Gateway port. Keep aligned with the desktop gateway defaults.
set "DRSAI_DESKTOP_GATEWAY_PORT=28643"
set "OPENDRSAI_LAUNCH_GATEWAY_PORT=28643"
set "OPENDRSAI_DEV_GATEWAY_PORT=28643"
set "OPENDRSAI_GATEWAY_STARTUP=eager"
set "OPENDRSAI_RUNTIME_PERSIST=0"
set "OPENDRSAI_ELECTRON_USER_DATA=%DRSAI_HOME%\electron-user-data"

REM Remove legacy gateway management flags so Electron owns desktop_gateway.
set "DRSAI_GATEWAY_DEV_MANAGED="
set "DRSAI_GATEWAY_HOT_RELOAD="
set "OPENDRSAI_WORKBENCH_EXTERNAL_RUNTIME="

REM --- Production platform endpoints (derived from PLATFORM_BASE_URL) ---
REM Only 3 env vars needed: PLATFORM_BASE_URL, OIDC_ISSUER, SKILLS_API_BASE_URL.
REM All other endpoints (platform API, DDF catalog, model API) are derived
REM from PLATFORM_BASE_URL + /apiv2 by platform_upstream.py.
set "OPENDRSAI_OIDC_ISSUER=https://ai.ihep.ac.cn/api"
set "OPENDRSAI_PLATFORM_BASE_URL=https://ddf.ihep.ac.cn"
set "OPENDRSAI_SKILLS_API_BASE_URL=https://opendrsai.ihep.ac.cn"



set "SYSTEM_SKILLS_DIR=%REPO_ROOT%\skills\skills"

REM Enforce the same OIDC-only boundary as the packaged desktop launcher.
set "HEPAI_API_KEY="
set "OPENAI_API_KEY="
set "OPENAI_ADMIN_KEY="

REM Rebuild PATH from Machine+User so Node/npm resolve from a stripped shell.
for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "MACHINE_PATH=%%B"
for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USER_PATH=%%B"
if defined MACHINE_PATH if defined USER_PATH set "PATH=%MACHINE_PATH%;%USER_PATH%;%PATH%"
if defined MACHINE_PATH if not defined USER_PATH set "PATH=%MACHINE_PATH%;%PATH%"
if not defined MACHINE_PATH if defined USER_PATH set "PATH=%USER_PATH%;%PATH%"

REM Prefer the System32 host explicitly.
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%POWERSHELL_EXE%" set "POWERSHELL_EXE=powershell.exe"
set "DEV_PS1=%SCRIPT_DIR%windows\scripts\dev.ps1"
REM --- Delegate to dev.ps1 in Production mode ---
"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%DEV_PS1%" -LaunchMode Production %*
set "EXIT_CODE=%ERRORLEVEL%"

if "%EXIT_CODE%"=="5" (
    echo.
    echo [WARN] PowerShell CreateProcess denied ^(5^). Trying ShellExecute...
    echo.
    start /wait "" "%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%DEV_PS1%" -LaunchMode Production %*
    set "EXIT_CODE=!ERRORLEVEL!"
)

if "%EXIT_CODE%"=="5" (
    echo.
    echo [WARN] ShellExecute still denied. Trying Node trampoline...
    echo.
    where node ^>nul 2^>^&1
    if "!ERRORLEVEL!"=="0" (
        node -e "const {spawnSync}=require('child_process'); const r=spawnSync(process.env.POWERSHELL_EXE||'powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',process.env.DEV_PS1,'-LaunchMode','Production',...process.argv.slice(1)],{stdio:'inherit',windowsHide:false,env:process.env}); process.exit(r.status==null?5:r.status);" %*
        set "EXIT_CODE=!ERRORLEVEL!"
    ) else (
        echo [WARN] node.exe not found on PATH; skip Node trampoline.
    )
)

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [ERROR] Production desktop launcher exited with code %EXIT_CODE%
    if "%EXIT_CODE%"=="5" (
        echo.
        echo [HINT] PowerShell CreateProcess is blocked on this machine.
        echo        Run apps\desktop\windows-desktop-dev.ps1 with -LaunchMode Production.
        echo.
    )
)

exit /b %EXIT_CODE%
