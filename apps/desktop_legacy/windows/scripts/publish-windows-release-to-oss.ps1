param(
    [Parameter(Mandatory = $true)][ValidateSet("beta", "stable")][string]$Channel,
    [Parameter(Mandatory = $true)][string]$ReleaseDirectory,
    [string]$BuildLabel,
    [string]$Bucket = "hepai-release",
    [string]$OssUtil = $env:OSSUTIL_PATH,
    [string]$OssutilConfig = $env:OSSUTIL_CONFIG,
    [switch]$StageVersionAssets,
    [switch]$DryRun,
    [switch]$VerifyOnline,
    [string]$Report
)

$ErrorActionPreference = "Stop"
$windowsRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$releaseRoot = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$package = Get-Content -LiteralPath (Join-Path $windowsRoot "package.json") -Raw | ConvertFrom-Json
$version = [string]$package.version
$tag = "v$version"
$runtimeName = "OpenDrSai-Windows-v$version-x64.zip"
$installerName = "OpenDrSai-Windows-Installer-x64.msi"
$runtimePath = Join-Path $releaseRoot "bootstrapper\$runtimeName"
$installerPath = Join-Path $releaseRoot "bootstrapper\$installerName"
$sourceManifest = Join-Path $releaseRoot "latest-windows.json"
$summaryPath = Join-Path $releaseRoot "release-summary.json"
$channelManifest = Join-Path $releaseRoot "latest-windows-$Channel.json"
$channelSummary = Join-Path $releaseRoot "release-summary-$Channel.json"
$versionBase = "oss://$Bucket/releases/$tag/windows"
$channelObject = "oss://$Bucket/channels/$Channel/latest-windows.json"
$cdnVersionBase = "https://download-opendrsai.ihep.ac.cn/releases/$tag/windows"
$cdnChannelUrl = "https://download-opendrsai.ihep.ac.cn/channels/$Channel/latest-windows.json"
$commands = [System.Collections.Generic.List[string]]::new()

foreach ($path in @($runtimePath, $installerPath, $sourceManifest, $summaryPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing release input: $path" }
}
if ($Channel -eq "beta" -and [string]::IsNullOrWhiteSpace($BuildLabel)) {
    $existing = Get-Content -LiteralPath $sourceManifest -Raw | ConvertFrom-Json
    $BuildLabel = [string]$existing.buildLabel
    if ([string]::IsNullOrWhiteSpace($BuildLabel)) { throw "Beta promotion requires -BuildLabel or source manifest buildLabel." }
}
if ($Channel -eq "stable" -and -not [string]::IsNullOrWhiteSpace($BuildLabel)) {
    throw "Stable promotion must not carry a buildLabel."
}

$env:OPENDRSAI_SOURCE_UPDATE_MANIFEST = $sourceManifest
$env:OPENDRSAI_CHANNEL_MANIFEST_PATH = $channelManifest
$env:OPENDRSAI_UPDATE_CHANNEL = $Channel
$env:OPENDRSAI_BUILD_LABEL = if ($Channel -eq "beta") { $BuildLabel } else { "" }
& node (Join-Path $PSScriptRoot "create-windows-channel-manifest.mjs")
if ($LASTEXITCODE -ne 0) { throw "Channel manifest generation failed." }
$env:OPENDRSAI_SOURCE_RELEASE_SUMMARY = $summaryPath
$env:OPENDRSAI_CHANNEL_SUMMARY_PATH = $channelSummary
& node (Join-Path $PSScriptRoot "create-windows-channel-summary.mjs")
if ($LASTEXITCODE -ne 0) { throw "Channel release summary generation failed." }

$manifest = Get-Content -LiteralPath $channelManifest -Raw | ConvertFrom-Json
$generatedSummary = Get-Content -LiteralPath $channelSummary -Raw | ConvertFrom-Json
$runtimeHash = (Get-FileHash -LiteralPath $runtimePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($manifest.version -ne $version) { throw "Manifest version does not match package.json." }
if ($manifest.runtime.url -ne "$cdnVersionBase/$runtimeName") { throw "Manifest runtime URL is not the immutable version URL." }
if ([long]$manifest.runtime.sizeBytes -ne (Get-Item -LiteralPath $runtimePath).Length) { throw "Manifest runtime size mismatch." }
if ($manifest.runtime.sha256 -ne $runtimeHash) { throw "Manifest runtime SHA-256 mismatch." }
if ($Channel -eq "stable" -and ($manifest.PSObject.Properties.Name -contains "buildLabel")) { throw "Stable manifest contains buildLabel." }
if ($Channel -eq "stable" -and -not [bool]$manifest.requireSignature) { throw "Stable manifest must require signatures." }
if ($Channel -eq "stable" -and -not [bool]$generatedSummary.distribution.publicDistributionReady) {
    throw "Stable promotion is blocked until the MSI and runtime executable have valid Authenticode signatures."
}

function Invoke-PublishCommand([string]$Display, [scriptblock]$Action) {
    $commands.Add($Display)
    if (-not $DryRun) {
        & $Action
        if ($LASTEXITCODE -ne 0) { throw "Publish command failed: $Display" }
    }
}

if (-not $DryRun) {
    if ([string]::IsNullOrWhiteSpace($OssUtil) -or -not (Test-Path -LiteralPath $OssUtil -PathType Leaf)) { throw "OSSUTIL_PATH must point to ossutil." }
    if ([string]::IsNullOrWhiteSpace($OssutilConfig) -or -not (Test-Path -LiteralPath $OssutilConfig -PathType Leaf)) { throw "OSSUTIL_CONFIG must point to the restricted ossutil config." }
}

if ($StageVersionAssets) {
    # Versioned objects are immutable. ossutil v2 skips an existing key; the
    # strict CDN verification below then rejects it unless the bytes match.
    Invoke-PublishCommand "ossutil cp MSI -> $versionBase/$installerName (ignore existing; verify identity)" {
        & $OssUtil cp $installerPath "$versionBase/$installerName" -c $OssutilConfig --region cn-beijing --ignore-existing
    }
    Invoke-PublishCommand "ossutil cp Runtime -> $versionBase/$runtimeName (ignore existing; verify identity)" {
        & $OssUtil cp $runtimePath "$versionBase/$runtimeName" -c $OssutilConfig --region cn-beijing --ignore-existing
    }
    Invoke-PublishCommand "ossutil cp summary -> $versionBase/release-summary.json (ignore existing; verify identity)" {
        & $OssUtil cp $summaryPath "$versionBase/release-summary.json" -c $OssutilConfig --region cn-beijing --ignore-existing
    }
}

# Promotion reuses already staged immutable bytes. Prove that they are public
# before mutating either channel pointer.
if (-not $DryRun) {
    $env:OPENDRSAI_RELEASE_BASE_URL = $cdnVersionBase
    $env:OPENDRSAI_RELEASE_METADATA_BASE_URL = $cdnVersionBase
    $env:OPENDRSAI_UPDATE_MANIFEST_URL = "$cdnVersionBase/latest-windows-$Channel.json"
}

Invoke-PublishCommand "ossutil cp version channel candidate -> $versionBase/latest-windows-$Channel.json (ignore existing; verify identity)" {
    & $OssUtil cp $channelManifest "$versionBase/latest-windows-$Channel.json" -c $OssutilConfig --region cn-beijing --ignore-existing
}
Invoke-PublishCommand "ossutil cp version channel summary -> $versionBase/release-summary-$Channel.json (ignore existing; verify identity)" {
    & $OssUtil cp $channelSummary "$versionBase/release-summary-$Channel.json" -c $OssutilConfig --region cn-beijing --ignore-existing
}

if (-not $DryRun) {
    & (Join-Path $PSScriptRoot "refresh-aliyun-cdn-object.ps1") -ObjectUrls @("$cdnVersionBase/latest-windows-$Channel.json", "$cdnVersionBase/release-summary-$Channel.json") -OssutilConfig $OssutilConfig | Out-Null
    $env:OPENDRSAI_LOCAL_ARTIFACT_ROOT = $releaseRoot
    $env:OPENDRSAI_LOCAL_UPDATE_MANIFEST = $channelManifest
    $env:OPENDRSAI_LOCAL_RELEASE_SUMMARY = $channelSummary
    $env:OPENDRSAI_RELEASE_SUMMARY_URL = "$cdnVersionBase/release-summary-$Channel.json"
    $env:VERIFY_PUBLIC_RELEASE_DOWNLOAD = "1"
    & node --use-system-ca (Join-Path $PSScriptRoot "verify-public-runtime-release.mjs")
    if ($LASTEXITCODE -ne 0) { throw "Immutable public asset verification failed; channel pointer was not changed." }
}

# The mutable channel manifest is deliberately the final OSS write.
Invoke-PublishCommand "ossutil cp channel manifest LAST -> $channelObject" {
    & $OssUtil cp $channelManifest $channelObject -c $OssutilConfig --region cn-beijing --force --cache-control "no-cache,max-age=0" --content-type "application/json"
}

if (-not $DryRun) {
    & (Join-Path $PSScriptRoot "refresh-aliyun-cdn-object.ps1") -ObjectUrls @($cdnChannelUrl) -OssutilConfig $OssutilConfig | Out-Null
}
if (-not $DryRun -and $VerifyOnline) {
    $env:OPENDRSAI_UPDATE_MANIFEST_URL = "$cdnChannelUrl`?verify=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
    & node --use-system-ca (Join-Path $PSScriptRoot "verify-public-runtime-release.mjs")
    if ($LASTEXITCODE -ne 0) { throw "Published channel verification failed." }
}

$result = [ordered]@{
    schemaVersion = 1
    generatedAt = [DateTimeOffset]::UtcNow.ToString("o")
    result = "passed"
    dryRun = [bool]$DryRun
    channel = $Channel
    version = $version
    buildLabel = if ($Channel -eq "beta") { $BuildLabel } else { $null }
    versionBase = $versionBase
    channelObject = $channelObject
    stagedVersionAssets = [bool]$StageVersionAssets
    channelManifestPublishedLast = $true
    cdnRefreshedAfterMutableManifest = -not [bool]$DryRun
    commands = @($commands)
}
if ($Report) {
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($Report), (($result | ConvertTo-Json -Depth 6) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
}
$result | ConvertTo-Json -Depth 6
