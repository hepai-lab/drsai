param(
    [switch]$SkipBuild,
    [switch]$SkipStage5Acceptance,
    [ValidateSet("stable", "beta", "dev")]
    [string]$Channel = "beta",
    [string]$ReleaseBaseUrl = "https://download-opendrsai.ihep.ac.cn/releases"
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
$variant = switch ($Channel) {
    "stable" { "release" }
    "beta" { "mvp" }
    "dev" { "acceptance" }
}
$variantTitle = (Get-Culture).TextInfo.ToTitleCase($variant)
$apk = Join-Path $project "app\build\outputs\apk\$variant\$fileName"

if (-not $SkipBuild) {
    Push-Location $project
    try {
        & .\gradlew.bat testDebugUnitTest "lint$variantTitle" "assemble$variantTitle"
        if ($LASTEXITCODE -ne 0) { throw "Android release gates failed: $LASTEXITCODE" }
    } finally { Pop-Location }
}
if (-not $SkipStage5Acceptance) {
    & (Join-Path $PSScriptRoot "verify-stage5-acceptance.ps1")
    if ($LASTEXITCODE -ne 0) { throw "Stage 5 acceptance gate failed: $LASTEXITCODE" }
}
if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) { throw "Missing APK: $apk" }

$output = Join-Path $project "app\build\stage5-release"
New-Item -ItemType Directory -Force -Path $output | Out-Null
$generator = Join-Path $PSScriptRoot "generate-android-update-manifests.ps1"
& $generator `
    -Apk $apk `
    -Channel $Channel `
    -OutputDirectory $output `
    -CdnReleaseBaseUrl $ReleaseBaseUrl `
    -MinimumSupportedVersion "1.5.0"
if ($LASTEXITCODE -ne 0) { throw "Android update manifest generation failed: $LASTEXITCODE" }

$manifestReportPath = Join-Path $output "android-release-manifest-report.json"
$manifestReport = Get-Content -LiteralPath $manifestReportPath -Raw | ConvertFrom-Json
$report = [ordered]@{
    generated_at = [DateTimeOffset]::UtcNow.ToString('o')
    result = "passed"
    apk = (Resolve-Path $apk).Path
    version = $version
    variant = $variant
    channel = $Channel
    file_name = $fileName
    size = $manifestReport.identity.sizeBytes
    sha256 = $manifestReport.identity.sha256
    signer_sha256 = $manifestReport.identity.signingCertSha256
    cdn_update_manifest = (Join-Path $output "latest-android-cdn.json")
    github_update_manifest = (Join-Path $output "latest-android-github.json")
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText(
    (Join-Path $output "stage5-release-report.json"),
    (($report | ConvertTo-Json -Depth 4) + [Environment]::NewLine),
    $utf8NoBom
)
$report | ConvertTo-Json -Depth 4
