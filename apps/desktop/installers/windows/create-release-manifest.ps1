param(
    [Parameter(Mandatory = $true)]
    [string]$BaseUrl,
    [string]$OutDir = "",
    [string]$ArtifactDir = "",
    [string]$Version = "",
    [string]$Channel = "stable"
)

$ErrorActionPreference = "Stop"

if (-not $OutDir) {
    $OutDir = Join-Path $PSScriptRoot "..\..\windows\release\bootstrapper"
}
if (-not $ArtifactDir) {
    $ArtifactDir = Join-Path $PSScriptRoot "..\..\windows\release\bootstrapper-local"
}

if ($Channel -notin @("stable", "beta", "dev")) {
    throw "Unsupported channel: $Channel"
}

function Resolve-FullPath([string]$Path) {
    if (Test-Path $Path) {
        return (Resolve-Path $Path).Path
    }
    return [System.IO.Path]::GetFullPath($Path)
}

function Join-Url([string]$Base, [string]$Leaf) {
    return $Base.TrimEnd("/") + "/" + [Uri]::EscapeDataString($Leaf)
}

function Get-ArtifactInfo([string]$Path, [string]$Base) {
    $item = Get-Item -LiteralPath $Path
    return [ordered]@{
        url = Join-Url $Base $item.Name
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $item.FullName).Hash.ToLowerInvariant()
        sizeBytes = [int64]$item.Length
    }
}

$windowsAppDir = Resolve-FullPath (Join-Path $PSScriptRoot "..\..\windows")
if (-not $Version) {
    $Version = (Get-Content (Join-Path $windowsAppDir "package.json") -Raw | ConvertFrom-Json).version
}

$artifactDir = Resolve-FullPath $ArtifactDir
$desktopZip = Join-Path $artifactDir "OpenDrSai-desktop-win-x64.zip"
$backendZip = Join-Path $artifactDir "opendrsai-backend-source.zip"
if (-not (Test-Path $desktopZip)) {
    throw "Desktop artifact not found: $desktopZip"
}
if (-not (Test-Path $backendZip)) {
    throw "Backend artifact not found: $backendZip"
}

$desktop = Get-ArtifactInfo $desktopZip $BaseUrl
$desktop.executableRelativePath = "OpenDrSai.exe"
$backend = Get-ArtifactInfo $backendZip $BaseUrl
$backend.installMode = "source-archive"

$manifest = [ordered]@{
    version = $Version
    channel = $Channel
    protocolVersion = "2026-07"
    minimumBootstrapperVersion = "0.1.0"
    platforms = [ordered]@{
        "windows-x64" = [ordered]@{
            desktop = $desktop
            backend = $backend
        }
    }
}

$outDir = Resolve-FullPath $OutDir
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$manifestPath = Join-Path $outDir "desktop-installer-windows.json"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($manifestPath, (($manifest | ConvertTo-Json -Depth 8) + [Environment]::NewLine), $utf8NoBom)
Write-Host "Wrote $manifestPath" -ForegroundColor Green
