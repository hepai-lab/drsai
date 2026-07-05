param(
    [string]$OutDir = "$PSScriptRoot\..\..\windows\release\bootstrapper",
    [string]$ManifestUrl = "https://github.com/hepai-lab/drsai/releases/latest/download/desktop-installer-windows.json",
    [string]$BootstrapperVersion = "",
    [string]$ExtraInstallArgs = "",
    [switch]$RequireNsis
)

$ErrorActionPreference = "Stop"

$windowsAppDir = Resolve-Path (Join-Path $PSScriptRoot "..\..\windows")
$packageJsonPath = Join-Path $windowsAppDir "package.json"
if (-not $BootstrapperVersion) {
    $BootstrapperVersion = (Get-Content $packageJsonPath -Raw | ConvertFrom-Json).version
}

$makensis = Get-Command makensis -ErrorAction SilentlyContinue
if (-not $makensis) {
    foreach ($candidate in @(
        "${env:ProgramFiles(x86)}\NSIS\makensis.exe",
        "${env:ProgramFiles}\NSIS\makensis.exe",
        "${env:ProgramFiles(x86)}\NSIS\Bin\makensis.exe",
        "${env:ProgramFiles}\NSIS\Bin\makensis.exe"
    )) {
        if ($candidate -and (Test-Path $candidate)) {
            $makensis = Get-Item -LiteralPath $candidate
            break
        }
    }
}
if (-not $makensis) {
    $message = "makensis was not found. Install NSIS and rerun this script."
    if ($RequireNsis) {
        throw $message
    }
    Write-Host $message -ForegroundColor Yellow
    exit 2
}

$OutDir = [System.IO.Path]::GetFullPath($OutDir)
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$defines = @(
    "/DOUTPUT_DIR=$OutDir",
    "/DMANIFEST_URL=$ManifestUrl",
    "/DBOOTSTRAPPER_VERSION=$BootstrapperVersion"
)
if ($ExtraInstallArgs) {
    $defines += "/DEXTRA_INSTALL_ARGS=$ExtraInstallArgs"
}

Push-Location $PSScriptRoot
try {
    & $makensis.FullName @defines ".\OpenDrSaiDesktopBootstrapper.nsi"
    if ($LASTEXITCODE -ne 0) {
        throw "makensis failed with exit code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}

$exe = Join-Path $OutDir "OpenDrSaiSetup.exe"
if (-not (Test-Path $exe)) {
    throw "Expected bootstrapper was not created: $exe"
}

Write-Host "Built $exe" -ForegroundColor Green
