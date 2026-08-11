param(
    [Parameter(Mandatory = $true)][string]$Serial,
    [string]$EvidenceDirectory = ""
)
$ErrorActionPreference = "Stop"

$androidRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $androidRoot)
$adb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
$mainApk = Join-Path $androidRoot "app\build\outputs\apk\debug\OpenDrSai-Android-v1.5.6.apk"
$testApk = Join-Path $androidRoot "app\build\outputs\apk\androidTest\debug\app-debug-androidTest.apk"
$runner = "ai.drsai.remote.debug.test/androidx.test.runner.AndroidJUnitRunner"
$target = "ai.drsai.remote.debug"
$canary = "sk-model-provider-leak-canary-20260804"
if ([string]::IsNullOrWhiteSpace($EvidenceDirectory)) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $EvidenceDirectory = Join-Path $repoRoot "docs\android\reports\evidence\samsung-model-provider-$stamp"
}

if (-not (Test-Path -LiteralPath $adb)) { throw "adb not found: $adb" }
if (-not (Test-Path -LiteralPath $mainApk)) { throw "main APK not found; build assembleDebug first" }
if (-not (Test-Path -LiteralPath $testApk)) { throw "test APK not found; build assembleDebugAndroidTest first" }
$deviceState = (& $adb -s $Serial get-state 2>&1 | Out-String).Trim()
if ($deviceState -ne "device") { throw "device $Serial is not online (state=$deviceState)" }
$manufacturer = (& $adb -s $Serial shell getprop ro.product.manufacturer | Out-String).Trim()
if ($manufacturer -notmatch "(?i)samsung") { throw "final acceptance requires Samsung hardware; found '$manufacturer'" }

New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null

function Invoke-Instrumentation([string]$Name, [string]$ClassSelector) {
    $output = & $adb -s $Serial shell am instrument -w -r -e class $ClassSelector $runner 2>&1
    $text = $output | Out-String
    $text | Set-Content -Encoding utf8 (Join-Path $EvidenceDirectory "$Name.txt")
    Write-Host $text
    if ($text -notmatch "OK \([0-9]+ tests?\)") { throw "instrumentation failed: $Name" }
    Start-Sleep -Seconds 5
}

& $adb -s $Serial install --no-streaming -r $mainApk
if ($LASTEXITCODE -ne 0) { throw "main APK install failed" }
& $adb -s $Serial install --no-streaming -r $testApk
if ($LASTEXITCODE -ne 0) { throw "test APK install failed" }
Start-Sleep -Seconds 5
$mainPath = (& $adb -s $Serial shell pm path $target | Out-String).Trim()
$testPath = (& $adb -s $Serial shell pm path "$target.test" | Out-String).Trim()
if ($mainPath -notmatch '^package:' -or $testPath -notmatch '^package:') {
    throw "installed packages did not stabilize: main='$mainPath' test='$testPath'"
}
& $adb -s $Serial logcat -c

# Samsung firmware can reclaim one very long-lived Compose instrumentation process.
# Class-level isolation with a short cooldown is stable; method-level process churn is not.
Invoke-Instrumentation "model-editor" "ai.drsai.remote.ui.ModelProviderEditorUiTest"
Invoke-Instrumentation "provider-list" "ai.drsai.remote.ui.ModelSettingsScreenUiTest"
Invoke-Instrumentation "settings-responsive" "ai.drsai.remote.ui.SettingsResponsiveUiTest"
Invoke-Instrumentation "persistence-security" "ai.drsai.remote.ModelProviderPersistenceTest"
Invoke-Instrumentation "room-migration" "ai.drsai.remote.ModelProviderMigrationTest"
Invoke-Instrumentation "settings-entry" "ai.drsai.remote.ui.MainInterfaceTest#permanentWorkbenchDrawerRendersItsPrimaryNavigation"
Invoke-Instrumentation "restart-seed" "ai.drsai.remote.ModelProviderRestartPersistenceTest#phase1SeedPersistentConfiguration"
& $adb -s $Serial shell am force-stop $target
Invoke-Instrumentation "restart-verify" "ai.drsai.remote.ModelProviderRestartPersistenceTest#phase2VerifyAfterForcedProcessRestartAndCleanup"

$logcat = & $adb -s $Serial logcat -d 2>&1 | Out-String
$logcatHits = ([regex]::Matches($logcat, [regex]::Escape($canary))).Count
$privateOutput = & $adb -s $Serial shell run-as $target grep -R -l $canary . 2>&1 | Out-String
$privateHits = if ([string]::IsNullOrWhiteSpace($privateOutput)) { 0 } else { ($privateOutput.Trim() -split "`n").Count }
if ($logcatHits -ne 0 -or $privateHits -ne 0) { throw "secret leak scan failed: logcat=$logcatHits private=$privateHits" }

$summary = [ordered]@{
    timestamp = (Get-Date).ToString("o")
    serial = $Serial
    manufacturer = $manufacturer
    model = (& $adb -s $Serial shell getprop ro.product.model | Out-String).Trim()
    sdk = (& $adb -s $Serial shell getprop ro.build.version.sdk | Out-String).Trim()
    core_configuration = "passed (Compose test-class isolated processes with cooldown)"
    settings_entry = "passed"
    forced_restart = "passed"
    logcat_canary_hits = $logcatHits
    private_storage_canary_hits = $privateHits
    manual_screenshot_review = "pending"
    manual_portrait_landscape_review = "pending"
}
$summary | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $EvidenceDirectory "summary.json")
Write-Host "Automated Samsung acceptance passed. Evidence: $EvidenceDirectory"
Write-Host "Remaining manual steps: settings screenshots with key hidden; phone/tablet portrait-landscape visual review."
