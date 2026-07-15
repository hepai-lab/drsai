param(
    [string]$OutDir = "$PSScriptRoot\..\..\windows\release\bootstrapper",
    [string]$RuntimeUrl = "",
    [string]$RuntimePath = "",
    [string]$RuntimeSha256 = "",
    [Int64]$RuntimeSizeBytes = 0,
    [string]$BootstrapperVersion = "",
    [string]$ExtraInstallArgs = "",
    [string]$WixDir = "",
    [ValidatePattern('^[A-Za-z0-9._-]+\.msi$')]
    [string]$OutputName = "OpenDrSaiSetup-win-x64.msi"
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

$wixHome = if ($WixDir) { $WixDir } else { Split-Path -Parent $candle }
$wixSdkDir = Join-Path $wixHome "sdk"
$dtfAssembly = Join-Path $wixSdkDir "Microsoft.Deployment.WindowsInstaller.dll"
$makeSfxCa = Join-Path $wixSdkDir "MakeSfxCA.exe"
$sfxCa = Join-Path $wixSdkDir "x64\sfxca.dll"
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
foreach ($requiredTool in @($dtfAssembly, $makeSfxCa, $sfxCa, $csc)) {
    if (-not (Test-Path $requiredTool)) {
        throw "Required MSI custom action build tool was not found: $requiredTool"
    }
}
if (-not $RuntimeUrl) {
    $RuntimeUrl = "https://github.com/hepai-lab/drsai/releases/download/v$BootstrapperVersion/OpenDrSaiRuntime-win-x64.zip"
}

$actionsDll = Join-Path $objDir "OpenDrSaiInstallerActions.dll"
$packedActionsDll = Join-Path $objDir "OpenDrSaiInstallerActions.CA.dll"
$customActionConfig = Join-Path $objDir "CustomAction.config"
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "OpenDrSaiInstallerActions.config") -Destination $customActionConfig -Force

& $csc `
    /nologo `
    /target:library `
    /platform:x64 `
    /optimize+ `
    "/out:$actionsDll" `
    "/reference:$dtfAssembly" `
    (Join-Path $PSScriptRoot "OpenDrSaiInstallerActions.cs")
if ($LASTEXITCODE -ne 0) {
    throw "csc.exe failed with exit code $LASTEXITCODE."
}

Remove-Item -LiteralPath $packedActionsDll -Force -ErrorAction SilentlyContinue
& $makeSfxCa $packedActionsDll $sfxCa $actionsDll $customActionConfig $dtfAssembly
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $packedActionsDll)) {
    throw "MakeSfxCA.exe failed to package the MSI download custom action."
}

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
    "-dInstallerActionsPath=$packedActionsDll" `
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
