param(
    [Parameter(Mandatory = $true)][string]$ArchivePath,
    [string]$ReceiptPath = "",
    [switch]$SkipPythonImport,
    [switch]$Fast,
    [switch]$CompleteReceipt
)

$ErrorActionPreference = "Stop"
$archive = (Resolve-Path -LiteralPath $ArchivePath).Path
if (-not $ReceiptPath) { $ReceiptPath = "$archive.receipt.json" }
$receipt = Get-Content -LiteralPath $ReceiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
$schemaVersion = [int]$receipt.schemaVersion
if ($CompleteReceipt -and $schemaVersion -lt 2) { throw "Only Runtime receipt schema v2 can be completed after full verification." }
if ($CompleteReceipt) {
    if ($receipt.status -notin @("staged", "complete")) { throw "Artifact receipt is not staged for verification: $ReceiptPath" }
} elseif ($receipt.status -ne "complete") {
    throw "Artifact receipt is not complete: $ReceiptPath"
}
$actualHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $receipt.artifact.sha256) { throw "Runtime archive SHA-256 differs from completed build receipt." }
if ((Get-Item -LiteralPath $archive).Length -ne $receipt.artifact.size) { throw "Runtime archive size differs from completed build receipt." }
if ($schemaVersion -ge 2) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archiveForMetrics = [System.IO.Compression.ZipFile]::OpenRead($archive)
    try {
        $archiveFiles = @($archiveForMetrics.Entries | Where-Object { -not $_.FullName.EndsWith("/") -and -not $_.FullName.EndsWith("\") })
        [Int64]$archiveExpandedSizeBytes = 0
        foreach ($entry in $archiveFiles) { $archiveExpandedSizeBytes += [Int64]$entry.Length }
        if ($archiveFiles.Count -ne [Int64]$receipt.payload.fileCount) {
            throw "Runtime ZIP file count differs from artifact receipt."
        }
        if ($archiveExpandedSizeBytes -ne [Int64]$receipt.payload.expandedSizeBytes) {
            throw "Runtime ZIP expanded size differs from artifact receipt."
        }
    } finally {
        $archiveForMetrics.Dispose()
    }
}

if ($Fast) {
    if ($CompleteReceipt) { throw "Fast verification cannot complete a staged receipt." }
    if ($schemaVersion -lt 2) { throw "Fast Runtime verification requires receipt schema v2 or newer." }
    if ($receipt.verification.status -ne "passed" -or $receipt.verification.mode -ne "full-extraction") {
        throw "Fast Runtime verification requires evidence of a completed full-extraction verification."
    }
    if ([Int64]$receipt.payload.fileCount -le 0 -or [Int64]$receipt.payload.expandedSizeBytes -le 0) {
        throw "Fast Runtime verification requires payload file-count and expanded-size metadata."
    }
    if ($receipt.verification.artifactSha256 -ne $receipt.artifact.sha256 -or
        $receipt.verification.runtimeManifestSha256 -ne $receipt.runtimeManifestSha256) {
        throw "Runtime full-verification evidence is not bound to the completed artifact receipt."
    }
    Write-Host "Fast-verified completed Runtime $($receipt.buildId): $archive" -ForegroundColor Green
    return
}

$extractRoot = Join-Path ([IO.Path]::GetTempPath()) ("opendrsai-runtime-verify-" + [guid]::NewGuid().ToString("N"))
try {
    Expand-Archive -LiteralPath $archive -DestinationPath $extractRoot
    $args = @(
        (Join-Path $PSScriptRoot "runtime-build-trust.mjs"),
        "verify-directory",
        "--payload", $extractRoot
    )
    if ($SkipPythonImport) { $args += "--skip-python-import" }
    & node @args
    if ($LASTEXITCODE -ne 0) { throw "Extracted Runtime trust verification failed." }
    $identity = Get-Content -LiteralPath (Join-Path $extractRoot "build-identity.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($identity.buildId -ne $receipt.buildId) { throw "Archive buildId differs from completed build receipt." }
    $manifestHash = (Get-FileHash -LiteralPath (Join-Path $extractRoot "runtime-files.sha256.json") -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($manifestHash -ne $receipt.runtimeManifestSha256) { throw "Archive Runtime manifest differs from completed build receipt." }
    if ($CompleteReceipt) {
        $receipt.status = "complete"
        $receipt | Add-Member -NotePropertyName completedAt -NotePropertyValue ([DateTime]::UtcNow.ToString("o")) -Force
        $receipt.verification = [ordered]@{
            status = "passed"
            mode = "full-extraction"
            verifiedAt = [DateTime]::UtcNow.ToString("o")
            artifactSha256 = [string]$receipt.artifact.sha256
            runtimeManifestSha256 = [string]$receipt.runtimeManifestSha256
        }
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        $resolvedReceiptPath = (Resolve-Path -LiteralPath $ReceiptPath).Path
        $temporaryReceiptPath = "$resolvedReceiptPath.tmp-$([guid]::NewGuid().ToString('N'))"
        try {
            [System.IO.File]::WriteAllText(
                $temporaryReceiptPath,
                (($receipt | ConvertTo-Json -Depth 12) + [Environment]::NewLine),
                $utf8NoBom
            )
            Move-Item -LiteralPath $temporaryReceiptPath -Destination $resolvedReceiptPath -Force
        } finally {
            Remove-Item -LiteralPath $temporaryReceiptPath -Force -ErrorAction SilentlyContinue
        }
    }
    Write-Host "Verified final Runtime archive $($receipt.buildId): $archive" -ForegroundColor Green
} finally {
    if (Test-Path -LiteralPath $extractRoot) { Remove-Item -LiteralPath $extractRoot -Recurse -Force }
}
