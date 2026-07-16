param(
    [string]$EvidenceRoot = "$PSScriptRoot\..\release\product-evidence\remote-workspace-lab",
    [int]$SshPort = 22224,
    [ValidateRange(60, 600)]
    [int]$TimeoutSeconds = 180,
    [switch]$KeepLab
)

$ErrorActionPreference = "Stop"
$sessionController = Join-Path $PSScriptRoot "windows-sandbox-session.ps1"
$guestProbe = Join-Path $PSScriptRoot "run-remote-workspace-sandbox-probe.ps1"
$labDir = Join-Path $PSScriptRoot "..\tests\remote-workspace-lab"
$runId = "remote-workspace-" + (Get-Date -Format "yyyyMMdd-HHmmss")
$runDir = [IO.Path]::GetFullPath((Join-Path $EvidenceRoot $runId))
$packageDir = Join-Path $runDir "package"
$secretDir = Join-Path $runDir "temporary-secrets"
$evidenceDir = Join-Path $runDir "evidence"
$keyPath = Join-Path $secretDir "opendrsai-acceptance-temporary"
$containerName = "opendrsai-remote-workspace-lab"
$imageName = "opendrsai-remote-workspace-lab:local"
$sandboxSessionId = $null

function Escape-Xml([string]$Value) { return [Security.SecurityElement]::Escape($Value) }
function Invoke-Checked([string]$FilePath, [string[]]$Arguments) {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$FilePath failed with exit code $LASTEXITCODE" }
}

New-Item -ItemType Directory -Force -Path $packageDir, $secretDir, $evidenceDir | Out-Null
Copy-Item -LiteralPath $guestProbe -Destination $packageDir -Force
$portableOpenSshDir = Join-Path $packageDir "openssh"
New-Item -ItemType Directory -Force -Path $portableOpenSshDir | Out-Null
foreach ($item in @(
    @{ name = "ssh.exe"; source = "System32\OpenSSH\ssh.exe" },
    @{ name = "ssh-keyscan.exe"; source = "System32\OpenSSH\ssh-keyscan.exe" },
    @{ name = "libcrypto.dll"; source = "System32\libcrypto.dll" },
    @{ name = "LICENSE.txt"; source = "System32\OpenSSH\LICENSE.txt" },
    @{ name = "NOTICE.txt"; source = "System32\OpenSSH\NOTICE.txt" }
)) {
    $name = $item.name
    $source = Join-Path $env:WINDIR $item.source
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Host OpenSSH client file is missing: $source" }
    Copy-Item -LiteralPath $source -Destination (Join-Path $portableOpenSshDir $name) -Force
}

try {
    # Windows PowerShell 5.1 drops a native empty-string argument, so pass the
    # conventional quoted empty passphrase explicitly.
    Invoke-Checked "ssh-keygen.exe" @("-q", "-t", "ed25519", "-N", '""', "-C", "opendrsai-acceptance-temporary:$runId", "-f", $keyPath)
    $publicKey = (Get-Content -LiteralPath "$keyPath.pub" -Raw -Encoding UTF8).Trim()
    [IO.File]::WriteAllText((Join-Path $secretDir "TEMPORARY_CREDENTIAL.txt"), "Temporary OpenDrSai acceptance credential. Delete after run: $runId`r`n", [Text.UTF8Encoding]::new($false))

    Invoke-Checked "docker.exe" @("build", "-t", $imageName, $labDir)
    $existingContainer = & docker.exe ps -aq --filter "name=^/${containerName}$"
    if ($existingContainer) { & docker.exe rm -f $containerName | Out-Null }
    Invoke-Checked "docker.exe" @("run", "-d", "--name", $containerName, "--label", "ai.opendrsai.purpose=temporary-acceptance", "-e", "OPENDRSAI_TEMPORARY_AUTHORIZED_KEY=$publicKey", "-p", "0.0.0.0:${SshPort}:22", $imageName)

    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
        & docker.exe exec $containerName sh -lc "sshd -t" 2>$null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw "Temporary Linux SSH target did not become ready." }

    $hostAddress = Get-NetIPConfiguration |
        Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } |
        ForEach-Object { $_.IPv4Address.IPAddress } |
        Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' } |
        Select-Object -First 1
    if (-not $hostAddress) { throw "A routable host IPv4 address was not found." }

    $packageXml = Escape-Xml $packageDir
    $secretXml = Escape-Xml $secretDir
    $evidenceXml = Escape-Xml $evidenceDir
    $command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command `$env:OPENDRSAI_PORTABLE_OPENSSH_DIR='C:\OpenDrSaiPackage\openssh'; &amp; 'C:\OpenDrSaiPackage\run-remote-workspace-sandbox-probe.ps1' -RunId '$runId' -SshPort $SshPort -HostAddress '$hostAddress' -ShutdownOnComplete"
    $wsb = @"
<Configuration>
  <VGpu>Disable</VGpu>
  <Networking>Enable</Networking>
  <MemoryInMB>4096</MemoryInMB>
  <MappedFolders>
    <MappedFolder><HostFolder>$packageXml</HostFolder><SandboxFolder>C:\OpenDrSaiPackage</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$secretXml</HostFolder><SandboxFolder>C:\OpenDrSaiTemporarySecrets</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$evidenceXml</HostFolder><SandboxFolder>C:\OpenDrSaiEvidence</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>$command</Command></LogonCommand>
</Configuration>
"@
    $wsbPath = Join-Path $runDir "$runId.wsb"
    [IO.File]::WriteAllText($wsbPath, $wsb, [Text.UTF8Encoding]::new($false))
    [xml](Get-Content -LiteralPath $wsbPath -Raw -Encoding UTF8) | Out-Null

    $sessionJson = & $sessionController -Action Start -ConfigPath $wsbPath -TimeoutSeconds 120 -AsJson
    if ($LASTEXITCODE -ne 0) { throw "Windows Sandbox failed to start." }
    $session = $sessionJson | ConvertFrom-Json
    $sandboxSessionId = [string]$session.id

    $evidencePath = Join-Path $evidenceDir "remote-workspace-sandbox-probe.json"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while (-not (Test-Path -LiteralPath $evidencePath) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
    if (-not (Test-Path -LiteralPath $evidencePath)) { throw "Timed out waiting for Sandbox evidence." }
    $evidence = Get-Content -LiteralPath $evidencePath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $evidence.passed) { throw "Sandbox to Docker SSH probe failed. Evidence: $evidencePath" }
    Write-Host "Remote workspace Sandbox probe passed: $evidencePath" -ForegroundColor Green
} finally {
    if ($sandboxSessionId) {
        & $sessionController -Action Stop -Id $sandboxSessionId -TimeoutSeconds 60 | Out-Null
    }
    if (-not $KeepLab) {
        $existingContainer = & docker.exe ps -aq --filter "name=^/${containerName}$"
        if ($existingContainer) { & docker.exe rm -f $containerName | Out-Null }
        Remove-Item -LiteralPath $secretDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
