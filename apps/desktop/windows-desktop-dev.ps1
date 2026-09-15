# OpenDrSai Windows Desktop - Development Launcher (PowerShell)
# Prefer this when windows-desktop-dev.cmd fails with Access Denied (5):
#   pwsh/powershell already running in the IDE terminal can host the script
#   without a nested CreateProcess(powershell) that endpoint agents often block.
#
# Usage:
#   .\apps\desktop\windows-desktop-dev.ps1
#   .\apps\desktop\windows-desktop-dev.ps1 -SkipNpmInstall

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$RemainingArgs
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$DevScript = Join-Path $ScriptDir "windows\scripts\dev.ps1"

$env:DRSAI_REPO = $RepoRoot
$env:DRSAI_HOME = Join-Path $env:USERPROFILE ".drsai-dev"
$env:OPENDRSAI_LAUNCH_HOME = $env:DRSAI_HOME
$env:OPENDRSAI_DEV_HOME = $env:DRSAI_HOME
$env:OPENDRSAI_RUNTIME_ROOT = Join-Path $env:DRSAI_HOME "drsai-agent"
$env:OPENDRSAI_DESKTOP_DEV = "1"
$env:OPENDRSAI_DESKTOP_LAUNCH_MODE = "development"
$env:VITE_OPENDRSAI_LAUNCH_MODE = "development"
$env:OPENDRSAI_ACTIVE_PLATFORM = "development"
$env:OPENDRSAI_OIDC_ONLY = "1"
$env:VITE_OPENDRSAI_OIDC_ONLY = "1"
# Quiet Skills Square / gateway HTTP trace (set to "1" to re-enable).
$env:OPENDRSAI_DEBUG_HTTP = "0"
$env:DRSAI_DESKTOP_GATEWAY_PORT = "28643"
$env:OPENDRSAI_LAUNCH_GATEWAY_PORT = "28643"
$env:OPENDRSAI_DEV_GATEWAY_PORT = "28643"
$env:OPENDRSAI_GATEWAY_STARTUP = "eager"
$env:OPENDRSAI_RUNTIME_PERSIST = "0"
$env:OPENDRSAI_ELECTRON_USER_DATA = Join-Path $env:DRSAI_HOME "electron-user-data"
Remove-Item Env:DRSAI_GATEWAY_DEV_MANAGED -ErrorAction SilentlyContinue
Remove-Item Env:DRSAI_GATEWAY_HOT_RELOAD -ErrorAction SilentlyContinue
Remove-Item Env:OPENDRSAI_WORKBENCH_EXTERNAL_RUNTIME -ErrorAction SilentlyContinue
$env:OPENDRSAI_PLATFORM_BASE_URL = "https://ai-dev.ihep.ac.cn"
$env:OPENDRSAI_PLATFORM_API_BASE_URL = "https://aiapi.ihep.ac.cn/apiv2"
# Development launcher → test WebUI Skills Square (drsaiv2). Production launch
# uses opendrsai via windows\scripts\dev.ps1 -LaunchMode Production.
$env:OPENDRSAI_SKILLS_API_BASE_URL = "https://drsaiv2.ihep.ac.cn"
$env:OPENDRSAI_DDF_API_BASE_URL = "https://aiapi.ihep.ac.cn/apiv2"
$env:OPENDRSAI_OIDC_ISSUER = "https://ai-dev.ihep.ac.cn/api"
$env:SYSTEM_SKILLS_DIR = Join-Path $RepoRoot "skills\skills"
Remove-Item Env:HEPAI_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:OPENAI_ADMIN_KEY -ErrorAction SilentlyContinue

# Refresh PATH from Machine+User for Node/npm.
$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$env:Path = @($machinePath, $userPath, $env:Path) -join [IO.Path]::PathSeparator

if (-not (Test-Path -LiteralPath $DevScript)) {
    throw "Cannot find bootstrap script: $DevScript"
}

& $DevScript -LaunchMode Development @RemainingArgs
exit $LASTEXITCODE
