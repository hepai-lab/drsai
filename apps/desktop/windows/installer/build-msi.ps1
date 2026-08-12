param(
    [string]$OutDir = "$PSScriptRoot\..\..\windows\release\bootstrapper",
    [string]$RuntimeUrl = "",
    [string]$RuntimePath = "",
    [string]$RuntimeSha256 = "",
    [Int64]$RuntimeSizeBytes = 0,
    [Int64]$EstimatedSizeKB = 0,
    [string]$BootstrapperVersion = "",
    [string]$ExtraInstallArgs = "",
    [string]$WixDir = "",
    [switch]$RequireTrustedRuntime,
    [ValidatePattern('^[A-Za-z0-9._-]+\.msi$')]
    [string]$OutputName = "OpenDrSai-Windows-Installer-x64.msi"
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

function Get-InstalledSizeKB([string]$RuntimeArchivePath) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archiveItem = Get-Item -LiteralPath $RuntimeArchivePath
    $archive = [System.IO.Compression.ZipFile]::OpenRead($archiveItem.FullName)
    try {
        [Int64]$expandedBytes = 0
        foreach ($entry in $archive.Entries) {
            $expandedBytes += [Int64]$entry.Length
        }
    } finally {
        $archive.Dispose()
    }

    # The installer keeps the verified Runtime ZIP in INSTALLFOLDER\cache and
    # installs its expanded payload beside the MSI support scripts. ARPSIZE is
    # expressed in KiB, so account for both copies instead of letting Windows
    # Installer report only the small set of files authored in the File table.
    [Int64]$supportBytes = 0
    foreach ($name in @(
        "install-opendrsai.ps1",
        "uninstall-opendrsai.ps1",
        "run-opendrsai-install.vbs",
        "run-opendrsai-uninstall.vbs"
    )) {
        $supportBytes += [Int64](Get-Item -LiteralPath (Join-Path $PSScriptRoot $name)).Length
    }
    return [Int64][Math]::Ceiling(($expandedBytes + [Int64]$archiveItem.Length + $supportBytes) / 1KB)
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
$wixSdkCandidates = @(
    (Join-Path $wixHome "sdk"),
    (Join-Path (Split-Path -Parent $wixHome) "sdk")
)
$wixSdkDir = $wixSdkCandidates |
    Where-Object { Test-Path (Join-Path $_ "Microsoft.Deployment.WindowsInstaller.dll") } |
    Select-Object -First 1
if (-not $wixSdkDir) {
    throw "WiX SDK directory was not found. Checked: $($wixSdkCandidates -join ', ')"
}

function Add-DownloadProgressUi([string]$MsiPath) {
    # Keep WixUI's ActionText control dedicated to the current install stage.
    # DownloadRuntime reports percentage, byte counts and transfer speed as
    # ActionData, so add a second visible line for those changing details.
    $installer = New-Object -ComObject WindowsInstaller.Installer
    $database = $installer.OpenDatabase($MsiPath, 1)
    $query = "SELECT ``Control`` FROM ``Control`` WHERE ``Dialog_``='ProgressDlg' AND ``Control``='DownloadDetails'"
    $view = $database.OpenView($query)
    try {
        $null = $view.Execute()
        $existing = $view.Fetch()
    } finally {
        $null = $view.Close()
    }
    if (-not $existing) {
        $insert = $database.OpenView("INSERT INTO ``Control`` (``Dialog_``, ``Control``, ``Type``, ``X``, ``Y``, ``Width``, ``Height``, ``Attributes``, ``Text``) VALUES ('ProgressDlg', 'DownloadDetails', 'Text', 20, 130, 330, 18, 3, ' ')")
        try {
            $null = $insert.Execute()
        } finally {
            $null = $insert.Close()
        }
    }
    $query = "SELECT ``Control_`` FROM ``EventMapping`` WHERE ``Dialog_``='ProgressDlg' AND ``Control_``='DownloadDetails' AND ``Event``='ActionData'"
    $view = $database.OpenView($query)
    try {
        $null = $view.Execute()
        $existing = $view.Fetch()
    } finally {
        $null = $view.Close()
    }
    if (-not $existing) {
        $insert = $database.OpenView("INSERT INTO ``EventMapping`` (``Dialog_``, ``Control_``, ``Event``, ``Attribute``) VALUES ('ProgressDlg', 'DownloadDetails', 'ActionData', 'Text')")
        try {
            $null = $insert.Execute()
        } finally {
            $null = $insert.Close()
        }
    }
    $database.Commit()
}
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
    $RuntimeUrl = "https://download-opendrsai.ihep.ac.cn/releases/v$BootstrapperVersion/windows/OpenDrSai-Windows-v$BootstrapperVersion-x64.zip"
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
    $candidateRuntime = Join-Path $outDir "OpenDrSai-Windows-v$BootstrapperVersion-x64.zip"
    if (Test-Path $candidateRuntime) {
        $RuntimePath = $candidateRuntime
    }
}
if ($RuntimePath) {
    $runtimeItem = Get-Item -LiteralPath (Resolve-FullPath $RuntimePath)
    if ($RequireTrustedRuntime) {
        $receiptPath = "$($runtimeItem.FullName).receipt.json"
        if (-not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) {
            throw "Trusted Runtime receipt is required before building an MSI: $receiptPath"
        }
        & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `
            (Join-Path $windowsAppDir "scripts\verify-final-runtime-artifact.ps1") `
            -ArchivePath $runtimeItem.FullName -ReceiptPath $receiptPath
        if ($LASTEXITCODE -ne 0) { throw "MSI input Runtime failed completed-artifact verification." }
    }
    if (-not $RuntimeSha256) {
        $RuntimeSha256 = Get-Sha256Hex $runtimeItem.FullName
    }
    if ($RuntimeSizeBytes -le 0) {
        $RuntimeSizeBytes = [Int64]$runtimeItem.Length
    }
    if ($EstimatedSizeKB -le 0) {
        $EstimatedSizeKB = Get-InstalledSizeKB $runtimeItem.FullName
    }
}
if (-not $RuntimeSha256 -or -not ($RuntimeSha256 -match "^[A-Fa-f0-9]{64}$")) {
    throw "RuntimeSha256 is required. Pass -RuntimePath or -RuntimeSha256."
}
if ($RuntimeSizeBytes -le 0) {
    throw "RuntimeSizeBytes is required. Pass -RuntimePath or -RuntimeSizeBytes."
}
if ($EstimatedSizeKB -le 0) {
    # Remote-only builds cannot inspect the archive's expanded entries. At
    # minimum, report the known downloaded payload instead of the MSI scripts.
    $EstimatedSizeKB = [Int64][Math]::Ceiling($RuntimeSizeBytes / 1KB)
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
    "-dEstimatedSizeKB=$EstimatedSizeKB" `
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

Add-DownloadProgressUi $msi

Write-Host "Built $msi" -ForegroundColor Green
