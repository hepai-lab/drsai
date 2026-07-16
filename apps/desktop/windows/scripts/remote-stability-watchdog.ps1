[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$StatePath,
    [switch]$Attach
)

$ErrorActionPreference = "Stop"
$StatePath = [IO.Path]::GetFullPath($StatePath)
$state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
$evidencePath = [IO.Path]::ChangeExtension($StatePath, "watchdog.json")
$stdoutPath = [IO.Path]::ChangeExtension($StatePath, "watchdog.stdout.log")
$stderrPath = [IO.Path]::ChangeExtension($StatePath, "watchdog.stderr.log")

if ($Attach) {
    if (-not (Get-Process -Id ([int]$state.pid) -ErrorAction SilentlyContinue)) { throw "Cannot attach a watchdog to an inactive stability PID." }
    if (-not $state.containerId) { throw "Cannot attach a watchdog before the stability container ID is bound." }
    if ($state.watchdogPid -and (Get-Process -Id ([int]$state.watchdogPid) -ErrorAction SilentlyContinue)) { throw "A stability watchdog is already active." }
    foreach ($path in @($evidencePath, $stdoutPath, $stderrPath)) { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force } }
    $watchdog = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $PSCommandPath, "-StatePath", $StatePath) -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    $state | Add-Member -NotePropertyName watchdogPid -NotePropertyValue $watchdog.Id -Force
    $state | Add-Member -NotePropertyName watchdogEvidence -NotePropertyValue $evidencePath -Force
    $state | Add-Member -NotePropertyName watchdogStdout -NotePropertyValue $stdoutPath -Force
    $state | Add-Member -NotePropertyName watchdogStderr -NotePropertyValue $stderrPath -Force
    [IO.File]::WriteAllText($StatePath, (($state | ConvertTo-Json -Depth 6) + "`n"), [Text.UTF8Encoding]::new($false))
    [pscustomobject]@{ status = "attached"; runnerPid = $state.pid; watchdogPid = $watchdog.Id; containerId = $state.containerId } | ConvertTo-Json
    exit 0
}

$runnerPid = [int]$state.pid
$containerName = [string]$state.exclusiveContainer
$boundContainerId = [string]$state.containerId
$appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$configPath = if ($state.sshConfig) { [IO.Path]::GetFullPath([string]$state.sshConfig) } else { Join-Path $appRoot ".cache\real-ssh-config" }
$failures = [Collections.Generic.List[string]]::new()

try {
    $runnerProcess = [Diagnostics.Process]::GetProcessById($runnerPid)
    $runnerProcess.WaitForExit()
    $runnerProcess.Dispose()
} catch [ArgumentException] {
    # The runner may be force-terminated before the watchdog acquires its
    # process handle. That is exactly the cleanup case this watchdog covers.
}
Start-Sleep -Seconds 2

$removedBoundContainer = $false
$currentContainerId = [string](& docker ps -a --no-trunc --filter "name=^/$containerName$" --format "{{.ID}}")
if ($currentContainerId -and $currentContainerId -eq $boundContainerId) {
    & docker rm -f $containerName | Out-Null
    if ($LASTEXITCODE -eq 0) { $removedBoundContainer = $true } else { $failures.Add("Failed to remove the bound Docker container.") }
} elseif ($currentContainerId -and $currentContainerId -ne $boundContainerId) {
    $failures.Add("Container name now belongs to a different container ID; refusing to remove it.")
}

$stoppedTunnels = 0
$tunnels = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -like "ssh*" -and ([string]$_.CommandLine).Contains($configPath) -and ([string]$_.CommandLine).Contains("-N")
})
foreach ($tunnel in $tunnels) {
    try { Stop-Process -Id $tunnel.ProcessId -Force -ErrorAction Stop; $stoppedTunnels += 1 }
    catch { $failures.Add("Failed to stop SSH tunnel PID $($tunnel.ProcessId).") }
}
Start-Sleep -Milliseconds 500
$remainingTunnels = @((Get-CimInstance Win32_Process | Where-Object {
    $_.Name -like "ssh*" -and ([string]$_.CommandLine).Contains($configPath) -and ([string]$_.CommandLine).Contains("-N")
})).Count
$remainingContainerId = [string](& docker ps -a --no-trunc --filter "name=^/$containerName$" --format "{{.ID}}")
if ($remainingTunnels -ne 0) { $failures.Add("$remainingTunnels matching SSH tunnel(s) remain.") }
if ($remainingContainerId -eq $boundContainerId) { $failures.Add("The bound Docker container remains.") }

$result = [ordered]@{
    schemaVersion = 1
    observedRunnerExitAt = (Get-Date).ToUniversalTime().ToString("o")
    runnerPid = $runnerPid
    boundContainerId = $boundContainerId
    removedBoundContainer = $removedBoundContainer
    stoppedTunnels = $stoppedTunnels
    remainingTunnels = $remainingTunnels
    remainingBoundContainer = ($remainingContainerId -eq $boundContainerId)
    refusedDifferentContainer = [bool]($remainingContainerId -and $remainingContainerId -ne $boundContainerId)
    failures = @($failures)
    cleanupVerified = ($failures.Count -eq 0)
}
[IO.File]::WriteAllText($evidencePath, (($result | ConvertTo-Json -Depth 6) + "`n"), [Text.UTF8Encoding]::new($false))
if ($failures.Count -ne 0) { exit 1 }
