#Requires -Version 5.1
# ==============================================================================
#  OpenDrSai Installer -- PowerShell (Windows)
#
#  Fully self-contained: downloads portable Python 3.12 + Node.js v22 + source
#  from ihepbox cloud storage. ZERO system pollution -- no admin needed.
#
#  Usage:
#    .\install_drsai.ps1                          # interactive install
#    .\install_drsai.ps1 -InstallDir "C:\drsai"  # specify directory
#    .\install_drsai.ps1 -Force                   # force overwrite
#    iwr -UseBasicParsing <URL> | iex              # one-liner install
# ==============================================================================
[CmdletBinding()]
param(
    [string]$InstallDir = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

# ==============================================================================
#  CONFIG -- Modify all download URLs here
# ==============================================================================
$IHEPBOX = "https://ihepbox.ihep.ac.cn/ihepbox/index.php/s"

# Source package (full project structure, .zip format, no prebuilt dist/entry.mjs)
$SRC_URL = "$IHEPBOX/hv9iGTJHvuQbRxE/download"

# Python 3.12.13 portable (python-build-standalone, .tar.gz)
$PYTHON_URL = "$IHEPBOX/ZjS6pFmcXbnjeaD/download"

# Node.js v22.22.3 portable (official distribution, .zip)
$NODE_URL = "$IHEPBOX/SwjEFncFIEqOXYK/download"

# Install parameters
$DEFAULT_INSTALL_DIR = "$env:USERPROFILE\.drsai"
$REQUIRED_SPACE_GB = 2
$REQUIRED_SPACE_BYTES = $REQUIRED_SPACE_GB * 1GB

# -- Logging -------------------------------------------------------------------
function Write-Section($msg) { Write-Host "`n--- $msg ---" -ForegroundColor Cyan }
function Write-Log($msg)     { Write-Host "> $msg" }
function Write-Info($msg)    { Write-Host "i  $msg" -ForegroundColor Blue }
function Write-Ok($msg)      { Write-Host "OK $msg" -ForegroundColor Green }
function Write-Warn($msg)    { Write-Host "!  $msg" -ForegroundColor Yellow }
function Write-Err($msg)     { Write-Host "X  $msg" -ForegroundColor Red }
function Die($msg)           { Write-Err $msg; exit 1 }

# ==============================================================================
#  1. PLATFORM DETECTION
# ==============================================================================
function Detect-Platform {
    Write-Section "Platform Detection"

    $os = "windows"
    $arch = if ($env:PROCESSOR_ARCHITECTURE -match "ARM") { "arm64" } else { "x64" }
    $script:PLATFORM = "$os-$arch"

    if ($arch -eq "arm64") {
        Die "Windows ARM64 is not supported (no portable Python/Node for ARM64 Windows)"
    }

    Write-Ok "Platform: $script:PLATFORM"
}

# ==============================================================================
#  2. INSTALL DIRECTORY SELECTION (>=2GB)
# ==============================================================================
function Select-InstallDir {
    Write-Section "Install Directory"

    if ([string]::IsNullOrWhiteSpace($InstallDir)) {
        $script:InstallDir = $DEFAULT_INSTALL_DIR
    }
    Write-Info "Default install dir: $script:InstallDir"

    $parent = Split-Path $script:InstallDir -Parent
    if ($parent -and !(Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    $checkDir = if (Test-Path $script:InstallDir) { $script:InstallDir } else { $parent }
    if (!$checkDir) { $checkDir = $env:USERPROFILE }

    do {
        $drive = (Get-Item $checkDir).PSDrive.Name
        $driveInfo = Get-PSDrive -Name $drive -ErrorAction SilentlyContinue
        if (!$driveInfo) {
            $availBytes = $REQUIRED_SPACE_BYTES * 2
        } else {
            $availBytes = $driveInfo.Free
        }
        $availGB = [math]::Round($availBytes / 1GB, 1)

        if ($availBytes -ge $REQUIRED_SPACE_BYTES) {
            break
        }

        Write-Warn "Insufficient disk space: ${availGB}GB < ${REQUIRED_SPACE_GB}GB"
        $userDir = Read-Host "Enter a different install directory (or press Enter to cancel)"
        if ([string]::IsNullOrWhiteSpace($userDir)) { Die "Installation cancelled by user" }
        $script:InstallDir = $userDir
        New-Item -ItemType Directory -Path $script:InstallDir -Force | Out-Null
        $checkDir = $script:InstallDir
    } while ($true)

    Write-Ok "Available space: ${availGB}GB (>= ${REQUIRED_SPACE_GB}GB)"
    Write-Ok "Install directory: $script:InstallDir"
}

# ==============================================================================
#  3. EXISTING INSTALLATION CHECK
# ==============================================================================
function Check-Existing {
    Write-Section "Checking Existing Installation"

    $launcher = Join-Path $script:InstallDir "bin\opendrsai.cmd"

    if (Test-Path $launcher) {
        Write-Warn "Found existing opendrsai installation: $launcher"

        if ($Force) {
            Write-Info "Using -Force, overwriting"
            $overwrite = $true
        } else {
            $response = Read-Host "Overwrite? (only bin/ and packages/ will be deleted; configs and data are preserved) [y/N]"
            $overwrite = ($response -match "^[yY]")
        }

        if ($overwrite) {
            Write-Info "Cleaning old installation (preserving configs, workspace, logs)..."
            $binPath = Join-Path $script:InstallDir "bin"
            $pkgPath = Join-Path $script:InstallDir "packages"
            if (Test-Path $binPath) { Remove-Item -Path $binPath -Recurse -Force }
            if (Test-Path $pkgPath) { Remove-Item -Path $pkgPath -Recurse -Force }
            Write-Ok "Old installation cleared (bin/ + packages/)"
        } else {
            Die "Installation cancelled by user"
        }
    } else {
        Write-Ok "No existing installation found"
    }
}

# ==============================================================================
#  4. DOWNLOAD
# ==============================================================================
function Download-Files {
    Write-Section "Downloading Files"

    $downloadDir = Join-Path $script:InstallDir ".download"
    New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null

    # Source
    Write-Info "Downloading source (drsai.zip)..."
    $srcFile = Join-Path $downloadDir "drsai.zip"
    try {
        Invoke-WebRequest -Uri $SRC_URL -OutFile $srcFile -UseBasicParsing
    } catch {
        Die "Source download failed: $_"
    }
    $size = [math]::Round((Get-Item $srcFile).Length / 1MB, 1)
    Write-Ok "Source: ${size}MB"

    # Python
    Write-Info "Downloading Python 3.12.13 ($($script:PLATFORM))..."
    $pyFile = Join-Path $downloadDir "python.tar.gz"
    try {
        Invoke-WebRequest -Uri $PYTHON_URL -OutFile $pyFile -UseBasicParsing
    } catch {
        Die "Python download failed: $_"
    }
    $size = [math]::Round((Get-Item $pyFile).Length / 1MB, 1)
    Write-Ok "Python: ${size}MB"

    # Node
    Write-Info "Downloading Node.js v22.22.3 ($($script:PLATFORM))..."
    $nodeFile = Join-Path $downloadDir "node.zip"
    try {
        Invoke-WebRequest -Uri $NODE_URL -OutFile $nodeFile -UseBasicParsing
    } catch {
        Die "Node download failed: $_"
    }
    $size = [math]::Round((Get-Item $nodeFile).Length / 1MB, 1)
    Write-Ok "Node: ${size}MB"

    $script:DownloadDir = $downloadDir
}

# ==============================================================================
#  5. EXTRACT
# ==============================================================================
function Extract-All {
    Write-Section "Extracting Files"

    $pkgDir = Join-Path $script:InstallDir "packages"
    New-Item -ItemType Directory -Path $pkgDir -Force | Out-Null

    # -- Python (tar.gz -> packages\python\) --
    Write-Info "Extracting Python..."
    $pyTmp = Join-Path $pkgDir "_py_tmp"
    New-Item -ItemType Directory -Path $pyTmp -Force | Out-Null

    $pyArchive = Join-Path $script:DownloadDir "python.tar.gz"
    & tar xzf "$pyArchive" -C "$pyTmp" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Die "Python extraction failed (tar)"
    }

    $pySrcDir = $null
    $candidate = Join-Path $pyTmp "python"
    if (Test-Path (Join-Path $candidate "python.exe")) {
        $pySrcDir = $candidate
    }
    if (!$pySrcDir) {
        $subDirs = Get-ChildItem -Path $pyTmp -Directory
        if ($subDirs.Count -gt 0) { $pySrcDir = $subDirs[0].FullName }
    }
    if (!$pySrcDir) { Die "Python extraction failed: no python directory found" }

    $pyDest = Join-Path $pkgDir "python"
    Move-Item -Path $pySrcDir -Destination $pyDest -Force
    Remove-Item -Path $pyTmp -Recurse -Force

    $pyBin = Join-Path $pyDest "python.exe"
    if (!(Test-Path $pyBin)) {
        $pyBin = Join-Path $pyDest "bin\python.exe"
    }
    if (!(Test-Path $pyBin)) { Die "Python binary not found: $pyDest" }

    $pyVer = & $pyBin --version 2>&1
    Write-Ok "Python: $pyVer"

    $script:PythonBin = $pyBin

    # -- Node (.zip -> packages\node\) --
    Write-Info "Extracting Node..."
    $nodeTmp = Join-Path $pkgDir "_node_tmp"
    New-Item -ItemType Directory -Path $nodeTmp -Force | Out-Null

    $nodeArchive = Join-Path $script:DownloadDir "node.zip"
    Expand-Archive -Path $nodeArchive -DestinationPath $nodeTmp -Force

    $nodeSrcDir = $null
    $subDirs = Get-ChildItem -Path $nodeTmp -Directory
    if ($subDirs.Count -gt 0) { $nodeSrcDir = $subDirs[0].FullName }
    if (!$nodeSrcDir) { Die "Node extraction failed: no node directory found" }

    $nodeDest = Join-Path $pkgDir "node"
    Move-Item -Path $nodeSrcDir -Destination $nodeDest -Force
    Remove-Item -Path $nodeTmp -Recurse -Force

    $nodeBin = Join-Path $nodeDest "node.exe"
    if (!(Test-Path $nodeBin)) { Die "Node binary not found: $nodeDest" }

    $nodeVer = & $nodeBin -v 2>&1
    Write-Ok "Node: $nodeVer"

    $script:NodeDir = $nodeDest

    # -- Source (zip -> packages\src\) --
    Write-Info "Extracting source..."
    $srcDir = Join-Path $pkgDir "src"
    New-Item -ItemType Directory -Path $srcDir -Force | Out-Null

    $srcArchive = Join-Path $script:DownloadDir "drsai.zip"
    & $pyBin -c "import zipfile; zipfile.ZipFile(r'$srcArchive').extractall(r'$srcDir')"
    if ($LASTEXITCODE -ne 0) {
        Expand-Archive -Path $srcArchive -DestinationPath $srcDir -Force
    }

    # Detect source root
    $script:SrcRoot = $null
    if ((Test-Path (Join-Path $srcDir "apps")) -and (Test-Path (Join-Path $srcDir "cores"))) {
        $script:SrcRoot = $srcDir
    } else {
        Get-ChildItem -Path $srcDir -Directory | ForEach-Object {
            if ((Test-Path (Join-Path $_.FullName "apps")) -and (Test-Path (Join-Path $_.FullName "cores"))) {
                $script:SrcRoot = $_.FullName
            }
        }
    }
    if (!$script:SrcRoot) { Die "Source extraction failed: apps/ and cores/ not found" }
    Write-Ok "Source root: $($script:SrcRoot)"

    $pkgJson = Join-Path $script:SrcRoot "apps\ui-tui\package.json"
    $pyproject = Join-Path $script:SrcRoot "cores\python\packages\drsai\pyproject.toml"
    if (!(Test-Path $pkgJson)) { Die "apps\ui-tui\package.json not found" }
    if (!(Test-Path $pyproject)) { Die "drsai\pyproject.toml not found" }
    Write-Ok "Source verification passed"

    Remove-Item -Path $script:DownloadDir -Recurse -Force
    Write-Ok "Temp download files cleaned"
}

# ==============================================================================
#  6. SETUP PYTHON VENV + INSTALL BACKEND
# ==============================================================================
function Setup-Python {
    Write-Section "Python Environment Setup"

    $venvDir = Join-Path $script:InstallDir "packages\venv"
    Write-Info "Creating virtual environment..."
    & $script:PythonBin -m venv $venvDir

    $venvPython = Join-Path $venvDir "Scripts\python.exe"
    if (!(Test-Path $venvPython)) { Die "venv creation failed: $venvPython" }

    Write-Info "Upgrading pip..."
    & $venvPython -m pip install --upgrade pip setuptools wheel --quiet 2>$null

    Write-Info "Installing DrSai backend (editable)..."
    $drsaiPkg = Join-Path $script:SrcRoot "cores\python\packages\drsai"
    $env:DRSAI_SKIP_TUI_BUILD = "1"
    & $venvPython -m pip install -e $drsaiPkg --quiet
    Remove-Item env:\DRSAI_SKIP_TUI_BUILD -ErrorAction SilentlyContinue

    $version = & $venvPython -c "from drsai.version import __version__; print(__version__)" 2>$null
    Write-Ok "DrSai backend version: $version"

    $script:VenvPython = $venvPython
}

# ==============================================================================
#  7. SETUP NODE + PNPM
# ==============================================================================
function Setup-Node {
    Write-Section "Node.js Environment Setup"

    $nodeDir = $script:NodeDir
    $npmBin = Join-Path $nodeDir "npm.cmd"
    if (!(Test-Path $npmBin)) { $npmBin = Join-Path $nodeDir "npm" }

    if (!(Test-Path $npmBin)) { Die "npm not found: $nodeDir" }

    Write-Info "Installing pnpm..."
    & $npmBin install -g pnpm --prefix="$nodeDir" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "npm install pnpm failed, trying corepack..."
        & (Join-Path $nodeDir "corepack.cmd") enable 2>$null
        & (Join-Path $nodeDir "corepack.cmd") prepare pnpm@latest --activate 2>$null
    }

    $pnpmBin = Join-Path $nodeDir "pnpm.cmd"
    if (Test-Path $pnpmBin) {
        $pnpmVer = & $pnpmBin -v 2>&1
        Write-Ok "pnpm: $pnpmVer"
    } else {
        Write-Warn "pnpm install failed, will try npm to build TUI"
    }
}

# ==============================================================================
#  8. BUILD TUI
# ==============================================================================
function Build-Tui {
    Write-Section "Building TUI"

    $tuiDir = Join-Path $script:SrcRoot "apps\ui-tui"

    $entryFile = Join-Path $tuiDir "dist\entry.mjs"
    if (Test-Path $entryFile) {
        Write-Ok "Prebuilt bundle found: dist\entry.mjs"
        return
    }

    $env:PATH = "$($script:NodeDir);$env:PATH"

    $pnpmBin = Join-Path $script:NodeDir "pnpm.cmd"
    $npmBin = Join-Path $script:NodeDir "npm.cmd"

    Push-Location $tuiDir

    $retry = 0
    while ($retry -lt 3) {
        $retry++
        Write-Info "Installing TUI dependencies (attempt $retry/3)..."
        try {
            if (Test-Path $pnpmBin) {
                & $pnpmBin install --frozen-lockfile 2>$null
                if ($LASTEXITCODE -ne 0) { & $pnpmBin install }
            } else {
                & $npmBin install
            }
            if ($LASTEXITCODE -eq 0) { break }
        } catch { }
        Write-Warn "Dependency install failed, retrying..."
        if ($retry -eq 3) { Pop-Location; Die "TUI dependency install failed (gave up after 3 retries)" }
    }

    Write-Info "Building TUI bundle..."
    if (Test-Path $pnpmBin) {
        & $pnpmBin build
        if ($LASTEXITCODE -ne 0) { Pop-Location; Die "pnpm build failed" }
    } else {
        & $npmBin run build
        if ($LASTEXITCODE -ne 0) { Pop-Location; Die "npm build failed" }
    }

    if (!(Test-Path $entryFile)) { Pop-Location; Die "TUI build failed: dist\entry.mjs not generated" }
    $size = [math]::Round((Get-Item $entryFile).Length / 1KB, 1)
    Write-Ok "TUI build successful: ${size}KB"

    Pop-Location
}

# ==============================================================================
#  9. CREATE LAUNCHER
# ==============================================================================
function Create-Launcher {
    Write-Section "Creating Launcher Script"

    $binDir = Join-Path $script:InstallDir "bin"
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null

    $launcher = Join-Path $binDir "opendrsai.cmd"
    $tuiDir = Join-Path $script:SrcRoot "apps\ui-tui"
    $srcRoot = $script:SrcRoot
    $tuiDir = $tuiDir -replace '/', '\'
    $srcRoot = $srcRoot -replace '/', '\'
    $pySrcRoot = Join-Path $srcRoot "cores\python\packages\drsai\src"
    $venvPython = Join-Path $script:InstallDir "packages\venv\Scripts\python.exe"

    $content = @"
@echo off
setlocal
REM -- OpenDrSai launcher (self-contained, no system Python/Node) --
set "INSTALL_DIR=%~dp0.."
set "DRSAI_HOME=%INSTALL_DIR%"
set "DRSAI_UI_TUI_DIR=$tuiDir"
REM Tell TUI to use venv Python for gateway subprocess
set "DRSAI_PYTHON=$venvPython"
set "DRSAI_PYTHON_SRC_ROOT=$pySrcRoot"
set "VIRTUAL_ENV=%INSTALL_DIR%\packages\venv"
set "PATH=%INSTALL_DIR%\packages\node;%PATH%"
REM Use console script (drsai.exe) instead of python -m to avoid runpy RuntimeWarning
if exist "%INSTALL_DIR%\packages\venv\Scripts\drsai.exe" (
    "%INSTALL_DIR%\packages\venv\Scripts\drsai.exe" %*
) else (
    "%INSTALL_DIR%\packages\venv\Scripts\python.exe" -m drsai.backend.run_cli %*
)
"@
    Set-Content -Path $launcher -Value $content -Encoding ASCII
    Write-Ok "Launcher: $launcher"

    $psLauncher = Join-Path $binDir "opendrsai.ps1"
    $psContent = @"
# OpenDrSai launcher (PowerShell)
`$INSTALL_DIR = Resolve-Path "`$PSScriptRoot\.."
`$env:DRSAI_HOME = `$INSTALL_DIR.Path
`$env:DRSAI_UI_TUI_DIR = "$tuiDir"
`$env:DRSAI_PYTHON = "$venvPython"
`$env:DRSAI_PYTHON_SRC_ROOT = "$pySrcRoot"
`$env:VIRTUAL_ENV = "`$INSTALL_DIR\packages\venv"
`$env:PATH = "`$INSTALL_DIR\packages\node;`$env:PATH"
`$drsaiExe = "`$INSTALL_DIR\packages\venv\Scripts\drsai.exe"
if (Test-Path `$drsaiExe) {
    & `$drsaiExe `$args
} else {
    & "`$INSTALL_DIR\packages\venv\Scripts\python.exe" -m drsai.backend.run_cli `$args
}
"@
    Set-Content -Path $psLauncher -Value $psContent -Encoding UTF8
    Write-Ok "PS launcher: $psLauncher"
}

# ==============================================================================
#  10. VERIFY
# ==============================================================================
function Verify-Install {
    Write-Section "Verifying Installation"

    Write-Info "Checking drsai import..."
    $r = & $script:VenvPython -c "import drsai; print('ok')" 2>&1
    if ($r -eq "ok") { Write-Ok "drsai import: OK" }
    else { Write-Err "Import failed: $r" }

    Write-Info "Checking version..."
    $v = & $script:VenvPython -c "from drsai.version import __version__; print(__version__)" 2>$null
    Write-Ok "drsai version: $v"

    $launcher = Join-Path $script:InstallDir "bin\opendrsai.cmd"
    if (Test-Path $launcher) { Write-Ok "Launcher: $launcher" }

    $entryFile = Join-Path $script:SrcRoot "apps\ui-tui\dist\entry.mjs"
    if (Test-Path $entryFile) { Write-Ok "TUI bundle: OK" }

    $pyBin = Join-Path $script:InstallDir "packages\python\python.exe"
    if (Test-Path $pyBin) {
        $pyVer = & $pyBin --version 2>&1
        Write-Ok "Python: $pyVer"
    }

    $nodeBin = Join-Path $script:InstallDir "packages\node\node.exe"
    if (Test-Path $nodeBin) {
        $nodeVer = & $nodeBin -v 2>&1
        Write-Ok "Node: $nodeVer"
    }
}

# ==============================================================================
#  MAIN
# ==============================================================================
Write-Host ""
Write-Host "  +----------------------------------------------------------+" -ForegroundColor Cyan
Write-Host "  |           OpenDrSai Installer - Self-Contained            |" -ForegroundColor Cyan
Write-Host "  |    Portable Python + Node - Zero System Pollution         |" -ForegroundColor Cyan
Write-Host "  +----------------------------------------------------------+" -ForegroundColor Cyan
Write-Host ""

try {
    Detect-Platform
    Select-InstallDir
    Check-Existing
    Download-Files
    Extract-All
    Setup-Python
    Setup-Node
    Build-Tui
    Create-Launcher
    Verify-Install
} catch {
    Write-Err "Installation failed: $_"
    exit 1
}

Write-Host ""
Write-Host "  +----------------------------------------------------------+" -ForegroundColor Green
Write-Host "  |                    Installation Complete!                 |" -ForegroundColor Green
Write-Host "  +----------------------------------------------------------+" -ForegroundColor Green
Write-Host ""

$binPath = Join-Path $script:InstallDir "bin"
Write-Host "  Install dir:  $script:InstallDir"
Write-Host "  Python:       $(Join-Path $script:InstallDir 'packages\python')"
Write-Host "  Node:         $(Join-Path $script:InstallDir 'packages\node')"
Write-Host "  Venv:        $(Join-Path $script:InstallDir 'packages\venv')"
Write-Host "  Source:      $(Join-Path $script:InstallDir 'packages\src')"
Write-Host "  Launcher:    $binPath"
Write-Host ""

# Auto-add to User PATH (permanent, for future sessions)
$currentUserPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($currentUserPath -and $currentUserPath.Contains($binPath)) {
    Write-Ok "Already in User PATH"
} else {
    $newPath = "$binPath;$currentUserPath"
    [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
    Write-Ok "Added to User PATH (permanent)"
}

Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Yellow
# Build the current-session command safely (avoid backtick escaping issues)
$currentCmd = '$env:PATH += ";' + $binPath + '"'
Write-Host "  For current session, run:" -ForegroundColor White
Write-Host "    $currentCmd" -ForegroundColor White
Write-Host ""
Write-Host "  Or open a NEW terminal, then run:" -ForegroundColor White
Write-Host "    opendrsai" -ForegroundColor White
Write-Host "  First run will trigger API key setup wizard." -ForegroundColor White
Write-Host ""
Write-Host "  No system Python/Node modified. All environments are self-contained." -ForegroundColor DarkGray
Write-Host ""
