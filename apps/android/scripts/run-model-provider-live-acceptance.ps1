$ErrorActionPreference = "Stop"

$required = @(
    "DRSAI_LIVE_OPENAI_API_KEY",
    "DRSAI_LIVE_OPENAI_MODEL",
    "DRSAI_LIVE_ANTHROPIC_API_KEY",
    "DRSAI_LIVE_ANTHROPIC_MODEL"
)
$missing = $required | Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) }
if ($missing.Count -gt 0) {
    throw "Missing live acceptance variables: $($missing -join ', ')"
}

$env:DRSAI_RUN_LIVE_MODEL_ACCEPTANCE = "true"
if ([string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
    $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
}

& "$PSScriptRoot\..\gradlew.bat" `
    --no-daemon `
    --console=plain `
    testDebugUnitTest `
    --tests ai.drsai.remote.LiveModelProviderAcceptanceTest `
    -x verifyAndroidRelayBindings
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
