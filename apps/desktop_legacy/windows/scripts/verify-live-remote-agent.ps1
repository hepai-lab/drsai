[CmdletBinding()]
param(
  [ValidateRange(1, 20)]
  [int]$Iterations = 1,
  [ValidateSet("analysis", "tool", "hil")]
  [string]$Scenario = "analysis"
)

$ErrorActionPreference = "Stop"
$electronPath = Join-Path $PSScriptRoot "..\..\node_modules\electron\dist\electron.exe"
$scriptPath = Join-Path $PSScriptRoot "verify-live-remote-agent.cjs"

if (-not (Test-Path -LiteralPath $electronPath -PathType Leaf)) {
  throw "Electron executable was not found. Run npm install first."
}

$previousIterations = $env:OPENDRSAI_LIVE_ITERATIONS
$previousScenario = $env:OPENDRSAI_LIVE_SCENARIO
try {
  $env:OPENDRSAI_LIVE_ITERATIONS = [string]$Iterations
  $env:OPENDRSAI_LIVE_SCENARIO = $Scenario
  $process = Start-Process `
    -FilePath $electronPath `
    -ArgumentList $scriptPath `
    -NoNewWindow `
    -Wait `
    -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Remote-agent live verification failed with exit code $($process.ExitCode)."
  }
} finally {
  if ($null -eq $previousIterations) {
    Remove-Item Env:OPENDRSAI_LIVE_ITERATIONS -ErrorAction SilentlyContinue
  } else {
    $env:OPENDRSAI_LIVE_ITERATIONS = $previousIterations
  }
  if ($null -eq $previousScenario) {
    Remove-Item Env:OPENDRSAI_LIVE_SCENARIO -ErrorAction SilentlyContinue
  } else {
    $env:OPENDRSAI_LIVE_SCENARIO = $previousScenario
  }
}
