param(
    [Parameter(Mandatory=$true)][string]$EvidenceDir,
    [Parameter(Mandatory=$true)][string]$RunId,
    [Parameter(Mandatory=$true)][int]$InitialProcessId,
    [ValidateRange(300,7200)][int]$TimeoutSeconds = 2400
)

$ErrorActionPreference = "Stop"
$packageDir = "C:\OpenDrSaiPackage"
$drsaiHome = Join-Path $env:USERPROFILE ".drsai"
$authPath = Join-Path $drsaiHome "auth\auth.json"
$telemetryPath = Join-Path $drsaiHome "logs\agent-telemetry.jsonl"
$markerPath = Join-Path $EvidenceDir "pre-logout-validation.json"
$startedAt = [DateTimeOffset]::Now
$initialProcess = Get-Process -Id $InitialProcessId -ErrorAction SilentlyContinue
$initialProcessStartedAt = $(if ($initialProcess) { [DateTimeOffset]$initialProcess.StartTime } else { $startedAt })
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)

function Read-Json([string]$Path) {
    try { if (Test-Path -LiteralPath $Path -PathType Leaf) { return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json } } catch { }
    return $null
}

function Get-CompletedChats {
    $rows = @()
    if (Test-Path -LiteralPath $telemetryPath -PathType Leaf) {
        Get-Content -LiteralPath $telemetryPath -Tail 500 | ForEach-Object {
            try {
                $row = $_ | ConvertFrom-Json
                $timestamp = [DateTimeOffset]::Parse([string]$row.timestamp)
                if ($row.event -eq "execution_completed" -and $row.agentId -eq "opendrsai" -and $row.requestId -and $row.runId -and $timestamp -ge $startedAt) { $rows += $row }
            } catch { }
        }
    }
    return @($rows)
}

function Invoke-Local([string]$Method, [string]$Path) {
    $headers = @{}
    $tokenPath = Join-Path $drsaiHome "runtime\instance-token"
    if (Test-Path -LiteralPath $tokenPath -PathType Leaf) { $headers["X-OpenDrSai-Gateway-Token"] = (Get-Content -LiteralPath $tokenPath -Raw).Trim() }
    return Invoke-RestMethod -Method $Method -Uri "http://127.0.0.1:18642$Path" -Headers $headers -TimeoutSec 30
}

function Test-Tavily {
    try {
        $perceptors = Invoke-Local "GET" "/v1/config/perceptors"
        $tavily = @($perceptors.data | Where-Object { $_.adapter -eq "tavily" -and $_.enabled -ne $false }) | Select-Object -First 1
        if (-not $tavily -or -not $tavily.perceptor_id) { return $null }
        $id = [Uri]::EscapeDataString([string]$tavily.perceptor_id)
        return Invoke-Local "POST" "/v1/config/perceptors/$id/test?capability=search"
    } catch { return $null }
}

$preLogoutWritten = $false
while ((Get-Date) -lt $deadline) {
    $auth = Read-Json $authPath
    $encryptedSession = $auth -and $auth.authenticated -and $auth.authMode -eq "oidc" -and $auth.encryptedAccessToken -and -not $auth.accessToken -and -not $auth.refreshToken -and -not $auth.idToken
    $chats = @(Get-CompletedChats)
    $initialExited = -not (Get-Process -Id $InitialProcessId -ErrorAction SilentlyContinue)
    $reopenedProcess = $(if ($initialExited) { Get-Process OpenDrSai -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $InitialProcessId } | Sort-Object StartTime -Descending | Select-Object -First 1 } else { $null })
    $reopened = [bool]$reopenedProcess
    $reopenedAt = $(if ($reopenedProcess) { [DateTimeOffset]$reopenedProcess.StartTime } else { $null })
    $preRestartChats = @($chats | Where-Object { try { [DateTimeOffset]::Parse([string]$_.timestamp) -ge $initialProcessStartedAt -and [DateTimeOffset]::Parse([string]$_.timestamp) -lt $reopenedAt } catch { $false } })
    $postRestartChats = @($chats | Where-Object { try { [DateTimeOffset]::Parse([string]$_.timestamp) -gt $reopenedAt } catch { $false } })

    if (-not $preLogoutWritten -and $encryptedSession -and $preRestartChats.Count -ge 1 -and $postRestartChats.Count -ge 1 -and $reopened) {
        $health = $null; $agents = $null; $modelState = $null
        try { $health = Invoke-Local "GET" "/health"; $agents = Invoke-Local "GET" "/v1/config/agents"; $modelState = Invoke-Local "GET" "/v1/config/model-state" } catch { }
        $tavilyTest = Test-Tavily
        $checks = [ordered]@{
            encryptedOidcSession = [bool]$encryptedSession
            restartPersistence = [bool]$reopened
            twoAcceptanceChats = ($preRestartChats.Count -ge 1 -and $postRestartChats.Count -ge 1)
            postRestartChat = ($postRestartChats.Count -ge 1)
            gatewayReady = [bool]($health.status -eq "ok")
            defaultAgentResolved = [bool]($agents.current_agent -eq "opendrsai" -and @($agents.agents).Count -gt 0)
            hepaiModelResolved = [bool]($modelState.effective.model_provider -eq "hepai" -and -not $modelState.effective.provider.requires_api_key)
            tavilySearchAvailable = [bool]($tavilyTest.ok -and $tavilyTest.status -eq "available" -and [int]$tavilyTest.result_count -gt 0)
        }
        $failed = @($checks.GetEnumerator() | Where-Object { -not $_.Value } | ForEach-Object Key)
        if ($failed.Count -eq 0) {
            $result = [ordered]@{ schemaVersion=1; runId=$RunId; generatedAt=[DateTime]::UtcNow.ToString("o"); passed=$true; provenance="background-observer"; checks=$checks; failedChecks=@(); completedChatCount=$chats.Count; tavilyResultCount=[int]$tavilyTest.result_count }
            [IO.File]::WriteAllText($markerPath, (($result | ConvertTo-Json -Depth 8) + "`n"), [Text.UTF8Encoding]::new($false))
            $preLogoutWritten = $true
        }
    }

    if ($preLogoutWritten) {
        $auth = Read-Json $authPath
        $tokenPresent = $auth -and ($auth.accessToken -or $auth.encryptedAccessToken)
        if (-not $auth -or (-not $auth.authenticated -and -not $tokenPresent)) {
            & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $packageDir "complete-windows-sandbox-acceptance.ps1") -EvidenceDir $EvidenceDir -RunId $RunId -ManualOutcome PASS -ManualNote "Application interactions confirmed; background observer captured chat, restart, Tavily and logout evidence." -NonInteractive
            exit $LASTEXITCODE
        }
    }
    Start-Sleep -Seconds 3
}

$collector = Join-Path $packageDir "collect-windows-sandbox-diagnostics.ps1"
if (Test-Path $collector) { & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $collector -EvidenceDir $EvidenceDir -RunId $RunId -Phase "automatic-timeout" }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $packageDir "complete-windows-sandbox-acceptance.ps1") -EvidenceDir $EvidenceDir -RunId $RunId -ManualOutcome FAIL -ManualNote "Background acceptance observer timed out." -NonInteractive
exit 1
