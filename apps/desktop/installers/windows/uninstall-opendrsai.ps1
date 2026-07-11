param(
    [string]$InstallRoot = (Join-Path (Join-Path $env:LOCALAPPDATA "Programs") "OpenDrSai"),
    [string]$DrsaiHome = (Join-Path $env:USERPROFILE ".drsai"),
    [string]$DesktopShortcut = (Join-Path ([Environment]::GetFolderPath("Desktop")) "OpenDrSai.lnk"),
    [string]$StartMenuDir = (Join-Path ([Environment]::GetFolderPath("Programs")) "OpenDrSai"),
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

Remove-Safely $DesktopShortcut
Remove-Safely $StartMenuDir
Remove-Safely $InstallRoot

if ($RemoveUserData) {
    Remove-Safely $DrsaiHome
}

exit 0
