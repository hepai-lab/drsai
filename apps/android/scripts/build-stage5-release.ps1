param(
    [switch]$SkipBuild,
    [switch]$SkipStage5Acceptance,
    [string]$Channel = "beta",
    [string]$ReleaseBaseUrl = "https://github.com/hepai-lab/drsai/releases/download"
)

$ErrorActionPreference = "Stop"
$bundledJdk = "C:\Program Files\Android\Android Studio\jbr"
if ([string]::IsNullOrWhiteSpace($env:JAVA_HOME) -and (Test-Path (Join-Path $bundledJdk "bin\java.exe"))) {
    $env:JAVA_HOME = $bundledJdk
}
if ([string]::IsNullOrWhiteSpace($env:JAVA_HOME) -or -not (Test-Path (Join-Path $env:JAVA_HOME "bin\java.exe"))) {
    throw "JAVA_HOME must point to JDK 17 or newer"
}
$project = Split-Path -Parent $PSScriptRoot
$repo = Resolve-Path (Join-Path $project "..\..")
$versionFile = Join-Path $repo "apps\webui\backend\src\drsai_ui\ui_backend\version.py"
$versionText = Get-Content -LiteralPath $versionFile -Raw
$versionMatch = [regex]::Match($versionText, '(?m)^VERSION\s*=\s*["'']([^"'']+)["'']')
if (-not $versionMatch.Success) { throw "Cannot read system version from $versionFile" }
$version = $versionMatch.Groups[1].Value
$fileName = "OpenDrSai-Android-v$version.apk"
$apk = Join-Path $project "app\build\outputs\apk\mvp\$fileName"

if (-not $SkipBuild) {
    Push-Location $project
    try {
        & .\gradlew.bat testDebugUnitTest lintMvp assembleMvp
        if ($LASTEXITCODE -ne 0) { throw "Android release gates failed: $LASTEXITCODE" }
    } finally { Pop-Location }
}
if (-not $SkipStage5Acceptance) {
    & (Join-Path $PSScriptRoot "verify-stage5-acceptance.ps1")
    if ($LASTEXITCODE -ne 0) { throw "Stage 5 acceptance gate failed: $LASTEXITCODE" }
}
if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) { throw "Missing APK: $apk" }

$sdkLine = Get-Content (Join-Path $project "local.properties") | Where-Object { $_ -like 'sdk.dir=*' } | Select-Object -First 1
$sdk = $sdkLine.Substring(8).Replace('\:', ':').Replace('\\', '\')
$buildTools = Get-ChildItem (Join-Path $sdk "build-tools") -Directory | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $buildTools) { throw "Android build-tools not found under $sdk" }
$aapt = Join-Path $buildTools.FullName "aapt.exe"
$apksigner = Join-Path $buildTools.FullName "apksigner.bat"
$badging = & $aapt dump badging $apk | Select-Object -First 1
if ($badging -notmatch "versionName='$([regex]::Escape($version))'") { throw "APK versionName does not match $version`: $badging" }
if ((Split-Path $apk -Leaf) -ne $fileName) { throw "APK file name mismatch" }

$signature = & $apksigner verify --print-certs $apk
if ($LASTEXITCODE -ne 0) { throw "APK signature verification failed" }
$certLine = $signature | Where-Object { $_ -match 'SHA-256 digest:' } | Select-Object -First 1
if (-not $certLine) { throw "APK signer SHA-256 digest missing" }
$certSha256 = ($certLine -split 'SHA-256 digest:', 2)[1].Trim()
$hash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
$size = (Get-Item -LiteralPath $apk).Length
$releaseTag = "v$version"
$url = "$($ReleaseBaseUrl.TrimEnd('/'))/$releaseTag/$fileName"

$output = Join-Path $project "app\build\stage5-release"
New-Item -ItemType Directory -Force -Path $output | Out-Null
$manifest = [ordered]@{
    schemaVersion = 1
    platform = "android"
    channel = $Channel
    version = $version
    versionCode = ([int]($version.Split('.')[0]) * 10000) + ([int]($version.Split('.')[1]) * 100) + [int]($version.Split('.')[2])
    publishedAt = [DateTimeOffset]::UtcNow.ToString('o')
    minimumSupportedVersion = "1.4.9"
    mandatory = $false
    apk = [ordered]@{
        url = $url
        sizeBytes = $size
        sha256 = $hash
        signingCertSha256 = $certSha256.ToLowerInvariant()
    }
    releaseNotesUrl = "https://github.com/hepai-lab/drsai/releases/tag/$releaseTag"
}
$report = [ordered]@{
    generated_at = [DateTimeOffset]::UtcNow.ToString('o')
    result = "passed"
    apk = (Resolve-Path $apk).Path
    version = $version
    file_name = $fileName
    size = $size
    sha256 = $hash
    signer_sha256 = $certSha256
    update_manifest = (Join-Path $output "latest-android.json")
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $output "latest-android.json") -Encoding UTF8
$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $output "stage5-release-report.json") -Encoding UTF8
$report | ConvertTo-Json -Depth 4
