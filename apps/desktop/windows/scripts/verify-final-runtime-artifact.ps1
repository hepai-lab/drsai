param(
    [Parameter(Mandatory = $true)][string]$ArchivePath,
    [string]$ReceiptPath = "",
    [switch]$SkipPythonImport
)

$ErrorActionPreference = "Stop"
$archive = (Resolve-Path -LiteralPath $ArchivePath).Path
if (-not $ReceiptPath) { $ReceiptPath = "$archive.receipt.json" }
$receipt = Get-Content -LiteralPath $ReceiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($receipt.status -ne "complete") { throw "Artifact receipt is not complete: $ReceiptPath" }
$actualHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $receipt.artifact.sha256) { throw "Runtime archive SHA-256 differs from completed build receipt." }
if ((Get-Item -LiteralPath $archive).Length -ne $receipt.artifact.size) { throw "Runtime archive size differs from completed build receipt." }

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
    Write-Host "Verified final Runtime archive $($receipt.buildId): $archive" -ForegroundColor Green
} finally {
    if (Test-Path -LiteralPath $extractRoot) { Remove-Item -LiteralPath $extractRoot -Recurse -Force }
}
