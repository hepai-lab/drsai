param(
    [string]$PackageDir = "C:\OpenDrSaiPackage",
    [string]$EvidenceDir = "C:\OpenDrSaiEvidence",
    [string]$ExpectedVersion = "1.4.4",
    [switch]$TestUninstall
)

$ErrorActionPreference = "Stop"
$startedAt = (Get-Date).ToUniversalTime()
$results = New-Object System.Collections.Generic.List[object]

function Add-Check([string]$Name, [string]$Status, [string]$Detail = "") {
    $results.Add([pscustomobject]@{ name = $Name; status = $Status; detail = $Detail }) | Out-Null
    $color = if ($Status -eq "PASS") { "Green" } elseif ($Status -eq "WARN") { "Yellow" } else { "Red" }
    Write-Host "[$Status] $Name $Detail" -ForegroundColor $color
}

function Wait-ForFreshInstallState([string]$Path, [datetime]$After, [int]$TimeoutSeconds = 300) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if (Test-Path -LiteralPath $Path) {
            try {
                $state = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
                if ([datetime]$state.installedAt -ge $After) { return $state }
            } catch { }
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw "Timed out waiting for a fresh install-state.json."
}

function Invoke-Native([string]$FilePath, [string[]]$Arguments) {
    $oldPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = & $FilePath @Arguments 2>&1
        return [pscustomobject]@{ exitCode = $LASTEXITCODE; output = (($output | Out-String).Trim()) }
    } finally {
        $ErrorActionPreference = $oldPreference
    }
}

New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null
$startupMarker = Join-Path $EvidenceDir "sandbox-started.txt"
$transcriptPath = Join-Path $EvidenceDir "sandbox-acceptance-transcript.txt"
[IO.File]::WriteAllText($startupMarker, ((Get-Date).ToUniversalTime().ToString("o") + [Environment]::NewLine))
Start-Transcript -Path $transcriptPath -Force | Out-Null
$msi = Join-Path $PackageDir "OpenDrSaiSetup.sandbox.msi"
$runtime = Join-Path $PackageDir "OpenDrSaiRuntime-win-x64.zip"
$localRuntime = "C:\OpenDrSaiRuntime-win-x64.zip"
$statePath = Join-Path $env:ProgramFiles "OpenDrSai\install-state.json"
$evidencePath = Join-Path $EvidenceDir ("windows-11-sandbox-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json")

try {
    Add-Check "Windows Sandbox identity" ($(if ($env:USERNAME -eq "WDAGUtilityAccount") { "PASS" } else { "FAIL" })) $env:USERNAME
    Add-Check "MSI exists" ($(if (Test-Path $msi) { "PASS" } else { "FAIL" })) $msi
    Add-Check "Runtime exists" ($(if (Test-Path $runtime) { "PASS" } else { "FAIL" })) $runtime
    if (-not (Test-Path $msi) -or -not (Test-Path $runtime)) { throw "Mapped release artifacts are missing." }

    foreach ($command in @("node.exe", "python.exe", "git.exe")) {
        $present = [bool](Get-Command $command -ErrorAction SilentlyContinue)
        Add-Check "Clean prerequisite: $command absent" ($(if (-not $present) { "PASS" } else { "WARN" }))
    }

    $signature = Get-AuthenticodeSignature -LiteralPath $msi
    Add-Check "MSI signature" ($(if ($signature.Status -eq "Valid") { "PASS" } else { "WARN" })) ([string]$signature.Status)
    $runtimeHash = (Get-FileHash -LiteralPath $runtime -Algorithm SHA256).Hash.ToLowerInvariant()
    Add-Check "Runtime SHA256" "PASS" $runtimeHash

    Copy-Item -LiteralPath $runtime -Destination $localRuntime -Force
    Add-Check "Runtime copied to Sandbox disk" ($(if (Test-Path $localRuntime) { "PASS" } else { "FAIL" })) $localRuntime

    Write-Host "Installing OpenDrSai in Windows Sandbox..." -ForegroundColor Cyan
    $msiInstallLog = Join-Path $EvidenceDir "msi-install.log"
    $installer = Start-Process msiexec.exe -ArgumentList @("/i", $msi, "/qn", "/norestart", "/L*v", $msiInstallLog) -Wait -PassThru
    Add-Check "MSI process" ($(if ($installer.ExitCode -eq 0) { "PASS" } else { "FAIL" })) "exit=$($installer.ExitCode)"
    if ($installer.ExitCode -ne 0) { throw "MSI installation failed." }

    $state = Wait-ForFreshInstallState $statePath $startedAt
    Add-Check "Runtime version" ($(if ($state.runtimeVersion -eq $ExpectedVersion) { "PASS" } else { "FAIL" })) ([string]$state.runtimeVersion)
    Add-Check "Desktop executable" ($(if (Test-Path $state.desktopPath) { "PASS" } else { "FAIL" })) ([string]$state.desktopPath)
    $desktopShortcut = Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) "OpenDrSai.lnk"
    $startMenuShortcut = Join-Path ([Environment]::GetFolderPath("Programs")) "OpenDrSai\OpenDrSai.lnk"
    Add-Check "Desktop shortcut" ($(if (Test-Path $desktopShortcut) { "PASS" } else { "FAIL" })) $desktopShortcut
    Add-Check "Start menu shortcut" ($(if (Test-Path $startMenuShortcut) { "PASS" } else { "FAIL" })) $startMenuShortcut
    $python = Join-Path $state.agentPath "venv\Scripts\python.exe"
    Add-Check "Bundled Python" ($(if (Test-Path $python) { "PASS" } else { "FAIL" })) $python
    $import = Invoke-Native $python @("-c", "import drsai; print('drsai import ok')")
    Add-Check "DrSai Python import" ($(if ($import.exitCode -eq 0 -and $import.output -match "drsai import ok") { "PASS" } else { "FAIL" })) $import.output
    $version = Invoke-Native $python @("-m", "drsai.backend.run_cli", "version")
    Add-Check "DrSai backend version" ($(if ($version.exitCode -eq 0 -and $version.output -match [regex]::Escape($ExpectedVersion)) { "PASS" } else { "FAIL" })) $version.output

    $env:OPENDRSAI_DIAGNOSTIC_LOG_PATH = Join-Path $EvidenceDir "desktop-chat-diagnostics.log"
    Remove-Item -LiteralPath $env:OPENDRSAI_DIAGNOSTIC_LOG_PATH -Force -ErrorAction SilentlyContinue
    Start-Process -FilePath $state.desktopPath | Out-Null
    Add-Check "OpenDrSai launch" "PASS" "Process started"

    Write-Host ""
    Write-Host "Complete these steps in OpenDrSai:" -ForegroundColor Cyan
    Write-Host "1. Sign in with HepAI (no API key/model configuration)."
    Write-Host "2. Open a temporary project and send a chat request."
    Write-Host "3. Confirm Gateway readiness does not report a missing api-key."
    Write-Host "4. Close and reopen OpenDrSai; confirm login, project/session, and chat recovery."
    Write-Host "5. Start an Agent task that changes a file; confirm Change Review opens and accept the change set."
    Write-Host "6. Start another Agent task; reject it, approve restore, and confirm the pre-run content is restored."
    Write-Host ""
    Add-Type -AssemblyName System.Windows.Forms
    $answer = [System.Windows.Forms.MessageBox]::Show(
        "Click Yes only after all six OpenDrSai checks pass. Click No if any check fails.",
        "OpenDrSai Windows 11 acceptance",
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Information
    )
    $manual = if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) { "PASS" } else { "FAIL" }
    Add-Check "Manual OIDC and core workflow" $manual $manual

    if ($TestUninstall) {
        Get-Process OpenDrSai -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        $userDataPath = Join-Path $env:USERPROFILE ".drsai"
        $msiUninstallLog = Join-Path $EvidenceDir "msi-uninstall.log"
        $uninstaller = Start-Process msiexec.exe -ArgumentList @("/x", $msi, "/qn", "/norestart", "/L*v", $msiUninstallLog) -Wait -PassThru
        Add-Check "MSI uninstall process" ($(if ($uninstaller.ExitCode -eq 0) { "PASS" } else { "FAIL" })) "exit=$($uninstaller.ExitCode)"
        Add-Check "App removed" ($(if (-not (Test-Path $state.installRoot)) { "PASS" } else { "FAIL" })) ([string]$state.installRoot)
        Add-Check "User data preserved" ($(if (Test-Path $userDataPath) { "PASS" } else { "FAIL" })) $userDataPath
    } else {
        Add-Check "Application retained after acceptance" "PASS" ([string]$state.installRoot)
    }
} catch {
    Add-Check "Acceptance execution" "FAIL" $_.Exception.Message
} finally {
    $failed = @($results | Where-Object status -eq "FAIL")
    $evidence = [ordered]@{
        schemaVersion = 1
        generatedAt = (Get-Date).ToUniversalTime().ToString("o")
        host = "Windows Sandbox"
        os = [Environment]::OSVersion.VersionString
        expectedVersion = $ExpectedVersion
        passed = ($failed.Count -eq 0)
        checks = $results
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($evidencePath, (($evidence | ConvertTo-Json -Depth 6) + [Environment]::NewLine), $utf8NoBom)
    Write-Host "Evidence: $evidencePath" -ForegroundColor Cyan
    Stop-Transcript | Out-Null
    if ($failed.Count -gt 0) { exit 1 }
}
