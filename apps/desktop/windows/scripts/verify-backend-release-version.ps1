param(
    [Parameter(Mandatory = $true)]
    [string]$Repository,

    [Parameter(Mandatory = $true)]
    [string]$Tag,

    [Parameter(Mandatory = $true)]
    [string]$ExpectedVersion
)

$ErrorActionPreference = "Stop"

function Get-SemanticVersion {
    param([string]$Value)
    $match = [regex]::Match($Value, '\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?')
    if (-not $match.Success) {
        throw "Could not parse semantic version from: $Value"
    }
    return $match.Value
}

function Resolve-PythonCommand {
    $candidates = @(
        "python",
        "python3",
        "py -3.11",
        "py -3"
    )
    foreach ($candidate in $candidates) {
        $parts = $candidate -split " "
        $exe = $parts[0]
        $args = @($parts | Select-Object -Skip 1) + @("--version")
        try {
            $output = & $exe @args 2>&1
            if ($LASTEXITCODE -eq 0 -and ($output | Out-String) -match "Python 3") {
                return $parts
            }
        } catch {
            continue
        }
    }
    throw "Python 3 is required to verify the backend release version."
}

if ($Tag -eq "latest") {
    Write-Host "Skipping backend release version check for latest."
    exit 0
}

$expected = Get-SemanticVersion $ExpectedVersion
$workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("opendrsai-backend-release-" + [guid]::NewGuid().ToString("N"))
$repoDir = Join-Path $workDir "repo"
$venvDir = Join-Path $workDir "venv"

try {
    New-Item -ItemType Directory -Path $workDir | Out-Null
    git clone --depth 1 --branch $Tag "https://github.com/$Repository.git" $repoDir
    if ($LASTEXITCODE -ne 0) {
        throw "git clone --branch $Tag failed for $Repository."
    }

    $packageDir = Join-Path $repoDir "cores\python\packages\drsai"
    if (-not (Test-Path (Join-Path $packageDir "pyproject.toml"))) {
        $packageDir = Join-Path $repoDir "python\packages\drsai"
    }
    if (-not (Test-Path (Join-Path $packageDir "pyproject.toml"))) {
        throw "Cannot find DrSai Python package in release tag $Tag."
    }

    $python = Resolve-PythonCommand
    & $python[0] @($python | Select-Object -Skip 1) -m venv $venvDir
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create Python venv for backend release verification."
    }

    $venvPython = if ($IsWindows -or $env:OS -eq "Windows_NT") {
        Join-Path $venvDir "Scripts\python.exe"
    } else {
        Join-Path $venvDir "bin/python"
    }

    & $venvPython -m pip install --upgrade pip setuptools wheel
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install Python packaging tools."
    }
    & $venvPython -m pip install -e $packageDir
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install DrSai backend package from $Tag."
    }

    $versionResult = & $venvPython -m drsai.backend.run_cli version 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "drsai backend version command failed for $Tag`n$versionResult"
    }

    $actual = Get-SemanticVersion ($versionResult | Out-String)
    if ($actual -ne $expected) {
        throw "Backend release tag $Tag reports version $actual, expected $expected."
    }

    Write-Host "Backend release tag $Tag reports expected version $expected."
} finally {
    Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
}
