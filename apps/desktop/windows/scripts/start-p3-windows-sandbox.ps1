param(
    [string] $RuntimePath = (Join-Path $PSScriptRoot "..\\release\\bootstrapper\\OpenDrSai-Windows-v1.5.6-x64.zip"),
    [string] $MsiPath = (Join-Path $PSScriptRoot "..\\release\\bootstrapper\\OpenDrSaiSetup-P3-current-source.msi"),
    [string] $EvidenceRoot = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..\\..\\..\\..\\tmp\\eval-results")).Path "p3-sandbox"),
    [switch] $DeveloperMode,
    [string] $ProviderProfilePath,
    [string] $ProviderApiKeyFile,
    [int] $TimeoutSeconds = 600
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\\..\\..\\..")).Path
$controller = Join-Path $PSScriptRoot "windows-sandbox-session.ps1"
$bootstrap = Join-Path $PSScriptRoot "bootstrap-p3-windows-sandbox.ps1"
$packagedLauncher = Join-Path $PSScriptRoot "run-p3-packaged-desktop-e2e.ps1"
$suiteRunner = Join-Path $PSScriptRoot "run-p3-packaged-sandbox-suite.cmd"
$providerStager = Join-Path $PSScriptRoot "stage-p3-developer-provider.py"
$regressionRoot = Join-Path $repoRoot "eval\regression"
foreach ($required in @($RuntimePath, $MsiPath, $controller, $bootstrap, $packagedLauncher, $suiteRunner, (Join-Path $regressionRoot "run_regression.py"))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required P3 input is missing: $required" }
}
if ($ProviderProfilePath -and -not $DeveloperMode) { throw "ProviderProfilePath is permitted only with DeveloperMode." }
if ($DeveloperMode -and -not $ProviderProfilePath) { throw "DeveloperMode requires ProviderProfilePath so its model calls remain real." }
if ($ProviderProfilePath -and -not (Test-Path -LiteralPath (Join-Path $ProviderProfilePath "config.toml") -PathType Leaf)) { throw "ProviderProfilePath must contain config.toml." }
if ($ProviderApiKeyFile -and -not $DeveloperMode) { throw "ProviderApiKeyFile is permitted only with DeveloperMode." }
if ($ProviderApiKeyFile -and -not (Test-Path -LiteralPath $ProviderApiKeyFile -PathType Leaf)) { throw "ProviderApiKeyFile is missing." }

$runId = "p3-current-source-" + (Get-Date -Format "yyyyMMdd-HHmmss")
$runRoot = Join-Path ([IO.Path]::GetFullPath($EvidenceRoot)) $runId
$packageRoot = Join-Path $runRoot "package"
$evidenceDir = Join-Path $runRoot "evidence"
$providerStageDir = Join-Path $runRoot "developer-provider-private"
New-Item -ItemType Directory -Force -Path $packageRoot, $evidenceDir | Out-Null
$runtimeDestination = Join-Path $packageRoot "OpenDrSai-Windows-v1.5.6-x64.zip"
$msiDestination = Join-Path $packageRoot "OpenDrSaiSetup-P3-current-source.msi"
Copy-Item -LiteralPath $RuntimePath -Destination $runtimeDestination -Force
Copy-Item -LiteralPath $MsiPath -Destination $msiDestination -Force
Copy-Item -LiteralPath $bootstrap -Destination (Join-Path $packageRoot "bootstrap-p3-windows-sandbox.ps1") -Force
Copy-Item -LiteralPath $packagedLauncher, $suiteRunner -Destination $packageRoot -Force
Copy-Item -LiteralPath $regressionRoot -Destination (Join-Path $packageRoot "regression") -Recurse -Force
if ($DeveloperMode) {
    if (-not (Test-Path -LiteralPath $providerStager -PathType Leaf)) { throw "Developer Provider stager is missing: $providerStager" }
    $stageArgs = @($providerStager, "--source-profile", $ProviderProfilePath, "--destination", $providerStageDir, "--provider", "zhizengzeng")
    if ($ProviderApiKeyFile) { $stageArgs += @("--api-key-file", $ProviderApiKeyFile) }
    & (Join-Path $repoRoot ".venv\Scripts\python.exe") @stageArgs | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $providerStageDir "config.toml") -PathType Leaf)) { throw "Developer Provider staging failed." }
}

$gitCommit = (git -C $repoRoot rev-parse HEAD).Trim()
$descriptor = [ordered]@{
    schemaVersion = 1
    runId = $runId
    gitCommit = $gitCommit
    gitDirty = [bool](git -C $repoRoot status --porcelain)
    runtime = [ordered]@{ file = "OpenDrSai-Windows-v1.5.6-x64.zip"; sha256 = (Get-FileHash -Algorithm SHA256 $runtimeDestination).Hash.ToLowerInvariant(); bytes = (Get-Item $runtimeDestination).Length }
    msi = [ordered]@{ file = "OpenDrSaiSetup-P3-current-source.msi"; sha256 = (Get-FileHash -Algorithm SHA256 $msiDestination).Hash.ToLowerInvariant(); bytes = (Get-Item $msiDestination).Length }
    source = "feature/desktop current worktree packaged on host"
    developerMode = [bool]$DeveloperMode
    provider = if ($DeveloperMode) { [ordered]@{ name="zhizengzeng"; source="host saved Provider configuration" } } else { $null }
}
$descriptor | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $packageRoot "p3-package.json") -Encoding UTF8
$descriptor | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $evidenceDir "host-build.json") -Encoding UTF8

function Escape-Xml([string] $value) { [Security.SecurityElement]::Escape($value) }
$packageXml = Escape-Xml $packageRoot
$evidenceXml = Escape-Xml $evidenceDir
$providerMap = ""
$providerBootstrapArg = ""
if ($DeveloperMode) {
    $providerStageXml = Escape-Xml $providerStageDir
    $providerMap = "<MappedFolder><HostFolder>$providerStageXml</HostFolder><SandboxFolder>C:\P3\developer-provider-source</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>"
    $providerBootstrapArg = " -DeveloperMode -ProviderSource C:\P3\developer-provider-source"
}
$command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\OpenDrSaiPackage\\bootstrap-p3-windows-sandbox.ps1 -PackageRoot C:\\OpenDrSaiPackage -EvidenceRoot C:\\P3\\evidence -RunId $runId$providerBootstrapArg"
$configuration = @"
<Configuration><VGpu>Disable</VGpu><Networking>Enable</Networking><MemoryInMB>6144</MemoryInMB><MappedFolders>
<MappedFolder><HostFolder>$packageXml</HostFolder><SandboxFolder>C:\OpenDrSaiPackage</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
<MappedFolder><HostFolder>$evidenceXml</HostFolder><SandboxFolder>C:\P3\evidence</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
$providerMap
</MappedFolders><LogonCommand><Command>$(Escape-Xml $command)</Command></LogonCommand></Configuration>
"@
$wsbPath = Join-Path $runRoot "$runId.wsb"
[IO.File]::WriteAllText($wsbPath, $configuration, [Text.UTF8Encoding]::new($false))
$session = (& $controller -Action Start -ConfigPath $wsbPath -TimeoutSeconds 120 -AsJson) | ConvertFrom-Json
[ordered]@{ runId = $runId; sessionId = [string]$session.id; package = $packageRoot; evidence = $evidenceDir; config = $wsbPath; status = "started" } | ConvertTo-Json -Depth 4
