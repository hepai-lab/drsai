param(
    [string]$PackageDir = "C:\OpenDrSaiPackage",
    [string]$EvidenceDir = "C:\OpenDrSaiEvidence",
    [string]$ExpectedVersion = "1.4.6",
    [string]$RunId = "m1-sandbox",
    [switch]$StandardUserRun,
    [switch]$InstallOnly,
    [switch]$ShutdownOnComplete,
    [switch]$TestUninstall
)

$ErrorActionPreference = "Stop"

function Get-Sha256Hex([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    } finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}
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

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$currentIsElevated = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null
$startupMarker = Join-Path $EvidenceDir "sandbox-started.txt"
$transcriptPath = Join-Path $EvidenceDir "sandbox-acceptance-transcript.txt"
[IO.File]::WriteAllText($startupMarker, ((Get-Date).ToUniversalTime().ToString("o") + [Environment]::NewLine))
Start-Transcript -Path $transcriptPath -Force | Out-Null
$msiSource = Join-Path $PackageDir "OpenDrSaiSetup.sandbox.msi"
$msi = Join-Path $env:TEMP "OpenDrSaiSetup.sandbox.msi"
$runtime = Join-Path $PackageDir "OpenDrSaiRuntime-win-x64.zip"
$localRuntime = Join-Path $env:TEMP "OpenDrSaiRuntime-win-x64.zip"
$installRoot = Join-Path $env:ProgramFiles "OpenDrSai"
$statePath = Join-Path $installRoot "install-state.json"
$evidencePath = Join-Path $EvidenceDir ("windows-11-sandbox-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json")
$cernPdf = Join-Path $PackageDir "WLCG-20260715-WLCG-talk-IHEP-visit.pdf"
$fakeGatewayScript = Join-Path $PackageDir "m1-fake-gateway.py"
$expectedPdfSha256 = "f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e"

try {
    Add-Check "Windows Sandbox identity" ($(if ($env:USERNAME -eq "WDAGUtilityAccount") { "PASS" } else { "FAIL" })) $env:USERNAME
    Add-Check "Elevated installer process" ($(if ($currentIsElevated) { "PASS" } else { "FAIL" })) "elevated=$currentIsElevated"
    Add-Check "MSI exists" ($(if (Test-Path $msiSource) { "PASS" } else { "FAIL" })) $msiSource
    Add-Check "Runtime exists" ($(if (Test-Path $runtime) { "PASS" } else { "FAIL" })) $runtime
    Add-Check "CERN PDF exists" ($(if (Test-Path $cernPdf) { "PASS" } else { "FAIL" })) $cernPdf
    Add-Check "M1 gateway fixture exists" ($(if (Test-Path $fakeGatewayScript) { "PASS" } else { "FAIL" })) $fakeGatewayScript
    if (-not (Test-Path $msiSource) -or -not (Test-Path $runtime) -or -not (Test-Path $cernPdf) -or -not (Test-Path $fakeGatewayScript)) { throw "Mapped M1 acceptance artifacts are missing." }

    foreach ($command in @("node.exe", "python.exe", "git.exe")) {
        $present = [bool](Get-Command $command -ErrorAction SilentlyContinue)
        Add-Check "Clean prerequisite: $command absent" ($(if (-not $present) { "PASS" } else { "WARN" }))
    }

    Copy-Item -LiteralPath $msiSource -Destination $msi -Force
    $signature = Get-AuthenticodeSignature -LiteralPath $msi
    Add-Check "MSI signature" ($(if ($signature.Status -eq "Valid") { "PASS" } else { "WARN" })) ([string]$signature.Status)
    $runtimeHash = Get-Sha256Hex $runtime
    Add-Check "Runtime SHA256" "PASS" $runtimeHash
    $pdfHash = Get-Sha256Hex $cernPdf
    Add-Check "CERN PDF SHA256" ($(if ($pdfHash -eq $expectedPdfSha256) { "PASS" } else { "FAIL" })) $pdfHash

    if (-not (Test-Path $localRuntime) -or (Get-Sha256Hex $localRuntime) -ne $runtimeHash) {
        Copy-Item -LiteralPath $runtime -Destination $localRuntime -Force
    }
    Add-Check "Runtime copied to Sandbox disk" ($(if (Test-Path $localRuntime) { "PASS" } else { "FAIL" })) $localRuntime

    Write-Host "Installing OpenDrSai in Windows Sandbox..." -ForegroundColor Cyan
    $msiInstallLog = Join-Path $EvidenceDir "msi-install.log"
    $installer = Start-Process msiexec.exe -ArgumentList @("/i", $msi, "/qn", "/norestart", "/L*v", $msiInstallLog) -Wait -PassThru
    Add-Check "MSI process" ($(if ($installer.ExitCode -eq 0) { "PASS" } else { "FAIL" })) "exit=$($installer.ExitCode)"
    if ($installer.ExitCode -ne 0) { throw "MSI installation failed." }

    $state = Wait-ForFreshInstallState $statePath $startedAt
    Add-Check "Machine install root" ($(if ($state.installRoot -eq $installRoot) { "PASS" } else { "FAIL" })) ([string]$state.installRoot)
    Add-Check "Machine install keeps user data external" ($(if (-not $state.drsaiHome) { "PASS" } else { "FAIL" })) ([string]$state.drsaiHome)
    Add-Check "Runtime version" ($(if ($state.runtimeVersion -eq $ExpectedVersion) { "PASS" } else { "FAIL" })) ([string]$state.runtimeVersion)
    Add-Check "Desktop executable" ($(if (Test-Path $state.desktopPath) { "PASS" } else { "FAIL" })) ([string]$state.desktopPath)
    $desktopShortcut = Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) "OpenDrSai.lnk"
    $startMenuShortcut = Join-Path ([Environment]::GetFolderPath("CommonPrograms")) "OpenDrSai\OpenDrSai.lnk"
    Add-Check "Desktop shortcut" ($(if (Test-Path $desktopShortcut) { "PASS" } else { "FAIL" })) $desktopShortcut
    Add-Check "Start menu shortcut" ($(if (Test-Path $startMenuShortcut) { "PASS" } else { "FAIL" })) $startMenuShortcut
    $python = Join-Path $state.agentPath "venv\Scripts\python.exe"
    Add-Check "Bundled Python" ($(if (Test-Path $python) { "PASS" } else { "FAIL" })) $python
    $import = Invoke-Native $python @("-c", "import drsai; print('drsai import ok')")
    Add-Check "DrSai Python import" ($(if ($import.exitCode -eq 0 -and $import.output -match "drsai import ok") { "PASS" } else { "FAIL" })) $import.output
    $version = Invoke-Native $python @("-m", "drsai.backend.run_cli", "version")
    Add-Check "DrSai backend version" ($(if ($version.exitCode -eq 0 -and $version.output -match [regex]::Escape($ExpectedVersion)) { "PASS" } else { "FAIL" })) $version.output

    if ($InstallOnly) {
        $acceptanceHome = Join-Path $env:USERPROFILE ".drsai"
        New-Item -ItemType Directory -Force -Path $acceptanceHome | Out-Null
        [IO.File]::WriteAllText((Join-Path $acceptanceHome "msi-uninstall-preservation-marker.txt"), "preserve", (New-Object Text.UTF8Encoding($false)))
        Add-Check "MSI install-only acceptance" "PASS" "Application workflow checks intentionally skipped."
    } else {
    $acceptanceHome = Join-Path $env:USERPROFILE ".drsai"
    $authDir = Join-Path $acceptanceHome "auth"
    $desktopDataDir = Join-Path $acceptanceHome "desktop"
    New-Item -ItemType Directory -Force -Path $acceptanceHome, $authDir, $desktopDataDir | Out-Null
    $fixturePdf = Join-Path $acceptanceHome (Split-Path -Leaf $cernPdf)
    Copy-Item -LiteralPath $cernPdf -Destination $fixturePdf -Force
    $now = (Get-Date).ToUniversalTime()
    $auth = [ordered]@{
        authenticated = $true
        sessionId = [Guid]::NewGuid().ToString()
        createdAt = $now.ToString("o")
        expiresAt = $now.AddHours(1).ToString("o")
        authMode = "offline"
        user = [ordered]@{ id = "m1-clean-user"; email = "m1-clean-user@acceptance.local"; name = "M1 Clean User"; role = "user" }
    }
    $workspace = @([ordered]@{
        id = "workspace-m1-cern"
        name = "CERN first result"
        path = $acceptanceHome
        type = "local"
        description = "M1 clean-install CERN acceptance workspace"
        createdAt = $now.ToString("o")
        updatedAt = $now.ToString("o")
        lastOpenedAt = $now.ToString("o")
        trusted = $true
        pinned = $true
    })
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText((Join-Path $authDir "auth.json"), (($auth | ConvertTo-Json -Depth 6) + [Environment]::NewLine), $utf8NoBom)
    [IO.File]::WriteAllText((Join-Path $desktopDataDir "workspaces.json"), ((ConvertTo-Json -InputObject $workspace -Depth 6) + [Environment]::NewLine), $utf8NoBom)

    $parser = Join-Path $state.agentPath "venv\Lib\site-packages\drsai\backend\presentation_pdf.py"
    Add-Check "Bundled CERN PDF parser" ($(if (Test-Path $parser) { "PASS" } else { "FAIL" })) $parser
    if (-not (Test-Path $parser)) { throw "Bundled presentation parser is missing." }

    $gatewayPort = "18655"
    $gateway = Start-Process -FilePath $python -ArgumentList @($fakeGatewayScript) -PassThru -WindowStyle Hidden
    try {
        $gatewayReady = $false
        $gatewayDeadline = (Get-Date).AddSeconds(15)
        do {
            try {
                $health = Invoke-RestMethod -Uri "http://127.0.0.1:$gatewayPort/health" -TimeoutSec 2
                $gatewayReady = $health.status -eq "ok"
            } catch { Start-Sleep -Milliseconds 200 }
        } while (-not $gatewayReady -and (Get-Date) -lt $gatewayDeadline)
        Add-Check "Local deterministic gateway" ($(if ($gatewayReady) { "PASS" } else { "FAIL" })) "port=$gatewayPort"
        if (-not $gatewayReady) { throw "M1 local acceptance gateway did not start." }

        $resultPath = Join-Path $EvidenceDir "m1-first-cern-result.json"
        $screenshotPath = Join-Path $EvidenceDir "m1-first-cern-result.png"
        Remove-Item -LiteralPath $resultPath, $screenshotPath -Force -ErrorAction SilentlyContinue
        $appStartedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $env:DRSAI_HOME = $acceptanceHome
        $env:DRSAI_REPO = $acceptanceHome
        $env:OPENDRSAI_GATEWAY_PORT = $gatewayPort
        $env:OPENDRSAI_E2E_PRESENTATION_PDF_ACTION = "1"
        $env:OPENDRSAI_E2E_PRESENTATION_PDF_NAME = (Split-Path -Leaf $fixturePdf)
        $env:OPENDRSAI_E2E_PRESENTATION_PDF_PATH = $fixturePdf
        $env:OPENDRSAI_E2E_PRESENTATION_SCENARIO = "structured-summary"
        $env:OPENDRSAI_E2E_PRESENTATION_PHASE_DELAY_MS = "150"
        $env:OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN = "1"
        $env:OPENDRSAI_E2E_RESULT = $resultPath
        $env:OPENDRSAI_E2E_SCREENSHOT = $screenshotPath
        $env:OPENDRSAI_E2E_TIMEOUT_MS = "150000"
        $env:OPENDRSAI_E2E_APP_STARTED_MS = [string]$appStartedAt
        $env:OPENDRSAI_PDF_PYTHON = $python
        $env:OPENDRSAI_PDF_SCRIPT = $parser
        $firstTaskWatch = [Diagnostics.Stopwatch]::StartNew()
        $appProcess = Start-Process -FilePath $state.desktopPath -ArgumentList @("--no-sandbox", "--disable-gpu", "--disable-gpu-compositing", "--disable-gpu-sandbox", "--in-process-gpu") -Wait -PassThru
        $firstTaskWatch.Stop()
        Add-Check "Installed OpenDrSai process" ($(if ($appProcess.ExitCode -eq 0) { "PASS" } else { "FAIL" })) "exit=$($appProcess.ExitCode)"
        Add-Check "Automated first-task evidence" ($(if (Test-Path $resultPath) { "PASS" } else { "FAIL" })) $resultPath
        if (-not (Test-Path $resultPath)) { throw "Installed app did not produce M1 evidence." }
        $firstTask = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
        Add-Check "Authenticated first-use session" ($(if ($firstTask.checks.authenticatedUserSessionVisible) { "PASS" } else { "FAIL" }))
        Add-Check "First interactive screen <=3 seconds" ($(if ($firstTask.checks.firstInteractiveScreenWithinThreeSeconds) { "PASS" } else { "FAIL" })) "$($firstTask.details.firstInteractiveScreenMs) ms"
        Add-Check "CERN PDF task completed" ($(if ($firstTask.ok -and $firstTask.checks.generationCompleted) { "PASS" } else { "FAIL" }))
        Add-Check "First result indexed in G1 Results center" ($(if ($firstTask.checks.firstResultIndexedInResultsCenter -and $firstTask.checks.firstResultOpensFromResultsCenter) { "PASS" } else { "FAIL" })) ([string]$firstTask.details.firstResultResultsCenter.artifactId)
        Add-Check "First valid task <=3 minutes" ($(if ($firstTaskWatch.Elapsed.TotalSeconds -le 180) { "PASS" } else { "FAIL" })) ("{0:N1} seconds" -f $firstTaskWatch.Elapsed.TotalSeconds)
        Add-Check "Generated PPTX exists" ($(if (Test-Path $firstTask.details.generatedOutputPath) { "PASS" } else { "FAIL" })) ([string]$firstTask.details.generatedOutputPath)
    } finally {
        if ($gateway -and -not $gateway.HasExited) { Stop-Process -Id $gateway.Id -Force -ErrorAction SilentlyContinue }
    }
    }

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
    $machineInstallerLogs = Join-Path $env:ProgramData "OpenDrSai\Installer\logs"
    if (Test-Path -LiteralPath $machineInstallerLogs) {
        $capturedInstallerLogs = Join-Path $EvidenceDir "installer-logs"
        New-Item -ItemType Directory -Force -Path $capturedInstallerLogs | Out-Null
        Copy-Item -Path (Join-Path $machineInstallerLogs "*") -Destination $capturedInstallerLogs -Force -ErrorAction SilentlyContinue
    }
    $failed = @($results | Where-Object status -eq "FAIL")
    $evidence = [ordered]@{
        schemaVersion = 1
        generatedAt = (Get-Date).ToUniversalTime().ToString("o")
        host = "Windows Sandbox"
        os = [Environment]::OSVersion.VersionString
        expectedVersion = $ExpectedVersion
        runId = $RunId
        passed = ($failed.Count -eq 0)
        checks = $results
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($evidencePath, (($evidence | ConvertTo-Json -Depth 6) + [Environment]::NewLine), $utf8NoBom)
    Write-Host "Evidence: $evidencePath" -ForegroundColor Cyan
    Stop-Transcript | Out-Null
    if ($ShutdownOnComplete) { Start-Process shutdown.exe -ArgumentList @("/s", "/t", "0") -WindowStyle Hidden }
    if ($failed.Count -gt 0) { exit 1 }
}
