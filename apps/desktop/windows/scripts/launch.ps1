param(
    [ValidateSet("dev", "build", "verify")]
    [string]$Command = "dev"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..\..\..\..")).Path
$WindowsRoot = Join-Path $RepoRoot "apps\desktop\windows"

switch ($Command) {
    "dev" { & (Join-Path $ScriptDir "dev.ps1") }
    "build" { Push-Location $WindowsRoot; try { npm run build:unpack } finally { Pop-Location } }
    "verify" { Push-Location $WindowsRoot; try { npm run verify } finally { Pop-Location } }
}
exit $LASTEXITCODE
