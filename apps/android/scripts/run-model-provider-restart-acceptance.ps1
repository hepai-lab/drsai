param([string]$Serial = "emulator-5560")
$ErrorActionPreference = "Stop"

$adb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path -LiteralPath $adb)) { throw "adb not found: $adb" }
$runner = "ai.drsai.remote.debug.test/androidx.test.runner.AndroidJUnitRunner"
$target = "ai.drsai.remote.debug"
$class = "ai.drsai.remote.ModelProviderRestartPersistenceTest"

& $adb -s $Serial shell am instrument -w -r -e class "$class#phase1SeedPersistentConfiguration" $runner
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $adb -s $Serial shell am force-stop $target
& $adb -s $Serial shell am instrument -w -r -e class "$class#phase2VerifyAfterForcedProcessRestartAndCleanup" $runner
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
