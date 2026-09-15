param(
    [string]$EvidenceRoot = "",
    [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
$appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$package = Get-Content (Join-Path $appRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$package.version
if (-not $EvidenceRoot) { $EvidenceRoot = Join-Path $appRoot "release\product-evidence\windows-sandbox-oidc" }
if (-not $OutputPath) { $OutputPath = Join-Path $appRoot "release\windows-sandbox-oidc-evidence-v$version.zip" }
$EvidenceRoot = [IO.Path]::GetFullPath($EvidenceRoot)
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
$stagingRoot = Join-Path $appRoot (".tmp\sandbox-evidence-seal-" + [Guid]::NewGuid().ToString("N"))
$reportPath = Join-Path $stagingRoot "verification-source.json"

try {
    [IO.Directory]::CreateDirectory($stagingRoot) | Out-Null
    & node (Join-Path $PSScriptRoot "verify-windows-sandbox-oidc-evidence.mjs") --root $EvidenceRoot --write-report $reportPath
    if ($LASTEXITCODE -ne 0) { throw "Windows Sandbox OIDC evidence is incomplete and cannot be sealed." }
    $report = Get-Content $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($selected in @($report.selected)) {
        $source = [IO.Path]::GetFullPath([string]$selected.evidenceDirectory)
        if (-not $source.StartsWith($EvidenceRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe evidence source outside root: $source" }
        $destination = Join-Path $stagingRoot (Join-Path ([string]$selected.runId) "evidence")
        [IO.Directory]::CreateDirectory($destination) | Out-Null
        Copy-Item -Path (Join-Path $source "*") -Destination $destination -Recurse -Force
    }
    Remove-Item -LiteralPath $reportPath -Force
    $sealedReport = [ordered]@{
        schemaVersion = 1; version = $version; generatedAt = [DateTime]::UtcNow.ToString("o"); passed = $true
        modes = @($report.selected | ForEach-Object { [ordered]@{ mode=$_.mode; runId=$_.runId; generatedAt=$_.generatedAt; expectedVersion=$_.expectedVersion } })
    }
    [IO.File]::WriteAllText((Join-Path $stagingRoot "evidence-report.json"), (($sealedReport | ConvertTo-Json -Depth 8) + "`n"), [Text.UTF8Encoding]::new($false))
    [IO.Directory]::CreateDirectory((Split-Path -Parent $OutputPath)) | Out-Null
    if (Test-Path $OutputPath) { Remove-Item -LiteralPath $OutputPath -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($stagingRoot, $OutputPath, [IO.Compression.CompressionLevel]::Optimal, $false)
    $hash = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $result = [ordered]@{ path=$OutputPath; version=$version; size=(Get-Item $OutputPath).Length; sha256=$hash; modes=@($sealedReport.modes.mode) }
    [IO.File]::WriteAllText("$OutputPath.json", (($result | ConvertTo-Json -Depth 6) + "`n"), [Text.UTF8Encoding]::new($false))
    $result | ConvertTo-Json -Depth 6
} finally {
    if (Test-Path $stagingRoot) {
        $resolved = [IO.Path]::GetFullPath($stagingRoot)
        $safeRoot = [IO.Path]::GetFullPath((Join-Path $appRoot ".tmp"))
        if ($resolved.StartsWith($safeRoot, [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $resolved -Recurse -Force }
    }
}
