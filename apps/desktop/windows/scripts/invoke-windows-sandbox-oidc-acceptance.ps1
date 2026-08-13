param(
    [ValidateSet("Online", "Candidate", "Upgrade", "NetworkCandidate")][string]$Mode = "Online",
    [string]$RuntimePath = "",
    [string]$EvidenceRoot = "",
    [string]$ChannelManifestUrl = "https://download-opendrsai.ihep.ac.cn/channels/beta/latest-windows.json",
    [string]$ReleaseBaseUrl = "https://download-opendrsai.ihep.ac.cn/releases",
    [ValidateRange(300, 7200)][int]$TimeoutSeconds = 2400,
    [switch]$StopExistingSessions,
    [switch]$AutomateInstaller,
    [switch]$KeepSandboxOnPass
)

$ErrorActionPreference = "Stop"
$scriptRoot = $PSScriptRoot
$windowsRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot ".."))
$repoRoot = [IO.Path]::GetFullPath((Join-Path $windowsRoot "..\..\.."))
$controller = Join-Path $scriptRoot "windows-sandbox-session.ps1"
$guest = Join-Path $scriptRoot "guest\Invoke-OpenDrSaiAcceptance.ps1"
$collector = Join-Path $scriptRoot "collect-windows-sandbox-diagnostics.ps1"
$finalizer = Join-Path $scriptRoot "complete-windows-sandbox-acceptance.ps1"
foreach ($required in @($controller, $guest, $collector, $finalizer)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required Sandbox input is missing: $required" }
}

$diagnosis = (& $controller -Action Diagnose -AsJson) | ConvertFrom-Json
if (-not $diagnosis.currentUserPackageRegistered) { throw "Windows Sandbox is not registered for the current user." }
$existing = (& $controller -Action List -AsJson) | ConvertFrom-Json
if (@($existing.sessions).Count -gt 0) {
    if (-not $StopExistingSessions) { throw "An existing Sandbox session must be stopped first: $(@($existing.sessions).Id -join ', ')" }
    foreach ($session in @($existing.sessions)) {
        & $controller -Action Stop -Id ([string]$session.Id) -TimeoutSeconds 90 | Out-Null
    }
}

$runId = "opendrsai-$($Mode.ToLowerInvariant())-" + (Get-Date -Format "yyyyMMdd-HHmmss")
if (-not $EvidenceRoot) { $EvidenceRoot = Join-Path $windowsRoot "release\product-evidence\windows-sandbox-oidc" }
$runDir = Join-Path ([IO.Path]::GetFullPath($EvidenceRoot)) $runId
$packageDir = Join-Path $runDir "package"
$evidenceDir = Join-Path $runDir "evidence"
New-Item -ItemType Directory -Force -Path $packageDir,$evidenceDir | Out-Null
Copy-Item -LiteralPath $guest,$collector,$finalizer -Destination $packageDir -Force

$expectedVersion = ""
$expectedBuildId = ""
$expectedRuntimeSha256 = ""
if ($Mode -in @("Candidate", "Upgrade")) {
    if (-not $RuntimePath) { throw "$Mode mode requires -RuntimePath." }
    $runtime = (Resolve-Path -LiteralPath $RuntimePath).Path
    $expectedVersion = [string](Get-Content (Join-Path $windowsRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
    $expectedName = "OpenDrSai-Windows-v$expectedVersion-x64.zip"
    if ([IO.Path]::GetFileName($runtime) -ne $expectedName) { throw "Candidate Runtime must be named $expectedName." }
    $receiptPath = "$runtime.receipt.json"
    if (-not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) {
        throw "Candidate Runtime has no completed build receipt: $receiptPath"
    }
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `
        (Join-Path $scriptRoot "verify-final-runtime-artifact.ps1") -ArchivePath $runtime -ReceiptPath $receiptPath
    if ($LASTEXITCODE -ne 0) { throw "Candidate Runtime failed final-artifact identity verification." }
    $receipt = Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $expectedBuildId = [string]$receipt.buildId
    $expectedRuntimeSha256 = [string]$receipt.artifact.sha256
    Copy-Item -LiteralPath $runtime -Destination (Join-Path $packageDir $expectedName) -Force
    Copy-Item -LiteralPath $receiptPath -Destination (Join-Path $packageDir "$expectedName.receipt.json") -Force
    $runtimeHash = (Get-FileHash -LiteralPath $runtime -Algorithm SHA256).Hash.ToLowerInvariant()
    $runtimeSize = (Get-Item -LiteralPath $runtime).Length
    $guestRuntimeUrl = "file:///C:/OpenDrSaiPackage/$expectedName"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $windowsRoot "installer\build-msi.ps1") `
        -OutDir $packageDir -RuntimeUrl $guestRuntimeUrl -RuntimePath $runtime `
        -RuntimeSha256 $runtimeHash -RuntimeSizeBytes $runtimeSize -BootstrapperVersion $expectedVersion `
        -RequireTrustedRuntime `
        -OutputName "OpenDrSai-Windows-Installer-x64.msi"
    if ($LASTEXITCODE -ne 0) { throw "$Mode acceptance MSI build failed." }
}

$input = [ordered]@{
    schemaVersion = 1; runId = $runId; mode = $Mode.ToLowerInvariant(); createdAt = [DateTime]::UtcNow.ToString("o")
    expectedVersion = $expectedVersion; channelManifestUrl = $ChannelManifestUrl
    expectedBuildId = $expectedBuildId; expectedRuntimeSha256 = $expectedRuntimeSha256
    releaseBaseUrl = $ReleaseBaseUrl.TrimEnd('/')
    automateInstaller = [bool]$AutomateInstaller
    gitCommit = (& git -C $repoRoot rev-parse HEAD).Trim(); gitDirty = [bool](& git -C $repoRoot status --porcelain)
}
[IO.File]::WriteAllText((Join-Path $packageDir "acceptance-input.json"), (($input | ConvertTo-Json -Depth 6) + "`n"), [Text.UTF8Encoding]::new($false))

function Escape-Xml([string]$Value) { [Security.SecurityElement]::Escape($Value) }
$packageXml = Escape-Xml $packageDir
$evidenceXml = Escape-Xml $evidenceDir
$config = @"
<Configuration>
  <VGpu>Disable</VGpu><Networking>Enable</Networking><MemoryInMB>8192</MemoryInMB>
  <MappedFolders>
    <MappedFolder><HostFolder>$packageXml</HostFolder><SandboxFolder>C:\OpenDrSaiPackage</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$evidenceXml</HostFolder><SandboxFolder>C:\OpenDrSaiEvidence</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\OpenDrSaiPackage\Invoke-OpenDrSaiAcceptance.ps1</Command></LogonCommand>
</Configuration>
"@
$configPath = Join-Path $runDir "$runId.wsb"
[IO.File]::WriteAllText($configPath, $config, [Text.UTF8Encoding]::new($false))
[xml]$config | Out-Null

$session = $null
try {
    $session = (& $controller -Action Start -ConfigPath $configPath -TimeoutSeconds 120 -AsJson) | ConvertFrom-Json
} catch {
    $launchError = $_.Exception.ToString()
    $postFailureDiagnosis = $null
    try { $postFailureDiagnosis = ((& $controller -Action Diagnose -AsJson) | ConvertFrom-Json) } catch { }
    $failure = [ordered]@{
        schemaVersion = 1; runId = $runId; failedAt = [DateTime]::UtcNow.ToString("o")
        stage = "sandbox-session-start"; diagnosticCode = "SANDBOX_SESSION_START_TIMEOUT"
        error = $launchError; configPath = $configPath; diagnosis = $postFailureDiagnosis
        remediation = "Use the standard controller to clean the timed-out launcher. If the minimal config also fails after AppX re-registration, sign out or restart Windows before retrying."
    }
    [IO.File]::WriteAllText((Join-Path $evidenceDir "host-sandbox-launch-failure.json"), (($failure | ConvertTo-Json -Depth 8) + "`n"), [Text.UTF8Encoding]::new($false))
    throw
}
$sessionId = [string]$session.id
Write-Host "Sandbox acceptance round started. runId=$runId sessionId=$sessionId" -ForegroundColor Cyan
if ($AutomateInstaller) {
    Write-Host "The MSI will install unattended. Complete OIDC login and both chat checks inside Sandbox, then use the desktop PASS/FAIL shortcut." -ForegroundColor Yellow
} else {
    Write-Host "Complete the MSI wizard, OIDC login and both chat checks inside Sandbox, then use the desktop PASS/FAIL shortcut." -ForegroundColor Yellow
}
$resultPath = Join-Path $evidenceDir "acceptance-result.json"
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while (-not (Test-Path -LiteralPath $resultPath) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    Write-Host "." -NoNewline
}
Write-Host ""
if (-not (Test-Path -LiteralPath $resultPath)) {
    throw "Timed out waiting for Sandbox acceptance. Session $sessionId remains open; evidence: $evidenceDir"
}
$result = Get-Content -LiteralPath $resultPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $result.passed) {
    throw "Sandbox acceptance failed. Session $sessionId remains open for inspection; evidence: $evidenceDir"
}
if (-not $KeepSandboxOnPass -and $sessionId) {
    & $controller -Action Stop -Id $sessionId -TimeoutSeconds 90 | Out-Null
}
Write-Host "Sandbox OIDC acceptance passed: $resultPath" -ForegroundColor Green
