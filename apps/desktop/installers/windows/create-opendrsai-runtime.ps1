param(
    [string]$OutDir = "$PSScriptRoot\..\..\windows\release\bootstrapper",
    [string]$DesktopAppDir = "$PSScriptRoot\..\..\windows\release\win-unpacked",
    [string]$DrsaiAgentDir = "",
    [string]$BackendSourceDir = "$PSScriptRoot\..\..\..\..\cores\python\packages\drsai\src\drsai",
    [string]$DrsaiHomeDefaultsDir = "",
    [string]$Version = "",
    [string]$Channel = "dev"
)

$ErrorActionPreference = "Stop"

function Get-Sha256Hex([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    } finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}

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

function Remove-PythonCaches([string]$Root) {
    Get-ChildItem -LiteralPath $Root -Recurse -Directory -Filter "__pycache__" -Force -ErrorAction SilentlyContinue |
        Sort-Object { $_.FullName.Length } -Descending |
        Remove-Item -Recurse -Force
    Get-ChildItem -LiteralPath $Root -Recurse -File -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -in @(".pyc", ".pyo") } |
        Remove-Item -Force
}

function Remove-NodePtyBuildSources([string]$AppRoot) {
    $nodePty = Join-Path $AppRoot "resources\app.asar.unpacked\node_modules\node-pty"
    if (-not (Test-Path -LiteralPath $nodePty)) { return }
    foreach ($name in @("build", "deps", "node-addon-api", "scripts", "src")) {
        $candidate = Join-Path $nodePty $name
        if (Test-Path -LiteralPath $candidate) {
            Remove-Item -LiteralPath $candidate -Recurse -Force
        }
    }
}

function Add-PortablePythonBase([string]$SourceAgent, [string]$TargetAgent) {
    $sourceVenv = Join-Path $SourceAgent "venv"
    $targetVenv = Join-Path $TargetAgent "venv"
    $configPath = Join-Path $sourceVenv "pyvenv.cfg"
    $homeLine = Get-Content -LiteralPath $configPath | Where-Object { $_ -match '^home\s*=' } | Select-Object -First 1
    if (-not $homeLine) { throw "pyvenv.cfg does not declare a Python home: $configPath" }
    $pythonHome = ($homeLine -split '=', 2)[1].Trim()
    if (-not (Test-Path (Join-Path $pythonHome "python.exe"))) {
        throw "Python base runtime was not found: $pythonHome"
    }

    foreach ($directory in @("DLLs", "libs", "tcl")) {
        $source = Join-Path $pythonHome $directory
        if (Test-Path $source) { Copy-DirectoryContents $source (Join-Path $targetVenv $directory) }
    }
    $sourceLib = Join-Path $pythonHome "Lib"
    Get-ChildItem -LiteralPath $sourceLib -Force |
        Where-Object { $_.Name -ne "site-packages" } |
        ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $targetVenv "Lib") -Recurse -Force }
    foreach ($pattern in @("python*.exe", "python*.dll", "vcruntime*.dll", "LICENSE.txt")) {
        Get-ChildItem -LiteralPath $pythonHome -Filter $pattern -File -ErrorAction SilentlyContinue |
            Copy-Item -Destination $targetVenv -Force
    }
}

function Set-RelocatablePythonLauncher([string]$TargetAgent) {
    $venvRoot = Join-Path $TargetAgent "venv"
    $scriptsDir = Join-Path $venvRoot "Scripts"
    New-Item -ItemType Directory -Force -Path $scriptsDir | Out-Null

    # A venv launcher records the absolute Python home from the build machine in
    # pyvenv.cfg. Older OpenDrSai updaters execute that launcher before they can
    # repair the configuration, so a CI-produced runtime would fail validation
    # on every customer machine. Replace it with the bundled base launcher and
    # an isolated, relative search path that remains valid after extraction.
    foreach ($name in @("python.exe", "pythonw.exe", "python3.exe", "python3.dll", "python311.dll", "vcruntime140.dll", "vcruntime140_1.dll")) {
        $source = Join-Path $venvRoot $name
        if (Test-Path -LiteralPath $source -PathType Leaf) {
            Copy-Item -LiteralPath $source -Destination (Join-Path $scriptsDir $name) -Force
        }
    }

    Remove-Item -LiteralPath (Join-Path $venvRoot "pyvenv.cfg") -Force -ErrorAction SilentlyContinue

    $relativePaths = [Collections.Generic.List[string]]::new()
    foreach ($path in @("..\Lib", "..\DLLs", "..\Lib\site-packages")) {
        $relativePaths.Add($path)
    }
    $sitePackages = Join-Path $venvRoot "Lib\site-packages"
    Get-ChildItem -LiteralPath $sitePackages -Filter "*.pth" -File -ErrorAction SilentlyContinue | ForEach-Object {
        foreach ($line in Get-Content -LiteralPath $_.FullName) {
            $entry = $line.Trim()
            if (-not $entry -or $entry.StartsWith("#") -or $entry -match '^import\s') { continue }
            if ([IO.Path]::IsPathRooted($entry)) {
                throw "Runtime dependency path must be relative: $($_.FullName): $entry"
            }
            $candidate = Join-Path $sitePackages $entry
            if (Test-Path -LiteralPath $candidate) {
                $normalized = "..\Lib\site-packages\" + $entry.Replace("/", "\")
                if (-not $relativePaths.Contains($normalized)) { $relativePaths.Add($normalized) }
            }
        }
    }
    [IO.File]::WriteAllLines(
        (Join-Path $scriptsDir "python311._pth"),
        $relativePaths,
        (New-Object Text.UTF8Encoding($false))
    )
}

function Materialize-CurrentDrsaiPackage([string]$AgentRoot, [string]$SourceDir) {
    $sitePackages = Join-Path $AgentRoot "venv\Lib\site-packages"
    Get-ChildItem -LiteralPath $sitePackages -Filter "*drsai*.pth" -File -ErrorAction SilentlyContinue |
        Remove-Item -Force
    Get-ChildItem -LiteralPath $sitePackages -Filter "drsai-*.dist-info" -Directory -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force
    $target = Join-Path $sitePackages "drsai"
    Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
    Copy-DirectoryContents $SourceDir $target
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
$backendSourceDir = Resolve-FullPath $BackendSourceDir
if (-not (Test-Path (Join-Path $backendSourceDir "version.py"))) {
    throw "Current DrSai backend source was not found: $backendSourceDir"
}
Write-Host "Using prepared DrSai agent: $drsaiAgentDir" -ForegroundColor DarkGray
Write-Host "Using current DrSai source: $backendSourceDir" -ForegroundColor DarkGray
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
Remove-NodePtyBuildSources (Join-Path $payloadRoot "app")
# The development agent may contain projects, caches, downloaded apps, or user
# files alongside its venv. Only the managed Python runtime belongs in a
# redistributable archive.
Copy-DirectoryContents (Join-Path $drsaiAgentDir "venv") (Join-Path $payloadRoot "drsai-agent\venv")
Materialize-CurrentDrsaiPackage (Join-Path $payloadRoot "drsai-agent") $backendSourceDir
Remove-PythonCaches (Join-Path $payloadRoot "drsai-agent")
Add-PortablePythonBase $drsaiAgentDir (Join-Path $payloadRoot "drsai-agent")
Set-RelocatablePythonLauncher (Join-Path $payloadRoot "drsai-agent")

$payloadPython = Join-Path $payloadRoot "drsai-agent\venv\Scripts\python.exe"
$originalLocation = Get-Location
try {
    Set-Location ([IO.Path]::GetTempPath())
    $versionOutput = (& $payloadPython -W ignore -m drsai.backend.run_cli version 2>&1 | Out-String).Trim()
} finally {
    Set-Location $originalLocation
}
if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch [regex]::Escape($Version)) {
    throw "Materialized backend version does not match runtime $Version. Output: $versionOutput"
}
Write-Host "Verified materialized backend version: $versionOutput" -ForegroundColor DarkGray
Remove-PythonCaches (Join-Path $payloadRoot "drsai-agent")
$pythonCacheFiles = @(Get-ChildItem -LiteralPath (Join-Path $payloadRoot "drsai-agent") -Recurse -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.PSIsContainer -and $_.Name -eq "__pycache__" -or -not $_.PSIsContainer -and $_.Extension -in @(".pyc", ".pyo") })
if ($pythonCacheFiles.Count -gt 0) {
    throw "Python cache cleanup was incomplete; found $($pythonCacheFiles.Count) cache path(s)."
}

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

$hash = Get-Sha256Hex $runtimeZip
$size = (Get-Item -LiteralPath $runtimeZip).Length
Write-Host "Built $runtimeZip" -ForegroundColor Green
Write-Host "  sha256: $hash"
Write-Host "  size:   $size"
