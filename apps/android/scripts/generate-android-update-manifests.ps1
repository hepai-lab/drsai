param(
    [Parameter(Mandatory = $true)][string]$Apk,
    [ValidateSet("stable", "beta", "dev")][string]$Channel,
    [string]$OutputDirectory,
    [string]$CdnReleaseBaseUrl = "https://download-opendrsai.ihep.ac.cn/releases",
    [string]$GitHubRepository = "hepai-lab/drsai",
    [string]$MinimumSupportedVersion = "1.5.0",
    [string]$ExpectedPackageName = "ai.drsai.remote",
    [switch]$Mandatory
)

$ErrorActionPreference = "Stop"
$bundledJdk = "C:\Program Files\Android\Android Studio\jbr"
if ([string]::IsNullOrWhiteSpace($env:JAVA_HOME) -and
    (Test-Path (Join-Path $bundledJdk "bin\java.exe"))) {
    $env:JAVA_HOME = $bundledJdk
}
$project = Split-Path -Parent $PSScriptRoot
$apkPath = (Resolve-Path -LiteralPath $Apk).Path
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $project "app\build\android-release"
}
$output = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $output | Out-Null

$sdkLine = Get-Content (Join-Path $project "local.properties") |
    Where-Object { $_ -like "sdk.dir=*" } |
    Select-Object -First 1
if (-not $sdkLine) { throw "sdk.dir is missing from local.properties" }
$sdk = $sdkLine.Substring(8).Replace('\:', ':').Replace('\\', '\')
$buildTools = Get-ChildItem (Join-Path $sdk "build-tools") -Directory |
    Sort-Object { [version]$_.Name } -Descending |
    Select-Object -First 1
if (-not $buildTools) { throw "Android build-tools not found under $sdk" }
$aapt = Join-Path $buildTools.FullName "aapt.exe"
$apksigner = Join-Path $buildTools.FullName "apksigner.bat"

$badging = (& $aapt dump badging $apkPath | Select-Object -First 1)
$packageMatch = [regex]::Match(
    $badging,
    "package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'"
)
if (-not $packageMatch.Success) {
    throw "Unable to read APK package/version metadata: $badging"
}
$packageName = $packageMatch.Groups[1].Value
$versionCode = [int64]$packageMatch.Groups[2].Value
$version = $packageMatch.Groups[3].Value
if ($packageName -ne $ExpectedPackageName) {
    throw "Release APK applicationId must be $ExpectedPackageName, got $packageName"
}
$expectedName = "OpenDrSai-Android-v$version.apk"
if ((Split-Path -Leaf $apkPath) -ne $expectedName) {
    throw "APK filename must be $expectedName"
}

$signature = & $apksigner verify --print-certs $apkPath
if ($LASTEXITCODE -ne 0) { throw "APK signature verification failed" }
$certLine = $signature |
    Where-Object { $_ -match "Signer #1 certificate SHA-256 digest:" } |
    Select-Object -First 1
if (-not $certLine) {
    $certLine = $signature | Where-Object { $_ -match "SHA-256 digest:" } | Select-Object -First 1
}
if (-not $certLine) { throw "APK signer SHA-256 digest missing" }
$certSha256 = ($certLine -split "SHA-256 digest:", 2)[1].Trim().ToLowerInvariant()
$certDn = ($signature | Where-Object { $_ -match "certificate DN:" } | Select-Object -First 1)
if ($Channel -eq "stable" -and $certDn -match "CN=Android Debug(?:,|$)") {
    throw "Stable Android releases require the organization Release Keystore."
}

$sha256 = (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash.ToLowerInvariant()
$size = (Get-Item -LiteralPath $apkPath).Length
$tag = "v$version"
$cdnApkUrl = "$($CdnReleaseBaseUrl.TrimEnd('/'))/$tag/android/$expectedName"
$githubApkUrl = "https://github.com/$GitHubRepository/releases/download/$tag/$expectedName"
$releaseNotesUrl = "https://github.com/$GitHubRepository/releases/tag/$tag"
$publishedAt = [DateTimeOffset]::UtcNow.ToString("o")

function New-Manifest([string]$ApkUrl) {
    return [ordered]@{
        schemaVersion = 1
        platform = "android"
        channel = $Channel
        version = $version
        versionCode = $versionCode
        publishedAt = $publishedAt
        minimumSupportedVersion = $MinimumSupportedVersion
        mandatory = [bool]$Mandatory
        apk = [ordered]@{
            url = $ApkUrl
            sizeBytes = $size
            sha256 = $sha256
            signingCertSha256 = $certSha256
        }
        releaseNotesUrl = $releaseNotesUrl
    }
}

$cdnManifest = New-Manifest $cdnApkUrl
$githubManifest = New-Manifest $githubApkUrl
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$cdnPath = Join-Path $output "latest-android-cdn.json"
$githubPath = Join-Path $output "latest-android-github.json"
$compatibilityPath = Join-Path $output "latest-android.json"
[IO.File]::WriteAllText($cdnPath, (($cdnManifest | ConvertTo-Json -Depth 5) + [Environment]::NewLine), $utf8NoBom)
[IO.File]::WriteAllText($githubPath, (($githubManifest | ConvertTo-Json -Depth 5) + [Environment]::NewLine), $utf8NoBom)
[IO.File]::WriteAllText($compatibilityPath, (($cdnManifest | ConvertTo-Json -Depth 5) + [Environment]::NewLine), $utf8NoBom)

$identity = [ordered]@{
    channel = $Channel
    version = $version
    versionCode = $versionCode
    sizeBytes = $size
    sha256 = $sha256
    signingCertSha256 = $certSha256
}
$report = [ordered]@{
    schemaVersion = 1
    generatedAt = $publishedAt
    result = "passed"
    packageName = $packageName
    apk = $apkPath
    apkFileName = $expectedName
    signerDn = $certDn
    identity = $identity
    cdnManifest = $cdnPath
    githubManifest = $githubPath
}
$reportPath = Join-Path $output "android-release-manifest-report.json"
[IO.File]::WriteAllText($reportPath, (($report | ConvertTo-Json -Depth 5) + [Environment]::NewLine), $utf8NoBom)
$report | ConvertTo-Json -Depth 5
