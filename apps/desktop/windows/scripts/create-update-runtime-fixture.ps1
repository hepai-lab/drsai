param(
    [Parameter(Mandatory = $true)]
    [string]$OutPath,
    [string]$Version = "1.4.3"
)

$ErrorActionPreference = "Stop"
$root = Join-Path ([IO.Path]::GetTempPath()) ("opendrsai-update-fixture-" + [guid]::NewGuid().ToString("N"))
try {
    New-Item -ItemType Directory -Force -Path (Join-Path $root "app"), (Join-Path $root "drsai-agent\venv\Scripts") | Out-Null
    Copy-Item -LiteralPath "$env:SystemRoot\System32\where.exe" -Destination (Join-Path $root "app\OpenDrSai.exe")
    $source = @"
using System;
public static class FixturePython {
  public static int Main(string[] args) { Console.WriteLine("version: $Version"); return 0; }
}
"@
    Add-Type -TypeDefinition $source -Language CSharp -OutputAssembly (Join-Path $root "drsai-agent\venv\Scripts\python.exe") -OutputType ConsoleApplication
    [IO.File]::WriteAllText((Join-Path $root "drsai-agent\venv\Scripts\drsai.cmd"), "@echo off`r`n", (New-Object Text.UTF8Encoding($false)))
    $manifest = [ordered]@{
        name = "OpenDrSai Runtime"
        version = $Version
        channel = "dev"
        platform = "windows-x64"
        layoutVersion = 1
        entrypoints = @{ desktop = "app/OpenDrSai.exe"; python = "drsai-agent/venv/Scripts/python.exe" }
    }
    [IO.File]::WriteAllText((Join-Path $root "opendrsai-runtime.json"), (($manifest | ConvertTo-Json -Depth 5) + "`n"), (New-Object Text.UTF8Encoding($false)))
    $parent = Split-Path -Parent $OutPath
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    Remove-Item -LiteralPath $OutPath -Force -ErrorAction SilentlyContinue
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($root, $OutPath, [IO.Compression.CompressionLevel]::Optimal, $false)
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
