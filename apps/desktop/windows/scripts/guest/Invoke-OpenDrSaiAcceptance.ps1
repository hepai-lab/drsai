param(
    [string]$PackageDir = "C:\OpenDrSaiPackage",
    [string]$EvidenceDir = "C:\OpenDrSaiEvidence"
)

$ErrorActionPreference = "Stop"
$input = Get-Content (Join-Path $PackageDir "acceptance-input.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$runId = [string]$input.runId
[IO.Directory]::CreateDirectory($EvidenceDir) | Out-Null

function Write-JsonFile([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, (($Value | ConvertTo-Json -Depth 10) + "`n"), [Text.UTF8Encoding]::new($false))
}

function Resolve-OnlineInstaller([string]$Role) {
    $manifestPath = Join-Path $EvidenceDir "$Role-manifest.json"
    $manifestResponse = Invoke-WebRequest -Uri ([string]$input.channelManifestUrl) -UseBasicParsing -TimeoutSec 30
    [IO.File]::WriteAllText($manifestPath, $manifestResponse.Content, [Text.UTF8Encoding]::new($false))
    $manifest = $manifestResponse.Content | ConvertFrom-Json
    $version = [string]$manifest.version
    if (-not $version) { throw "$Role channel manifest has no version." }
    $msiUrl = "$([string]$input.releaseBaseUrl)/v$version/windows/OpenDrSai-Windows-Installer-x64.msi"
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
    Start-Process $app
}

function Verify-InstalledBuildIdentity {
    if (-not $input.expectedBuildId) { return }
    $identityPath = "C:\Program Files\OpenDrSai\build-identity.json"
    $agentIdentityPath = "C:\Program Files\OpenDrSai\drsai-agent\build-identity.json"
    foreach ($path in @($identityPath, $agentIdentityPath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Installed build identity is missing: $path" }
    }
    $identity = Get-Content -LiteralPath $identityPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $agentIdentity = Get-Content -LiteralPath $agentIdentityPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($identity.buildId -ne $input.expectedBuildId -or $agentIdentity.buildId -ne $input.expectedBuildId) {
        throw "Installed Runtime identity does not match the accepted candidate. expected=$($input.expectedBuildId) runtime=$($identity.buildId) agent=$($agentIdentity.buildId)"
    }
    Write-JsonFile (Join-Path $EvidenceDir "installed-build-identity.json") ([ordered]@{
        expectedBuildId = [string]$input.expectedBuildId
        installedBuildId = [string]$identity.buildId
        agentBuildId = [string]$agentIdentity.buildId
        expectedRuntimeSha256 = [string]$input.expectedRuntimeSha256
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

function Write-OutcomeShortcuts([string]$ManualNote) {
    $finalizer = Join-Path $PackageDir "complete-windows-sandbox-acceptance.ps1"
    $pass = "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$finalizer`" -EvidenceDir `"$EvidenceDir`" -RunId `"$runId`" -ManualOutcome PASS -ManualNote `"$ManualNote`"`r`n"
    $desktop = [Environment]::GetFolderPath('Desktop')
    [IO.File]::WriteAllText((Join-Path $desktop "1-OpenDrSai-Acceptance-PASS.cmd"), $pass, [Text.Encoding]::Default)
    Write-FailShortcut
}

function Write-FailShortcut {
    $finalizer = Join-Path $PackageDir "complete-windows-sandbox-acceptance.ps1"
    $fail = "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$finalizer`" -EvidenceDir `"$EvidenceDir`" -RunId `"$runId`" -ManualOutcome FAIL -ManualNote `"Tester observed a failure.`"`r`n"
    $desktop = [Environment]::GetFolderPath('Desktop')
    [IO.File]::WriteAllText((Join-Path $desktop "2-OpenDrSai-Acceptance-FAIL-Collect.cmd"), $fail, [Text.Encoding]::Default)
}

try {
    if ($input.mode -in @("online", "networkcandidate", "upgrade")) {
        $online = Resolve-OnlineInstaller $(if ($input.mode -eq "upgrade") { "baseline" } else { "network" })
        $msiPath = $online.path
        if ($input.mode -ne "upgrade") { $input.expectedVersion = $online.version }
        $input.baselineVersion = $online.version
        $input.runtimeUrl = $online.runtimeUrl
        $input.installerUrl = $online.msiUrl
        $onlineEvidence = Write-DownloadEvidence $online.role $msiPath $online.msiUrl
        if ($input.mode -ne "upgrade") { Write-JsonFile (Join-Path $EvidenceDir "download-evidence.json") $onlineEvidence }
        $input.installerSize = $onlineEvidence.size
        $input.installerSha256 = $onlineEvidence.sha256
    } else {
        $msiPath = Join-Path $PackageDir "OpenDrSai-Windows-Installer-x64.msi"
        $candidateEvidence = Write-DownloadEvidence "candidate" $msiPath "file:///C:/OpenDrSaiPackage/OpenDrSai-Windows-Installer-x64.msi"
        Write-JsonFile (Join-Path $EvidenceDir "download-evidence.json") $candidateEvidence
    }
    Write-JsonFile (Join-Path $EvidenceDir "resolved-input.json") $input
    Install-Msi $msiPath $(if ($input.mode -eq "upgrade") { "msi-baseline-install.log" } else { "msi-install.log" }) ([bool]$input.automateInstaller)
    if ($input.mode -ne "upgrade") { Verify-InstalledBuildIdentity }
    Start-InstalledApp
    Start-Sleep -Seconds 8
    Collect-Diagnostics $(if ($input.mode -eq "upgrade") { "baseline-pre-oidc" } else { "pre-oidc" })

    Add-Type -AssemblyName PresentationFramework
    if ($input.mode -eq "upgrade") {
        $desktop = [Environment]::GetFolderPath('Desktop')
        $signal = Join-Path $EvidenceDir "upgrade-continue.signal"
        $continue = "@echo off`r`npowershell.exe -NoProfile -Command `"[IO.File]::WriteAllText('$signal','continue')`"`r`n"
        [IO.File]::WriteAllText((Join-Path $desktop "1-Continue-OpenDrSai-Candidate-Upgrade.cmd"), $continue, [Text.Encoding]::Default)
        Write-FailShortcut
        [Windows.MessageBox]::Show("Sign in on baseline $($input.baselineVersion), send a chat and confirm a reply. Then run 1-Continue-OpenDrSai-Candidate-Upgrade.cmd from the desktop. Use FAIL-Collect if baseline fails.", "OpenDrSai upgrade acceptance - baseline") | Out-Null
        $deadline = (Get-Date).AddMinutes(20)
        while (-not (Test-Path $signal) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
        if (-not (Test-Path $signal)) { throw "Timed out waiting for baseline acceptance before upgrade." }
        Get-Process OpenDrSai -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        $candidateMsi = Join-Path $PackageDir "OpenDrSai-Windows-Installer-x64.msi"
        $candidateEvidence = Write-DownloadEvidence "candidate" $candidateMsi "file:///C:/OpenDrSaiPackage/OpenDrSai-Windows-Installer-x64.msi"
        Write-JsonFile (Join-Path $EvidenceDir "download-evidence.json") $candidateEvidence
        Install-Msi $candidateMsi "msi-candidate-upgrade.log" $true
        Verify-InstalledBuildIdentity
        Start-InstalledApp
        Start-Sleep -Seconds 8
        Collect-Diagnostics "candidate-post-upgrade-pre-chat"
        Write-OutcomeShortcuts "Baseline login/chat, candidate upgrade, persisted OIDC, restart and post-upgrade chat confirmed by tester."
        [Windows.MessageBox]::Show("Candidate $($input.expectedVersion) is installed. Confirm login persisted, chat works, close/reopen from Start, chat again, then run PASS. Use FAIL-Collect on any failure.", "OpenDrSai upgrade acceptance - candidate") | Out-Null
        exit 0
    }

    Write-OutcomeShortcuts "OIDC login, first chat, restart persistence and second chat confirmed by tester."
    [Windows.MessageBox]::Show(
        "Complete these checks: 1. If the MSI wizard is visible, finish it; unattended candidate runs skip this step. 2. Sign in with HepAI OIDC. 3. Send SANDBOX-E2E-$runId and confirm a reply. 4. Close OpenDrSai and reopen it from Start. 5. Confirm login persists and chat works again. Then run the PASS desktop shortcut. If anything fails, run FAIL-Collect. Do not close Sandbox first.",
        "OpenDrSai clean-environment acceptance"
    ) | Out-Null
} catch {
    [IO.File]::WriteAllText((Join-Path $EvidenceDir "bootstrap-error.txt"), $_.Exception.ToString(), [Text.UTF8Encoding]::new($false))
    $collector = Join-Path $PackageDir "collect-windows-sandbox-diagnostics.ps1"
    if (Test-Path $collector) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $collector -EvidenceDir $EvidenceDir -RunId $runId -Phase "bootstrap-failure" }
    throw
}
