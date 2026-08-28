param(
    [Parameter(Mandatory)] [string] $CaseId,
    [string] $InputText = $env:OPENDRSAI_P3_INPUT,
    [string] $ResultPath = $env:OPENDRSAI_E2E_RESULT,
    [string] $ScreenshotPath = $env:OPENDRSAI_E2E_SCREENSHOT,
    [string] $DrsaiHome,
    [ValidateRange(1, 65535)] [int] $GatewayPort = 28642,
    [switch] $VerifyModelConnection,
    [switch] $SkipNpmInstall,
    [Parameter(ValueFromRemainingArguments = $true)] [string[]] $IgnoredHostArguments
)

$ErrorActionPreference = "Stop"
$CaseId = if ($CaseId) { $CaseId } else { $env:OPENDRSAI_P3_CASE_ID }
if (-not $InputText -or -not $ResultPath -or -not $ScreenshotPath) { throw "P3 Desktop launcher requires input, result and screenshot paths." }
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$devScript = Join-Path $scriptDir "dev.ps1"
if (-not (Test-Path -LiteralPath $devScript)) { throw "P3 Desktop launcher cannot find dev.ps1." }

$resolvedResult = [IO.Path]::GetFullPath($ResultPath)
$resolvedScreenshot = [IO.Path]::GetFullPath($ScreenshotPath)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedResult) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedScreenshot) | Out-Null
Remove-Item -LiteralPath $resolvedResult -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $resolvedScreenshot -Force -ErrorAction SilentlyContinue

# This flag selects the renderer-driven P3 smoke: it fills the visible composer,
# clicks its send button, waits for visible turn projection, and captures Electron.
$env:OPENDRSAI_E2E_P3_DESKTOP = "1"
$env:OPENDRSAI_P3_CASE_ID = $CaseId
$env:OPENDRSAI_P3_INPUT = $InputText
$env:OPENDRSAI_E2E_RESULT = $resolvedResult
$env:OPENDRSAI_E2E_SCREENSHOT = $resolvedScreenshot
$env:OPENDRSAI_E2E_TIMEOUT_MS = "90000"
if ($VerifyModelConnection) { $env:OPENDRSAI_E2E_P3_VERIFY_MODEL = "1" }

$devLaunchArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $devScript, "-HotLoad", "-GatewayPort", $GatewayPort)
if ($DrsaiHome) { $devLaunchArgs += @("-DrsaiHome", $DrsaiHome) }
if ($SkipNpmInstall) { $devLaunchArgs += "-SkipNpmInstall" }
& powershell.exe @devLaunchArgs
if ($LASTEXITCODE -ne 0) { throw "P3 Desktop app exited with code $LASTEXITCODE for $CaseId." }
if (-not (Test-Path -LiteralPath $resolvedResult)) { throw "desktop_ui_electron_e2e_result_missing" }
if (-not (Test-Path -LiteralPath $resolvedScreenshot)) { throw "desktop_ui_screenshot_missing" }
