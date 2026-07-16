# DrSai Desktop  Windows Installer

# ==================================

# Full install: clone repo, create venv, pip install drsai, write wrappers.

#

# Usage:

#   .\scripts\install.ps1                           # Full install (clone from GitHub)

#   .\scripts\install.ps1 -DevSource D:\work\DrSai\drsai   # Dev install (symlink)

#   .\scripts\install.ps1 -SkipSetup               # Skip final reminder

#   .\scripts\install.ps1 -InstallDir ~\.drsai\custom-agent  # Custom dir

#

# Equivalent to: curl ... | bash scripts/install.sh [--dev-source PATH] [--skip-setup]

param(

    [switch]$SkipSetup,

    [string]$InstallDir,

    [string]$DrsaiHome,

    [string]$RepoUrl = "https://github.com/hepai-lab/drsai.git",

    [string]$Branch = "main",

    [string]$Python,

    [string]$DevSource,

    [string]$ExpectedVersion,

    [string]$SourceArchive,

    [string]$SourceArchiveSha256,

    [switch]$SourceArchiveCheckOnly,

    [switch]$CheckOnly,

    [switch]$InstallPrerequisites

)

$ErrorActionPreference = "Stop"

function Get-Sha256Hex([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    } finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}

#  Resolve paths

if (-not $DrsaiHome) {

    $DrsaiHome = if ($env:DRSAI_HOME) { $env:DRSAI_HOME } else { Join-Path $env:USERPROFILE ".drsai" }

}

if (-not $InstallDir) {

    $InstallDir = Join-Path $DrsaiHome "drsai-agent"

}

Write-Host @"

          DrSai Desktop Installer

"@ -ForegroundColor Cyan

Write-Host "  DrSai home:  $DrsaiHome" -ForegroundColor Green

Write-Host "  Install dir: $InstallDir" -ForegroundColor Green

Write-Host "  Repository:  $RepoUrl" -ForegroundColor Green

Write-Host "  Branch:      $Branch" -ForegroundColor Green

if ($DevSource) {

    Write-Host "  Dev source:  $DevSource" -ForegroundColor Yellow

}

if ($SourceArchive) {

    Write-Host "  Source zip:  $SourceArchive" -ForegroundColor Yellow

}

Write-Host ""

#  Ensure DrSai home exists

New-Item -ItemType Directory -Force -Path $DrsaiHome | Out-Null

function Install-WithWinget {

    param(

        [string]$Id,

        [string]$Name

    )

    $winget = Get-Command winget -ErrorAction SilentlyContinue

    if (-not $winget) {

        throw "$Name is required but was not found, and winget is not available to install it automatically."

    }

    Write-Host "  Installing $Name with winget..." -ForegroundColor Yellow

    & $winget.Source install --exact --id $Id --source winget --accept-package-agreements --accept-source-agreements

    if ($LASTEXITCODE -ne 0) {

        throw "winget failed to install $Name (exit code $LASTEXITCODE). Install it manually and run this installer again."

    }

}

function Update-ProcessPath {

    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")

    $env:Path = @($machinePath, $userPath, $env:Path) -join [IO.Path]::PathSeparator

}

function Resolve-CommandSource {

    param(

        [string]$Name

    )

    $found = Get-Command $Name -ErrorAction SilentlyContinue

    if (-not $found) { return $null }

    $path = $found.Source

    if ($path -match 'WindowsApps') {

        Write-Host "  SKIP Windows Store stub: $path" -ForegroundColor DarkGray

        return $null

    }

    return $path

}

function Resolve-PyLauncherPython {

    $py = Resolve-CommandSource "py"

    if (-not $py) { return $null }

    $resolved = & $py -3.11 -c "import sys; print(sys.executable)" 2>$null

    if ($LASTEXITCODE -eq 0 -and $resolved -and (Test-Path $resolved.Trim())) {

        return $resolved.Trim()

    }

    return $null

}

function Get-SemanticVersion {

    param(

        [string]$Value

    )

    if (-not $Value) { return "" }

    $match = [regex]::Match($Value, "\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?")

    if ($match.Success) { return $match.Value }

    return $Value.Trim()

}

function Get-PythonVersion {

    param(

        [string]$PythonPath

    )

    $pyVerRaw = & $PythonPath -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>&1

    if (-not $pyVerRaw -or $pyVerRaw -match '^\s*$') {

        return $null

    }

    return $pyVerRaw.Trim()

}

function Test-SupportedPython {

    param(

        [string]$PythonPath

    )

    $pyVer = Get-PythonVersion $PythonPath

    if (-not $pyVer) { return $false }

    try {

        $major = [int]$pyVer.Split('.')[0]

        $minor = [int]$pyVer.Split('.')[1]

    } catch {

        return $false

    }

    return ($major -gt 3 -or ($major -eq 3 -and $minor -ge 11))

}

function Expand-SourceArchive {

    if (-not $SourceArchive) {

        throw "SourceArchive is required for source archive mode."

    }

    if (-not (Test-Path $SourceArchive)) {

        throw "Source archive does not exist: $SourceArchive"

    }

    if ($SourceArchiveSha256) {

        $actualArchiveHash = Get-Sha256Hex $SourceArchive

        $expectedArchiveHash = $SourceArchiveSha256.ToLowerInvariant()

        if ($actualArchiveHash -ne $expectedArchiveHash) {

            throw "Source archive SHA256 mismatch. Expected $expectedArchiveHash, got $actualArchiveHash."

        }

    }

    Write-Host "  Extracting bundled source archive..." -ForegroundColor Yellow

    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $InstallDir

    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

    Expand-Archive -LiteralPath $SourceArchive -DestinationPath $InstallDir -Force

    if (-not (Test-Path (Join-Path $InstallDir "cores\python\packages\drsai\pyproject.toml"))) {

        throw "Source archive did not contain cores\python\packages\drsai\pyproject.toml."

    }

}

#  Find Python

function Find-Python {

    if ($Python) {

        if (Test-Path $Python) { return $Python }

        throw "Python not found: $Python"

    }

    # Prefer "python", then the Python Launcher, then "python3" on Windows.

    $toTry = @(

        "python",

        "py",

        "python3"

    )

    foreach ($name in $toTry) {

        if ($name -eq "py") {

            $launcherPython = Resolve-PyLauncherPython

            if ($launcherPython -and (Test-SupportedPython $launcherPython)) { return $launcherPython }

            continue

        }

        $path = Resolve-CommandSource $name

        if ($path) {

            if (Test-SupportedPython $path) { return $path }

        }

    }

    if ($InstallPrerequisites) {

        Install-WithWinget -Id "Python.Python.3.11" -Name "Python 3.11"

        Update-ProcessPath

        foreach ($name in $toTry) {

            if ($name -eq "py") {

                $launcherPython = Resolve-PyLauncherPython

                if ($launcherPython -and (Test-SupportedPython $launcherPython)) { return $launcherPython }

                continue

            }

            $path = Resolve-CommandSource $name

            if ($path -and (Test-SupportedPython $path)) { return $path }

        }

    }

    throw "Python >= 3.11 not found.`n`n  Install Python via one of:`n    conda:  conda create -n drsai python=3.11`n    scoop:  scoop install python`n    winget: winget install --exact --id Python.Python.3.11`n    https://www.python.org/downloads/`n`n  Or if Python is installed, activate your environment first:`n    conda activate drsai_dev"

}

$PythonBin = Find-Python

Write-Host "[1/6] Python: $PythonBin" -ForegroundColor Green

#  Verify Python version

$pyVerRaw = & $PythonBin -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>&1

if (-not $pyVerRaw -or $pyVerRaw -match '^\s*$') {

    throw "Python at '$PythonBin' did not return a version. It may be a broken stub (e.g. Microsoft Store). Install real Python via conda/scoop/winget/python.org."

}

$pyVer = $pyVerRaw.Trim()

try {

    $major = [int]$pyVer.Split('.')[0]

    $minor = [int]$pyVer.Split('.')[1]

} catch {

    throw "Cannot parse Python version from $PythonBin (got: $pyVerRaw)"

}

if ($major -lt 3 -or ($major -eq 3 -and $minor -lt 11)) {

    throw "Python >= 3.11 required, found $pyVer"

}

Write-Host "  Python version: $pyVer" -ForegroundColor Green

#  Check git when a repository checkout is needed.

$RequiresGit = -not $DevSource -and -not $SourceArchive

$GitBin = if ($RequiresGit -or $CheckOnly) { Resolve-CommandSource "git" } else { $null }

if (-not $GitBin) {

    if ($RequiresGit -and $InstallPrerequisites) {

        Install-WithWinget -Id "Git.Git" -Name "Git"

        Update-ProcessPath

        $GitBin = Resolve-CommandSource "git"

    }

}

if ($RequiresGit -and -not $GitBin) {

    throw "git is required but not found. Install from https://git-scm.com/ or run: winget install --exact --id Git.Git"

}

$GitVersion = if ($GitBin) { & $GitBin --version } else { "not required (using source archive)" }

Write-Host "  git: $GitVersion" -ForegroundColor Green

if ($CheckOnly) {

    Write-Host ""

    Write-Host "Prerequisite check complete." -ForegroundColor Green

    Write-Host "  Python: $PythonBin ($pyVer)" -ForegroundColor Green

    Write-Host "  Git:    $GitVersion" -ForegroundColor Green

    exit 0

}

if ($SourceArchiveCheckOnly) {

    Write-Host ""

    Write-Host "Checking bundled source archive..." -ForegroundColor Yellow

    Expand-SourceArchive

    Write-Host "Source archive check complete." -ForegroundColor Green

    exit 0

}

#  Clone or symlink repo

Write-Host "[2/6] Setting up repository..." -ForegroundColor Yellow

if ($DevSource) {

    # Dev mode: symlink to local source

    if (-not (Test-Path $DevSource)) {

        throw "Development source does not exist: $DevSource"

    }

    $parentDir = Split-Path -Parent $InstallDir

    New-Item -ItemType Directory -Force -Path $parentDir | Out-Null

    if (Test-Path $InstallDir) {

        Write-Host "  Using existing directory: $InstallDir" -ForegroundColor Yellow

    } else {

        # Try symlink, fallback to junction

        try {

            New-Item -ItemType SymbolicLink -Path $InstallDir -Target $DevSource -ErrorAction Stop | Out-Null

            Write-Host "  Symlink created: $InstallDir -> $DevSource" -ForegroundColor Green

        } catch {

            cmd /c "mklink /J `"$InstallDir`" `"$DevSource`"" 2>$null

            if ($LASTEXITCODE -eq 0) {

                Write-Host "  Junction created: $InstallDir -> $DevSource" -ForegroundColor Green

            } else {

                throw "Cannot create symlink or junction. Run as Administrator or use --InstallDir to an existing path."

            }

        }

    }

} elseif ($SourceArchive) {

    Expand-SourceArchive

} else {

    # Normal mode: clone from GitHub

    if (Test-Path (Join-Path $InstallDir ".git")) {

        Write-Host "  Updating existing repository..." -ForegroundColor Yellow

        & $GitBin -C $InstallDir fetch --all --prune

        if ($LASTEXITCODE -ne 0) {

            throw "git fetch failed for $InstallDir (exit code $LASTEXITCODE)."

        }

        & $GitBin -C $InstallDir checkout $Branch

        if ($LASTEXITCODE -ne 0) {

            throw "git checkout $Branch failed for $InstallDir (exit code $LASTEXITCODE)."

        }

        & $GitBin -C $InstallDir pull --ff-only origin $Branch

        if ($LASTEXITCODE -ne 0) {

            throw "git pull --ff-only origin $Branch failed for $InstallDir (exit code $LASTEXITCODE)."

        }

    } else {

        Write-Host "  Cloning $RepoUrl ..." -ForegroundColor Yellow

        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $InstallDir

        & $GitBin clone --branch $Branch $RepoUrl $InstallDir

        if ($LASTEXITCODE -ne 0) {

            throw "git clone --branch $Branch failed (exit code $LASTEXITCODE)."

        }

    }

}

#  Create venv

Write-Host "[3/6] Creating virtual environment..." -ForegroundColor Yellow

$VenvDir = Join-Path $InstallDir "venv"

$VenvPython = if ($IsWindows -or $env:OS -eq "Windows_NT") {

    Join-Path $VenvDir "Scripts\python.exe"

} else {

    Join-Path $VenvDir "bin\python"

}

if (Test-Path $VenvPython) {

    Write-Host "  Reusing existing virtual environment: $VenvDir" -ForegroundColor Yellow

} else {

    & $PythonBin -m venv $VenvDir

    if ($LASTEXITCODE -ne 0) {

        throw "python -m venv failed for $VenvDir (exit code $LASTEXITCODE)."

    }

}

if (-not (Test-Path $VenvPython)) {

    throw "Virtualenv Python not found: $VenvPython"

}

#  Pip install

Write-Host "[4/6] Installing DrSai package..." -ForegroundColor Yellow

$env:PIP_DISABLE_PIP_VERSION_CHECK = "1"
$env:PIP_PROGRESS_BAR = "off"

& $VenvPython -m pip install --disable-pip-version-check --no-input --upgrade pip setuptools wheel

if ($LASTEXITCODE -ne 0) {

    throw "pip bootstrap failed (exit code $LASTEXITCODE)."

}

$PackageDir = Join-Path $InstallDir "cores\python\packages\drsai"

if (-not (Test-Path (Join-Path $PackageDir "pyproject.toml"))) {

    $PackageDir = Join-Path $InstallDir "python\packages\drsai"

}

if (-not (Test-Path (Join-Path $PackageDir "pyproject.toml"))) {

    throw "Cannot find DrSai Python package at $PackageDir"

}

& $VenvPython -m pip install --disable-pip-version-check --no-input -e $PackageDir

if ($LASTEXITCODE -ne 0) {

    throw "pip editable install failed for $PackageDir (exit code $LASTEXITCODE)."

}

#  Write wrappers

Write-Host "[5/6] Writing wrappers..." -ForegroundColor Yellow

# drsai.cmd in venv Scripts

$drsaiCmd = Join-Path $InstallDir "venv\Scripts\drsai.cmd"

$wrapperContent = "@echo off`r`n`"$VenvPython`" -m drsai.backend.run_cli %*"

[System.IO.File]::WriteAllText($drsaiCmd, $wrapperContent, [System.Text.Encoding]::ASCII)

Write-Host "  $drsaiCmd" -ForegroundColor Green

# drsai.cmd in ~/.local/bin (for PATH)

$localBin = Join-Path $env:USERPROFILE ".local\bin"

New-Item -ItemType Directory -Force -Path $localBin | Out-Null

$localDrsai = Join-Path $localBin "drsai.cmd"

[System.IO.File]::WriteAllText($localDrsai, $wrapperContent, [System.Text.Encoding]::ASCII)

Write-Host "  $localDrsai" -ForegroundColor Green

#  Create default configs

Write-Host "[6/6] Creating default configs..." -ForegroundColor Yellow

$envFile = Join-Path $DrsaiHome ".env"

if (-not (Test-Path $envFile)) {

    $envContent = "# DrSai environment`n# Configure in DrSai Desktop or uncomment and fill:`n# HEPAI_API_KEY=`n"

    [System.IO.File]::WriteAllText($envFile, $envContent, [System.Text.Encoding]::UTF8)

    Write-Host "  Created $envFile" -ForegroundColor Green

}

$configFile = Join-Path $DrsaiHome "config.yaml"

if (-not (Test-Path $configFile)) {

    $configContent = @(

        '# DrSai configuration',

        'model:',

        '  provider: anthropic',

        '  default: hepai/minimax-m2.7-highspeed',

        '  base_url: https://aiapi.ihep.ac.cn/apiv2/anthropic',

        '  streaming: true',

        'smart_model_routing:',

        '  enabled: false'

    ) -join "`r`n"

    [System.IO.File]::WriteAllText($configFile, $configContent, [System.Text.Encoding]::UTF8)

    Write-Host "  Created $configFile" -ForegroundColor Green

}

#  Verify

Write-Host ""

Write-Host "Verifying installation..." -ForegroundColor Yellow

$result = & $VenvPython -c "import drsai; print('drsai import ok')" 2>&1

if ($LASTEXITCODE -ne 0) {

    throw "drsai import failed after installation:`n$result"

}

Write-Host "  $result" -ForegroundColor Green

$versionResult = & $VenvPython -W ignore -m drsai.backend.run_cli version 2>&1

if ($LASTEXITCODE -ne 0) {

    throw "drsai CLI version check failed after installation:`n$versionResult"

}

Write-Host "  $versionResult" -ForegroundColor Green

if ($ExpectedVersion) {

    $actualVersion = Get-SemanticVersion ($versionResult | Out-String)

    $targetVersion = Get-SemanticVersion $ExpectedVersion

    if ($actualVersion -ne $targetVersion) {

        throw "Installed DrSai backend version $actualVersion does not match expected version $targetVersion."

    }

    Write-Host "  backend version matches expected version: $targetVersion" -ForegroundColor Green

}

if (-not (Test-Path $drsaiCmd)) {

    throw "CLI wrapper was not created: $drsaiCmd"

}

#  Done

Write-Host ""

Write-Host " " -ForegroundColor Cyan

Write-Host "    DrSai installation complete!             " -ForegroundColor Cyan

Write-Host " " -ForegroundColor Cyan

Write-Host ""

Write-Host "  Venv python:  $VenvPython" -ForegroundColor Green

Write-Host "  CLI wrapper:  $drsaiCmd" -ForegroundColor Green

Write-Host ""

Write-Host "  Next steps:" -ForegroundColor Yellow

Write-Host "    .\desktop\scripts\dev.ps1          # Start in dev mode (hot reload)" -ForegroundColor White

Write-Host "    .\launch_desktop.ps1               # Quick start (Electron spawns gateway)" -ForegroundColor White

Write-Host ""

if (-not $SkipSetup) {

    Write-Host "  Configure API keys through DrSai Desktop or edit:" -ForegroundColor Yellow

    Write-Host "    $envFile" -ForegroundColor White

} else {

    Write-Host "  (Setup skipped  configure API keys manually)" -ForegroundColor Cyan

}
