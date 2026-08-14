param(
    [string]$PackageDir = "C:\OpenDrSaiPackage",
    [string]$EvidenceDir = "C:\OpenDrSaiEvidence"
)

$ErrorActionPreference = "Stop"
$acceptanceInput = Get-Content (Join-Path $PackageDir "acceptance-input.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$runId = [string]$acceptanceInput.runId
[IO.Directory]::CreateDirectory($EvidenceDir) | Out-Null

function Write-JsonFile([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, (($Value | ConvertTo-Json -Depth 10) + "`n"), [Text.UTF8Encoding]::new($false))
}

function Set-AcceptanceInputField([string]$Name, $Value) {
    $acceptanceInput | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
}

function Resolve-OnlineInstaller([string]$Role) {
    $manifestPath = Join-Path $EvidenceDir "$Role-manifest.json"
    $channelManifestUrl = [string]$acceptanceInput.channelManifestUrl
    $releaseBaseUrl = ([string]$acceptanceInput.releaseBaseUrl).TrimEnd('/')
    $manifestResponse = Invoke-WebRequest -Uri $channelManifestUrl -UseBasicParsing -TimeoutSec 30
    [IO.File]::WriteAllText($manifestPath, $manifestResponse.Content, [Text.UTF8Encoding]::new($false))
    $manifest = $manifestResponse.Content | ConvertFrom-Json
    $version = [string]$manifest.version
    if (-not $version) { throw "$Role channel manifest has no version." }
    # Braces are required on both variables: slashes following a variable in an
    # expandable PowerShell string can be parsed as a scoped variable reference.
    $msiUrl = "${releaseBaseUrl}/v${version}/windows/OpenDrSai-Windows-Installer-x64.msi"
    $path = Join-Path $env:USERPROFILE "Downloads\$Role-OpenDrSai-Windows-Installer-x64.msi"
    [IO.Directory]::CreateDirectory((Split-Path -Parent $path)) | Out-Null
    Invoke-WebRequest -Uri $msiUrl -OutFile $path -UseBasicParsing -TimeoutSec 180
    return [pscustomobject]@{ role=$Role; version=$version; runtimeUrl=[string]$manifest.runtime.url; msiUrl=$msiUrl; path=$path }
}

function Write-DownloadEvidence([string]$Name, [string]$Path, [string]$Url) {
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    $download = [ordered]@{
        path=$Path; url=$Url; size=(Get-Item $Path).Length
        sha256=(Get-FileHash $Path -Algorithm SHA256).Hash.ToLowerInvariant()
        signatureStatus=[string]$signature.Status; signer=[string]$signature.SignerCertificate.Subject
    }
    Write-JsonFile (Join-Path $EvidenceDir "$Name-download-evidence.json") $download
    return $download
}

function Install-Msi([string]$Path, [string]$LogName, [bool]$Unattended) {
    $log = Join-Path $EvidenceDir $LogName
    $args = @('/i', $Path, '/L*v', $log)
    if ($Unattended) { $args += '/qn' }
    $process = Start-Process msiexec.exe -ArgumentList $args -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "MSI installation failed with exit code $($process.ExitCode); log=$log" }
}

function Start-InstalledApp {
    $app = "C:\Program Files\OpenDrSai\app\OpenDrSai.exe"
    if (-not (Test-Path $app)) { throw "Installed OpenDrSai.exe was not found." }
    $env:OPENDRSAI_ACCEPTANCE_RUN_ID = $runId
    $env:OPENDRSAI_ACCEPTANCE_AUTO_DEVICE_LOGIN = "1"
    $env:OPENDRSAI_OIDC_DEVICE_HANDOFF_PATH = Join-Path $EvidenceDir "device-login-handoff.json"
    return Start-Process $app -PassThru
}

function Verify-InstalledBuildIdentity {
    if (-not $acceptanceInput.expectedBuildId) { return }
    $identityPath = "C:\Program Files\OpenDrSai\build-identity.json"
    $agentIdentityPath = "C:\Program Files\OpenDrSai\drsai-agent\build-identity.json"
    foreach ($path in @($identityPath, $agentIdentityPath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Installed build identity is missing: $path" }
    }
    $identity = Get-Content -LiteralPath $identityPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $agentIdentity = Get-Content -LiteralPath $agentIdentityPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($identity.buildId -ne $acceptanceInput.expectedBuildId -or $agentIdentity.buildId -ne $acceptanceInput.expectedBuildId) {
        throw "Installed Runtime identity does not match the accepted candidate. expected=$($acceptanceInput.expectedBuildId) runtime=$($identity.buildId) agent=$($agentIdentity.buildId)"
    }
    Write-JsonFile (Join-Path $EvidenceDir "installed-build-identity.json") ([ordered]@{
        expectedBuildId = [string]$acceptanceInput.expectedBuildId
        installedBuildId = [string]$identity.buildId
        agentBuildId = [string]$agentIdentity.buildId
        expectedRuntimeSha256 = [string]$acceptanceInput.expectedRuntimeSha256
        identityVerified = $true
        verifiedAt = [DateTime]::UtcNow.ToString("o")
    })
}

function Collect-Diagnostics([string]$Phase) {
    $collector = Join-Path $PackageDir "collect-windows-sandbox-diagnostics.ps1"
    if (Test-Path $collector) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $collector -EvidenceDir $EvidenceDir -RunId $runId -Phase $Phase
    }
}

function Start-AcceptanceObserver([int]$InitialProcessId) {
    $watcher = Join-Path $PackageDir "watch-windows-sandbox-acceptance.ps1"
    $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$watcher`" -EvidenceDir `"$EvidenceDir`" -RunId `"$runId`" -InitialProcessId $InitialProcessId"
    Start-Process powershell.exe -ArgumentList $arguments -WindowStyle Hidden | Out-Null
}

function Wait-ForCompletedChat([DateTimeOffset]$After, [int]$TimeoutSeconds = 1200) {
    $telemetryPath = Join-Path $env:USERPROFILE ".drsai\logs\agent-telemetry.jsonl"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path -LiteralPath $telemetryPath -PathType Leaf) {
            foreach ($line in @(Get-Content -LiteralPath $telemetryPath -Tail 200)) {
                try {
                    $row = $line | ConvertFrom-Json
                    if ($row.event -eq "execution_completed" -and $row.agentId -eq "opendrsai" -and [DateTimeOffset]::Parse([string]$row.timestamp) -ge $After) { return }
                } catch { }
            }
        }
        Start-Sleep -Seconds 3
    }
    throw "Timed out waiting for a successful OpenDrSai chat; diagnostics will be collected automatically."
}

try {
    if ($acceptanceInput.mode -in @("online", "networkcandidate", "upgrade")) {
        $online = Resolve-OnlineInstaller $(if ($acceptanceInput.mode -eq "upgrade") { "baseline" } else { "network" })
        $msiPath = $online.path
        if ($acceptanceInput.mode -ne "upgrade") { Set-AcceptanceInputField "expectedVersion" $online.version }
        Set-AcceptanceInputField "baselineVersion" $online.version
        Set-AcceptanceInputField "runtimeUrl" $online.runtimeUrl
        Set-AcceptanceInputField "installerUrl" $online.msiUrl
        $onlineEvidence = Write-DownloadEvidence $online.role $msiPath $online.msiUrl
        if ($acceptanceInput.mode -ne "upgrade") { Write-JsonFile (Join-Path $EvidenceDir "download-evidence.json") $onlineEvidence }
        Set-AcceptanceInputField "installerSize" $onlineEvidence.size
        Set-AcceptanceInputField "installerSha256" $onlineEvidence.sha256
    } else {
        $msiPath = Join-Path $PackageDir "OpenDrSai-Windows-Installer-x64.msi"
        $candidateEvidence = Write-DownloadEvidence "candidate" $msiPath "file:///C:/OpenDrSaiPackage/OpenDrSai-Windows-Installer-x64.msi"
        Write-JsonFile (Join-Path $EvidenceDir "download-evidence.json") $candidateEvidence
    }
    Write-JsonFile (Join-Path $EvidenceDir "resolved-input.json") $acceptanceInput
    Install-Msi $msiPath $(if ($acceptanceInput.mode -eq "upgrade") { "msi-baseline-install.log" } else { "msi-install.log" }) ([bool]$acceptanceInput.automateInstaller)
    if ($acceptanceInput.mode -ne "upgrade") { Verify-InstalledBuildIdentity }
    $initialApp = Start-InstalledApp
    Start-Sleep -Seconds 8
    Collect-Diagnostics $(if ($acceptanceInput.mode -eq "upgrade") { "baseline-pre-oidc" } else { "pre-oidc" })

    Add-Type -AssemblyName PresentationFramework
    if ($acceptanceInput.mode -eq "upgrade") {
        $baselineStartedAt = [DateTimeOffset]$initialApp.StartTime
        [Windows.MessageBox]::Show("Sign in on baseline $($acceptanceInput.baselineVersion), send one chat and confirm a reply. The candidate upgrade will continue automatically; do not click any CMD files.", "OpenDrSai upgrade acceptance - baseline") | Out-Null
        Wait-ForCompletedChat $baselineStartedAt
        Get-Process OpenDrSai -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        $candidateMsi = Join-Path $PackageDir "OpenDrSai-Windows-Installer-x64.msi"
        $candidateEvidence = Write-DownloadEvidence "candidate" $candidateMsi "file:///C:/OpenDrSaiPackage/OpenDrSai-Windows-Installer-x64.msi"
        Write-JsonFile (Join-Path $EvidenceDir "download-evidence.json") $candidateEvidence
        Install-Msi $candidateMsi "msi-candidate-upgrade.log" $true
        Verify-InstalledBuildIdentity
        $candidateApp = Start-InstalledApp
        Start-Sleep -Seconds 8
        Collect-Diagnostics "candidate-post-upgrade-pre-chat"
        Start-AcceptanceObserver $candidateApp.Id
        [Windows.MessageBox]::Show("Candidate $($acceptanceInput.expectedVersion) is installed. Confirm login persisted; configure and test Tavily; chat; close/reopen from Start; chat again; then log out in OpenDrSai. Evidence and PASS/FAIL diagnostics are collected automatically; do not click any CMD files.", "OpenDrSai upgrade acceptance - candidate") | Out-Null
        exit 0
    }

    Start-AcceptanceObserver $initialApp.Id
    [Windows.MessageBox]::Show(
        "Complete these checks in OpenDrSai only: 1. Finish the MSI wizard if visible. 2. Sign in with HepAI device code. 3. Configure Tavily in Settings and make its Search test pass. 4. Send SANDBOX-E2E-$runId and confirm a reply. 5. Close OpenDrSai, reopen it from Start, confirm login persists, and send another chat. 6. Log out in OpenDrSai. Evidence and PASS/FAIL diagnostics are collected automatically; do not click any CMD files or close Sandbox first.",
        "OpenDrSai clean-environment acceptance"
    ) | Out-Null
} catch {
    [IO.File]::WriteAllText((Join-Path $EvidenceDir "bootstrap-error.txt"), $_.Exception.ToString(), [Text.UTF8Encoding]::new($false))
    $collector = Join-Path $PackageDir "collect-windows-sandbox-diagnostics.ps1"
    if (Test-Path $collector) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $collector -EvidenceDir $EvidenceDir -RunId $runId -Phase "bootstrap-failure" }
    throw
}
