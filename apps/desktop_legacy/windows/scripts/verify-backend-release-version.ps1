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

if ($Tag -eq "latest") {
    Write-Host "Skipping backend release version check for latest."
    exit 0
}

$expected = Get-SemanticVersion $ExpectedVersion
$workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("opendrsai-backend-release-" + [guid]::NewGuid().ToString("N"))
$repoDir = Join-Path $workDir "repo"

try {
    New-Item -ItemType Directory -Path $workDir | Out-Null
    git clone --filter=blob:none --no-checkout --depth 1 --branch $Tag "https://github.com/$Repository.git" $repoDir
    if ($LASTEXITCODE -ne 0) {
        throw "git clone --branch $Tag failed for $Repository."
    }

    $versionResult = git -C $repoDir show "${Tag}:cores/python/packages/drsai/src/drsai/version.py" 2>$null
    if ($LASTEXITCODE -ne 0) {
        $versionResult = git -C $repoDir show "${Tag}:python/packages/drsai/src/drsai/version.py" 2>$null
    }
    if ($LASTEXITCODE -ne 0 -or -not $versionResult) {
        throw "Cannot read the DrSai backend version from release tag $Tag."
    }

    $actual = Get-SemanticVersion ($versionResult | Out-String)
    if ($actual -ne $expected) {
        throw "Backend release tag $Tag reports version $actual, expected $expected."
    }

    Write-Host "Backend release tag $Tag reports expected version $expected."
} finally {
    Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
}
