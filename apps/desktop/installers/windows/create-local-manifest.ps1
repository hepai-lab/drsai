param(
    [string]$OutDir = "$PSScriptRoot\..\..\windows\release\bootstrapper-local",
    [string]$DesktopReleaseDir = "$PSScriptRoot\..\..\windows\release\win-unpacked",
    [string]$BackendResourceDir = "$PSScriptRoot\..\..\windows\resources\backend",
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath([string]$Path) {
    if (Test-Path $Path) {
        return (Resolve-Path $Path).Path
    }
    return [System.IO.Path]::GetFullPath($Path)
}

function ConvertTo-FileUrl([string]$Path) {
    return ([Uri](Resolve-FullPath $Path)).AbsoluteUri
}

function Get-ArtifactInfo([string]$Path) {
    $item = Get-Item -LiteralPath $Path
    return [ordered]@{
        url = ConvertTo-FileUrl $item.FullName
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $item.FullName).Hash.ToLowerInvariant()
        sizeBytes = [int64]$item.Length
    }
}

$windowsAppDir = Resolve-FullPath (Join-Path $PSScriptRoot "..\..\windows")
if (-not $Version) {
    $Version = (Get-Content (Join-Path $windowsAppDir "package.json") -Raw | ConvertFrom-Json).version
}

$desktopReleaseDir = Resolve-FullPath $DesktopReleaseDir
if (-not (Test-Path (Join-Path $desktopReleaseDir "OpenDrSai.exe"))) {
    throw "Packaged desktop app was not found: $(Join-Path $desktopReleaseDir "OpenDrSai.exe"). Run npm run build:unpack from apps\desktop\windows first."
}

$backendResourceDir = Resolve-FullPath $BackendResourceDir
$backendArchive = Join-Path $backendResourceDir "opendrsai-backend-source.zip"
if (-not (Test-Path $backendArchive)) {
    $bundleScript = Join-Path $windowsAppDir "scripts\create-backend-source-archive.ps1"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bundleScript
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create backend source archive."
    }
}
if (-not (Test-Path $backendArchive)) {
    throw "Backend source archive was not found: $backendArchive"
}

$outDir = Resolve-FullPath $OutDir
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$desktopZip = Join-Path $outDir "OpenDrSai-desktop-win-x64.zip"
Remove-Item -LiteralPath $desktopZip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $desktopReleaseDir "*") -DestinationPath $desktopZip -Force

$backendZip = Join-Path $outDir "opendrsai-backend-source.zip"
Copy-Item -LiteralPath $backendArchive -Destination $backendZip -Force

$desktop = Get-ArtifactInfo $desktopZip
$desktop.executableRelativePath = "OpenDrSai.exe"
$backend = Get-ArtifactInfo $backendZip
$backend.installMode = "source-archive"

$manifest = [ordered]@{
    version = $Version
    channel = "dev"
    protocolVersion = "2026-07"
    minimumBootstrapperVersion = "0.1.0"
    platforms = [ordered]@{
        "windows-x64" = [ordered]@{
            desktop = $desktop
            backend = $backend
        }
    }
}

$manifestPath = Join-Path $outDir "desktop-installer-windows.local.json"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($manifestPath, (($manifest | ConvertTo-Json -Depth 8) + [Environment]::NewLine), $utf8NoBom)
Write-Host "Wrote $manifestPath" -ForegroundColor Green
