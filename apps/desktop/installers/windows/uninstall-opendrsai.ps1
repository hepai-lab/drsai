param(
    [string]$InstallRoot = (Join-Path $env:ProgramFiles "OpenDrSai"),
    [string]$DrsaiHome = (Join-Path $env:USERPROFILE ".drsai"),
    [switch]$RemoveUserData
)

$ErrorActionPreference = "Stop"

function Remove-Safely([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
}

Get-Process -Name "OpenDrSai" -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path.StartsWith($InstallRoot, [StringComparison]::OrdinalIgnoreCase) } |
    Stop-Process -Force -ErrorAction SilentlyContinue

foreach ($relativePath in @(
    "app",
    "app.previous",
    "drsai-agent",
    "drsai-agent.previous",
    "defaults",
    "cache",
    "install-state.json"
)) {
    Remove-Safely (Join-Path $InstallRoot $relativePath)
}

$machineInstallerData = Join-Path $env:ProgramData "OpenDrSai\Installer"
Remove-Safely $machineInstallerData

if ($RemoveUserData) {
    Remove-Safely $DrsaiHome
}

exit 0
