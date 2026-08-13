param(
    [Parameter(Mandatory=$true)][string]$EvidenceDir,
    [Parameter(Mandatory=$true)][string]$RunId
)

$ErrorActionPreference = "Stop"
$drsaiHome = Join-Path $env:USERPROFILE ".drsai"
$authPath = Join-Path $drsaiHome "auth\auth.json"
$telemetryPath = Join-Path $drsaiHome "logs\agent-telemetry.jsonl"
$markerPath = Join-Path $EvidenceDir "pre-logout-validation.json"

function Read-Json([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

$auth = Read-Json $authPath
$encryptedSession = $auth -and $auth.authenticated -and $auth.authMode -eq "oidc" -and
    $auth.encryptedAccessToken -and -not $auth.accessToken -and -not $auth.refreshToken -and -not $auth.idToken

$mainProcess = Get-Process OpenDrSai -ErrorAction SilentlyContinue |
    Sort-Object StartTime -Descending | Select-Object -First 1
$authCreated = $null
try { if ($auth.createdAt) { $authCreated = [DateTimeOffset]::Parse([string]$auth.createdAt) } } catch { }
$processStarted = $null
try { if ($mainProcess) { $processStarted = [DateTimeOffset]$mainProcess.StartTime } } catch { }

$completed = @()
if (Test-Path -LiteralPath $telemetryPath -PathType Leaf) {
    Get-Content -LiteralPath $telemetryPath -Tail 500 | ForEach-Object {
        try {
            $row = $_ | ConvertFrom-Json
            if ($row.event -eq "execution_completed" -and $row.agentId -eq "opendrsai" -and $row.requestId -and $row.runId) {
                $completed += $row
            }
        } catch { }
    }
}
$correlatedPreRestart = @($completed | Where-Object {
    try {
        $_.acceptanceRunId -eq $RunId -and
        [DateTimeOffset]::Parse([string]$_.timestamp) -lt $processStarted
    } catch { $false }
}).Count -gt 0
$postRestartCompleted = @($completed | Where-Object {
    try {
        $_.acceptanceRunId -eq $RunId -and
        [DateTimeOffset]::Parse([string]$_.timestamp) -gt $processStarted
    } catch { $false }
}).Count -gt 0
$restartPersisted = $encryptedSession -and $correlatedPreRestart -and $postRestartCompleted
$twoChatsCompleted = $correlatedPreRestart -and $postRestartCompleted

$gatewayHeaders = @{}
$gatewayTokenPath = Join-Path $drsaiHome "runtime\instance-token"
if (Test-Path -LiteralPath $gatewayTokenPath -PathType Leaf) {
    $gatewayHeaders["X-OpenDrSai-Gateway-Token"] = (Get-Content -LiteralPath $gatewayTokenPath -Raw).Trim()
}
function Invoke-Local([string]$Method, [string]$Path) {
    $uri = "http://127.0.0.1:18642$Path"
    try {
        return Invoke-RestMethod -Method $Method -Uri $uri -Headers $gatewayHeaders -TimeoutSec 30
    } catch {
        $statusCode = $null
        try { $statusCode = [int]$_.Exception.Response.StatusCode } catch { }
        $statusText = $(if ($statusCode) { " HTTP $statusCode" } else { "" })
        throw "Local Gateway request failed:$statusText $Method $Path. $($_.Exception.Message)"
    }
}

$health = Invoke-Local "GET" "/health"
$agents = Invoke-Local "GET" "/v1/config/agents"
$modelState = Invoke-Local "GET" "/v1/config/model-state"
$perceptors = Invoke-Local "GET" "/v1/config/perceptors"
$tavily = @($perceptors.data | Where-Object { $_.adapter -eq "tavily" -and $_.enabled -ne $false }) | Select-Object -First 1
$tavilyTest = $null
if ($tavily) {
    # The public perceptor contract uses `perceptor_id`. Using the UI-only `id`
    # alias produces an empty path segment and calls /v1/config/perceptors//test.
    $escapedId = [Uri]::EscapeDataString([string]$tavily.perceptor_id)
    if (-not $escapedId) { throw "The Tavily perceptor response did not contain perceptor_id." }
    $tavilyTest = Invoke-Local "POST" "/v1/config/perceptors/$escapedId/test?capability=search"
}
$tavilyAvailable = $tavily -and $tavilyTest.ok -and $tavilyTest.status -eq "available" -and [int]$tavilyTest.result_count -gt 0

$checks = [ordered]@{
    encryptedOidcSession = [bool]$encryptedSession
    restartPersistence = [bool]$restartPersisted
    twoAcceptanceChats = [bool]$twoChatsCompleted
    postRestartChat = [bool]$postRestartCompleted
    gatewayReady = [bool]($health.status -eq "ok")
    defaultAgentResolved = [bool]($agents.current_agent -eq "opendrsai" -and @($agents.agents).Count -gt 0)
    hepaiModelResolved = [bool]($modelState.effective.model_provider -eq "hepai" -and -not $modelState.effective.provider.requires_api_key)
    tavilySearchAvailable = [bool]$tavilyAvailable
}
$failed = @($checks.GetEnumerator() | Where-Object { -not $_.Value } | ForEach-Object Key)
$result = [ordered]@{
    schemaVersion = 1
    runId = $RunId
    generatedAt = [DateTime]::UtcNow.ToString("o")
    passed = ($failed.Count -eq 0)
    checks = $checks
    failedChecks = $failed
    completedChatCount = $completed.Count
    tavilyResultCount = $(if ($tavilyTest) { [int]$tavilyTest.result_count } else { 0 })
    authCreatedAt = $(if ($authCreated) { $authCreated.ToUniversalTime().ToString("o") } else { "" })
    currentProcessStartedAt = $(if ($processStarted) { $processStarted.ToUniversalTime().ToString("o") } else { "" })
}
[IO.Directory]::CreateDirectory($EvidenceDir) | Out-Null
[IO.File]::WriteAllText($markerPath, (($result | ConvertTo-Json -Depth 8) + "`n"), [Text.UTF8Encoding]::new($false))
if (-not $result.passed) {
    throw "Pre-logout validation failed: $($failed -join ', '). Keep OpenDrSai signed in, fix the failed checks, and run this shortcut again."
}
Write-Host "Pre-logout validation passed. Log out in OpenDrSai, then run the PASS shortcut."
