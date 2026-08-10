param(
    [Parameter(Mandatory)] [string] $CaseId,
    [string] $InputText = $env:OPENDRSAI_P3_INPUT,
    [string] $ResultPath = $env:OPENDRSAI_E2E_RESULT,
    [string] $ScreenshotPath = $env:OPENDRSAI_E2E_SCREENSHOT,
    [string] $DrsaiHome = "C:\P3\profile",
    [ValidateRange(1, 65535)] [int] $GatewayPort = 28643,
    [switch] $VerifyModelConnection,
    [switch] $DeveloperBypass
)

$ErrorActionPreference = "Stop"
if (-not $InputText -or -not $ResultPath -or -not $ScreenshotPath) { throw "P3 packaged launcher requires input, result and screenshot paths." }
if (-not $env:OPENDRSAI_E2E_RUNTIME_EVIDENCE) { throw "P3 packaged launcher requires OPENDRSAI_E2E_RUNTIME_EVIDENCE." }
$app = Join-Path (Join-Path $env:ProgramFiles "OpenDrSai") "app\OpenDrSai.exe"
if (-not (Test-Path -LiteralPath $app -PathType Leaf)) { throw "desktop_ui_packaged_executable_missing: $app" }
$resolvedResult = [IO.Path]::GetFullPath($ResultPath)
$resolvedScreenshot = [IO.Path]::GetFullPath($ScreenshotPath)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedResult), (Split-Path -Parent $resolvedScreenshot) | Out-Null
Remove-Item -LiteralPath $resolvedResult, $resolvedScreenshot -Force -ErrorAction SilentlyContinue

$env:DRSAI_HOME = $DrsaiHome
$env:OPENDRSAI_GATEWAY_PORT = [string]$GatewayPort
$safeCaseId = $CaseId -replace "[^A-Za-z0-9._-]", "_"
$env:OPENDRSAI_ELECTRON_USER_DATA = Join-Path $DrsaiHome ("p3-e2e-user-data-" + $safeCaseId)
$env:OPENDRSAI_E2E_P3_DESKTOP = "1"
$env:OPENDRSAI_P3_CASE_ID = $CaseId
$env:OPENDRSAI_P3_INPUT = $InputText
$env:OPENDRSAI_E2E_RESULT = $resolvedResult
$env:OPENDRSAI_E2E_SCREENSHOT = $resolvedScreenshot
$env:OPENDRSAI_E2E_TIMEOUT_MS = "180000"
if ($VerifyModelConnection) { $env:OPENDRSAI_E2E_P3_VERIFY_MODEL = "1" }
if ($DeveloperBypass) {
    # The Electron runner clicks the visible developer-workspace button. It
    # never synthesizes an OIDC session or bypasses the Desktop UI.
    $env:OPENDRSAI_E2E_AGENT_RUN = "1"
    $env:OPENDRSAI_DEV_AUTH_BYPASS = "1"
    $env:OPENDRSAI_E2E_P3_DEVELOPER_LOGIN = "1"
}

& $app
if ($LASTEXITCODE -ne 0) { throw "P3 packaged Desktop exited with code $LASTEXITCODE for $CaseId." }
if (-not (Test-Path -LiteralPath $resolvedResult)) { throw "desktop_ui_electron_e2e_result_missing" }
if (-not (Test-Path -LiteralPath $resolvedScreenshot)) { throw "desktop_ui_screenshot_missing" }
