param(
    [string]$OutputFile
)

$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $PSScriptRoot
$repo = Resolve-Path (Join-Path $project "..\..")
$plan = Join-Path $repo "docs\android\ANDROID_UNIFIED_WORKBENCH_RUNTIME_V2_DEVELOPMENT_PLAN.md"
if ([string]::IsNullOrWhiteSpace($OutputFile)) {
    $OutputFile = Join-Path $repo "docs\android\acceptance\stage5\feature-evidence.json"
}
if (-not (Test-Path -LiteralPath $plan -PathType Leaf)) { throw "Stage 5 plan missing: $plan" }

$planText = Get-Content -LiteralPath $plan -Raw -Encoding UTF8
$featureIds = [regex]::Matches($planText, 'M\d{2}-F\d{2}') | ForEach-Object Value | Sort-Object -Unique
if ($featureIds.Count -ne 96) { throw "Expected 96 feature IDs, found $($featureIds.Count)" }

$existing = @{}
if (Test-Path -LiteralPath $OutputFile -PathType Leaf) {
    $document = Get-Content -LiteralPath $OutputFile -Raw -Encoding UTF8 | ConvertFrom-Json
    @($document.features) | ForEach-Object { $existing[$_.id] = $_ }
}

$features = foreach ($id in $featureIds) {
    $record = $existing[$id]
    [ordered]@{
        id = $id
        result = if ($null -ne $record -and $record.result -in @("pending", "passed", "failed")) { $record.result } else { "pending" }
        code_ref = if ($null -ne $record) { [string]$record.code_ref } else { "" }
        test_ref = if ($null -ne $record) { [string]$record.test_ref } else { "" }
        notes = if ($null -ne $record) { [string]$record.notes } else { "" }
    }
}

$parent = Split-Path -Parent $OutputFile
New-Item -ItemType Directory -Force -Path $parent | Out-Null
[ordered]@{
    schema_version = 1
    generated_at = [DateTimeOffset]::UtcNow.ToString('o')
    policy = "pending records must never be promoted without code, automated test, and required device evidence"
    features = @($features)
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $OutputFile -Encoding UTF8

Write-Output "Initialized $($featureIds.Count) Stage 5 evidence records at $OutputFile"
