[CmdletBinding()]
param(
    [ValidateRange(3600, 3600)]
    [int]$RequiredDurationSeconds = 3600
)

$ErrorActionPreference = "Stop"
$AppRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$EvidenceDir = Join-Path $AppRoot "release\product-evidence\remote-workspace"
$SourceStatePath = Join-Path $EvidenceDir "remote-stability-24h.state.json"
$SourceEvidencePath = Join-Path $EvidenceDir "remote-stability-24h.json"
$TargetStatePath = Join-Path $EvidenceDir "remote-stability-1h.state.json"
$TargetEvidencePath = Join-Path $EvidenceDir "remote-stability-1h.json"
$TargetWatchdogPath = [IO.Path]::ChangeExtension($TargetStatePath, "watchdog.json")

if (-not (Test-Path -LiteralPath $SourceStatePath) -or -not (Test-Path -LiteralPath $SourceEvidencePath)) {
    throw "The superseded 24-hour state and evidence are required for controlled finalization."
}
$state = Get-Content -LiteralPath $SourceStatePath -Raw | ConvertFrom-Json
$source = Get-Content -LiteralPath $SourceEvidencePath -Raw | ConvertFrom-Json
$samples = @($source.samples | Sort-Object { [int]$_.elapsedSeconds })
if ($source.completed -eq $true -or [int]$source.durationSeconds -lt 86400) { throw "Source is not the active superseded 24-hour window." }
if ($samples.Count -lt 2 -or [int]$samples[-1].elapsedSeconds -lt $RequiredDurationSeconds) { throw "Source samples do not cover one hour." }
$runtimeIds = @($samples | ForEach-Object { $_.runtimeId } | Select-Object -Unique)
$instanceIds = @($samples | ForEach-Object { $_.instanceId } | Select-Object -Unique)
if ($runtimeIds.Count -ne 1 -or $instanceIds.Count -ne 1) { throw "Runtime identity drifted in the observed window." }
foreach ($sample in $samples) {
    if ([int]$sample.tunnelCount -ne 1 -or [int]$sample.runtimeProcessCount -ne 1 -or [int]$sample.ptyProcessCount -ne 0) {
        throw "Observed sample $($sample.elapsedSeconds) has invalid process counts."
    }
}

$runnerPid = [int]$state.pid
$watchdogPid = [int]$state.watchdogPid
$runnerActive = [bool](Get-Process -Id $runnerPid -ErrorAction SilentlyContinue)
$watchdogActive = [bool](Get-Process -Id $watchdogPid -ErrorAction SilentlyContinue)
if ($runnerActive -and $watchdogActive) {
    Stop-Process -Id $runnerPid -Force
} elseif ($runnerActive -or $watchdogActive) {
    throw "Runner/Watchdog lifecycle is inconsistent; refusing an ambiguous finalization."
} elseif (-not (Test-Path -LiteralPath $state.watchdogEvidence)) {
    throw "Runner and Watchdog already stopped without cleanup evidence; rerun the bound watchdog before resuming finalization."
}

$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline) {
    $runnerAlive = [bool](Get-Process -Id $runnerPid -ErrorAction SilentlyContinue)
    $watchdogAlive = [bool](Get-Process -Id $watchdogPid -ErrorAction SilentlyContinue)
    if (-not $runnerAlive -and -not $watchdogAlive -and (Test-Path -LiteralPath $state.watchdogEvidence)) { break }
    Start-Sleep -Milliseconds 500
}
if (Get-Process -Id $runnerPid -ErrorAction SilentlyContinue) { throw "Runner did not stop." }
if (Get-Process -Id $watchdogPid -ErrorAction SilentlyContinue) { throw "Watchdog did not finish cleanup." }
if (-not (Test-Path -LiteralPath $state.watchdogEvidence)) { throw "Watchdog did not write cleanup evidence." }
$watchdog = Get-Content -LiteralPath $state.watchdogEvidence -Raw | ConvertFrom-Json
if ($watchdog.cleanupVerified -ne $true -or [int]$watchdog.remainingTunnels -ne 0 -or $watchdog.remainingBoundContainer -ne $false -or @($watchdog.failures).Count -ne 0) {
    throw "Watchdog cleanup evidence did not pass."
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$archive = Join-Path $EvidenceDir "policy-change-24h-to-1h-$stamp"
New-Item -ItemType Directory -Force -Path $archive | Out-Null
$sourceArtifacts = @($SourceStatePath, $SourceEvidencePath, [string]$state.stdout, [string]$state.stderr, [string]$state.watchdogEvidence, [string]$state.watchdogStdout, [string]$state.watchdogStderr)
foreach ($path in $sourceArtifacts | Where-Object { $_ -and (Test-Path -LiteralPath $_) }) {
    Copy-Item -LiteralPath $path -Destination (Join-Path $archive (Split-Path $path -Leaf)) -Force
}
$archivedSourceEvidence = Join-Path $archive (Split-Path $SourceEvidencePath -Leaf)
$sourceHash = (Get-FileHash -LiteralPath $archivedSourceEvidence -Algorithm SHA256).Hash.ToLowerInvariant()
Copy-Item -LiteralPath $state.watchdogEvidence -Destination $TargetWatchdogPath -Force

$finalization = [ordered]@{
    kind = "requirement-reduced-after-observed-window"
    finalizedAt = (Get-Date).ToUniversalTime().ToString("o")
    previousRequirementSeconds = 86400
    newRequirementSeconds = $RequiredDurationSeconds
    observedWindowSeconds = [int]$samples[-1].elapsedSeconds
    sourceEvidence = $archivedSourceEvidence
    sourceSha256 = $sourceHash
}
$targetEvidence = [ordered]@{
    schemaVersion = 1
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    temporaryCredential = $true
    mode = "1h"
    durationSeconds = $RequiredDurationSeconds
    intervalSeconds = [int]$source.intervalSeconds
    completed = $true
    samples = $samples
    finalTunnelCount = 0
    finalization = $finalization
}
$targetState = [ordered]@{
    schemaVersion = 1
    startedAt = $state.startedAt
    completedAt = (Get-Date).ToUniversalTime().ToString("o")
    pid = $runnerPid
    watchdogPid = $watchdogPid
    durationSeconds = $RequiredDurationSeconds
    intervalSeconds = [int]$source.intervalSeconds
    evidence = $TargetEvidencePath
    temporaryCredential = $true
    exclusiveContainer = [string]$state.exclusiveContainer
    containerId = [string]$state.containerId
    sshConfig = [string]$state.sshConfig
    watchdogEvidence = $TargetWatchdogPath
    finalizationKind = $finalization.kind
    sourceArchive = $archive
}
[IO.File]::WriteAllText($TargetEvidencePath, (($targetEvidence | ConvertTo-Json -Depth 10) + "`n"), [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($TargetStatePath, (($targetState | ConvertTo-Json -Depth 10) + "`n"), [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $archive "policy-change.json"), (([ordered]@{ schemaVersion = 1; accepted = $true; finalization = $finalization; watchdogCleanupVerified = $true } | ConvertTo-Json -Depth 8) + "`n"), [Text.UTF8Encoding]::new($false))

foreach ($path in $sourceArtifacts | Where-Object { $_ -and (Test-Path -LiteralPath $_) }) { Remove-Item -LiteralPath $path -Force }
[pscustomobject]@{ status = "finalized"; requiredDurationSeconds = $RequiredDurationSeconds; observedWindowSeconds = [int]$samples[-1].elapsedSeconds; samples = $samples.Count; cleanupVerified = $true; archive = $archive } | ConvertTo-Json -Depth 5
