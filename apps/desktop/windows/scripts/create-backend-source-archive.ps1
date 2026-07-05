param(
    [string]$OutDir = "$PSScriptRoot\..\resources\backend"
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")
$VersionFile = Join-Path $Root "cores\VERSION"
$Version = if (Test-Path $VersionFile) {
    (Get-Content -LiteralPath $VersionFile -Raw).Trim()
} else {
    $VersionPy = Join-Path $Root "cores\python\packages\drsai\src\drsai\version.py"
    $VersionContent = Get-Content -LiteralPath $VersionPy -Raw
    $VersionMatch = [regex]::Match($VersionContent, '__version__\s*=\s*["'']([^"'']+)["'']')
    if (-not $VersionMatch.Success) {
        throw "Could not determine DrSai backend version from cores\VERSION or version.py"
    }
    $VersionMatch.Groups[1].Value
}
$PackageRoot = Join-Path $Root "cores\python\packages\drsai"
$ArchivePath = Join-Path $OutDir "opendrsai-backend-source.zip"
$ManifestPath = Join-Path $OutDir "backend-source.json"
$FixedTimestamp = [DateTimeOffset]::new(2024, 1, 1, 0, 0, 0, [TimeSpan]::Zero)

if (-not (Test-Path (Join-Path $PackageRoot "pyproject.toml"))) {
    throw "DrSai Python package was not found at $PackageRoot"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Remove-Item -LiteralPath $ArchivePath -Force -ErrorAction SilentlyContinue

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-RelativeZipPath {
    param(
        [string]$BasePath,
        [string]$FilePath,
        [string]$Prefix
    )
    $baseUri = [Uri]((Resolve-Path -LiteralPath $BasePath).Path.TrimEnd('\') + '\')
    $fileUri = [Uri](Resolve-Path -LiteralPath $FilePath).Path
    $relative = [Uri]::UnescapeDataString($baseUri.MakeRelativeUri($fileUri).ToString())
    return "$Prefix/$relative".Replace('\', '/')
}

function Add-ZipEntry {
    param(
        [System.IO.Compression.ZipArchive]$Zip,
        [string]$SourcePath,
        [string]$EntryName
    )
    $entry = $Zip.CreateEntry($EntryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime = $FixedTimestamp
    $entryStream = $entry.Open()
    try {
        $fileStream = [System.IO.File]::OpenRead($SourcePath)
        try {
            $fileStream.CopyTo($entryStream)
        } finally {
            $fileStream.Dispose()
        }
    } finally {
        $entryStream.Dispose()
    }
}

$packagePrefix = "cores/python/packages/drsai"
$files = New-Object System.Collections.Generic.List[object]
Get-ChildItem -LiteralPath $PackageRoot -Recurse -File |
    Where-Object {
        $_.FullName -notmatch '\\__pycache__\\' -and
        $_.Name -notmatch '\.pyc$' -and
        $_.FullName -notmatch '\\\.pytest_cache\\'
    } |
    ForEach-Object {
        $files.Add([pscustomobject]@{
            Source = $_.FullName
            Entry = Get-RelativeZipPath -BasePath $PackageRoot -FilePath $_.FullName -Prefix $packagePrefix
        }) | Out-Null
    }

if (Test-Path $VersionFile) {
    $files.Add([pscustomobject]@{
        Source = (Resolve-Path -LiteralPath $VersionFile).Path
        Entry = "cores/VERSION"
    }) | Out-Null
}

$archiveStream = [System.IO.File]::Open($ArchivePath, [System.IO.FileMode]::CreateNew)
try {
    $zip = [System.IO.Compression.ZipArchive]::new($archiveStream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $files |
            Sort-Object Entry |
            ForEach-Object {
                Add-ZipEntry -Zip $zip -SourcePath $_.Source -EntryName $_.Entry
            }
    } finally {
        $zip.Dispose()
    }
} finally {
    $archiveStream.Dispose()
}

$Archive = Get-Item -LiteralPath $ArchivePath
$Sha256 = (Get-FileHash -Algorithm SHA256 -Path $ArchivePath).Hash.ToLowerInvariant()
$Manifest = [ordered]@{
    version = $Version
    archive = $Archive.Name
    sha256 = $Sha256
    sizeBytes = $Archive.Length
    sourceRoot = "cores/python/packages/drsai"
    generatedAt = "1970-01-01T00:00:00.0000000Z"
}
[System.IO.File]::WriteAllText(
    $ManifestPath,
    ($Manifest | ConvertTo-Json),
    [System.Text.UTF8Encoding]::new($false)
)

Write-Host "Bundled backend source: $ArchivePath"
Write-Host "  version: $Version"
Write-Host "  sha256:  $Sha256"
Write-Host "  size:    $($Archive.Length)"
