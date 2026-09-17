param([switch]$SkipEmulators)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
$desktop = Join-Path $repo "apps\desktop"
$android = Join-Path $repo "apps\android"
$python = Join-Path $repo "venv\Scripts\python.exe"
$gradle = Join-Path $android "gradlew.bat"
$sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
$adb = Join-Path $sdk "platform-tools\adb.exe"
$emulator = Join-Path $sdk "emulator\emulator.exe"
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr" }

function Invoke-GateStep([string]$Name, [scriptblock]$Action) {
    Write-Host "[pairing-gate] $Name"
    & $Action
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
}

Push-Location $repo
try {
    Invoke-GateStep "Relay and Full Runtime tests" {
        & $python -m pytest `
          cores/python/packages/drsai/tests/test_relay_registry.py `
          cores/python/packages/drsai/tests/test_relay_api.py `
          cores/python/packages/drsai/tests/test_relay_runtime_api.py `
          cores/python/packages/drsai/tests/test_mobile_pairing.py `
          cores/python/packages/drsai/tests/test_android_windows_runtime_e2e.py -q
    }
    Invoke-GateStep "Relay generated contract drift" { & $python scripts/generate_relay_contract.py --check }

    Push-Location $desktop
    try {
        Invoke-GateStep "Desktop typecheck" { & npm run typecheck --workspace opendrsai-windows-desktop }
        Invoke-GateStep "Desktop pairing controller" { & npm run verify:mobile-pairing-controller --workspace opendrsai-windows-desktop }
        Invoke-GateStep "Desktop QR and UI contract" { & npm run verify:mobile-pairing-ui --workspace opendrsai-windows-desktop }
        Invoke-GateStep "Desktop pairing security" { & npm run verify:mobile-pairing-security --workspace opendrsai-windows-desktop }
        Invoke-GateStep "Production dependency audit" { & npm audit --omit=dev }
        Invoke-GateStep "Desktop production build" { & npm run build --workspace opendrsai-windows-desktop }
        Invoke-GateStep "Electron pairing visual interaction" { & npm run verify:mobile-pairing-visual --workspace opendrsai-windows-desktop }
    } finally { Pop-Location }

    Push-Location $android
    try {
        Invoke-GateStep "Android JVM tests" { & $gradle testDebugUnitTest }
        Invoke-GateStep "Android instrumentation APK build" { & $gradle assembleDebugAndroidTest }
    } finally { Pop-Location }

    if (-not $SkipEmulators) {
        foreach ($target in @(
            @{ Api = 30; Avd = "OpenDrSai_API_30"; Port = 5560 },
            @{ Api = 35; Avd = "OpenDrSai_API_35"; Port = 5562 }
        )) {
            $serial = $null
            $launched = $false
            $deviceLines = & $adb devices | Where-Object { $_ -match '^emulator-\d+\s+device' }
            foreach ($line in $deviceLines) {
                $candidate = ($line -split '\s+')[0]
                # A previously launched emulator can remain in `adb devices` briefly
                # after `emu kill`. Treat a missing SDK value as a disappearing device
                # instead of failing the whole gate before the next AVD starts.
                $candidateSdk = ""
                try {
                    $sdkOutput = & $adb -s $candidate shell getprop ro.build.version.sdk 2>$null
                    if ($null -ne $sdkOutput) { $candidateSdk = ([string]$sdkOutput).Trim() }
                } catch {
                    $candidateSdk = ""
                }
                if ($candidateSdk -eq [string]$target.Api) {
                    $serial = $candidate
                    break
                }
            }
            if (-not $serial) {
                $serial = "emulator-$($target.Port)"
                Start-Process -FilePath $emulator -ArgumentList @(
                    '-avd', $target.Avd, '-port', [string]$target.Port, '-no-window', '-no-audio',
                    '-no-snapshot-save', '-no-boot-anim', '-gpu', 'swiftshader_indirect'
                ) -WindowStyle Hidden | Out-Null
                $launched = $true
                $ready = $false
                for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
                    Start-Sleep -Seconds 2
                    $boot = ""
                    try { $boot = (& $adb -s $serial shell getprop sys.boot_completed 2>$null) } catch { $boot = "" }
                    if ($boot.Trim() -eq "1") { $ready = $true; break }
                }
                if (-not $ready) {
                    & $adb -s $serial emu kill 2>$null | Out-Null
                    throw "API $($target.Api) emulator did not boot"
                }
            }
            try {
                $appApk = Get-ChildItem (Join-Path $android "app\build\outputs\apk\debug") -Filter "*.apk" | Select-Object -First 1
                if (-not $appApk) { throw "Debug app APK was not produced" }
                Invoke-GateStep "API $($target.Api) install app" { & $adb -s $serial install -r -t $appApk.FullName }
                $testApk = Get-ChildItem (Join-Path $android "app\build\outputs\apk\androidTest\debug") -Filter "*.apk" | Select-Object -First 1
                Invoke-GateStep "API $($target.Api) install tests" { & $adb -s $serial install -r -t $testApk.FullName }
                Write-Host "[pairing-gate] API $($target.Api) instrumentation"
                $instrumentation = (& $adb -s $serial shell am instrument -w -r ai.drsai.remote.debug.test/androidx.test.runner.AndroidJUnitRunner) -join "`n"
                Write-Host $instrumentation
                if ($instrumentation -notmatch 'OK \(68 tests\)' -or $instrumentation -match 'FAILURES|INSTRUMENTATION_FAILED') {
                    throw "API $($target.Api) instrumentation did not pass 68 tests"
                }
            } finally {
                if ($launched) { & $adb -s $serial emu kill | Out-Null }
            }
        }
    }

    Invoke-GateStep "54-feature evidence" { & node (Join-Path $PSScriptRoot "generate-mobile-pairing-evidence.mjs") }
    Write-Host "[pairing-gate] PASSED: 9 modules, 54/54 features"
} finally {
    Pop-Location
}
