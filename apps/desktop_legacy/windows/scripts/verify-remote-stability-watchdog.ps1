[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$temporary = Join-Path $appRoot (".tmp\stability-watchdog-{0}" -f ([Guid]::NewGuid().ToString("N")))
$containerName = "opendrsai-stability-watchdog-fixture-$([Guid]::NewGuid().ToString('N'))"
$runner = $null
$watchdogPid = $null
New-Item -ItemType Directory -Force -Path $temporary | Out-Null
$statePath = Join-Path $temporary "fixture.state.json"
$sshConfig = Join-Path $temporary "nonexistent-ssh-config"

try {
    $containerId = (& docker run -d --name $containerName debian:bookworm-slim sleep 300).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $containerId) { throw "Unable to start the watchdog fixture container." }
    $runner = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-Command", "Start-Sleep -Seconds 300") -WindowStyle Hidden -PassThru
    $state = [ordered]@{
        schemaVersion = 1
        startedAt = (Get-Date).ToUniversalTime().ToString("o")
        pid = $runner.Id
        durationSeconds = 86400
        intervalSeconds = 3600
        temporaryCredential = $true
        exclusiveContainer = $containerName
        containerId = $containerId
        sshConfig = $sshConfig
    }
    [IO.File]::WriteAllText($statePath, (($state | ConvertTo-Json -Depth 5) + "`n"), [Text.UTF8Encoding]::new($false))
    & (Join-Path $PSScriptRoot "remote-stability-watchdog.ps1") -StatePath $statePath -Attach | Out-Null
    $attached = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $watchdogPid = [int]$attached.watchdogPid
    if (-not (Get-Process -Id $watchdogPid -ErrorAction SilentlyContinue)) { throw "Watchdog did not remain active." }

    Stop-Process -Id $runner.Id -Force
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline -and (Get-Process -Id $watchdogPid -ErrorAction SilentlyContinue)) { Start-Sleep -Milliseconds 250 }
    if (Get-Process -Id $watchdogPid -ErrorAction SilentlyContinue) { throw "Watchdog did not finish after the forced Runner termination." }
    if (-not (Test-Path -LiteralPath $attached.watchdogEvidence)) {
        $watchdogError = if (Test-Path -LiteralPath $attached.watchdogStderr) { Get-Content -LiteralPath $attached.watchdogStderr -Raw } else { "<no watchdog stderr>" }
        throw "Watchdog did not write cleanup evidence. $watchdogError"
    }
    $result = Get-Content -LiteralPath $attached.watchdogEvidence -Raw | ConvertFrom-Json
    $remaining = [string](& docker ps -a --filter "name=^/$containerName$" --format "{{.Names}}")
    if (-not $result.cleanupVerified -or $result.runnerPid -ne $runner.Id -or $result.boundContainerId -ne $containerId -or $result.remainingTunnels -ne 0 -or $result.remainingBoundContainer -or $remaining) {
        throw "Watchdog strong-kill cleanup evidence is invalid: $($result | ConvertTo-Json -Compress)"
    }
    [pscustomobject]@{ status = "passed"; strongKill = $true; runnerPid = $runner.Id; watchdogPid = $watchdogPid; containerRemoved = $true; remainingTunnels = 0 } | ConvertTo-Json
} finally {
    if ($runner -and (Get-Process -Id $runner.Id -ErrorAction SilentlyContinue)) { Stop-Process -Id $runner.Id -Force -ErrorAction SilentlyContinue }
    if ($watchdogPid -and (Get-Process -Id $watchdogPid -ErrorAction SilentlyContinue)) { Stop-Process -Id $watchdogPid -Force -ErrorAction SilentlyContinue }
    $cleanupContainer = [string](& docker ps -a --filter "name=^/$containerName$" --format "{{.Names}}")
    if ($cleanupContainer -eq $containerName) { & docker rm -f $containerName | Out-Null }
    Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
}
