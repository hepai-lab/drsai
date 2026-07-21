param(
    [Parameter(Mandatory=$true)][string]$RuntimePath,
    [string]$HostPython = "",
    [string]$HostCodexPath = "",
    [string]$HostStateRoot = "",
    [string]$EvidenceRoot = "",
    [int]$BridgePort = 0,
    [int]$TimeoutSeconds = 1800
)

$ErrorActionPreference = "Stop"
if($BridgePort -eq 0){
    $portProbe=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
    $portProbe.Start()
    try{$BridgePort=([Net.IPEndPoint]$portProbe.LocalEndpoint).Port}finally{$portProbe.Stop()}
}
if($BridgePort -lt 1024 -or $BridgePort -gt 65535){throw "BridgePort must be 0 or an unprivileged TCP port."}
$runtime = [IO.Path]::GetFullPath($RuntimePath)
$HostPython = if($HostPython){[IO.Path]::GetFullPath($HostPython)}else{[IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\..\..\venv\Scripts\python.exe"))}
$HostCodexPath = if($HostCodexPath){[IO.Path]::GetFullPath($HostCodexPath)}else{
    Get-Process codex -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like '*\OpenAI\Codex\bin\*\codex.exe' } | Select-Object -First 1 -ExpandProperty Path
}
if(-not$HostCodexPath -or -not(Test-Path -LiteralPath $HostCodexPath -PathType Leaf)){throw "Host Codex executable was not found; pass -HostCodexPath."}
$HostStateRoot = if($HostStateRoot){[IO.Path]::GetFullPath($HostStateRoot)}else{Join-Path $env:USERPROFILE ".drsai"}
$EvidenceRoot = if($EvidenceRoot){[IO.Path]::GetFullPath($EvidenceRoot)}else{[IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\release\product-evidence\sandbox-host-codex"))}
$controller = Join-Path $PSScriptRoot "windows-sandbox-session.ps1"
$guest = Join-Path $PSScriptRoot "run-sandbox-host-codex-guest.ps1"
$verifier = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\..\..\scripts\verify-codex-runtime-online.py"))
foreach($required in @($runtime,$HostPython,$controller,$guest,$verifier)){
    if(-not(Test-Path -LiteralPath $required -PathType Leaf)){throw "Required input is missing: $required"}
}

$runId = "sandbox-host-codex-" + (Get-Date -Format "yyyyMMdd-HHmmss")
$runDir = Join-Path $EvidenceRoot $runId
$packageDir = Join-Path $runDir "package"
$evidenceDir = Join-Path $runDir "evidence"
$workspaceDir = Join-Path $runDir "workspace"
New-Item -ItemType Directory -Force -Path $packageDir,$evidenceDir,$workspaceDir | Out-Null
Copy-Item -LiteralPath $runtime -Destination (Join-Path $packageDir "OpenDrSaiRuntime-win-x64.zip") -Force
Copy-Item -LiteralPath $guest,$verifier -Destination $packageDir -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "..\..\installers\windows\install-opendrsai.ps1") -Destination $packageDir -Force
$descriptor=[ordered]@{sha256=(Get-FileHash -Algorithm SHA256 $runtime).Hash.ToLowerInvariant();size=(Get-Item $runtime).Length}
[IO.File]::WriteAllText((Join-Path $packageDir "package.json"),(($descriptor|ConvertTo-Json)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
$tokenBytes = New-Object byte[] 32
$tokenGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $tokenGenerator.GetBytes($tokenBytes) } finally { $tokenGenerator.Dispose() }
$token = [Convert]::ToBase64String($tokenBytes)
$bridgeConfig=[ordered]@{port=$BridgePort;token=$token}
[IO.File]::WriteAllText((Join-Path $packageDir "bridge.json"),(($bridgeConfig|ConvertTo-Json)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))

$bridgeStdout=Join-Path $evidenceDir "host-bridge-stdout.log"
$bridgeStderr=Join-Path $evidenceDir "host-bridge-stderr.log"
$env:OPENDRSAI_CODEX_BRIDGE_TOKEN=$token
$env:DRSAI_CODEX_DEVELOPMENT="1"
$env:CODEX_BIN=$HostCodexPath
$bridge=Start-Process -FilePath $HostPython -ArgumentList @(
    "-m","drsai.backend.codex_adapter.bridge_server","--host","0.0.0.0","--port",[string]$BridgePort,"--state-root",$HostStateRoot
) -WorkingDirectory ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\..\.."))) -WindowStyle Hidden `
    -RedirectStandardOutput $bridgeStdout -RedirectStandardError $bridgeStderr -PassThru

function Escape-Xml([string]$Value){[Security.SecurityElement]::Escape($Value)}
$packageXml=Escape-Xml $packageDir;$evidenceXml=Escape-Xml $evidenceDir;$workspaceXml=Escape-Xml $workspaceDir
$workspaceArgumentXml=Escape-Xml ('"' + $workspaceDir + '"')
$config=@"
<Configuration><VGpu>Disable</VGpu><Networking>Enable</Networking><MemoryInMB>6144</MemoryInMB><MappedFolders>
<MappedFolder><HostFolder>$packageXml</HostFolder><SandboxFolder>C:\OpenDrSaiPackage</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
<MappedFolder><HostFolder>$evidenceXml</HostFolder><SandboxFolder>C:\OpenDrSaiEvidence</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
<MappedFolder><HostFolder>$workspaceXml</HostFolder><SandboxFolder>$workspaceXml</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
</MappedFolders><LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\OpenDrSaiPackage\run-sandbox-host-codex-guest.ps1 -WorkspaceDir $workspaceArgumentXml -ShutdownOnComplete</Command></LogonCommand></Configuration>
"@
$configPath=Join-Path $runDir "$runId.wsb";[IO.File]::WriteAllText($configPath,$config,[Text.UTF8Encoding]::new($false));[xml]$config|Out-Null
$sessionId=$null
try{
    $deadline=(Get-Date).AddSeconds(30)
    while((Get-Date)-lt$deadline -and -not((Test-Path $bridgeStdout)-and((Get-Content -Raw $bridgeStdout)-match 'codex_bridge.ready'))){
        if($bridge.HasExited){throw "Host Codex Bridge exited before readiness. See $bridgeStderr"};Start-Sleep -Milliseconds 250
    }
    if(-not((Test-Path $bridgeStdout)-and((Get-Content -Raw $bridgeStdout)-match 'codex_bridge.ready'))){throw "Host Codex Bridge readiness timed out."}
    $session=(& $controller -Action Start -ConfigPath $configPath -TimeoutSeconds 120 -AsJson)|ConvertFrom-Json;$sessionId=[string]$session.id
    $resultPath=Join-Path $evidenceDir "sandbox-host-codex.json";$deadline=(Get-Date).AddSeconds($TimeoutSeconds)
    $bridgeRestarted=$false
    while(-not(Test-Path $resultPath)-and(Get-Date)-lt$deadline){
        $restartRequest=Join-Path $evidenceDir "bridge-restart-request.json"
        if(-not$bridgeRestarted -and (Test-Path $restartRequest)){
            if($bridge -and -not$bridge.HasExited){& taskkill.exe /PID $bridge.Id /T /F|Out-Null}
            $restartStdout=Join-Path $evidenceDir "host-bridge-restart-stdout.log"
            $restartStderr=Join-Path $evidenceDir "host-bridge-restart-stderr.log"
            $bridge=Start-Process -FilePath $HostPython -ArgumentList @(
                "-m","drsai.backend.codex_adapter.bridge_server","--host","0.0.0.0","--port",[string]$BridgePort,"--state-root",$HostStateRoot
            ) -WorkingDirectory ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\..\.."))) -WindowStyle Hidden `
                -RedirectStandardOutput $restartStdout -RedirectStandardError $restartStderr -PassThru
            $restartDeadline=(Get-Date).AddSeconds(30)
            while((Get-Date)-lt$restartDeadline -and -not((Test-Path $restartStdout)-and((Get-Content -Raw $restartStdout)-match 'codex_bridge.ready'))){
                if($bridge.HasExited){throw "Restarted Host Bridge exited before readiness. See $restartStderr"};Start-Sleep -Milliseconds 250
            }
            if(-not((Test-Path $restartStdout)-and((Get-Content -Raw $restartStdout)-match 'codex_bridge.ready'))){throw "Restarted Host Bridge readiness timed out."}
            [IO.File]::WriteAllText((Join-Path $evidenceDir "bridge-restart-ack.json"),'{"restarted":true}'+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
            $bridgeRestarted=$true
        }
        Start-Sleep -Milliseconds 500
    }
    if(-not(Test-Path $resultPath)){throw "Timed out waiting for Sandbox evidence."}
    $evidence=Get-Content -Raw -Encoding UTF8 $resultPath|ConvertFrom-Json
    if(-not$evidence.passed){throw "Sandbox host Codex acceptance failed: $resultPath"}
    & node.exe (Join-Path $PSScriptRoot "finalize-sandbox-host-codex-evidence.mjs") $evidenceDir
    if($LASTEXITCODE -ne 0){throw "Sandbox host Codex release evidence gate failed: $evidenceDir"}
    Write-Host "Sandbox host Codex acceptance passed: $resultPath" -ForegroundColor Green
}finally{
    if($sessionId){& $controller -Action Stop -Id $sessionId -TimeoutSeconds 60 -Force|Out-Null}
    if($bridge -and -not$bridge.HasExited){& taskkill.exe /PID $bridge.Id /T /F|Out-Null}
    Remove-Item Env:OPENDRSAI_CODEX_BRIDGE_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:DRSAI_CODEX_DEVELOPMENT -ErrorAction SilentlyContinue
    Remove-Item Env:CODEX_BIN -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $packageDir "bridge.json") -Force -ErrorAction SilentlyContinue
}
