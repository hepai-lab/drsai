param(
    [string]$ReleaseBaseUrl,
    [string]$BootstrapperPath,
    [string]$RuntimeUrlOverride,
    [switch]$RunBootstrapper,
    [switch]$LaunchApp,
    [switch]$WaitForGateway,
    [switch]$RequireBackend,
    [switch]$RequireSigned,
    [string]$ExpectedVersion,
    [int]$GatewayTimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$results = New-Object System.Collections.Generic.List[object]

function Add-Result {
    param(
        [string]$Name,
        [string]$Status,
        [string]$Detail = ""
    )
    $results.Add([pscustomobject]@{
        Name = $Name
        Status = $Status
        Detail = $Detail
    }) | Out-Null
}

function Test-Url {
    param([string]$Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -Method Head -MaximumRedirection 5 -TimeoutSec 30 -UseBasicParsing
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
    } catch {
        try {
            $response = Invoke-WebRequest -Uri $Url -Headers @{ Range = "bytes=0-0" } -MaximumRedirection 5 -TimeoutSec 30 -UseBasicParsing
            return $response.StatusCode -eq 206 -or ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400)
        } catch {
            return $false
        }
    }
}

function Get-SemanticVersion {
    param([string]$Value)
    if (-not $Value) { return "" }
    $match = [regex]::Match($Value, "\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?")
    if ($match.Success) { return $match.Value }
    return $Value.Trim()
}

function Invoke-CapturedCommand {
    param(
        [string]$FilePath,
        [string[]]$Arguments
    )
    $previousErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = & $FilePath @Arguments 2>&1
        $exitCode = $LASTEXITCODE
        return [pscustomobject]@{
            ExitCode = $exitCode
            Output = (($output | Out-String).Trim())
        }
    } catch {
        return [pscustomobject]@{
            ExitCode = 1
            Output = $_.Exception.Message
        }
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }
}

function Find-OpenDrSaiExe {
    $candidates = @(
        (Join-Path $env:ProgramFiles "OpenDrSai\app\OpenDrSai.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\OpenDrSai\app\OpenDrSai.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\OpenDrSai\OpenDrSai.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\opendrsai\OpenDrSai.exe"),
        (Join-Path $env:LOCALAPPDATA "OpenDrSai\OpenDrSai.exe"),
        (Join-Path $env:LOCALAPPDATA "OpenDrSai\app\OpenDrSai.exe")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $candidate }
    }

    $programs = Join-Path $env:LOCALAPPDATA "Programs"
    if (Test-Path $programs) {
        $found = Get-ChildItem -Path $programs -Recurse -Filter OpenDrSai.exe -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    return $null
}

Write-Host "OpenDrSai clean Windows smoke test" -ForegroundColor Cyan
Write-Host "User: $env:USERNAME"
Write-Host "Computer: $env:COMPUTERNAME"
Write-Host "OS: $([Environment]::OSVersion.VersionString)"
Write-Host ""

if ($ReleaseBaseUrl) {
    $base = $ReleaseBaseUrl.TrimEnd("/")
    try {
        $summary = Invoke-RestMethod -Uri "$base/release-summary.json" -TimeoutSec 30
        Add-Result "Public release-summary.json" "PASS" "$base/release-summary.json"
        if ($ExpectedVersion) {
            $actualSummaryVersion = Get-SemanticVersion ([string]$summary.version)
            $targetSummaryVersion = Get-SemanticVersion $ExpectedVersion
            Add-Result "Public summary version" ($(if ($actualSummaryVersion -eq $targetSummaryVersion) { "PASS" } else { "FAIL" })) "Expected $targetSummaryVersion, got $actualSummaryVersion"
        }

        $assetUrls = @(
            "$base/bootstrapper/OpenDrSaiSetup-win-x64.msi",
            "$base/bootstrapper/OpenDrSaiRuntime-win-x64.zip"
        )
        foreach ($url in $assetUrls) {
            if (Test-Url $url) {
                Add-Result "Public asset reachable" "PASS" $url
            } else {
                Add-Result "Public asset reachable" "FAIL" $url
            }
        }
        $ready = $summary.distribution.publicDistributionReady -eq $true
        Add-Result "Public distribution summary" ($(if ($ready) { "PASS" } else { "FAIL" })) "publicDistributionReady=$($summary.distribution.publicDistributionReady)"
    } catch {
        Add-Result "Public release summary" "FAIL" $_.Exception.Message
    }
} else {
    Add-Result "Public release summary" "SKIP" "Pass -ReleaseBaseUrl to validate published assets."
    Add-Result "Public distribution summary" "SKIP" "Pass -ReleaseBaseUrl to validate release-summary.json."
}

if ($BootstrapperPath) {
    if (Test-Path $BootstrapperPath) {
        Add-Result "Bootstrapper exists" "PASS" $BootstrapperPath
        $signature = Get-AuthenticodeSignature -LiteralPath $BootstrapperPath
        Add-Result "Bootstrapper signature" ($(if ($signature.Status -eq "Valid") { "PASS" } elseif ($RequireSigned) { "FAIL" } else { "WARN" })) $signature.Status
        if ($RunBootstrapper) {
            Write-Host "Running bootstrapper. Complete the installer UI if it appears..." -ForegroundColor Yellow
            $msiArgs = @("/i", $BootstrapperPath, "/passive", "/norestart")
            if ($RuntimeUrlOverride) {
                $msiArgs += "RUNTIMEURL=$RuntimeUrlOverride"
            }
            $process = Start-Process -FilePath "msiexec.exe" -ArgumentList $msiArgs -Wait -PassThru
            Add-Result "Bootstrapper process" ($(if ($process.ExitCode -eq 0) { "PASS" } else { "FAIL" })) "Exit code $($process.ExitCode)"
        }
    } else {
        Add-Result "Bootstrapper exists" "FAIL" $BootstrapperPath
    }
} else {
    Add-Result "Bootstrapper exists" "SKIP" "Pass -BootstrapperPath to validate or run the tiny installer."
}

$appExe = Find-OpenDrSaiExe
if ($appExe) {
    Add-Result "Installed OpenDrSai.exe" "PASS" $appExe
    $signature = Get-AuthenticodeSignature -LiteralPath $appExe
    Add-Result "Installed app signature" ($(if ($signature.Status -eq "Valid") { "PASS" } else { "WARN" })) $signature.Status
    if ($LaunchApp) {
        Start-Process -FilePath $appExe | Out-Null
        Add-Result "Launch OpenDrSai" "PASS" "Started $appExe"
    }
} else {
    Add-Result "Installed OpenDrSai.exe" "FAIL" "OpenDrSai.exe was not found under %PROGRAMFILES%."
}

$drsaiHome = Join-Path $env:USERPROFILE ".drsai"
$repo = Join-Path $env:ProgramFiles "OpenDrSai\drsai-agent"
$venvPython = Join-Path $repo "venv\Scripts\python.exe"
$cli = Join-Path $repo "venv\Scripts\drsai.cmd"
$logDir = Join-Path $drsaiHome "logs"
$backendStatusWhenMissing = if ($RequireBackend -or $RunBootstrapper) { "FAIL" } else { "WARN" }

Add-Result "DrSai home" ($(if (Test-Path $drsaiHome) { "PASS" } else { $backendStatusWhenMissing })) $drsaiHome
Add-Result "DrSai repository" ($(if (Test-Path $repo) { "PASS" } else { $backendStatusWhenMissing })) $repo
Add-Result "DrSai venv Python" ($(if (Test-Path $venvPython) { "PASS" } else { $backendStatusWhenMissing })) $venvPython
Add-Result "DrSai CLI wrapper" ($(if (Test-Path $cli) { "PASS" } else { $backendStatusWhenMissing })) $cli
Add-Result "Installer logs" ($(if (Test-Path $logDir) { "PASS" } else { $backendStatusWhenMissing })) $logDir

if (Test-Path $venvPython) {
    $import = Invoke-CapturedCommand -FilePath $venvPython -Arguments @("-c", "import drsai; print('drsai import ok')")
    Add-Result "DrSai Python import" ($(if ($import.ExitCode -eq 0 -and $import.Output -match "drsai import ok") { "PASS" } else { "FAIL" })) $import.Output

    $version = Invoke-CapturedCommand -FilePath $venvPython -Arguments @("-m", "drsai.backend.run_cli", "version")
    Add-Result "DrSai CLI version" ($(if ($version.ExitCode -eq 0 -and $version.Output) { "PASS" } else { "FAIL" })) $version.Output
    if ($ExpectedVersion) {
        $actualVersion = Get-SemanticVersion $version.Output
        $targetVersion = Get-SemanticVersion $ExpectedVersion
        Add-Result "DrSai backend version match" ($(if ($actualVersion -eq $targetVersion) { "PASS" } else { "FAIL" })) "Expected $targetVersion, got $actualVersion"
    }
} elseif ($RequireBackend -or $RunBootstrapper) {
    Add-Result "DrSai Python import" "FAIL" "Venv Python was not found."
    Add-Result "DrSai CLI version" "FAIL" "Venv Python was not found."
} else {
    Add-Result "DrSai Python import" "WARN" "Venv Python was not found."
    Add-Result "DrSai CLI version" "WARN" "Venv Python was not found."
}

if (Test-Path $logDir) {
    $candidateLogs = @(
        Get-ChildItem -Path $logDir -Filter "desktop-install-*.log" -ErrorAction SilentlyContinue
        Get-ChildItem -Path (Join-Path $logDir "bootstrapper") -Filter "install-*.log" -ErrorAction SilentlyContinue
    )
    $latestLog = $candidateLogs |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($latestLog) {
        $logText = Get-Content -LiteralPath $latestLog.FullName -Raw -ErrorAction SilentlyContinue
        $hasSuccess = $logText -match "DrSai installation complete|Installation complete|OpenDrSai install exited with code 0|OpenDrSai Runtime installation complete"
        Add-Result "Latest installer log success" ($(if ($hasSuccess) { "PASS" } else { "FAIL" })) $latestLog.FullName
    } else {
        Add-Result "Latest installer log success" $backendStatusWhenMissing "No current installer log found."
    }
}

if ($WaitForGateway) {
    $deadline = (Get-Date).AddSeconds($GatewayTimeoutSeconds)
    $healthReady = $false
    $modelsReady = $false
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-RestMethod -Uri "http://127.0.0.1:18642/health" -TimeoutSec 3 | Out-Null
            $healthReady = $true
        } catch {
            Start-Sleep -Seconds 3
            continue
        }
        try {
            Invoke-RestMethod -Uri "http://127.0.0.1:18642/v1/models" -TimeoutSec 3 | Out-Null
            $modelsReady = $true
            break
        } catch {
            Start-Sleep -Seconds 3
        }
    }
    Add-Result "Gateway health" ($(if ($healthReady) { "PASS" } else { "FAIL" })) "http://127.0.0.1:18642/health"
    Add-Result "Gateway models" ($(if ($modelsReady) { "PASS" } else { "FAIL" })) "http://127.0.0.1:18642/v1/models"
} else {
    Add-Result "Gateway health" "SKIP" "Pass -WaitForGateway after starting the gateway in the app."
    Add-Result "Gateway models" "SKIP" "Pass -WaitForGateway after starting the gateway in the app."
}

Write-Host ""
Write-Host "Smoke test summary" -ForegroundColor Cyan
$results | Format-Table -AutoSize

$failures = @($results | Where-Object { $_.Status -eq "FAIL" })
if ($failures.Count -gt 0) {
    exit 1
}
