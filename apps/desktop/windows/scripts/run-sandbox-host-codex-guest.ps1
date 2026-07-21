param(
    [string]$PackageDir = "C:\OpenDrSaiPackage",
    [string]$EvidenceDir = "C:\OpenDrSaiEvidence",
    [string]$WorkspaceDir = "C:\OpenDrSaiWorkspace",
    [switch]$ShutdownOnComplete
)

$ErrorActionPreference = "Stop"
$checks = [Collections.Generic.List[object]]::new()
$resultPath = Join-Path $EvidenceDir "sandbox-host-codex.json"
function Add-Check([string]$Name, [bool]$Passed, [string]$Detail = "") {
    $checks.Add([pscustomobject]@{name=$Name;status=$(if($Passed){"PASS"}else{"FAIL"});detail=$Detail}) | Out-Null
}

New-Item -ItemType Directory -Force -Path $EvidenceDir,$WorkspaceDir | Out-Null
$gateway = $null
try {
    Add-Check "Windows Sandbox identity" ($env:USERNAME -eq "WDAGUtilityAccount") $env:USERNAME
    $bridgeConfig = Get-Content -Raw -Encoding UTF8 (Join-Path $PackageDir "bridge.json") | ConvertFrom-Json
    $routeOutput = & route.exe print -4 0.0.0.0
    $defaultRoute = $routeOutput | Where-Object { $_ -match '^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d{1,3}(?:\.\d{1,3}){3})\s+' } | Select-Object -First 1
    if (-not $defaultRoute) { throw "Sandbox host gateway was not discovered from the IPv4 route table." }
    [void]($defaultRoute -match '^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d{1,3}(?:\.\d{1,3}){3})\s+')
    $hostAddress = $Matches[1]
    $bridgeUrl = "tcp://${hostAddress}:$($bridgeConfig.port)"

    $descriptor = Get-Content -Raw -Encoding UTF8 (Join-Path $PackageDir "package.json") | ConvertFrom-Json
    $runtimeZip = Join-Path $PackageDir "OpenDrSaiRuntime-win-x64.zip"
    $actualHash = (Get-FileHash -Algorithm SHA256 $runtimeZip).Hash.ToLowerInvariant()
    if ($actualHash -ne [string]$descriptor.sha256) { throw "Runtime digest mismatch." }
    $installRoot = "C:\OpenDrSai"
    $stateRoot = "C:\OpenDrSaiHome"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PackageDir "install-opendrsai.ps1") `
        -RuntimeUrl ([Uri]$runtimeZip).AbsoluteUri -RuntimeSha256 $actualHash -RuntimeSizeBytes ([int64]$descriptor.size) `
        -InstallRoot $installRoot -DrsaiHome $stateRoot -BootstrapperVersion "1.4.8" -NoShortcuts -NoLaunch -Quiet
    if ($LASTEXITCODE -ne 0) { throw "Runtime installation failed." }

    $python = Join-Path $installRoot "drsai-agent\venv\Scripts\python.exe"
    $env:DRSAI_HOME = $stateRoot
    $env:OPENDRSAI_DEV_AUTH_BYPASS = "1"
    $env:OPENDRSAI_CODEX_BRIDGE_URL = $bridgeUrl
    $env:OPENDRSAI_CODEX_BRIDGE_TOKEN = [string]$bridgeConfig.token
    $env:PYTHONUTF8 = "1"
    $gateway = Start-Process -FilePath $python -ArgumentList @("-m","drsai.backend.run_cli","gateway","--port","18642","--host","127.0.0.1") `
        -WindowStyle Hidden -RedirectStandardOutput (Join-Path $EvidenceDir "gateway-stdout.log") `
        -RedirectStandardError (Join-Path $EvidenceDir "gateway-stderr.log") -PassThru
    $verifier = Join-Path $PackageDir "verify-codex-runtime-online.py"
    $state = Join-Path $EvidenceDir "runtime-state.json"
    $execute = Join-Path $EvidenceDir "execute-result.json"
    $auth = Join-Path $EvidenceDir "unexpected-auth-request.json"
    $verify = Start-Process -FilePath $python -ArgumentList @(
        $verifier,"--phase","execute","--workspace",$WorkspaceDir,"--runtime-state-root",$stateRoot,
        "--state",$state,"--auth-request",$auth,"--result",$execute,"--allow-no-approval"
    ) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $EvidenceDir "verifier-stdout.log") `
        -RedirectStandardError (Join-Path $EvidenceDir "verifier-stderr.log") -PassThru -Wait
    Add-Check "Host Bridge reachable" ($verify.ExitCode -eq 0) $bridgeUrl
    Add-Check "Host account reused without guest login" (-not (Test-Path $auth)) "auth request absent"
    if ($verify.ExitCode -ne 0) { throw "Host Codex Bridge execution failed with exit code $($verify.ExitCode)." }
    $executed = Get-Content -Raw -Encoding UTF8 $execute | ConvertFrom-Json
    Add-Check "Archive and unarchive roundtrip" ([bool]$executed.archive_roundtrip) "Runtime and Codex Thread"
    $multiTurnPassed = $executed.multi_turn.context_retained -and `
        $executed.multi_turn.thread_id -and `
        ($executed.multi_turn.first_turn_id -ne $executed.multi_turn.second_turn_id)
    Add-Check "Multi-turn reuses one Codex Thread" ([bool]$multiTurnPassed) "session=$($executed.multi_turn.session_id); thread=$($executed.multi_turn.thread_id)"

    if($gateway -and -not$gateway.HasExited){& taskkill.exe /PID $gateway.Id /T /F|Out-Null;$gateway.WaitForExit(30000)|Out-Null}
    $gateway.Dispose();$gateway=$null
    $restartRequest=Join-Path $EvidenceDir "bridge-restart-request.json"
    [IO.File]::WriteAllText($restartRequest,'{"requested":true}'+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
    $restartAck=Join-Path $EvidenceDir "bridge-restart-ack.json";$restartDeadline=(Get-Date).AddSeconds(60)
    while(-not(Test-Path $restartAck)-and(Get-Date)-lt$restartDeadline){Start-Sleep -Milliseconds 250}
    if(-not(Test-Path $restartAck)){throw "Host Bridge restart acknowledgement timed out."}

    $recoverPort=18644
    $gateway = Start-Process -FilePath $python -ArgumentList @("-m","drsai.backend.run_cli","gateway","--port",[string]$recoverPort,"--host","127.0.0.1") `
        -WindowStyle Hidden -RedirectStandardOutput (Join-Path $EvidenceDir "gateway-recover-stdout.log") `
        -RedirectStandardError (Join-Path $EvidenceDir "gateway-recover-stderr.log") -PassThru
    $account=$null;$accountError="";$accountDeadline=(Get-Date).AddSeconds(60)
    while(-not$account -and(Get-Date)-lt$accountDeadline){
        try{$account=Invoke-RestMethod -Uri "http://127.0.0.1:$recoverPort/v1/agent-backends/codex/account?refresh=true" -Method Get -TimeoutSec 15}
        catch{
            $accountError=$_.Exception.Message
            if($_.Exception.Response){
                try{$reader=[IO.StreamReader]::new($_.Exception.Response.GetResponseStream());$accountError=$reader.ReadToEnd();$reader.Dispose()}catch{}
            }
            Start-Sleep -Seconds 2
        }
    }
    if(-not$account){throw "Host account did not recover after Bridge restart: $accountError"}
    Add-Check "Runtime and Bridge restart recovery" ($account.logged_in -eq $true) "host account reconnected"
    $recover=Join-Path $EvidenceDir "recover-result.json"
    $recoverProcess=Start-Process -FilePath $python -ArgumentList @($verifier,"--base-url","http://127.0.0.1:$recoverPort","--phase","recover","--state",$state,"--result",$recover) `
        -WindowStyle Hidden -RedirectStandardOutput (Join-Path $EvidenceDir "recover-stdout.log") `
        -RedirectStandardError (Join-Path $EvidenceDir "recover-stderr.log") -PassThru -Wait
    if($recoverProcess.ExitCode -ne 0){throw "Runtime recovery verification failed with exit code $($recoverProcess.ExitCode)."}
} catch {
    Add-Check "Sandbox host Codex acceptance" $false $_.Exception.Message
} finally {
    if ($gateway -and -not $gateway.HasExited) { & taskkill.exe /PID $gateway.Id /T /F | Out-Null }
    $failed = @($checks | Where-Object status -eq "FAIL")
    $evidence = [ordered]@{schemaVersion=1;generatedAt=[DateTime]::UtcNow.ToString("o");passed=($failed.Count -eq 0);checks=$checks}
    [IO.File]::WriteAllText($resultPath,(($evidence|ConvertTo-Json -Depth 6)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
    if ($ShutdownOnComplete) { Start-Process shutdown.exe -ArgumentList @('/s','/t','0') -WindowStyle Hidden }
    if ($failed.Count -gt 0) { exit 1 }
}
