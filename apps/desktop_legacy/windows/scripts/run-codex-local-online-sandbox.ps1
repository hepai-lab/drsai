param(
    [string]$PackageDir = "C:\OpenDrSaiPackage",
    [string]$EvidenceDir = "C:\OpenDrSaiEvidence",
    [switch]$ShutdownOnComplete
)

$ErrorActionPreference = "Stop"
$checks = [Collections.Generic.List[object]]::new()
$evidencePath = Join-Path $EvidenceDir "codex-local-online-sandbox.json"
function Add-Check([string]$Name, [bool]$Passed, [string]$Detail = "") {
    $checks.Add([pscustomobject]@{ name = $Name; status = $(if ($Passed) { "PASS" } else { "FAIL" }); detail = $Detail }) | Out-Null
}
function Start-Gateway([string]$Python, [string]$StateRoot, [string]$LogPrefix) {
    $env:DRSAI_HOME = $StateRoot
    $env:OPENDRSAI_DEV_AUTH_BYPASS = "1"
    $env:PYTHONUTF8 = "1"
    return Start-Process -FilePath $Python -ArgumentList @("-m", "drsai.backend.run_cli", "gateway", "--port", "18642", "--host", "127.0.0.1") `
        -WindowStyle Hidden -RedirectStandardOutput ($LogPrefix + "-stdout.log") `
        -RedirectStandardError ($LogPrefix + "-stderr.log") -PassThru
}
function Invoke-Verifier([string]$Python, [string[]]$Arguments, [string]$LogPrefix) {
    $process = Start-Process -FilePath $Python -ArgumentList $Arguments -WindowStyle Hidden `
        -RedirectStandardOutput ($LogPrefix + "-stdout.log") `
        -RedirectStandardError ($LogPrefix + "-stderr.log") -PassThru -Wait
    return $process.ExitCode
}

New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null
$gateway = $null
try {
    Add-Check "Windows Sandbox identity" ($env:USERNAME -eq "WDAGUtilityAccount") $env:USERNAME
    $networked = @(Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object IPv4DefaultGateway).Count -gt 0
    Add-Check "Networking enabled for account Turn" $networked "defaultGateway=$networked"
    $descriptor = Get-Content -Raw -Encoding UTF8 (Join-Path $PackageDir "package.json") | ConvertFrom-Json
    $zip = Join-Path $PackageDir "OpenDrSaiRuntime-win-x64.zip"
    $actualHash = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant()
    if ($actualHash -ne [string]$descriptor.sha256) { throw "Runtime digest mismatch." }
    $installRoot = "C:\OpenDrSai"; $stateRoot = "C:\OpenDrSaiHome"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PackageDir "install-opendrsai.ps1") `
        -RuntimeUrl ([Uri]$zip).AbsoluteUri -RuntimeSha256 $actualHash -RuntimeSizeBytes ([int64]$descriptor.size) `
        -InstallRoot $installRoot -DrsaiHome $stateRoot -BootstrapperVersion "1.4.6" -NoShortcuts -NoLaunch -Quiet
    if ($LASTEXITCODE -ne 0) { throw "Runtime installation failed." }
    $python = Join-Path $installRoot "drsai-agent\venv\Scripts\python.exe"
    $verifier = Join-Path $PackageDir "verify-codex-runtime-online.py"
    $state = Join-Path $EvidenceDir "runtime-state.json"
    $authRequest = Join-Path $EvidenceDir "auth-request.json"
    $executeResult = Join-Path $EvidenceDir "execute-result.json"
    $recoverResult = Join-Path $EvidenceDir "recover-result.json"

    $gateway = Start-Gateway $python $stateRoot (Join-Path $EvidenceDir "gateway-execute")
    $executeExit = Invoke-Verifier $python @($verifier,"--phase","execute","--workspace","C:\OpenDrSaiWorkspace","--runtime-state-root",$stateRoot,"--state",$state,"--auth-request",$authRequest,"--open-login-browser","--result",$executeResult) (Join-Path $EvidenceDir "verifier-execute")
    if ($executeExit -ne 0) { throw "Live Codex Runtime execution phase failed with exit code $executeExit." }
    Add-Check "Codex completion, approval and cancel" (Test-Path $executeResult) "Runtime Protocol"
    if (-not $gateway.HasExited) { & taskkill.exe /PID $gateway.Id /T /F | Out-Null; $gateway.WaitForExit(30000) | Out-Null }
    $gateway.Dispose(); $gateway = Start-Gateway $python $stateRoot (Join-Path $EvidenceDir "gateway-recover")
    $recoverExit = Invoke-Verifier $python @($verifier,"--phase","recover","--state",$state,"--result",$recoverResult) (Join-Path $EvidenceDir "verifier-recover")
    if ($recoverExit -ne 0) { throw "Live Codex Runtime recovery phase failed with exit code $recoverExit." }
    $recovered = Get-Content -Raw -Encoding UTF8 $recoverResult | ConvertFrom-Json
    Add-Check "Runtime restart recovery" ($recovered.passed -and $recovered.recovered) (($recovered.statuses -join ","))
} catch {
    Add-Check "Online Sandbox execution" $false $_.Exception.Message
} finally {
    if ($gateway -and -not $gateway.HasExited) { & taskkill.exe /PID $gateway.Id /T /F | Out-Null }
    Remove-Item -LiteralPath (Join-Path $EvidenceDir "auth-request.json") -Force -ErrorAction SilentlyContinue
    $failed = @($checks | Where-Object status -eq "FAIL")
    $evidence = [ordered]@{ schemaVersion=1; generatedAt=[DateTime]::UtcNow.ToString("o"); passed=($failed.Count -eq 0); checks=$checks }
    [IO.File]::WriteAllText($evidencePath, (($evidence | ConvertTo-Json -Depth 6) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    if ($ShutdownOnComplete) { Start-Process shutdown.exe -ArgumentList @('/s','/t','0') -WindowStyle Hidden }
    if ($failed.Count -gt 0) { exit 1 }
}
