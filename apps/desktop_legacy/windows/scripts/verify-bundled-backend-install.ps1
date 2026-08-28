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
$installed = Join-Path $work "installed"
New-Item -ItemType Directory -Force -Path $expanded, $wheels, $installed | Out-Null

try {
    Expand-Archive -LiteralPath $archivePath -DestinationPath $expanded -Force
    $package = Join-Path $expanded "cores\python\packages\drsai"
    $required = Join-Path $expanded "cores\protocol\owop\owop.schema.json"
    if (-not (Test-Path $required)) { throw "Extracted archive omits required OWOP schema" }
    $playwrightSkill = Join-Path $expanded "skills\skills\playwright-cli\SKILL.md"
    if (-not (Test-Path $playwrightSkill)) { throw "Extracted archive omits the built-in playwright-cli Skill" }
    $env:DRSAI_SKIP_TUI_BUILD = "1"
    # Match the production installer: let pip create an isolated Hatchling
    # environment, but do not resolve or install DrSai runtime dependencies.
    & $python -m pip wheel --disable-pip-version-check --no-deps --wheel-dir $wheels $package
    if ($LASTEXITCODE -ne 0) { throw "Bundled backend wheel build failed with exit code $LASTEXITCODE" }
    $wheel = Get-ChildItem -LiteralPath $wheels -Filter "drsai-*.whl" | Select-Object -First 1
    if (-not $wheel) { throw "Bundled backend verification produced no wheel" }
    & $python -m pip install --disable-pip-version-check --no-deps --target $installed $wheel.FullName
    if ($LASTEXITCODE -ne 0) { throw "Bundled backend wheel install failed with exit code $LASTEXITCODE" }
    $previousPythonPath = $env:PYTHONPATH
    try {
        $env:PYTHONPATH = $installed
        & $python -c "from pathlib import Path; import drsai; from drsai.backend.runtime.web_search import create_web_search_tool; root=Path(r'$installed').resolve(); assert Path(drsai.__file__).resolve().is_relative_to(root); assert create_web_search_tool().schema['name'] == 'web_search'"
        if ($LASTEXITCODE -ne 0) { throw "Bundled backend WebSearch import verification failed with exit code $LASTEXITCODE" }
        if ($env:OPENDRSAI_VERIFY_WEB_SEARCH_NETWORK -eq "1") {
            & $python -c "import asyncio; from drsai.backend.runtime.web_search.bing_playwright import search_bing_with_playwright; result=asyncio.run(search_bing_with_playwright('Python programming language official', 2)); assert len(result.results) == 2; assert all(item.content for item in result.results); print('Bundled backend WebSearch real-network verification passed.')"
            if ($LASTEXITCODE -ne 0) { throw "Bundled backend WebSearch real-network verification failed with exit code $LASTEXITCODE" }
        }
    } finally {
        $env:PYTHONPATH = $previousPythonPath
    }
    Write-Host "Bundled backend install verification passed: $($wheel.Name)"
} finally {
    $resolvedWork = [System.IO.Path]::GetFullPath($work)
    if ($resolvedWork.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path $resolvedWork -Leaf).StartsWith("opendrsai-backend-install-")) {
        Remove-Item -LiteralPath $resolvedWork -Recurse -Force -ErrorAction SilentlyContinue
    }
}
