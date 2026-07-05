param(
    [string]$OutDir = "$PSScriptRoot\..\release\bootstrapper",
    [string]$ManifestUrl = "https://github.com/hepai-lab/drsai/releases/latest/download/latest-windows.json",
    [string]$BootstrapperVersion = "",
    [string]$ExpectedSignerThumbprint = $env:EXPECTED_WINDOWS_SIGNER_THUMBPRINT,
    [string]$ExpectedSignerSubject = $env:EXPECTED_WINDOWS_SIGNER_SUBJECT,
    [switch]$RequireSignerPin
)

$ErrorActionPreference = "Stop"

$makensis = Get-Command makensis -ErrorAction SilentlyContinue
if (-not $makensis) {
    throw "NSIS makensis was not found. Install NSIS and make sure makensis.exe is on PATH."
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

if (-not $BootstrapperVersion) {
    $packageJson = Join-Path $PSScriptRoot "..\package.json"
    $BootstrapperVersion = (Get-Content $packageJson -Raw | ConvertFrom-Json).version
}

if ($RequireSignerPin -and -not $ExpectedSignerThumbprint) {
    throw "ExpectedSignerThumbprint is required when building a release bootstrapper."
}

$scriptPath = Join-Path $PSScriptRoot "OpenDrSaiInstaller.nsi"
$defines = @(
    "/DOUTPUT_DIR=$OutDir",
    "/DMANIFEST_URL=$ManifestUrl",
    "/DBOOTSTRAPPER_VERSION=$BootstrapperVersion",
    "/DEXPECTED_SIGNER_THUMBPRINT=$ExpectedSignerThumbprint",
    "/DEXPECTED_SIGNER_SUBJECT=$ExpectedSignerSubject"
)

& $makensis.Source @defines $scriptPath
if ($LASTEXITCODE -ne 0) {
    throw "makensis failed with exit code $LASTEXITCODE."
}

Get-ChildItem -Path $OutDir -Filter "OpenDrSai Installer*.exe" | Select-Object FullName, Length
