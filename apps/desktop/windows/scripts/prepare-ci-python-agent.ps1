param(
    [string]$Python = "python",
    [string]$AgentDir = "",
    [string]$PipIndexUrl = "https://pypi.tuna.tsinghua.edu.cn/simple",
    [switch]$Recreate
)

$ErrorActionPreference = "Stop"
$windowsRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repoRoot = (Resolve-Path (Join-Path $windowsRoot "..\..\..")).Path
if ($Python -eq "python") {
    $repositoryPython = Join-Path $repoRoot ".venv\Scripts\python.exe"
    if (Test-Path -LiteralPath $repositoryPython -PathType Leaf) {
        $Python = $repositoryPython
    }
}
if (-not $AgentDir) {
    $AgentDir = Join-Path $windowsRoot ".tmp\bootstrapper-msi3\.drsai\drsai-agent"
}
$venvDir = Join-Path $AgentDir "venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$scriptsDir = Join-Path $venvDir "Scripts"
$packageDir = Join-Path $repoRoot "cores\python\packages\drsai"

if ($Recreate -and (Test-Path -LiteralPath $venvDir)) {
    $resolvedAgent = [IO.Path]::GetFullPath($AgentDir)
    $managedRoot = [IO.Path]::GetFullPath((Join-Path $windowsRoot ".tmp"))
    if (-not $resolvedAgent.StartsWith($managedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to recreate a Python agent outside the managed Windows .tmp directory: $resolvedAgent"
    }
    Remove-Item -LiteralPath $venvDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $AgentDir | Out-Null
if (-not (Test-Path -LiteralPath $venvPython)) {
    & $Python -m venv $venvDir
    if ($LASTEXITCODE -ne 0) { throw "python -m venv failed with exit code $LASTEXITCODE." }
}

$env:PIP_DISABLE_PIP_VERSION_CHECK = "1"
$env:PIP_PROGRESS_BAR = "off"
if ($PipIndexUrl -notmatch '^https://[^\s/]+(?:/.*)?$') {
    throw "PipIndexUrl must be an HTTPS simple-index URL."
}
$env:PIP_INDEX_URL = $PipIndexUrl.TrimEnd('/')
Write-Host "Using Python package index: $($env:PIP_INDEX_URL)"
& $venvPython -m pip install --disable-pip-version-check --no-input --index-url $env:PIP_INDEX_URL --upgrade pip setuptools wheel
if ($LASTEXITCODE -ne 0) { throw "pip bootstrap failed with exit code $LASTEXITCODE." }
& $venvPython -m pip install --disable-pip-version-check --no-input --index-url $env:PIP_INDEX_URL -e $packageDir
if ($LASTEXITCODE -ne 0) { throw "DrSai dependency installation failed with exit code $LASTEXITCODE." }

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText(
    (Join-Path $scriptsDir "drsai.cmd"),
    "@echo off`r`n`"$venvPython`" -m drsai.backend.run_cli %*`r`n",
    $utf8NoBom
)
[System.IO.File]::WriteAllText(
    (Join-Path $scriptsDir "drsai-gateway.cmd"),
    "@echo off`r`n`"$venvPython`" -m drsai.backend.tui_gateway.entry %*`r`n",
    $utf8NoBom
)

if ($env:GITHUB_ENV) {
    "OPENDRSAI_GATEWAY_SMOKE_PYTHON=$venvPython" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
}
Write-Host "Prepared CI DrSai agent: $AgentDir"
Write-Host "Python: $venvPython"
