param(
    [string]$OutputRoot,
    [string]$GradleTask = "connectedDebugAndroidTest",
    [switch]$Resume
)

$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $PSScriptRoot
$repo = Resolve-Path (Join-Path $project "..\..")
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $repo "docs\android\acceptance\stage5\emulator-results"
}
$gradlew = Join-Path $project "gradlew.bat"
$rawResults = Join-Path $project "app\build\outputs\androidTest-results\connected\debug"
$classes = @(
    "ai.drsai.remote.AndroidLocalCapabilitiesInstrumentedTest",
    "ai.drsai.remote.AttachmentProcessorTest",
    "ai.drsai.remote.LocalStoreTest",
    "ai.drsai.remote.LoginScreenTest",
    "ai.drsai.remote.OidcRedirectTest",
    "ai.drsai.remote.remote.ui.RemoteSessionUiTest",
    "ai.drsai.remote.remote.ui.RemoteWorkspaceUiTest",
    "ai.drsai.remote.remote.ui.WorkspaceReadUiTest",
    "ai.drsai.remote.ui.MainInterfaceTest"
)

$destinations = @{
    api30 = Join-Path $OutputRoot "api30"
    api35 = Join-Path $OutputRoot "api35"
}
foreach ($destination in $destinations.Values) {
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    if (-not $Resume) {
        Get-ChildItem -LiteralPath $destination -Filter "stage5-*.xml" -File -ErrorAction SilentlyContinue |
            Remove-Item -Force
    }
}

Push-Location $project
try {
    foreach ($class in $classes) {
        $shard = ($class -split '\.')[-1]
        $api30Shard = Join-Path $destinations.api30 "stage5-$shard.xml"
        $api35Shard = Join-Path $destinations.api35 "stage5-$shard.xml"
        if ($Resume -and (Test-Path -LiteralPath $api30Shard) -and (Test-Path -LiteralPath $api35Shard)) {
            Write-Host "Skipping completed Stage 5 shard: $shard"
            continue
        }
        Write-Host "Running Stage 5 shard: $shard"
        $passed = $false
        foreach ($attempt in 1..2) {
            & $gradlew $GradleTask "-Pandroid.testInstrumentationRunnerArguments.class=$class" --console=plain
            if ($LASTEXITCODE -eq 0) { $passed = $true; break }
            Write-Warning "Instrumentation shard attempt $attempt failed: $class"
        }
        if (-not $passed) { throw "Instrumentation shard failed: $class" }

        $reports = @(Get-ChildItem -LiteralPath $rawResults -Filter "*.xml" -File)
        foreach ($report in $reports) {
            [xml]$xml = Get-Content -LiteralPath $report.FullName -Raw
            $device = @($xml.testsuite.properties.property | Where-Object name -eq "device")[0].value
            $api = if ($device -match "API_30|API 30") { "api30" } elseif ($device -match "API_35|API 35") { "api35" } else { $null }
            if ($null -eq $api) { continue }
            Copy-Item -LiteralPath $report.FullName -Destination (Join-Path $destinations[$api] "stage5-$shard.xml") -Force
        }
    }
} finally {
    Pop-Location
}

foreach ($api in @("api30", "api35")) {
    $tests = 0
    $failures = 0
    $errors = 0
    $skipped = 0
    $files = @(Get-ChildItem -LiteralPath $destinations[$api] -Filter "stage5-*.xml" -File)
    foreach ($file in $files) {
        [xml]$xml = Get-Content -LiteralPath $file.FullName -Raw
        $tests += [int]$xml.testsuite.tests
        $failures += [int]$xml.testsuite.failures
        $errors += [int]$xml.testsuite.errors
        $skipped += [int]$xml.testsuite.skipped
    }
    if ($files.Count -ne $classes.Count -or $tests -ne 67 -or $failures -ne 0 -or $errors -ne 0 -or $skipped -ne 0) {
        throw "$api instrumentation incomplete: files=$($files.Count) tests=$tests failures=$failures errors=$errors skipped=$skipped"
    }
    Write-Host "$api passed: files=$($files.Count) tests=$tests failures=0 errors=0 skipped=0"
}
