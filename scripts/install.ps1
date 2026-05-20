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

    [string]$DevSource

)

$ErrorActionPreference = "Stop"

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

Write-Host ""

#  Ensure DrSai home exists

New-Item -ItemType Directory -Force -Path $DrsaiHome | Out-Null

#  Find Python

function Find-Python {

    if ($Python) {

        if (Test-Path $Python) { return $Python }

        throw "Python not found: $Python"

    }

    # Prefer "python" over "python3" on Windows (python3 is often Store stub)

    # Also try common conda paths

    $toTry = @(

        "python",

        "python3"

    )

    foreach ($name in $toTry) {

        $found = Get-Command $name -ErrorAction SilentlyContinue

        if ($found) {

            $path = $found.Source

            # Skip Windows Store stubs

            if ($path -match 'WindowsApps') {

                Write-Host "  SKIP Windows Store stub: $path" -ForegroundColor DarkGray

                continue

            }

            return $path

        }

    }

    throw "Python >= 3.11 not found.`n`n  Install Python via one of:`n    conda:  conda create -n drsai python=3.11`n    scoop:  scoop install python`n    winget: winget install Python.Python.3.11`n    https://www.python.org/downloads/`n`n  Or if Python is installed, activate your environment first:`n    conda activate drsai_dev"

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

#  Check git

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {

    throw "git is required but not found. Install from https://git-scm.com/"

}

Write-Host "  git: $(git --version)" -ForegroundColor Green

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

} else {

    # Normal mode: clone from GitHub

    if (Test-Path (Join-Path $InstallDir ".git")) {

        Write-Host "  Updating existing repository..." -ForegroundColor Yellow

        git -C $InstallDir fetch --all --prune

        git -C $InstallDir checkout $Branch

        git -C $InstallDir pull --ff-only origin $Branch

        if ($LASTEXITCODE -ne 0) {

            Write-Host "  WARNING: git pull failed, continuing with existing checkout" -ForegroundColor Yellow

        }

    } else {

        Write-Host "  Cloning $RepoUrl ..." -ForegroundColor Yellow

        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $InstallDir

        git clone --branch $Branch $RepoUrl $InstallDir

    }

}

#  Create venv

Write-Host "[3/6] Creating virtual environment..." -ForegroundColor Yellow

$VenvDir = Join-Path $InstallDir "venv"

& $PythonBin -m venv $VenvDir

$VenvPython = if ($IsWindows -or $env:OS -eq "Windows_NT") {

    Join-Path $VenvDir "Scripts\python.exe"

} else {

    Join-Path $VenvDir "bin\python"

}

if (-not (Test-Path $VenvPython)) {

    throw "Virtualenv Python not found: $VenvPython"

}

#  Pip install

Write-Host "[4/6] Installing DrSai package..." -ForegroundColor Yellow

& $VenvPython -m pip install --upgrade pip setuptools wheel

$PackageDir = Join-Path $InstallDir "python\packages\drsai"

if (-not (Test-Path (Join-Path $PackageDir "pyproject.toml"))) {

    throw "Cannot find DrSai Python package at $PackageDir"

}

& $VenvPython -m pip install -e $PackageDir

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

try {

    $result = & $VenvPython -c "import drsai; print('drsai import ok')" 2>&1

    Write-Host "  $result" -ForegroundColor Green

} catch {

    Write-Host "  WARNING: drsai import failed. Check pip install output." -ForegroundColor Yellow

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