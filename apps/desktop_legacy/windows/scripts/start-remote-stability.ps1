[CmdletBinding()]
param(
  [ValidateRange(3600, 604800)]
  [int]$DurationSeconds = 3600,
  [ValidateRange(5, 3600)]
  [int]$IntervalSeconds = 300,
  [string]$ArchiveReason = "superseded-before-formal-completion"
)

$ErrorActionPreference = "Stop"
$desktop = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$evidenceDir = Join-Path $desktop "release\product-evidence\remote-workspace"
$statePath = Join-Path $evidenceDir "remote-stability-1h.state.json"
$evidencePath = Join-Path $evidenceDir "remote-stability-1h.json"
$stdoutPath = Join-Path $evidenceDir "remote-stability-1h.stdout.log"
$stderrPath = Join-Path $evidenceDir "remote-stability-1h.stderr.log"
$watchdogEvidencePath = [IO.Path]::ChangeExtension($statePath, "watchdog.json")
$watchdogStdoutPath = [IO.Path]::ChangeExtension($statePath, "watchdog.stdout.log")
$watchdogStderrPath = [IO.Path]::ChangeExtension($statePath, "watchdog.stderr.log")
$configPath = Join-Path $desktop ".cache\real-ssh-config"
New-Item -ItemType Directory -Force -Path $evidenceDir | Out-Null

if (Test-Path -LiteralPath $statePath) {
  try {
    $existing = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($existing.pid -and (Get-Process -Id ([int]$existing.pid) -ErrorAction SilentlyContinue)) {
      throw "A Remote Workspace stability process is already active with PID $($existing.pid)."
    }
    if ($existing.watchdogPid -and (Get-Process -Id ([int]$existing.watchdogPid) -ErrorAction SilentlyContinue)) {
      throw "The previous Remote Workspace cleanup watchdog is still active with PID $($existing.watchdogPid)."
    }
  } catch {
    if ($_.Exception.Message -like "A Remote Workspace stability process is already active*" -or $_.Exception.Message -like "The previous Remote Workspace cleanup watchdog is still active*") { throw }
  }
}

$container = & docker ps -a --filter "name=^/opendrsai-real-remote-gateway$" --format "{{.Names}}"
if ($LASTEXITCODE -ne 0) { throw "Unable to inspect the Docker stability container." }
if (@($container | Where-Object { $_ -eq "opendrsai-real-remote-gateway" }).Count -ne 0) {
  throw "The stability Docker container already exists; clean or diagnose it before starting a formal window."
}

$matchingTunnels = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -like "ssh*" -and ([string]$_.CommandLine).Contains($configPath) -and ([string]$_.CommandLine).Contains("-N")
})
if ($matchingTunnels.Count -ne 0) { throw "$($matchingTunnels.Count) matching SSH tunnel process(es) already exist." }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$archive = Join-Path $evidenceDir "invalidated-$stamp"
$existingArtifacts = @($statePath, $evidencePath, $stdoutPath, $stderrPath, $watchdogEvidencePath, $watchdogStdoutPath, $watchdogStderrPath) | Where-Object { Test-Path -LiteralPath $_ }
if ($existingArtifacts.Count) {
  New-Item -ItemType Directory -Force -Path $archive | Out-Null
  foreach ($path in $existingArtifacts) { Copy-Item -LiteralPath $path -Destination (Join-Path $archive (Split-Path $path -Leaf)) }
  [IO.File]::WriteAllText(
    (Join-Path $archive "invalidation.json"),
    (([ordered]@{ invalidatedAt = (Get-Date).ToUniversalTime().ToString("o"); reason = $ArchiveReason; formalEvidenceAccepted = $false } | ConvertTo-Json -Depth 4) + "`n"),
    [Text.UTF8Encoding]::new($false)
  )
}
foreach ($path in @($statePath, $evidencePath, $stdoutPath, $stderrPath, $watchdogEvidencePath, $watchdogStdoutPath, $watchdogStderrPath)) {
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
$env:OPENDRSAI_REMOTE_STABILITY_SECONDS = [string]$DurationSeconds
$env:OPENDRSAI_REMOTE_STABILITY_INTERVAL_SECONDS = [string]$IntervalSeconds
$env:OPENDRSAI_REMOTE_STABILITY_EVIDENCE = $evidencePath
$env:OPENDRSAI_REMOTE_STABILITY_STATE = $statePath
$process = Start-Process -FilePath $node -ArgumentList @("scripts/verify-real-remote-gateway.mjs") -WorkingDirectory $desktop -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
$state = [ordered]@{
  schemaVersion = 1
  startedAt = (Get-Date).ToUniversalTime().ToString("o")
  pid = $process.Id
  durationSeconds = $DurationSeconds
  intervalSeconds = $IntervalSeconds
  evidence = $evidencePath
  stdout = $stdoutPath
  stderr = $stderrPath
  temporaryCredential = $true
  exclusiveContainer = "opendrsai-real-remote-gateway"
  sshConfig = $configPath
}
[IO.File]::WriteAllText($statePath, (($state | ConvertTo-Json -Depth 4) + "`n"), [Text.UTF8Encoding]::new($false))

$deadline = (Get-Date).AddMinutes(10)
while ((Get-Date) -lt $deadline) {
  if ($process.HasExited) {
    $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { "" }
    throw "Stability process exited before its first sample. $stderr"
  }
  if (Test-Path -LiteralPath $evidencePath) {
    $evidence = Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json
    if (@($evidence.samples).Count -ge 1) {
      $containerId = (& docker inspect opendrsai-real-remote-gateway --format "{{.Id}}").Trim()
      if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($containerId)) { throw "Unable to bind the formal stability state to its Docker container ID." }
      $state["containerId"] = $containerId
      [IO.File]::WriteAllText($statePath, (($state | ConvertTo-Json -Depth 4) + "`n"), [Text.UTF8Encoding]::new($false))
      & (Join-Path $PSScriptRoot "remote-stability-watchdog.ps1") -StatePath $statePath -Attach | Out-Null
      $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
      [pscustomobject]@{ status = "running"; pid = $process.Id; startedAt = $state.startedAt; samples = @($evidence.samples).Count; evidence = $evidencePath; archivedPrevious = $existingArtifacts.Count -gt 0 } | ConvertTo-Json -Depth 4
      exit 0
    }
  }
  Start-Sleep -Seconds 2
  $process.Refresh()
}
Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
throw "Stability process did not write its first sample within 10 minutes."
