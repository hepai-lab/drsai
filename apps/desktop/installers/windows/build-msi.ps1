param(
    [string]$OutDir = "$PSScriptRoot\..\..\windows\release\bootstrapper",
    [string]$RuntimeUrl = "https://github.com/hepai-lab/drsai/releases/latest/download/OpenDrSaiRuntime-win-x64.zip",
    [string]$RuntimePath = "",
    [string]$RuntimeSha256 = "",
    [Int64]$RuntimeSizeBytes = 0,
    [string]$BootstrapperVersion = "",
    [string]$ExtraInstallArgs = "",
    [string]$WixDir = "",
    [ValidatePattern('^[A-Za-z0-9._-]+\.msi$')]
    [string]$OutputName = "OpenDrSaiSetup.msi"
)

$ErrorActionPreference = "Stop"

function Get-Sha256Hex([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    } finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}

function Resolve-FullPath([string]$Path) {
    if (Test-Path $Path) {
        return (Resolve-Path $Path).Path
    }
    return [System.IO.Path]::GetFullPath($Path)
}

$windowsAppDir = Resolve-FullPath (Join-Path $PSScriptRoot "..\..\windows")
if (-not $BootstrapperVersion) {
    $BootstrapperVersion = (Get-Content (Join-Path $windowsAppDir "package.json") -Raw | ConvertFrom-Json).version
}

if (-not $WixDir) {
    $portableWix = Join-Path $PSScriptRoot ".tools\wix314"
    if (Test-Path (Join-Path $portableWix "candle.exe")) {
        $WixDir = $portableWix
    }
}

$candle = if ($WixDir) { Join-Path $WixDir "candle.exe" } else { (Get-Command candle.exe -ErrorAction SilentlyContinue).Source }
$light = if ($WixDir) { Join-Path $WixDir "light.exe" } else { (Get-Command light.exe -ErrorAction SilentlyContinue).Source }
if (-not $candle -or -not (Test-Path $candle)) {
    throw "candle.exe was not found. Download WiX portable binaries or install WiX Toolset."
}
if (-not $light -or -not (Test-Path $light)) {
    throw "light.exe was not found. Download WiX portable binaries or install WiX Toolset."
}

$outDir = Resolve-FullPath $OutDir
$objDir = Join-Path $outDir "obj-msi"
New-Item -ItemType Directory -Force -Path $outDir, $objDir | Out-Null

if (-not $RuntimePath) {
    $candidateRuntime = Join-Path $outDir "OpenDrSaiRuntime-win-x64.zip"
    if (Test-Path $candidateRuntime) {
        $RuntimePath = $candidateRuntime
    }
}
if ($RuntimePath) {
    $runtimeItem = Get-Item -LiteralPath (Resolve-FullPath $RuntimePath)
    if (-not $RuntimeSha256) {
        $RuntimeSha256 = Get-Sha256Hex $runtimeItem.FullName
    }
    if ($RuntimeSizeBytes -le 0) {
        $RuntimeSizeBytes = [Int64]$runtimeItem.Length
    }
}
if (-not $RuntimeSha256 -or -not ($RuntimeSha256 -match "^[A-Fa-f0-9]{64}$")) {
    throw "RuntimeSha256 is required. Pass -RuntimePath or -RuntimeSha256."
}
if ($RuntimeSizeBytes -le 0) {
    throw "RuntimeSizeBytes is required. Pass -RuntimePath or -RuntimeSizeBytes."
}

$productVersion = $BootstrapperVersion
if ($productVersion -match '^(\d+\.\d+\.\d+)') {
    $productVersion = $Matches[1]
}
$wixExtraInstallArgs = if ($ExtraInstallArgs) { $ExtraInstallArgs } else { " " }

$wixObj = Join-Path $objDir "OpenDrSaiDesktopBootstrapper.wixobj"
$msi = Join-Path $outDir $OutputName

& $candle `
    -nologo `
    -arch x64 `
    "-dSourceDir=$PSScriptRoot" `
    "-dProductVersion=$productVersion" `
    "-dRuntimeUrl=$RuntimeUrl" `
    "-dRuntimeSha256=$RuntimeSha256" `
    "-dRuntimeSizeBytes=$RuntimeSizeBytes" `
    "-dBootstrapperVersion=$BootstrapperVersion" `
    "-dExtraInstallArgs=$wixExtraInstallArgs" `
    -out $wixObj `
    (Join-Path $PSScriptRoot "OpenDrSaiDesktopBootstrapper.wxs")
if ($LASTEXITCODE -ne 0) {
    throw "candle.exe failed with exit code $LASTEXITCODE."
}

& $light `
    -nologo `
    -sval `
    -ext WixUIExtension `
    -out $msi `
    $wixObj
if ($LASTEXITCODE -ne 0) {
    throw "light.exe failed with exit code $LASTEXITCODE."
}

if (-not (Test-Path $msi)) {
    throw "Expected MSI was not created: $msi"
}

Write-Host "Built $msi" -ForegroundColor Green
