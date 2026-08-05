param(
    [string]$EvidenceFile,
    [string]$JvmResults,
    [string]$Api30Results,
    [string]$Api35Results
)

$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $PSScriptRoot
$repo = Resolve-Path (Join-Path $project "..\..")
$plan = Join-Path $repo "docs\android\ANDROID_UNIFIED_WORKBENCH_RUNTIME_V2_DEVELOPMENT_PLAN.md"
if ([string]::IsNullOrWhiteSpace($EvidenceFile)) {
    $EvidenceFile = Join-Path $repo "docs\android\testing\acceptance\stage5\feature-evidence.json"
}
if ([string]::IsNullOrWhiteSpace($JvmResults)) {
    $JvmResults = Join-Path $project "app\build\test-results\testDebugUnitTest"
}
if ([string]::IsNullOrWhiteSpace($Api30Results)) {
    $Api30Results = Join-Path $repo "docs\android\testing\acceptance\stage5\emulator-results\api30"
}
if ([string]::IsNullOrWhiteSpace($Api35Results)) {
    $Api35Results = Join-Path $repo "docs\android\testing\acceptance\stage5\emulator-results\api35"
}

if (-not (Test-Path -LiteralPath $plan -PathType Leaf)) { throw "Stage 5 plan missing: $plan" }
$featureIds = [regex]::Matches((Get-Content -LiteralPath $plan -Raw -Encoding UTF8), 'M\d{2}-F\d{2}') |
    ForEach-Object Value | Sort-Object -Unique
if ($featureIds.Count -ne 96) { throw "Stage 5 plan must contain exactly 96 unique feature IDs; found $($featureIds.Count)" }
if (-not (Test-Path -LiteralPath $EvidenceFile -PathType Leaf)) { throw "Feature evidence missing: $EvidenceFile" }

$evidence = Get-Content -LiteralPath $EvidenceFile -Raw -Encoding UTF8 | ConvertFrom-Json
$records = @($evidence.features)
$duplicateIds = $records | Group-Object id | Where-Object Count -gt 1 | Select-Object -ExpandProperty Name
if ($duplicateIds) { throw "Duplicate feature evidence IDs: $($duplicateIds -join ', ')" }
$byId = @{}
$records | ForEach-Object { $byId[$_.id] = $_ }
$unexpected = @($records | Where-Object { $_.id -notin $featureIds } | ForEach-Object id)
if ($unexpected.Count -gt 0) { throw "Unexpected feature IDs: $($unexpected -join ', ')" }
$incomplete = foreach ($id in $featureIds) {
    $record = $byId[$id]
    if ($null -eq $record -or $record.result -ne "passed" -or
        [string]::IsNullOrWhiteSpace($record.code_ref) -or
        [string]::IsNullOrWhiteSpace($record.test_ref)) { $id }
}
if ($incomplete.Count -gt 0) { throw "Stage 5 feature evidence incomplete: $($incomplete -join ', ')" }

function Read-TestSummary([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw "$Label results missing: $Path" }
    $xmlFiles = @(Get-ChildItem -LiteralPath $Path -Recurse -Filter '*.xml' -File)
    if ($xmlFiles.Count -eq 0) { throw "$Label contains no XML reports: $Path" }
    $tests = 0
    $failures = 0
    $errors = 0
    $skipped = 0
    foreach ($file in $xmlFiles) {
        [xml]$xml = Get-Content -LiteralPath $file.FullName -Raw
        foreach ($suite in @($xml.testsuite)) {
            $tests += [int]$suite.tests
            $failures += [int]$suite.failures
            $errors += [int]$suite.errors
            $skipped += [int]$suite.skipped
        }
    }
    if ($tests -le 0 -or $failures -ne 0 -or $errors -ne 0 -or $skipped -ne 0) {
        throw "$Label not fully green: tests=$tests failures=$failures errors=$errors skipped=$skipped"
    }
    [ordered]@{ tests = $tests; failures = $failures; errors = $errors; skipped = $skipped; path = (Resolve-Path $Path).Path }
}

$summary = [ordered]@{
    generated_at = [DateTimeOffset]::UtcNow.ToString('o')
    result = "passed"
    planned_features = $featureIds.Count
    accepted_features = $featureIds.Count
    jvm = (Read-TestSummary $JvmResults "JVM")
    api30 = (Read-TestSummary $Api30Results "API 30")
    api35 = (Read-TestSummary $Api35Results "API 35")
    evidence_file = (Resolve-Path $EvidenceFile).Path
}
$output = Join-Path $project "app\build\stage5-release"
New-Item -ItemType Directory -Force -Path $output | Out-Null
$summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $output "stage5-acceptance-report.json") -Encoding UTF8
$summary | ConvertTo-Json -Depth 6
