param(
    [string]$DrsaiHome,
    [switch]$InstallPrerequisites,
    [switch]$InstallOnly,
    [switch]$ForceInstall,
    [switch]$SkipNpmInstall,
    [switch]$NoDevServer,
    [switch]$NoGateway
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$MovedScript = Join-Path $RepoRoot "apps\desktop\scripts\windows-desktop-dev.ps1"

$forwardArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $MovedScript)
if ($DrsaiHome) {
    $forwardArgs += @("-DrsaiHome", $DrsaiHome)
}
if ($InstallPrerequisites) {
    $forwardArgs += "-InstallPrerequisites"
}
if ($InstallOnly) {
    $forwardArgs += "-InstallOnly"
}
if ($ForceInstall) {
    $forwardArgs += "-ForceInstall"
}
if ($SkipNpmInstall) {
    $forwardArgs += "-SkipNpmInstall"
}
if ($NoDevServer) {
    $forwardArgs += "-NoDevServer"
}
if ($NoGateway) {
    $forwardArgs += "-NoGateway"
}

& powershell @forwardArgs
exit $LASTEXITCODE
