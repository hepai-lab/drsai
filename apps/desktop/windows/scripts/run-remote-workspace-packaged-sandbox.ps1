param(
    [string]$PackageDir = "C:\OpenDrSaiPackage",
    [string]$SecretDir = "C:\OpenDrSaiTemporarySecrets",
    [string]$EvidenceDir = "C:\OpenDrSaiEvidence",
    [string]$HostAddress,
    [int]$SshPort = 22224,
    [string]$RunId = "remote-workspace-packaged-sandbox",
    [switch]$ShutdownOnComplete
)

$ErrorActionPreference = "Stop"
$checks = [Collections.Generic.List[object]]::new()
$startedAt = [DateTime]::UtcNow
$evidencePath = Join-Path $EvidenceDir "remote-workspace-packaged-sandbox.json"
$appProcess = $null
$resultDetail = $null

function Add-Check([string]$Name, [bool]$Passed, [string]$Detail = "") {
    $checks.Add([pscustomobject]@{ name = $Name; status = $(if ($Passed) { "PASS" } else { "FAIL" }); detail = $Detail }) | Out-Null
}

function Wait-Json([string]$Path, [int]$Seconds = 300) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        if (Test-Path -LiteralPath $Path) { try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } catch {} }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)
    throw "Timed out waiting for JSON: $Path"
}

function Invoke-Cdp([string]$WebSocketUrl, [string]$Expression) {
    $socket = [Net.WebSockets.ClientWebSocket]::new()
    try {
        $socket.ConnectAsync([Uri]$WebSocketUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        function Send-Cdp([int]$Id, [string]$Method, [object]$Params, [string]$SessionId = "") {
            $message = @{ id = $Id; method = $Method; params = $Params }
            if ($SessionId) { $message.sessionId = $SessionId }
            $bytes = [Text.Encoding]::UTF8.GetBytes(($message | ConvertTo-Json -Depth 10 -Compress))
            $socket.SendAsync([ArraySegment[byte]]::new($bytes), [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        }
        function Receive-Cdp([int]$Id) {
            $buffer = New-Object byte[] 65536
            while ($true) {
                $stream = [IO.MemoryStream]::new()
                do {
                    $received = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
                    if ($received.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close) { throw "CDP socket closed before returning a result." }
                    $stream.Write($buffer, 0, $received.Count)
                } while (-not $received.EndOfMessage)
                $message = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
                if ($message.id -eq $Id) { return $message }
            }
        }
        $sessionId = ""
        if ($WebSocketUrl -match "/devtools/browser/") {
            Send-Cdp 1 "Target.getTargets" @{}
            $targets = Receive-Cdp 1
            $page = @($targets.result.targetInfos | Where-Object type -eq "page" | Select-Object -First 1)[0]
            if (-not $page) { throw "Browser CDP endpoint has no renderer page target." }
            Send-Cdp 2 "Target.attachToTarget" @{ targetId = [string]$page.targetId; flatten = $true }
            $attached = Receive-Cdp 2
            $sessionId = [string]$attached.result.sessionId
        }
        Send-Cdp 3 "Runtime.evaluate" @{ expression = $Expression; awaitPromise = $true; returnByValue = $true } $sessionId
        $evaluated = Receive-Cdp 3
        if ($evaluated.result.exceptionDetails) {
            $description = [string]$evaluated.result.exceptionDetails.exception.description
            throw $(if ($description) { $description } else { [string]$evaluated.result.exceptionDetails.text })
        }
        return $evaluated.result.result.value
    } finally {
        $socket.Dispose()
    }
}

New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null
try {
    Add-Check "Windows Sandbox identity" ($env:USERNAME -eq "WDAGUtilityAccount") $env:USERNAME
    $msi = Join-Path $PackageDir "OpenDrSaiSetup.sandbox.msi"
    $runtime = Join-Path $PackageDir "OpenDrSaiRuntime-win-x64.zip"
    $artifactManifest = Get-Content -LiteralPath (Join-Path $PackageDir "runtime-artifact.json") -Raw | ConvertFrom-Json
    Add-Check "Mapped Desktop MSI and Runtime" ((Test-Path $msi) -and (Test-Path $runtime)) $PackageDir
    Add-Check "Temporary signed Runtime artifact" ($artifactManifest.temporaryCredential -eq $true) ([string]$artifactManifest.version)
    $localMsi = Join-Path $env:TEMP "OpenDrSaiSetup.sandbox.msi"
    $localRuntime = Join-Path $env:TEMP "OpenDrSaiRuntime-win-x64.zip"
    Copy-Item $msi $localMsi -Force
    Copy-Item $runtime $localRuntime -Force
    $install = Start-Process msiexec.exe -ArgumentList @("/i", $localMsi, "/qn", "/norestart", "/L*v", (Join-Path $EvidenceDir "msi-install.log")) -Wait -PassThru
    Add-Check "Packaged Desktop installed" ($install.ExitCode -eq 0) "exit=$($install.ExitCode)"
    if ($install.ExitCode -ne 0) { throw "MSI installation failed." }
    $state = Wait-Json "C:\Program Files\OpenDrSai\install-state.json" 300
    $desktop = [string]$state.desktopPath
    Add-Check "Installed Desktop executable" (Test-Path $desktop) $desktop

    $localKey = Join-Path $env:TEMP "opendrsai-packaged-e2e-key"
    Copy-Item (Join-Path $SecretDir "opendrsai-acceptance-temporary") $localKey -Force
    & icacls.exe $localKey /inheritance:r /grant:r "$($env:USERNAME):(R)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not secure the temporary SSH private key." }
    $sshConfig = Join-Path $env:TEMP "opendrsai-packaged-e2e-ssh-config"
    [IO.File]::WriteAllText($sshConfig, @"
Host opendrsai-packaged-e2e
  HostName $HostAddress
  Port $SshPort
  User vscode
  IdentityFile $localKey
  IdentitiesOnly yes
  StrictHostKeyChecking no
  UserKnownHostsFile NUL
  LogLevel ERROR
"@, [Text.UTF8Encoding]::new($false))

    $env:DRSAI_HOME = Join-Path $env:USERPROFILE ".drsai-packaged-e2e"
    $env:DRSAI_REPO = "C:\OpenDrSaiLocal"
    $env:OPENDRSAI_DEV_AUTH_BYPASS = "1"
    $env:OPENDRSAI_SSH_CONFIG = $sshConfig
    $env:OPENDRSAI_RUNTIME_TRUST_STORE = Join-Path $PackageDir ([string]$artifactManifest.trustStore)
    $localWorkspace = "C:\OpenDrSaiLocal"
    New-Item -ItemType Directory -Force -Path $localWorkspace | Out-Null
    [IO.File]::WriteAllText((Join-Path $localWorkspace "local.txt"), "LOCAL_WORKSPACE_OK", [Text.UTF8Encoding]::new($false))
    $cdpProfile = Join-Path $env:TEMP "OpenDrSaiCdpProfile"
    Remove-Item $cdpProfile -Recurse -Force -ErrorAction SilentlyContinue
    $appProcess = Start-Process -FilePath $desktop -ArgumentList @("--remote-debugging-port=0", "--user-data-dir=$cdpProfile", "--no-sandbox", "--disable-gpu", "--disable-gpu-sandbox") -PassThru
    $target = $null
    $debugPort = 0
    $deadline = (Get-Date).AddSeconds(90)
    do {
        $portFile = Join-Path $cdpProfile "DevToolsActivePort"
        if ($debugPort -eq 0 -and (Test-Path $portFile)) {
            $portLines = @(Get-Content $portFile)
            $debugPort = [int]$portLines[0]
            if ($portLines.Count -gt 1) { $target = [pscustomobject]@{ webSocketDebuggerUrl = "ws://127.0.0.1:$debugPort$($portLines[1])" } }
        }
        if (-not $target -and $debugPort -gt 0) { try { $target = @(Invoke-RestMethod "http://127.0.0.1:$debugPort/json/list" -TimeoutSec 2 | Where-Object type -eq "page")[0] } catch {} }
        if (-not $target) { Start-Sleep -Milliseconds 500 }
    } while (-not $target -and (Get-Date) -lt $deadline)
    if (-not $target) { $appProcess.Refresh(); throw "Packaged Desktop did not expose its renderer CDP target (processExited=$($appProcess.HasExited), exitCode=$(if($appProcess.HasExited){$appProcess.ExitCode}else{'running'}), port=$debugPort)." }

    $loginResult = Invoke-Cdp ([string]$target.webSocketDebuggerUrl) "(async () => { const result = await window.openDrSai.login({ developerBypass: true, rememberMe: false }); return { ok: result?.ok === true }; })()"
    Add-Check "Packaged Desktop temporary acceptance login" ([bool]$loginResult.ok) "offline developer session"
    if (-not $loginResult.ok) { throw "Packaged Desktop temporary acceptance login failed." }
    Invoke-Cdp ([string]$target.webSocketDebuggerUrl) "window.location.reload(); true" | Out-Null
    Start-Sleep -Seconds 3

    $hostLiteral = ConvertTo-Json "opendrsai-packaged-e2e" -Compress
    $localLiteral = ConvertTo-Json $localWorkspace -Compress
    $versionLiteral = ConvertTo-Json ([string]$artifactManifest.version) -Compress
    $wheelLiteral = ConvertTo-Json (Join-Path $PackageDir ([string]$artifactManifest.wheel)) -Compress
    $shaLiteral = ConvertTo-Json ([string]$artifactManifest.sha256) -Compress
    $publisherLiteral = ConvertTo-Json ([string]$artifactManifest.publisher) -Compress
    $signatureLiteral = ConvertTo-Json ([string]$artifactManifest.signature) -Compress
    $expression = @"
(async () => {
  const api = window.openDrSai;
  const checks = {};
  const detail = {};
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (find, timeout = 20000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = find(); if (value) return value; await wait(50); } return null; };
  if (!api) throw new Error('window.openDrSai is unavailable');
  checks.authenticatedProductUi = Boolean(await waitFor(() => document.querySelector('.app-shell')));
  const local = await api.createWorkspace({ source: 'existing', path: $localLiteral, name: 'Local acceptance', trusted: true });
  checks.localWorkspace = local.location === 'local' && local.path === $localLiteral;
  const hosts = await api.listSshHosts();
  checks.remoteHostListed = hosts.some(h => h.alias === $hostLiteral);
  const keys = await api.inspectSshHostKeys($hostLiteral);
  checks.hostFingerprint = keys.length > 0 && keys.every(k => String(k.fingerprint).startsWith('SHA256:'));
  checks.hostApproved = await api.approveSshHostKey($hostLiteral);
  const preflightBefore = await api.preflightRemoteGateway($hostLiteral);
  detail.preflightBefore = preflightBefore;
  const install = await api.installRemoteGateway({ hostAlias: $hostLiteral, action: 'install', version: $versionLiteral, artifactPath: $wheelLiteral, artifactSha256: $shaLiteral, artifactPublisher: $publisherLiteral, artifactSignature: $signatureLiteral });
  checks.runtimeInstall = install.changed === true && install.currentRelease === $versionLiteral;
  const dirs = await api.listRemoteDirectories($hostLiteral, '/home/vscode');
  checks.remoteDirectoryPicker = dirs.some(d => d.path === '/home/vscode/workspace');
  let remote;
  try {
    remote = await api.connectRemoteWorkspace({ hostAlias: $hostLiteral, path: '/home/vscode/workspace', name: 'Remote acceptance', trusted: true });
  } catch (error) {
    detail.connectError = String(error?.stack || error);
    detail.sshDiagnostics = await api.getRemoteSshDiagnosticReport().catch(e => ({ diagnosticError: String(e) }));
    throw new Error('Remote connect failed: ' + JSON.stringify(detail));
  }
  let status = await api.getRemoteWorkspaceStatus(remote.id);
  checks.remoteConnected = status.connected === true && status.gatewayReady === true;
  const all = await api.listWorkspaces();
  checks.localRemoteModel = all.some(w => w.id === local.id && w.location === 'local') && all.some(w => w.id === remote.id && w.location === 'remote');
  const files = await api.listWorkspaceFiles({ workspacePath: remote.path, workspaceId: remote.id, maxDepth: 3 });
  checks.remoteFiles = files.nodes.some(n => n.name === 'tracked.txt');
  const preview = await api.previewWorkspaceFile({ workspacePath: remote.path, workspaceId: remote.id, path: remote.path + '/tracked.txt' });
  checks.remotePreview = String(preview.content || '').includes('tracked');
  const thread = await api.createThread({ kind: 'chat', title: 'Remote packaged acceptance', workspacePath: remote.path });
  const events = [];
  const stopEvents = api.onChatEvent(e => events.push(e));
  const requestId = 'sandboxremote' + Date.now();
  await api.startChat({ requestId, threadId: thread.id, workspacePath: remote.path, workspaceId: remote.id, model: 'drsai', messages: [{ role: 'user', content: 'Reply with REMOTE_WORKSPACE_RESULT.' }] });
  for (let i = 0; i < 40 && !events.some(e => e.requestId === requestId && e.type === 'start'); i++) await wait(250);
  await wait(1000);
  checks.chatAbortRequested = (await api.cancelChatTurn({ requestId })).accepted;
  for (let i = 0; i < 80 && !events.some(e => e.requestId === requestId && (e.type === 'done' || e.type === 'error' || e.type === 'aborted')); i++) await wait(250);
  stopEvents();
  checks.sessionRunEvents = events.some(e => e.requestId === requestId && e.type === 'start') && events.some(e => e.requestId === requestId && (e.type === 'done' || e.type === 'error' || e.type === 'aborted'));
  const snapshot = await api.getThreadSnapshot(thread.id);
  const remoteThreads = await api.listRemoteThreads(remote.id);
  const desktopThreads = await api.listThreads();
  checks.resultView = Boolean(snapshot || remoteThreads.some(t => t.id === thread.id) || desktopThreads.some(t => t.id === thread.id && t.lastRunId === requestId));
  const terminal = await api.createTerminal({ workspacePath: remote.path, workspaceId: remote.id, cwd: remote.path, cols: 80, rows: 24 });
  const proposal = await api.requestShellCommandApproval({ terminalSessionId: terminal.id, commandId: 'sandbox-approval', command: 'touch approval-marker', invocation: 'touch approval-marker', risk: 'high' });
  const pending = await api.listPendingApprovals();
  const approval = proposal.approval || pending.find(p => p.id === proposal.approval?.id || p.terminalSessionId === terminal.id);
  checks.approvalQueued = proposal.requiresApproval === true && Boolean(approval);
  if (approval) checks.approvalDecision = await api.decidePendingApproval({ id: approval.id, approved: false, reason: 'cancel' });
  else checks.approvalDecision = false;
  await api.killTerminal(terminal.id);
  await api.disconnectRemoteWorkspace(remote.id);
  try {
    remote = await api.connectRemoteWorkspace({ hostAlias: $hostLiteral, path: '/home/vscode/workspace', name: 'Remote acceptance', trusted: true });
  } catch (error) {
    detail.reconnectError = String(error?.stack || error);
    detail.reconnectDiagnostics = await api.getRemoteSshDiagnosticReport().catch(e => ({ diagnosticError: String(e) }));
    throw new Error('Remote reconnect failed: ' + JSON.stringify(detail));
  }
  status = await api.getRemoteWorkspaceStatus(remote.id);
  checks.reconnected = status.connected === true;
  detail.remote = remote;
  detail.chatEvents = events.map(e => ({ type: e.type, error: e.error || null }));
  detail.desktopThreads = desktopThreads.filter(t => t.id === thread.id);
  detail.remoteThreads = remoteThreads;
  detail.bodyText = document.body.innerText.slice(0, 4000);
  checks.renderedWorkspace = Boolean(document.querySelector('.app-shell')) && detail.bodyText.includes('OpenDrSaiLocal');
  await api.disconnectRemoteWorkspace(remote.id);
  return { checks, detail, passed: Object.values(checks).every(Boolean) };
})()
"@
    $result = Invoke-Cdp ([string]$target.webSocketDebuggerUrl) $expression
    $resultDetail = $result.detail
    foreach ($property in $result.checks.psobject.Properties) { Add-Check ("Packaged UI: " + $property.Name) ([bool]$property.Value) "" }
    if (-not $result.passed) { throw "One or more packaged Desktop remote-workspace checks failed." }
} catch {
    Add-Check "Packaged remote-workspace execution" $false $_.Exception.Message
} finally {
    if ($appProcess -and -not $appProcess.HasExited) { Stop-Process -Id $appProcess.Id -Force -ErrorAction SilentlyContinue }
    $failed = @($checks | Where-Object status -eq "FAIL")
    $evidence = [ordered]@{ schemaVersion = 1; runId = $RunId; generatedAt = [DateTime]::UtcNow.ToString("o"); durationSeconds = [math]::Round(([DateTime]::UtcNow - $startedAt).TotalSeconds, 2); temporaryCredential = $true; passed = ($failed.Count -eq 0); checks = $checks; detail = $resultDetail }
    [IO.File]::WriteAllText($evidencePath, (($evidence | ConvertTo-Json -Depth 8) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    Remove-Item (Join-Path $env:TEMP "opendrsai-packaged-e2e-key") -Force -ErrorAction SilentlyContinue
    if ($ShutdownOnComplete) { Start-Process shutdown.exe -ArgumentList @('/s','/t','0') -WindowStyle Hidden }
    if ($failed.Count -gt 0) { exit 1 }
}
