param(
    [string]$ReleaseDir = "$PSScriptRoot\..\release\bootstrapper",
    [string]$CernPdf = "C:\tmp\WLCG-20260715-WLCG-talk-IHEP-visit.pdf",
    [string]$EvidenceDir = "$PSScriptRoot\..\release\product-evidence\m1-clean-install",
    [string]$ExpectedVersion = "1.4.6",
    [ValidateRange(1, 10)]
    [int]$Runs = 10,
    [ValidateRange(60, 900)]
    [int]$TimeoutSeconds = 420
)

$ErrorActionPreference = "Stop"

function Get-Sha256Hex([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Escape-Xml([string]$Value) {
    return [Security.SecurityElement]::Escape($Value)
}

$sandboxExe = (Get-Command WindowsSandbox.exe -ErrorAction SilentlyContinue).Source
if (-not $sandboxExe) {
    throw "Windows Sandbox is unavailable. Enable it once in Windows Features, then rerun this non-elevated matrix."
}

$releaseDir = (Resolve-Path $ReleaseDir).Path
$runtime = Join-Path $releaseDir "OpenDrSaiRuntime-win-x64.zip"
$sourceMsi = Join-Path $releaseDir "OpenDrSaiSetup-win-x64.msi"
$cernPdf = (Resolve-Path $CernPdf).Path
foreach ($required in @($runtime, $sourceMsi, $cernPdf, "$PSScriptRoot\run-windows-sandbox-acceptance.ps1", "$PSScriptRoot\m1-fake-gateway.py")) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required M1 artifact is missing: $required" }
}
$sandboxSessionScript = "$PSScriptRoot\windows-sandbox-session.ps1"
if (-not (Test-Path -LiteralPath $sandboxSessionScript)) { throw "Sandbox session controller is missing: $sandboxSessionScript" }
if ((Get-Sha256Hex $cernPdf) -ne "f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e") {
    throw "The CERN PDF fixture hash does not match the locked M1 source."
}

$evidenceDir = [IO.Path]::GetFullPath($EvidenceDir)
$sessionId = "m1-" + (Get-Date -Format "yyyyMMdd-HHmmss")
$packageDir = Join-Path $evidenceDir "package-$sessionId"
New-Item -ItemType Directory -Force -Path $evidenceDir, $packageDir | Out-Null
Copy-Item -LiteralPath $runtime -Destination (Join-Path $packageDir "OpenDrSaiRuntime-win-x64.zip") -Force
Copy-Item -LiteralPath $cernPdf -Destination (Join-Path $packageDir "WLCG-20260715-WLCG-talk-IHEP-visit.pdf") -Force
Copy-Item -LiteralPath "$PSScriptRoot\run-windows-sandbox-acceptance.ps1" -Destination $packageDir -Force
Copy-Item -LiteralPath "$PSScriptRoot\m1-fake-gateway.py" -Destination $packageDir -Force

$runtimeHash = Get-Sha256Hex $runtime
$runtimeSize = (Get-Item -LiteralPath $runtime).Length
$sandboxMsi = Join-Path $packageDir "OpenDrSaiSetup.sandbox.msi"
$runtimeUrl = "https://github.com/hepai-lab/drsai/releases/download/v$ExpectedVersion/OpenDrSaiRuntime-win-x64.zip"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\..\..\installers\windows\build-msi.ps1" `
    -OutDir $packageDir -RuntimePath $runtime -RuntimeUrl $runtimeUrl -RuntimeSha256 $runtimeHash `
    -RuntimeSizeBytes $runtimeSize -BootstrapperVersion $ExpectedVersion -OutputName "OpenDrSaiSetup.sandbox.msi"
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $sandboxMsi)) { throw "Failed to build the local-only M1 Sandbox MSI." }

$matrix = New-Object System.Collections.Generic.List[object]
for ($index = 1; $index -le $Runs; $index += 1) {
    $runId = "$sessionId-clean-{0:D2}" -f $index
    $runDir = Join-Path $evidenceDir $runId
    New-Item -ItemType Directory -Force -Path $runDir | Out-Null
    $packageXml = Escape-Xml $packageDir
    $runXml = Escape-Xml $runDir
    $command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\OpenDrSaiPackage\run-windows-sandbox-acceptance.ps1 -RunId $runId -ExpectedVersion $ExpectedVersion -ShutdownOnComplete"
    $wsb = @"
<Configuration>
  <VGpu>Disable</VGpu>
  <Networking>Disable</Networking>
  <MemoryInMB>4096</MemoryInMB>
  <MappedFolders>
    <MappedFolder><HostFolder>$packageXml</HostFolder><SandboxFolder>C:\OpenDrSaiPackage</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$runXml</HostFolder><SandboxFolder>C:\OpenDrSaiEvidence</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>$command</Command></LogonCommand>
</Configuration>
"@
    $wsbPath = Join-Path $runDir "$runId.wsb"
    [IO.File]::WriteAllText($wsbPath, $wsb, (New-Object Text.UTF8Encoding($false)))
    $started = Get-Date
    $sessionJson = & $sandboxSessionScript -Action Start -ConfigPath $wsbPath -TimeoutSeconds 120 -AsJson
    $sandboxSession = $sessionJson | ConvertFrom-Json
    $deadline = $started.AddSeconds($TimeoutSeconds)
    $resultFile = $null
    do {
        Start-Sleep -Seconds 2
        $resultFile = Get-ChildItem -LiteralPath $runDir -Filter "windows-11-sandbox-*.json" -File -ErrorAction SilentlyContinue | Select-Object -First 1
    } while (-not $resultFile -and (Get-Date) -lt $deadline)
    if (-not $resultFile) {
        if ($sandboxSession.id) {
            & $sandboxSessionScript -Action Stop -Id $sandboxSession.id -TimeoutSeconds 60 -Force | Out-Null
        } else {
            & $sandboxSessionScript -Action StopAll -TimeoutSeconds 60 -Force | Out-Null
        }
        $matrix.Add([pscustomobject]@{ runId = $runId; passed = $false; durationSeconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1); evidence = $null; error = "Timed out or Sandbox exited before evidence was written." }) | Out-Null
        break
    }
    $evidence = Get-Content -LiteralPath $resultFile.FullName -Raw | ConvertFrom-Json
    $matrix.Add([pscustomobject]@{ runId = $runId; passed = [bool]$evidence.passed; durationSeconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1); evidence = $resultFile.FullName; error = $null }) | Out-Null
    if ($sandboxSession.id) {
        & $sandboxSessionScript -Action Stop -Id $sandboxSession.id -TimeoutSeconds 60 -Force | Out-Null
    }
}

$summary = [ordered]@{
    schemaVersion = 1
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    expectedVersion = $ExpectedVersion
    sessionId = $sessionId
    requestedRuns = $Runs
    passedRuns = @($matrix | Where-Object passed).Count
    passed = @($matrix | Where-Object passed).Count -eq $Runs
    runtimeSha256 = $runtimeHash
    cernPdfSha256 = Get-Sha256Hex $cernPdf
    runs = $matrix
}
$summaryPath = Join-Path $evidenceDir "m1-clean-install-matrix.json"
[IO.File]::WriteAllText($summaryPath, (($summary | ConvertTo-Json -Depth 8) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
Write-Host "M1 clean-install matrix: $($summary.passedRuns)/$Runs passed" -ForegroundColor $(if ($summary.passed) { "Green" } else { "Red" })
Write-Host "Evidence: $summaryPath"
if (-not $summary.passed) { exit 1 }
