param(
    [string]$OutDir = "$PSScriptRoot\..\..\windows\release\bootstrapper",
    [string]$DesktopAppDir = "$PSScriptRoot\..\..\windows\release\win-unpacked",
    [string]$DrsaiAgentDir = "",
    [string]$DrsaiHomeDefaultsDir = "",
    [string]$Version = "",
    [string]$Channel = "dev"
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath([string]$Path) {
    if (Test-Path $Path) {
        return (Resolve-Path $Path).Path
    }
    return [System.IO.Path]::GetFullPath($Path)
}

function Copy-DirectoryContents([string]$Source, [string]$Destination) {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Copy-Item -Path (Join-Path $Source "*") -Destination $Destination -Recurse -Force
}

$windowsAppDir = Resolve-FullPath (Join-Path $PSScriptRoot "..\..\windows")
if (-not $Version) {
    $Version = (Get-Content (Join-Path $windowsAppDir "package.json") -Raw | ConvertFrom-Json).version
}
if ($Channel -notin @("stable", "beta", "dev")) {
    throw "Unsupported channel: $Channel"
}

$desktopAppDir = Resolve-FullPath $DesktopAppDir
if (-not (Test-Path (Join-Path $desktopAppDir "OpenDrSai.exe"))) {
    throw "Desktop app was not found: $(Join-Path $desktopAppDir "OpenDrSai.exe")."
}

if (-not $DrsaiAgentDir) {
    $candidates = @(
        (Join-Path $windowsAppDir ".tmp\bootstrapper-msi3\.drsai\drsai-agent"),
        (Join-Path $windowsAppDir ".tmp\bootstrapper-exe\.drsai\drsai-agent"),
        (Join-Path $env:USERPROFILE ".drsai\drsai-agent")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path (Join-Path $candidate "venv\Scripts\python.exe")) {
            $DrsaiAgentDir = $candidate
            break
        }
    }
}
if (-not $DrsaiAgentDir) {
    throw "DrsaiAgentDir is required. Provide a prepared drsai-agent directory with venv."
}
$drsaiAgentDir = Resolve-FullPath $DrsaiAgentDir
if (-not (Test-Path (Join-Path $drsaiAgentDir "venv\Scripts\python.exe"))) {
    throw "DrsaiAgentDir is missing venv\Scripts\python.exe: $drsaiAgentDir"
}
if (-not (Test-Path (Join-Path $drsaiAgentDir "venv\Scripts\drsai.cmd"))) {
    throw "DrsaiAgentDir is missing venv\Scripts\drsai.cmd: $drsaiAgentDir"
}

$outDir = Resolve-FullPath $OutDir
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$workRoot = Join-Path $outDir "opendrsai-runtime-work"
$payloadRoot = Join-Path $workRoot "OpenDrSaiRuntime-win-x64"
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $workRoot
New-Item -ItemType Directory -Force -Path $payloadRoot | Out-Null

Copy-DirectoryContents $desktopAppDir (Join-Path $payloadRoot "app")
Copy-DirectoryContents $drsaiAgentDir (Join-Path $payloadRoot "drsai-agent")

$homeDefaultsTarget = Join-Path $payloadRoot "drsai-home"
New-Item -ItemType Directory -Force -Path $homeDefaultsTarget | Out-Null
if ($DrsaiHomeDefaultsDir -and (Test-Path $DrsaiHomeDefaultsDir)) {
    Copy-DirectoryContents (Resolve-FullPath $DrsaiHomeDefaultsDir) $homeDefaultsTarget
} else {
    $agentParent = Split-Path -Parent $drsaiAgentDir
    foreach ($name in @(".env", "config.yaml")) {
        $candidate = Join-Path $agentParent $name
        if (Test-Path $candidate) {
            Copy-Item -LiteralPath $candidate -Destination (Join-Path $homeDefaultsTarget $name) -Force
        }
    }
}

$manifest = [ordered]@{
    name = "OpenDrSai Runtime"
    version = $Version
    channel = $Channel
    platform = "windows-x64"
    layoutVersion = 1
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    entrypoints = [ordered]@{
        desktop = "app/OpenDrSai.exe"
        python = "drsai-agent/venv/Scripts/python.exe"
        drsai = "drsai-agent/venv/Scripts/drsai.cmd"
        gateway = "drsai-agent/venv/Scripts/drsai-gateway.cmd"
    }
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText(
    (Join-Path $payloadRoot "opendrsai-runtime.json"),
    (($manifest | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
    $utf8NoBom
)

$runtimeZip = Join-Path $outDir "OpenDrSaiRuntime-win-x64.zip"
Remove-Item -LiteralPath $runtimeZip -Force -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $payloadRoot,
    $runtimeZip,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
)
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $workRoot

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $runtimeZip).Hash.ToLowerInvariant()
$size = (Get-Item -LiteralPath $runtimeZip).Length
Write-Host "Built $runtimeZip" -ForegroundColor Green
Write-Host "  sha256: $hash"
Write-Host "  size:   $size"
