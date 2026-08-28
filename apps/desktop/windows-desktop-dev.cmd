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

REM Platform URLs (development environment)
set "OPENDRSAI_PLATFORM_BASE_URL=https://ai-dev.ihep.ac.cn"
set "OPENDRSAI_PLATFORM_API_BASE_URL=https://ai-dev.ihep.ac.cn/apiv2/v1"
set "OPENDRSAI_MODEL_BASE_URL=https://ai-dev.ihep.ac.cn/apiv2/v1"
set "OPENDRSAI_OIDC_ISSUER=https://ai-dev.ihep.ac.cn/api"

REM Built-in skills directory
set "SYSTEM_SKILLS_DIR=%REPO_ROOT%\skills\skills"

REM Remove static API keys (enforce OIDC-only auth boundary)
set "HEPAI_API_KEY="
set "OPENAI_API_KEY="
set "OPENAI_ADMIN_KEY="

REM --- Delegate to dev.ps1 for full bootstrap + hot reload ---
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%windows\scripts\dev.ps1" -LaunchMode Development %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [ERROR] dev.ps1 exited with code %EXIT_CODE%
    echo.
)

exit /b %EXIT_CODE%
