param(
    [Parameter(Mandatory = $true)][string]$Apk,
    [Parameter(Mandatory = $true)][string]$CdnManifest,
    [Parameter(Mandatory = $true)][string]$GitHubManifest,
    [switch]$VerifyOnline,
    [string]$Report
)

$ErrorActionPreference = "Stop"
$apkPath = (Resolve-Path -LiteralPath $Apk).Path
$cdnPath = (Resolve-Path -LiteralPath $CdnManifest).Path
$githubPath = (Resolve-Path -LiteralPath $GitHubManifest).Path
$cdn = Get-Content -LiteralPath $cdnPath -Raw | ConvertFrom-Json
$github = Get-Content -LiteralPath $githubPath -Raw | ConvertFrom-Json

function Assert-Equal([string]$Name, $Left, $Right) {
    if ($Left -ne $Right) { throw "$Name mismatch: '$Left' != '$Right'" }
}

Assert-Equal "schemaVersion" $cdn.schemaVersion 1
Assert-Equal "platform" $cdn.platform "android"
Assert-Equal "schemaVersion/github" $github.schemaVersion 1
Assert-Equal "platform/github" $github.platform "android"
foreach ($field in @("channel", "version", "versionCode", "minimumSupportedVersion", "mandatory")) {
    Assert-Equal $field $cdn.$field $github.$field
}
foreach ($field in @("sizeBytes", "sha256", "signingCertSha256")) {
    Assert-Equal "apk.$field" $cdn.apk.$field $github.apk.$field
}

$expectedFileName = "OpenDrSai-Android-v$($cdn.version).apk"
Assert-Equal "APK filename" (Split-Path -Leaf $apkPath) $expectedFileName
Assert-Equal "APK size" (Get-Item -LiteralPath $apkPath).Length ([int64]$cdn.apk.sizeBytes)
Assert-Equal "APK SHA-256" `
    (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash.ToLowerInvariant() `
    ([string]$cdn.apk.sha256).ToLowerInvariant()

$cdnUri = [Uri]$cdn.apk.url
$githubUri = [Uri]$github.apk.url
Assert-Equal "CDN APK scheme" $cdnUri.Scheme "https"
Assert-Equal "CDN APK host" $cdnUri.Host "download-opendrsai.ihep.ac.cn"
Assert-Equal "GitHub APK scheme" $githubUri.Scheme "https"
Assert-Equal "GitHub APK host" $githubUri.Host "github.com"
if (-not $cdnUri.AbsolutePath.EndsWith("/releases/v$($cdn.version)/android/$expectedFileName")) {
    throw "CDN APK URL is not an immutable version path: $cdnUri"
}
if (-not $githubUri.AbsolutePath.EndsWith("/releases/download/v$($cdn.version)/$expectedFileName")) {
    throw "GitHub APK URL is not an immutable release path: $githubUri"
}

$onlineChecks = @()
if ($VerifyOnline) {
    foreach ($asset in @(
        [ordered]@{ source = "cdn"; url = $cdn.apk.url },
        [ordered]@{ source = "github"; url = $github.apk.url }
    )) {
        $head = Invoke-WebRequest -Uri $asset.url -Method Head -MaximumRedirection 6 -UseBasicParsing
        if ([int]$head.StatusCode -lt 200 -or [int]$head.StatusCode -ge 400) {
            throw "$($asset.source) HEAD failed: $($head.StatusCode)"
        }
        if ($head.Headers["Content-Length"] -and
            [int64]$head.Headers["Content-Length"] -ne [int64]$cdn.apk.sizeBytes) {
            throw "$($asset.source) Content-Length mismatch"
        }
        # Windows PowerShell 5.1 rejects Range as a restricted header when it
        # is supplied through Invoke-WebRequest -Headers. HttpWebRequest's
        # AddRange API works on both Windows PowerShell 5.1 and PowerShell 7.
        $rangeRequest = [System.Net.HttpWebRequest]::Create([string]$asset.url)
        $rangeRequest.Method = "GET"
        $rangeRequest.AllowAutoRedirect = $true
        $rangeRequest.MaximumAutomaticRedirections = 6
        $rangeRequest.AddRange(0, 1)
        $rangeResponse = $rangeRequest.GetResponse()
        try {
            $rangeStatus = [int]$rangeResponse.StatusCode
        } finally {
            $rangeResponse.Dispose()
        }
        if ($rangeStatus -notin @(200, 206)) {
            throw "$($asset.source) Range request failed: $rangeStatus"
        }
        $onlineChecks += [ordered]@{
            source = $asset.source
            headStatus = [int]$head.StatusCode
            rangeStatus = $rangeStatus
            contentLength = $head.Headers["Content-Length"]
        }
    }
}

$result = [ordered]@{
    schemaVersion = 1
    generatedAt = [DateTimeOffset]::UtcNow.ToString("o")
    result = "passed"
    channel = $cdn.channel
    version = $cdn.version
    versionCode = [int64]$cdn.versionCode
    sizeBytes = [int64]$cdn.apk.sizeBytes
    sha256 = ([string]$cdn.apk.sha256).ToLowerInvariant()
    signingCertSha256 = ([string]$cdn.apk.signingCertSha256).ToLowerInvariant()
    onlineVerified = [bool]$VerifyOnline
    onlineChecks = $onlineChecks
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
