$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
$appRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$manifestPath = Join-Path $appRoot "resources\backend\backend-source.json"
$manifest = Get-Content -Raw -Encoding UTF8 $manifestPath | ConvertFrom-Json
$archivePath = Join-Path (Split-Path $manifestPath) $manifest.archive
$python = Join-Path $repo "venv\Scripts\python.exe"
if (-not (Test-Path $python)) { throw "Repository Python is missing: $python" }

$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$work = Join-Path $tempRoot ("opendrsai-backend-install-" + [guid]::NewGuid().ToString("N"))
$expanded = Join-Path $work "source"
$wheels = Join-Path $work "wheels"
New-Item -ItemType Directory -Force -Path $expanded, $wheels | Out-Null

try {
    Expand-Archive -LiteralPath $archivePath -DestinationPath $expanded -Force
    $package = Join-Path $expanded "cores\python\packages\drsai"
    $required = Join-Path $expanded "cores\protocol\owop\owop.schema.json"
    if (-not (Test-Path $required)) { throw "Extracted archive omits required OWOP schema" }
    $env:DRSAI_SKIP_TUI_BUILD = "1"
    # Match the production installer: let pip create an isolated Hatchling
    # environment, but do not resolve or install DrSai runtime dependencies.
    & $python -m pip wheel --disable-pip-version-check --no-deps --wheel-dir $wheels $package
    if ($LASTEXITCODE -ne 0) { throw "Bundled backend wheel build failed with exit code $LASTEXITCODE" }
    $wheel = Get-ChildItem -LiteralPath $wheels -Filter "drsai-*.whl" | Select-Object -First 1
    if (-not $wheel) { throw "Bundled backend verification produced no wheel" }
    Write-Host "Bundled backend install verification passed: $($wheel.Name)"
} finally {
    $resolvedWork = [System.IO.Path]::GetFullPath($work)
    if ($resolvedWork.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path $resolvedWork -Leaf).StartsWith("opendrsai-backend-install-")) {
        Remove-Item -LiteralPath $resolvedWork -Recurse -Force -ErrorAction SilentlyContinue
    }
}
