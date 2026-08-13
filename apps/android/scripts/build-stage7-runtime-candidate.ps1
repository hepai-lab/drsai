param(
    [Parameter(Mandatory = $true)][string]$AcceptanceRunId,
    [Parameter(Mandatory = $true)][string]$BuildId,
    [string]$VersionName = "1.5.4",
    [int]$VersionCode = 10504,
    [string]$PythonExecutable = "",
    [string]$AndroidSdk = "",
    [string]$OutputDirectory = "",
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$android = Join-Path $repo "apps\android"
$python = if ($PythonExecutable) {
    if ([IO.Path]::IsPathRooted($PythonExecutable)) { [IO.Path]::GetFullPath($PythonExecutable) } else { [IO.Path]::GetFullPath((Join-Path $repo $PythonExecutable)) }
} else {
    $launcher = Get-Command py -ErrorAction SilentlyContinue
    if (-not $launcher) { throw "android_build_python_3_12_missing" }
    $resolved = & $launcher.Source -3.12 -c "import sys; print(sys.executable)"
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($resolved)) { throw "android_build_python_3_12_missing" }
    $resolved.Trim()
}
$javaHome = "C:\Program Files\Android\Android Studio\jbr"
$androidSdkPath = if ($AndroidSdk) { [IO.Path]::GetFullPath($AndroidSdk) } elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }
if (-not (Test-Path -LiteralPath $python)) { throw "workspace_python_missing" }
$pythonVersion = & $python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
if ($LASTEXITCODE -ne 0 -or $pythonVersion.Trim() -ne "3.12") { throw "android_build_python_must_be_3_12" }
if (-not (Test-Path -LiteralPath (Join-Path $javaHome "bin\java.exe"))) { throw "android_jbr_missing" }
if (-not (Test-Path -LiteralPath $androidSdkPath)) { throw "android_sdk_missing" }
if ((git -C $repo status --porcelain).Count -ne 0) { throw "trusted_build_requires_clean_checkout" }
if ((git -C $repo rev-parse --verify HEAD) -notmatch '^[0-9a-f]{40,64}$') { throw "git_commit_invalid" }

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $androidSdkPath
$env:OPENDRSAI_ANDROID_BUILD_PYTHON = $python
Push-Location $android
try {
    if (-not $SkipTests) {
        & .\gradlew.bat testDebugUnitTest --rerun-tasks --no-daemon
        if ($LASTEXITCODE -ne 0) { throw "android_jvm_verification_failed" }
        & .\gradlew.bat lintAcceptance --no-daemon
        if ($LASTEXITCODE -ne 0) { throw "android_lint_verification_failed" }
    }
    & .\gradlew.bat assembleAcceptance packageAcceptanceAndroidTest `
        "-Popendrsai.android.testBuildType=acceptance" `
        "-Popendrsai.android.acceptanceVersion=$VersionName" --no-daemon
    if ($LASTEXITCODE -ne 0) { throw "acceptance_build_failed" }
} finally {
    Pop-Location
}

$apk = Join-Path $android "app\build\outputs\apk\acceptance\OpenDrSai-Android-v$VersionName.apk"
if (-not (Test-Path -LiteralPath $apk)) { throw "candidate_apk_missing:$apk" }
$testApk = Join-Path $android "app\build\outputs\apk\androidTest\acceptance\app-acceptance-androidTest.apk"
if (-not (Test-Path -LiteralPath $testApk)) { throw "candidate_test_apk_missing:$testApk" }
$metadataPath = Join-Path $android "app\build\outputs\apk\acceptance\output-metadata.json"
if (-not (Test-Path -LiteralPath $metadataPath)) { throw "candidate_metadata_missing" }
$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
$element = @($metadata.elements)[0]
if ($element.versionCode -ne $VersionCode -or $element.versionName -ne $VersionName) {
    throw "candidate_version_metadata_mismatch:$($element.versionCode):$($element.versionName)"
}
$evidence = if ($OutputDirectory) {
    if ([IO.Path]::IsPathRooted($OutputDirectory)) { [IO.Path]::GetFullPath($OutputDirectory) } else { [IO.Path]::GetFullPath((Join-Path $repo $OutputDirectory)) }
} else {
    Join-Path $repo "docs\android\testing\acceptance\python-runtime-production"
}
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
$pythonJunit = Join-Path $evidence "python-junit.xml"

if (-not $SkipTests) {
    & $python -m pytest `
        (Join-Path $repo "cores\python\packages\drsai\tests\test_mobile_agent_core.py") `
        (Join-Path $repo "cores\python\packages\drsai\tests\test_mobile_runtime_protocol.py") `
        (Join-Path $repo "cores\python\packages\drsai\tests\test_stage7_python_runtime_verifier.py") `
        --junitxml $pythonJunit -q
    if ($LASTEXITCODE -ne 0) { throw "python_runtime_verification_failed" }
}

& $python (Join-Path $PSScriptRoot "initialize-stage7-python-runtime-evidence.py") `
    --repo $repo --apk $apk --output $evidence --variant acceptance `
    --version-code $VersionCode --version-name $VersionName `
    --acceptance-run-id $AcceptanceRunId --build-id $BuildId
if ($LASTEXITCODE -ne 0) { throw "stage7_evidence_initialization_failed" }

& $python (Join-Path $PSScriptRoot "verify-stage7-android-security-boundaries.py") `
    --repo $repo --identity-from (Join-Path $evidence "release-manifest.json") `
    --output (Join-Path $evidence "android-security-boundaries.json")
if ($LASTEXITCODE -ne 0) { throw "android_security_boundary_verification_failed" }

& $python (Join-Path $PSScriptRoot "verify-stage7-trusted-build.py") `
    --repo $repo --identity-from (Join-Path $evidence "release-manifest.json") --apk $apk `
    --output (Join-Path $evidence "trusted-build-audit.json")
if ($LASTEXITCODE -ne 0) { throw "trusted_build_audit_failed" }

$androidJunit = Get-ChildItem -LiteralPath (Join-Path $android "app\build\test-results\testDebugUnitTest") -Filter "*.xml" `
    -ErrorAction SilentlyContinue | ForEach-Object { @("--android-junit", $_.FullName) }
$pythonJunitArgs = if (Test-Path -LiteralPath $pythonJunit) { @("--python-junit", $pythonJunit) } else { @() }
$junitIndexArgs = @()
if (-not $SkipTests) {
    $junitIndex = Join-Path $evidence "local-junit-index.json"
    $junitFiles = @(
        Get-ChildItem -LiteralPath (Join-Path $android "app\build\test-results\testDebugUnitTest") -Filter "*.xml" `
            -ErrorAction SilentlyContinue | ForEach-Object { @("--junit", $_.FullName) }
    ) + @("--junit", $pythonJunit)
    & $python (Join-Path $PSScriptRoot "index-stage7-junit.py") `
        --identity-from (Join-Path $evidence "release-manifest.json") --runner "trusted-local-build-v1" `
        @junitFiles --output $junitIndex
    if ($LASTEXITCODE -ne 0) { throw "local_junit_index_failed" }
    $junitIndexArgs = @("--junit-index", $junitIndex)
}
& $python (Join-Path $PSScriptRoot "generate-stage7-feature-evidence.py") `
    --repo $repo --evidence $evidence --identity-from (Join-Path $evidence "release-manifest.json") `
    @androidJunit @pythonJunitArgs @junitIndexArgs --output (Join-Path $evidence "feature-evidence.json")
if ($LASTEXITCODE -notin @(0, 2)) { throw "stage7_feature_evidence_failed" }

$sbom = Join-Path $repo "docs\android\testing\acceptance\python-runtime\cyclonedx-sbom.json"
& $python (Join-Path $PSScriptRoot "finalize-stage7-release-manifest.py") `
    --evidence $evidence --identity-from (Join-Path $evidence "feature-evidence.json") `
    --apk $apk --source-sbom $sbom --rollback-version $VersionName `
    --output (Join-Path $evidence "release-manifest.json")
if ($LASTEXITCODE -ne 0) { throw "stage7_manifest_finalization_failed" }

& $python (Join-Path $PSScriptRoot "verify-stage7-python-runtime.py") `
    --evidence $evidence --apk $apk --output (Join-Path $evidence "acceptance-verification.json")
$decision = Get-Content -LiteralPath (Join-Path $evidence "acceptance-verification.json") -Raw | ConvertFrom-Json
if ($decision.decision -ne "GO") {
    Write-Warning "Candidate built successfully but Stage 7 remains NO_GO until external evidence is populated."
}
Write-Output ([ordered]@{
    apk = $apk
    test_apk = $testApk
    evidence = $evidence
    decision = $decision.decision
    blockers = $decision.errors
    acceptance_finalizer = (Join-Path $PSScriptRoot "finalize-stage7-acceptance.py")
    acceptance_aggregator = (Join-Path $PSScriptRoot "aggregate-stage7-runtime-acceptance.py")
    device_test_runner = (Join-Path $PSScriptRoot "run-stage7-device-tests.py")
    device_performance_aggregator = (Join-Path $PSScriptRoot "aggregate-stage7-device-performance.py")
} | ConvertTo-Json -Depth 5)
