@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM  OpenDrSai Windows Desktop - Development Launcher
REM  Sets critical environment variables then delegates to dev.ps1
REM ============================================================

REM Resolve script directory and repository root
REM SCRIPT_DIR = apps\desktop\
REM RepoRoot   = apps\desktop\..\..\  (e.g. D:\work\projects\drsai)
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%..\.."
set "REPO_ROOT=%CD%"
popd

REM --- Critical environment variables for desktop_gateway ---
REM These are also set by dev.ps1, but defining them here ensures
REM they are available even if dev.ps1 is bypassed or fails early.

REM Repository root (where the drsai Python package lives)
set "DRSAI_REPO=%REPO_ROOT%"

REM Development home directory (isolated from production ~/.drsai)
set "DRSAI_HOME=%USERPROFILE%\.drsai-dev"
set "OPENDRSAI_LAUNCH_HOME=%DRSAI_HOME%"
set "OPENDRSAI_DEV_HOME=%DRSAI_HOME%"

REM Runtime root (Python backend install)
set "OPENDRSAI_RUNTIME_ROOT=%DRSAI_HOME%\drsai-agent"

REM Desktop dev-mode flags
set "OPENDRSAI_DESKTOP_DEV=1"
set "OPENDRSAI_DESKTOP_LAUNCH_MODE=development"
set "VITE_OPENDRSAI_LAUNCH_MODE=development"
set "OPENDRSAI_ACTIVE_PLATFORM=development"
set "OPENDRSAI_OIDC_ONLY=1"
set "VITE_OPENDRSAI_OIDC_ONLY=1"
REM Quiet Skills Square / gateway HTTP trace in the terminal (set to 1 to re-enable).
set "OPENDRSAI_DEBUG_HTTP=0"

REM Gateway port (28643 for both dev and prod)
set "DRSAI_DESKTOP_GATEWAY_PORT=28643"
set "OPENDRSAI_LAUNCH_GATEWAY_PORT=28643"
set "OPENDRSAI_DEV_GATEWAY_PORT=28643"

REM Gateway startup mode
set "OPENDRSAI_GATEWAY_STARTUP=eager"
set "OPENDRSAI_RUNTIME_PERSIST=0"

REM Electron user data directory
set "OPENDRSAI_ELECTRON_USER_DATA=%DRSAI_HOME%\electron-user-data"

REM Remove legacy gateway management flags so Electron owns desktop_gateway
set "DRSAI_GATEWAY_DEV_MANAGED="
set "DRSAI_GATEWAY_HOT_RELOAD="
set "OPENDRSAI_WORKBENCH_EXTERNAL_RUNTIME="

REM Platform URLs — align with WebUI test (drsaiv2):
REM OIDC/portal on ai-dev; DDF agent catalog on HepAI aiapi (same as WebUI get_ddf_agents).
set "OPENDRSAI_PLATFORM_BASE_URL=https://ai-dev.ihep.ac.cn"
set "OPENDRSAI_PLATFORM_API_BASE_URL=https://aiapi.ihep.ac.cn/apiv2"
REM Skills Square REST APIs are served by WebUI (test=drsaiv2), not the HepAI portal.
set "OPENDRSAI_SKILLS_API_BASE_URL=https://drsaiv2.ihep.ac.cn"
REM OPENDRSAI_MODEL_BASE_URL intentionally NOT set to aiapi.ihep.ac.cn — the
REM OIDC token is issued by ai-dev.ihep.ac.cn, and the production aiapi server
REM cannot verify it (401 "OIDC signing keys are unavailable"). Let
REM resolve_hepai_model_base_url() resolve the correct URL from the OIDC issuer.
set "OPENDRSAI_DDF_API_BASE_URL=https://aiapi.ihep.ac.cn/apiv2"
set "OPENDRSAI_OIDC_ISSUER=https://ai-dev.ihep.ac.cn/api"

REM Built-in skills directory
set "SYSTEM_SKILLS_DIR=%REPO_ROOT%\skills\skills"

REM Remove static API keys (enforce OIDC-only auth boundary)
set "HEPAI_API_KEY="
set "OPENAI_API_KEY="
set "OPENAI_ADMIN_KEY="

REM Rebuild PATH from Machine+User so Node/npm resolve when this .cmd is
REM launched from a stripped shell (some IDE terminals / endpoint agents).
for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "MACHINE_PATH=%%B"
for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USER_PATH=%%B"
if defined MACHINE_PATH if defined USER_PATH set "PATH=%MACHINE_PATH%;%USER_PATH%;%PATH%"
if defined MACHINE_PATH if not defined USER_PATH set "PATH=%MACHINE_PATH%;%PATH%"
if not defined MACHINE_PATH if defined USER_PATH set "PATH=%USER_PATH%;%PATH%"

REM Prefer the System32 host explicitly. A bare "powershell" name is sometimes
REM denied by endpoint CreateProcess hooks (WinError 5 / 拒绝访问).
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%POWERSHELL_EXE%" set "POWERSHELL_EXE=powershell.exe"
set "DEV_PS1=%SCRIPT_DIR%windows\scripts\dev.ps1"
set "DEV_PS1_LAUNCHER=%SCRIPT_DIR%windows-desktop-dev.ps1"

REM --- Delegate to dev.ps1 for full bootstrap + hot reload ---
"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%DEV_PS1%" -LaunchMode Development %*
set "EXIT_CODE=%ERRORLEVEL%"

REM Endpoint agents occasionally deny CreateProcess(powershell) from cmd.exe.
if "%EXIT_CODE%"=="5" (
    echo.
    echo [WARN] PowerShell CreateProcess denied ^(5^). Trying ShellExecute...
    echo.
    start /wait "" "%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%DEV_PS1%" -LaunchMode Development %*
    set "EXIT_CODE=!ERRORLEVEL!"
)

if "%EXIT_CODE%"=="5" (
    echo.
    echo [WARN] ShellExecute still denied. Trying Node trampoline...
    echo.
    where node >nul 2>&1
    if "!ERRORLEVEL!"=="0" (
        node -e "const {spawnSync}=require('child_process'); const r=spawnSync(process.env.POWERSHELL_EXE||'powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',process.env.DEV_PS1,'-LaunchMode','Development',...process.argv.slice(1)],{stdio:'inherit',windowsHide:false,env:process.env}); process.exit(r.status==null?5:r.status);" %*
        set "EXIT_CODE=!ERRORLEVEL!"
    ) else (
        echo [WARN] node.exe not found on PATH; skip Node trampoline.
    )
)

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [ERROR] dev.ps1 exited with code %EXIT_CODE%
    if "%EXIT_CODE%"=="5" (
        echo.
        echo [HINT] cmd.exe -^> powershell.exe is blocked on this machine.
        echo        You are already in PowerShell — run the in-process launcher instead:
        echo.
        echo   powershell -NoProfile -ExecutionPolicy Bypass -File "%DEV_PS1_LAUNCHER%"
        echo.
        echo        Or from repo root:
        echo   .\apps\desktop\windows-desktop-dev.ps1
        echo.
    )
    echo.
)

exit /b %EXIT_CODE%
