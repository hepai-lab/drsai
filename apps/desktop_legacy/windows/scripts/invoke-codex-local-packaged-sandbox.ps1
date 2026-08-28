param(
    [Parameter(Mandatory=$true)][string]$RuntimePath,
    [string]$EvidenceRoot = "",
    [int]$TimeoutSeconds = 900
)

$ErrorActionPreference = "Stop"
$EvidenceRoot = if ($EvidenceRoot) { [IO.Path]::GetFullPath($EvidenceRoot) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\release\product-evidence\codex-local-packaged-sandbox")) }
$runtime = [IO.Path]::GetFullPath($RuntimePath)
$controller = Join-Path $PSScriptRoot "windows-sandbox-session.ps1"
$guest = Join-Path $PSScriptRoot "run-codex-local-packaged-sandbox.ps1"
foreach ($required in @($runtime, $controller, $guest)) { if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required Sandbox input is missing: $required" } }
$runId = "codex-local-packaged-" + (Get-Date -Format "yyyyMMdd-HHmmss")
$runDir = [IO.Path]::GetFullPath((Join-Path $EvidenceRoot $runId))
$packageDir = Join-Path $runDir "package"; $evidenceDir = Join-Path $runDir "evidence"
New-Item -ItemType Directory -Force -Path $packageDir, $evidenceDir | Out-Null
Copy-Item -LiteralPath $runtime -Destination (Join-Path $packageDir "OpenDrSaiRuntime-win-x64.zip") -Force
Copy-Item -LiteralPath $guest -Destination $packageDir -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "..\installer\install-opendrsai.ps1") -Destination $packageDir -Force
$descriptor = [ordered]@{ sha256 = (Get-FileHash -Algorithm SHA256 $runtime).Hash.ToLowerInvariant(); size = (Get-Item $runtime).Length }
[IO.File]::WriteAllText((Join-Path $packageDir "package.json"), (($descriptor | ConvertTo-Json) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
function Escape-Xml([string]$Value) { [Security.SecurityElement]::Escape($Value) }
$packageXml = Escape-Xml $packageDir; $evidenceXml = Escape-Xml $evidenceDir
$config = @"
<Configuration>
  <VGpu>Disable</VGpu><Networking>Disable</Networking><MemoryInMB>6144</MemoryInMB>
  <MappedFolders>
    <MappedFolder><HostFolder>$packageXml</HostFolder><SandboxFolder>C:\OpenDrSaiPackage</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$evidenceXml</HostFolder><SandboxFolder>C:\OpenDrSaiEvidence</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\OpenDrSaiPackage\run-codex-local-packaged-sandbox.ps1 -ShutdownOnComplete</Command></LogonCommand>
</Configuration>
"@
$configPath = Join-Path $runDir "$runId.wsb"
[IO.File]::WriteAllText($configPath, $config, [Text.UTF8Encoding]::new($false)); [xml]$config | Out-Null
$sessionId = $null
try {
    $session = (& $controller -Action Start -ConfigPath $configPath -TimeoutSeconds 120 -AsJson) | ConvertFrom-Json
    $sessionId = [string]$session.id
    $evidencePath = Join-Path $evidenceDir "codex-local-packaged-sandbox.json"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while (-not (Test-Path -LiteralPath $evidencePath) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
    if (-not (Test-Path -LiteralPath $evidencePath)) { throw "Timed out waiting for Codex Sandbox evidence." }
    $evidence = Get-Content -Raw -Encoding UTF8 $evidencePath | ConvertFrom-Json
    if (-not $evidence.passed) { throw "Codex Sandbox acceptance failed: $evidencePath" }
    Write-Host "Codex offline packaged Sandbox acceptance passed: $evidencePath" -ForegroundColor Green
} finally {
    if ($sessionId) { & $controller -Action Stop -Id $sessionId -TimeoutSeconds 60 -Force | Out-Null }
}
