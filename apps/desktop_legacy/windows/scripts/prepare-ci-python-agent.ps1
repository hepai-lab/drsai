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
$fingerprintPath = Join-Path $AgentDir ".opendrsai-python-agent-fingerprint.json"

function Get-DependencyFingerprint {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $pythonIdentity = (& $Python -c "import sys; print(sys.executable); print(sys.version)" 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw "Could not inspect the source Python interpreter." }
        $inputs = @(
            (Join-Path $packageDir "pyproject.toml"),
            (Join-Path $packageDir "build_hook.py")
        )
        $builder = New-Object System.Text.StringBuilder
        $null = $builder.AppendLine("python=$pythonIdentity")
        $null = $builder.AppendLine("index=$($PipIndexUrl.TrimEnd('/'))")
        foreach ($path in $inputs) {
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Dependency fingerprint input is missing: $path" }
            $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
            $null = $builder.AppendLine("$([IO.Path]::GetFileName($path))=$hash")
        }
        $bytes = [Text.Encoding]::UTF8.GetBytes($builder.ToString())
        return ([BitConverter]::ToString($sha256.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
    } finally {
        $sha256.Dispose()
    }
}

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
$dependencyFingerprint = Get-DependencyFingerprint
$cachedFingerprint = ""
if (Test-Path -LiteralPath $fingerprintPath -PathType Leaf) {
    try {
        $cachedFingerprint = [string](Get-Content -LiteralPath $fingerprintPath -Raw -Encoding UTF8 | ConvertFrom-Json).fingerprint
    } catch {
        $cachedFingerprint = ""
    }
}
$canReuse = -not $Recreate -and $cachedFingerprint -eq $dependencyFingerprint
if ($canReuse) {
    & $venvPython -I -c "import drsai" *> $null
    $canReuse = $LASTEXITCODE -eq 0
}
if ($canReuse) {
    Write-Host "Reusing cached trusted Python agent dependencies: $dependencyFingerprint" -ForegroundColor DarkGray
} else {
    & $venvPython -m pip install --disable-pip-version-check --no-input --index-url $env:PIP_INDEX_URL --upgrade pip setuptools wheel
    if ($LASTEXITCODE -ne 0) { throw "pip bootstrap failed with exit code $LASTEXITCODE." }
    & $venvPython -m pip install --disable-pip-version-check --no-input --index-url $env:PIP_INDEX_URL -e $packageDir
    if ($LASTEXITCODE -ne 0) { throw "DrSai dependency installation failed with exit code $LASTEXITCODE." }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $fingerprintRecord = [ordered]@{
        schemaVersion = 1
        fingerprint = $dependencyFingerprint
        preparedAt = [DateTime]::UtcNow.ToString("o")
        python = $Python
        pipIndexUrl = $env:PIP_INDEX_URL
    }
    [System.IO.File]::WriteAllText(
        $fingerprintPath,
        (($fingerprintRecord | ConvertTo-Json -Depth 4) + [Environment]::NewLine),
        $utf8NoBom
    )
}

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
