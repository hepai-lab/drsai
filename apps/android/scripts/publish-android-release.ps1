param(
    [Parameter(Mandatory = $true)][string]$Apk,
    [Parameter(Mandatory = $true)][string]$ReleaseDirectory,
    [ValidateSet("stable", "beta")][string]$Channel,
    [string]$Bucket = "hepai-release",
    [string]$GitHubRepository = "hepai-lab/drsai",
    [string]$OssUtil = $env:OSSUTIL_PATH,
    [switch]$DryRun,
    [switch]$VerifyOnline,
    [string]$Report
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$apkPath = (Resolve-Path -LiteralPath $Apk).Path
$cdnManifest = Join-Path $root "latest-android-cdn.json"
$githubManifest = Join-Path $root "latest-android-github.json"
$verify = Join-Path $PSScriptRoot "verify-android-release.ps1"
& $verify -Apk $apkPath -CdnManifest $cdnManifest -GitHubManifest $githubManifest

$cdn = Get-Content -LiteralPath $cdnManifest -Raw | ConvertFrom-Json
if ($cdn.channel -ne $Channel) {
    throw "Requested channel '$Channel' does not match manifest '$($cdn.channel)'"
}
$version = [string]$cdn.version
$tag = "v$version"
$fileName = Split-Path -Leaf $apkPath
$versionObject = "oss://$Bucket/releases/$tag/android/$fileName"
$channelObject = "oss://$Bucket/channels/$Channel/latest-android.json"
$commands = [System.Collections.Generic.List[string]]::new()

function Invoke-PublishCommand([string]$Display, [scriptblock]$Action) {
    $commands.Add($Display)
    if (-not $DryRun) {
        & $Action
        if ($LASTEXITCODE -ne 0) { throw "Publish command failed: $Display" }
    }
}

if (-not $DryRun -and ([string]::IsNullOrWhiteSpace($OssUtil) -or -not (Test-Path -LiteralPath $OssUtil))) {
    throw "OSSUTIL_PATH must point to ossutil for a real publish"
}
if (-not $DryRun -and -not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "gh is required for a real GitHub Release publish"
}

# Version assets are immutable and uploaded before either channel pointer.
Invoke-PublishCommand "ossutil cp APK -> $versionObject (forbid overwrite)" {
    & $OssUtil cp $apkPath $versionObject --forbid-overwrite
}

Invoke-PublishCommand "gh create/view release $tag" {
    & gh release view $tag --repo $GitHubRepository 2>$null
    if ($LASTEXITCODE -ne 0) {
        & gh release create $tag --repo $GitHubRepository --title "OpenDrSai $version" --notes "OpenDrSai $version"
    }
}

$githubAssetDirectory = Join-Path $root "github-assets"
New-Item -ItemType Directory -Force -Path $githubAssetDirectory | Out-Null
$githubChannelAsset = Join-Path $githubAssetDirectory "latest-android.json"
Copy-Item -LiteralPath $githubManifest -Destination $githubChannelAsset -Force
Invoke-PublishCommand "gh upload immutable APK and manifest to $tag" {
    & gh release upload $tag $apkPath $githubChannelAsset --repo $GitHubRepository --clobber
}

if ($Channel -eq "stable") {
    Invoke-PublishCommand "gh mark $tag as latest stable" {
        & gh release edit $tag --repo $GitHubRepository --latest
    }
} else {
    Invoke-PublishCommand "gh update android-beta channel pointer" {
        & gh release view android-beta --repo $GitHubRepository 2>$null
        if ($LASTEXITCODE -ne 0) {
            & gh release create android-beta --repo $GitHubRepository --prerelease `
                --title "OpenDrSai Android Beta channel" --notes "Mutable Android Beta channel pointer."
        }
        & gh release upload android-beta $githubChannelAsset --repo $GitHubRepository --clobber
    }
}

# This is deliberately the final mutation. A failed asset upload cannot expose a
# channel manifest that points at a missing APK.
Invoke-PublishCommand "ossutil cp channel manifest -> $channelObject" {
    & $OssUtil cp $cdnManifest $channelObject --force
}

if (-not $DryRun -and $VerifyOnline) {
    & $verify `
        -Apk $apkPath `
        -CdnManifest $cdnManifest `
        -GitHubManifest $githubManifest `
        -VerifyOnline
}

$result = [ordered]@{
    schemaVersion = 1
    generatedAt = [DateTimeOffset]::UtcNow.ToString("o")
    result = "passed"
    dryRun = [bool]$DryRun
    channel = $Channel
    version = $version
    versionObject = $versionObject
    channelObject = $channelObject
    githubRepository = $GitHubRepository
    githubTag = $tag
    commands = @($commands)
    channelManifestPublishedLast = $true
}
if ($Report) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText(
        [IO.Path]::GetFullPath($Report),
        (($result | ConvertTo-Json -Depth 6) + [Environment]::NewLine),
        $utf8NoBom
    )
}
$result | ConvertTo-Json -Depth 6
