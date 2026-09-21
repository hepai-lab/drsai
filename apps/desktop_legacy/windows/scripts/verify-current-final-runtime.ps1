$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$version = (Get-Content -LiteralPath (Join-Path $root "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
$archive = Join-Path $root "release\bootstrapper\OpenDrSai-Windows-v$version-x64.zip"
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `
    (Join-Path $PSScriptRoot "verify-final-runtime-artifact.ps1") -ArchivePath $archive
if ($LASTEXITCODE -ne 0) { throw "Current final Runtime verification failed." }
