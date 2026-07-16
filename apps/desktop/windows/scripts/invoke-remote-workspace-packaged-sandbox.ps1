param(
    [string]$EvidenceRoot = "$PSScriptRoot\..\release\product-evidence\remote-workspace-packaged-sandbox",
    [int]$SshPort = 22224,
    [int]$TimeoutSeconds = 900,
    [switch]$KeepLab
)

$ErrorActionPreference = "Stop"
$desktop = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$repo = [IO.Path]::GetFullPath((Join-Path $desktop "..\..\.."))
$runtime = Join-Path $desktop "release\bootstrapper\OpenDrSaiRuntime-win-x64.zip"
$sessionController = Join-Path $PSScriptRoot "windows-sandbox-session.ps1"
$guest = Join-Path $PSScriptRoot "run-remote-workspace-packaged-sandbox.ps1"
$runId = "remote-workspace-packaged-" + (Get-Date -Format "yyyyMMdd-HHmmss")
$runDir = [IO.Path]::GetFullPath((Join-Path $EvidenceRoot $runId))
$packageDir = Join-Path $runDir "package"
$secretDir = Join-Path $runDir "temporary-secrets"
$evidenceDir = Join-Path $runDir "evidence"
$keyPath = Join-Path $secretDir "opendrsai-acceptance-temporary"
$container = "opendrsai-remote-workspace-packaged-lab"
$image = "opendrsai-real-remote-gateway:local"
$sandboxSessionId = $null

function Escape-Xml([string]$Value) { [Security.SecurityElement]::Escape($Value) }
function Invoke-Checked([string]$Command, [string[]]$Arguments, [string]$WorkingDirectory = $desktop) {
    $process = Start-Process -FilePath $Command -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -Wait -PassThru -NoNewWindow
    if ($process.ExitCode -ne 0) { throw "$Command failed with exit code $($process.ExitCode)" }
}

foreach ($required in @($runtime, $sessionController, $guest)) { if (-not (Test-Path $required)) { throw "Required packaged Sandbox input is missing: $required" } }
New-Item -ItemType Directory -Force -Path $packageDir, $secretDir, $evidenceDir | Out-Null
try {
    & ssh-keygen.exe -q -t ed25519 -N '""' -C "opendrsai-packaged-acceptance-temporary:$runId" -f $keyPath
    if ($LASTEXITCODE -ne 0) { throw "Could not generate the temporary packaged-Sandbox SSH key." }
    $publicKey = (Get-Content "$keyPath.pub" -Raw).Trim()
    [IO.File]::WriteAllText((Join-Path $secretDir "TEMPORARY_CREDENTIAL.txt"), "Temporary OpenDrSai packaged acceptance credential. Delete after run: $runId`r`n", [Text.UTF8Encoding]::new($false))

    & node (Join-Path $PSScriptRoot "prepare-remote-workspace-sandbox-artifact.mjs") $packageDir
    if ($LASTEXITCODE -ne 0) { throw "Could not prepare the temporary signed Runtime artifact." }
    Copy-Item $runtime (Join-Path $packageDir "OpenDrSaiRuntime-win-x64.zip") -Force
    Copy-Item $guest $packageDir -Force
    $hash = (Get-FileHash $runtime -Algorithm SHA256).Hash.ToLowerInvariant()
    $size = (Get-Item $runtime).Length
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $desktop "..\installers\windows\build-msi.ps1") -OutDir $packageDir -RuntimePath $runtime -RuntimeUrl "https://acceptance.invalid/OpenDrSaiRuntime-win-x64.zip" -RuntimeSha256 $hash -RuntimeSizeBytes $size -BootstrapperVersion "1.4.6" -OutputName "OpenDrSaiSetup.sandbox.msi"
    if ($LASTEXITCODE -ne 0) { throw "Could not build the local-only packaged Sandbox MSI." }

    $buildAuthorizedKeys = Join-Path $repo "apps\desktop\windows\tests\remote-ssh\authorized_keys"
    $hadBuildAuthorizedKeys = Test-Path $buildAuthorizedKeys
    $previousBuildAuthorizedKeys = if ($hadBuildAuthorizedKeys) { [IO.File]::ReadAllBytes($buildAuthorizedKeys) } else { $null }
    try {
        [IO.File]::WriteAllText($buildAuthorizedKeys, $publicKey + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
        & docker build -f "apps/desktop/windows/tests/remote-ssh/Dockerfile.real" -t $image $repo
        if ($LASTEXITCODE -ne 0) { throw "Could not build the real Runtime Docker fixture." }
    } finally {
        if ($hadBuildAuthorizedKeys) { [IO.File]::WriteAllBytes($buildAuthorizedKeys, $previousBuildAuthorizedKeys) }
        else { Remove-Item $buildAuthorizedKeys -Force -ErrorAction SilentlyContinue }
    }
    $existing = & docker ps -aq --filter "name=^/${container}$"
    if ($existing) { & docker rm -f $container | Out-Null }
    & docker run -d --name $container --label "ai.opendrsai.purpose=temporary-packaged-acceptance" -p "0.0.0.0:${SshPort}:22" $image | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not start the real Runtime Docker fixture." }
    $publicKey | & docker exec -i $container sh -lc "cat > /home/vscode/.ssh/authorized_keys && chown vscode:vscode /home/vscode/.ssh/authorized_keys && chmod 600 /home/vscode/.ssh/authorized_keys"
    if ($LASTEXITCODE -ne 0) { throw "Could not install the temporary key in the real Runtime fixture." }

    $hostAddress = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } | ForEach-Object { $_.IPv4Address.IPAddress } | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' } | Select-Object -First 1
    if (-not $hostAddress) { throw "A routable host address was not found." }
    $packageXml = Escape-Xml $packageDir; $secretXml = Escape-Xml $secretDir; $evidenceXml = Escape-Xml $evidenceDir
    $command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\OpenDrSaiPackage\run-remote-workspace-packaged-sandbox.ps1 -HostAddress $hostAddress -SshPort $SshPort -RunId $runId -ShutdownOnComplete"
    $wsb = @"
<Configuration>
  <VGpu>Disable</VGpu><Networking>Enable</Networking><MemoryInMB>6144</MemoryInMB>
  <MappedFolders>
    <MappedFolder><HostFolder>$packageXml</HostFolder><SandboxFolder>C:\OpenDrSaiPackage</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$secretXml</HostFolder><SandboxFolder>C:\OpenDrSaiTemporarySecrets</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$evidenceXml</HostFolder><SandboxFolder>C:\OpenDrSaiEvidence</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>$command</Command></LogonCommand>
</Configuration>
"@
    $wsbPath = Join-Path $runDir "$runId.wsb"
    [IO.File]::WriteAllText($wsbPath, $wsb, [Text.UTF8Encoding]::new($false)); [xml]$wsb | Out-Null
    $session = (& $sessionController -Action Start -ConfigPath $wsbPath -TimeoutSeconds 120 -AsJson) | ConvertFrom-Json
    $sandboxSessionId = [string]$session.id
    $evidencePath = Join-Path $evidenceDir "remote-workspace-packaged-sandbox.json"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while (-not (Test-Path $evidencePath) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
    if (-not (Test-Path $evidencePath)) { throw "Timed out waiting for packaged Sandbox evidence." }
    $evidence = Get-Content $evidencePath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $evidence.passed) { throw "Packaged Sandbox remote-workspace E2E failed: $evidencePath" }
    Write-Host "Packaged Sandbox remote-workspace E2E passed: $evidencePath" -ForegroundColor Green
} finally {
    if ($sandboxSessionId) { & $sessionController -Action Stop -Id $sandboxSessionId -TimeoutSeconds 60 -Force | Out-Null }
    if (-not $KeepLab) {
        $existing = & docker ps -aq --filter "name=^/${container}$"
        if ($existing) { & docker rm -f $container | Out-Null }
        Remove-Item $secretDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
