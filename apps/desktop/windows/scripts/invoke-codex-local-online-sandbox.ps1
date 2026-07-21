param(
    [Parameter(Mandatory=$true)][string]$RuntimePath,
    [string]$EvidenceRoot = "",
    [int]$TimeoutSeconds = 1800,
    [switch]$OpenBrowser
)

$ErrorActionPreference = "Stop"
$EvidenceRoot = if ($EvidenceRoot) { [IO.Path]::GetFullPath($EvidenceRoot) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\release\product-evidence\codex-local-online-sandbox")) }
$runtime = [IO.Path]::GetFullPath($RuntimePath)
$controller = Join-Path $PSScriptRoot "windows-sandbox-session.ps1"
$guest = Join-Path $PSScriptRoot "run-codex-local-online-sandbox.ps1"
$verifier = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\..\..\scripts\verify-codex-runtime-online.py"))
foreach ($required in @($runtime,$controller,$guest,$verifier)) { if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required input is missing: $required" } }
$runId = "codex-local-online-" + (Get-Date -Format "yyyyMMdd-HHmmss")
$runDir = Join-Path $EvidenceRoot $runId; $packageDir = Join-Path $runDir "package"; $evidenceDir = Join-Path $runDir "evidence"
New-Item -ItemType Directory -Force -Path $packageDir,$evidenceDir | Out-Null
Copy-Item $runtime (Join-Path $packageDir "OpenDrSaiRuntime-win-x64.zip") -Force
Copy-Item $guest,$verifier $packageDir -Force
Copy-Item (Join-Path $PSScriptRoot "..\..\installers\windows\install-opendrsai.ps1") $packageDir -Force
$descriptor=[ordered]@{sha256=(Get-FileHash -Algorithm SHA256 $runtime).Hash.ToLowerInvariant();size=(Get-Item $runtime).Length}
[IO.File]::WriteAllText((Join-Path $packageDir "package.json"),(($descriptor|ConvertTo-Json)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
function Escape-Xml([string]$Value){[Security.SecurityElement]::Escape($Value)}
$packageXml=Escape-Xml $packageDir; $evidenceXml=Escape-Xml $evidenceDir
$config=@"
<Configuration><VGpu>Disable</VGpu><Networking>Enable</Networking><MemoryInMB>6144</MemoryInMB><MappedFolders>
<MappedFolder><HostFolder>$packageXml</HostFolder><SandboxFolder>C:\OpenDrSaiPackage</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
<MappedFolder><HostFolder>$evidenceXml</HostFolder><SandboxFolder>C:\OpenDrSaiEvidence</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
</MappedFolders><LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\OpenDrSaiPackage\run-codex-local-online-sandbox.ps1 -ShutdownOnComplete</Command></LogonCommand></Configuration>
"@
$configPath=Join-Path $runDir "$runId.wsb"; [IO.File]::WriteAllText($configPath,$config,[Text.UTF8Encoding]::new($false));[xml]$config|Out-Null
$sessionId=$null
try {
    $session=(& $controller -Action Start -ConfigPath $configPath -TimeoutSeconds 120 -AsJson)|ConvertFrom-Json;$sessionId=[string]$session.id
    $authPath=Join-Path $evidenceDir "auth-request.json"; $resultPath=Join-Path $evidenceDir "codex-local-online-sandbox.json"
    $deadline=(Get-Date).AddSeconds($TimeoutSeconds); $announced=$false
    while (-not (Test-Path $resultPath) -and (Get-Date) -lt $deadline) {
        if (-not $announced -and (Test-Path $authPath)) {
            $auth=Get-Content -Raw -Encoding UTF8 $authPath|ConvertFrom-Json
            $url=if($auth.verificationUrl){[string]$auth.verificationUrl}else{[string]$auth.authUrl}
            Write-Host "Complete Codex device login: $url  code=$($auth.userCode)" -ForegroundColor Yellow
            if($OpenBrowser -and $url){Start-Process $url}
            $announced=$true
        }
        Start-Sleep -Seconds 1
    }
    if(-not(Test-Path $resultPath)){throw "Timed out waiting for online Codex Sandbox evidence."}
    $evidence=Get-Content -Raw -Encoding UTF8 $resultPath|ConvertFrom-Json
    if(-not $evidence.passed){throw "Online Codex Sandbox acceptance failed: $resultPath"}
    Write-Host "Online Codex Sandbox acceptance passed: $resultPath" -ForegroundColor Green
} finally { if($sessionId){& $controller -Action Stop -Id $sessionId -TimeoutSeconds 60 -Force|Out-Null} }
