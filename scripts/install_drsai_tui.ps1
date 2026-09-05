#Requires -Version 5.1
# ==============================================================================
#  OpenDrSai Installer -- PowerShell (Windows)
#
#  Fully self-contained: downloads portable Python 3.12 + Node.js v22 + source
#  from ihepbox cloud storage. ZERO system pollution -- no admin needed.
#
#  Usage:
#    .\install_drsai_tui.ps1                          # interactive install
#    .\install_drsai_tui.ps1 -InstallDir "C:\drsai"  # specify directory
#    .\install_drsai_tui.ps1 -Force                   # force overwrite
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
#  1b. DETECT SYSTEM DEPENDENCIES (skip portable download if available)
# ==============================================================================
function Detect-SystemDeps {
    Write-Section "Detecting System Dependencies"

    $script:UseSystemPython = $false
    $script:UseSystemNode = $false

    # -- Check for system Python 3.11 ~ 3.13 --
    $sysPython = $null
    try {
        $sysPython = (Get-Command python -ErrorAction SilentlyContinue).Source
        if (-not $sysPython) {
            $sysPython = (Get-Command python3 -ErrorAction SilentlyContinue).Source
        }
    } catch { }

    if ($sysPython) {
        $pyVer = & $sysPython -c "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')" 2>$null
        if ($pyVer) {
            $parts = $pyVer -split '\.'
            $major = [int]$parts[0]
            $minor = [int]$parts[1]
            if ($major -eq 3 -and $minor -ge 11 -and $minor -le 13) {
                Write-Ok "System Python $pyVer found - will use it (skip portable Python)"
                $script:UseSystemPython = $true
                $script:PythonBin = $sysPython
            } else {
                Write-Info "System Python $pyVer found but not in range [3.11, 3.13] - will download portable Python"
            }
        } else {
            Write-Info "System Python found but version unknown - will download portable Python"
        }
    } else {
        Write-Info "No system Python found - will download portable Python"
    }

    # -- Check for DrSai portable Python (from previous install) --
    if (-not $script:UseSystemPython) {
        $drsaiPy = Join-Path $script:InstallDir "packages\python\python.exe"
        if (-not (Test-Path $drsaiPy)) {
            $drsaiPy = Join-Path $script:InstallDir "packages\python\bin\python.exe"
        }
        if (Test-Path $drsaiPy) {
            $drsaiPyVer = & $drsaiPy --version 2>&1
            Write-Ok "DrSai portable Python found at $script:InstallDir\packages\python - will reuse it"
            Write-Ok "  $drsaiPyVer (skip download)"
            $script:UseSystemPython = $true
            $script:PythonBin = $drsaiPy
        }
    }

    # -- Check for system Node >= 20 --
    $sysNode = $null
    try {
        $sysNode = (Get-Command node -ErrorAction SilentlyContinue).Source
    } catch { }

    if ($sysNode) {
        $nodeVer = & $sysNode -v 2>$null
        if ($nodeVer -match 'v(\d+)') {
            $nodeMajor = [int]$Matches[1]
            if ($nodeMajor -ge 20) {
                Write-Ok "System Node $nodeVer found - will use it (skip portable Node)"
                $script:UseSystemNode = $true
                $script:NodeDir = Split-Path $sysNode -Parent
            } else {
                Write-Info "System Node $nodeVer found but < 20 - will download portable Node"
            }
        } else {
            Write-Info "System Node found but version unknown - will download portable Node"
        }
    } else {
        Write-Info "No system Node found - will download portable Node"
    }

    # -- Check for DrSai portable Node (from previous install) --
    if (-not $script:UseSystemNode) {
        $drsaiNode = Join-Path $script:InstallDir "packages\node\node.exe"
        if (Test-Path $drsaiNode) {
            $drsaiNodeVer = & $drsaiNode -v 2>&1
            Write-Ok "DrSai portable Node found at $script:InstallDir\packages\node - will reuse it"
            Write-Ok "  $drsaiNodeVer (skip download)"
            $script:UseSystemNode = $true
            $script:NodeDir = Join-Path $script:InstallDir "packages\node"
        }
    }
}

# ==============================================================================
#  2. INSTALL DIRECTORY SELECTION (>=2GB)
#  Checks $OPENDRSAI env var for existing installation, then lets user
#  choose default path or enter a custom one. Auto-creates directory.
#  On error (mkdir fail or insufficient space), re-prompts.
# ==============================================================================
function Select-InstallDir {
    Write-Section "Install Directory"

    # Step 1: Check OPENDRSAI environment variable for existing installation
    if (-not [string]::IsNullOrWhiteSpace($env:OPENDRSAI)) {
        Write-Info "Found OPENDRSAI environment variable: $env:OPENDRSAI"
        $existingLauncher = Join-Path $env:OPENDRSAI "bin\opendrsai.cmd"
        if (Test-Path $existingLauncher) {
            Write-Warn "Found existing installation at: $env:OPENDRSAI"
            $response = Read-Host "  Remove existing installation? (bin/ and packages/ will be deleted; configs and data are preserved) [y/N]"
            if ($response -match "^[yY]") {
                Write-Info "Removing existing installation at $env:OPENDRSAI..."
                $binPath = Join-Path $env:OPENDRSAI "bin"
                $pkgPath = Join-Path $env:OPENDRSAI "packages"
                if (Test-Path $binPath) { Remove-Item -Path $binPath -Recurse -Force -ErrorAction SilentlyContinue }
                if (Test-Path $pkgPath) { Remove-Item -Path $pkgPath -Recurse -Force -ErrorAction SilentlyContinue }
                Write-Ok "Existing installation removed"
            } else {
                Write-Info "Keeping existing installation at $env:OPENDRSAI"
            }
        } else {
            Write-Info "No existing installation found at $env:OPENDRSAI"
        }
    }

    # Step 2: Let user choose install path (or use -InstallDir if provided)
    while ($true) {
        if (-not [string]::IsNullOrWhiteSpace($InstallDir)) {
            # -InstallDir was provided via command line, use it directly
            $script:InstallDir = $InstallDir
            Write-Info "Install dir (from -InstallDir): $($script:InstallDir)"
        } else {
            Write-Host ""
            Write-Host "  Choose install directory:" -ForegroundColor White
            Write-Host "  [1] Default: $DEFAULT_INSTALL_DIR"
            Write-Host "  [2] Enter a custom path"
            $choice = Read-Host "  Select option [1]"
            if ([string]::IsNullOrWhiteSpace($choice)) { $choice = "1" }

            switch ($choice.Trim()) {
                "1" {
                    $script:InstallDir = $DEFAULT_INSTALL_DIR
                }
                "2" {
                    $customDir = Read-Host "  Enter install path"
                    if ([string]::IsNullOrWhiteSpace($customDir)) {
                        Write-Warn "Empty path, please try again"
                        continue
                    }
                    $script:InstallDir = $customDir.Trim()
                }
                default {
                    Write-Warn "Invalid option: $choice, please try again"
                    continue
                }
            }
        }

        # Step 3: Create directory if it doesn't exist
        try {
            if (!(Test-Path $script:InstallDir)) {
                New-Item -ItemType Directory -Path $script:InstallDir -Force | Out-Null
            }
        } catch {
            Write-Warn "Failed to create directory: $($script:InstallDir) - $_"
            $InstallDir = ""
            $script:InstallDir = ""
            continue
        }

        # Step 4: Check disk space
        $checkDir = $script:InstallDir
        if (!(Test-Path $checkDir)) { $checkDir = $env:USERPROFILE }
        $drive = (Get-Item $checkDir).PSDrive.Name
        $driveInfo = Get-PSDrive -Name $drive -ErrorAction SilentlyContinue
        if (!$driveInfo) {
            $availBytes = $REQUIRED_SPACE_BYTES * 2
        } else {
            $availBytes = $driveInfo.Free
        }
        $availGB = [math]::Round($availBytes / 1GB, 1)

        if ($availBytes -lt $REQUIRED_SPACE_BYTES) {
            Write-Warn "Insufficient disk space: ${availGB}GB < ${REQUIRED_SPACE_GB}GB"
            $InstallDir = ""
            $script:InstallDir = ""
            continue
        }

        # Success
        break
    }

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
            if (Test-Path $binPath) { Remove-Item -Path $binPath -Recurse -Force }
            # Clean venv, src, .download but preserve python/node if reused
            $venvPath = Join-Path $script:InstallDir "packages\venv"
            $srcPaths = @("apps", "cores", "skills") | ForEach-Object { Join-Path $script:InstallDir "packages\$_" }
            $dlPath = Join-Path $script:InstallDir "packages\.download"
            if (Test-Path $venvPath) { Remove-Item -Path $venvPath -Recurse -Force }
            foreach ($srcPath in $srcPaths) { if (Test-Path $srcPath) { Remove-Item -Path $srcPath -Recurse -Force } }
            if (Test-Path $dlPath) { Remove-Item -Path $dlPath -Recurse -Force }
            # Preserve portable Python/Node if they were detected for reuse
            if (-not $script:UseSystemPython) {
                $pyPath = Join-Path $script:InstallDir "packages\python"
                if (Test-Path $pyPath) { Remove-Item -Path $pyPath -Recurse -Force }
            }
            if (-not $script:UseSystemNode) {
                $nodePath = Join-Path $script:InstallDir "packages\node"
                if (Test-Path $nodePath) { Remove-Item -Path $nodePath -Recurse -Force }
            }
            Write-Ok "Old installation cleared (bin/ + venv + src; python/node preserved if reused)"
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
    if ($script:UseSystemPython) {
        Write-Ok "Skipping Python download (using system Python)"
    } else {
        Write-Info "Downloading Python 3.12.13 ($($script:PLATFORM))..."
        $pyFile = Join-Path $downloadDir "python.tar.gz"
        try {
            Invoke-WebRequest -Uri $PYTHON_URL -OutFile $pyFile -UseBasicParsing
        } catch {
            Die "Python download failed: $_"
        }
        $size = [math]::Round((Get-Item $pyFile).Length / 1MB, 1)
        Write-Ok "Python: ${size}MB"
    }

    # Node
    if ($script:UseSystemNode) {
        Write-Ok "Skipping Node download (using system Node)"
    } else {
        Write-Info "Downloading Node.js v22.22.3 ($($script:PLATFORM))..."
        $nodeFile = Join-Path $downloadDir "node.zip"
        try {
            Invoke-WebRequest -Uri $NODE_URL -OutFile $nodeFile -UseBasicParsing
        } catch {
            Die "Node download failed: $_"
        }
        $size = [math]::Round((Get-Item $nodeFile).Length / 1MB, 1)
        Write-Ok "Node: ${size}MB"
    }

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
    if ($script:UseSystemPython) {
        Write-Ok "Using system Python: $(& $script:PythonBin --version 2>&1)"
    } else {
        Write-Info "Extracting Python..."
        $pyDest = Join-Path $pkgDir "python"
        if (Test-Path $pyDest) { Remove-Item -Path $pyDest -Recurse -Force }
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
    }

    # -- Node (.zip -> packages\node\) --
    if ($script:UseSystemNode) {
        Write-Ok "Using system Node: $(& $script:NodeDir\node.exe -v 2>&1)"
    } else {
        Write-Info "Extracting Node..."
        $nodeDest = Join-Path $pkgDir "node"
        if (Test-Path $nodeDest) { Remove-Item -Path $nodeDest -Recurse -Force }
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
    }

    # -- Source (zip -> packages\{apps,cores,skills}\) --
    Write-Info "Extracting source..."
    $srcTmp = Join-Path $pkgDir "_src_tmp"
    if (Test-Path $srcTmp) { Remove-Item $srcTmp -Recurse -Force }
    foreach ($name in @("apps", "cores", "skills")) {
        $target = Join-Path $pkgDir $name
        if (Test-Path $target) { Remove-Item $target -Recurse -Force }
    }
    New-Item -ItemType Directory -Path $srcTmp -Force | Out-Null

    $srcArchive = Join-Path $script:DownloadDir "drsai.zip"
    & $script:PythonBin -c "import zipfile; zipfile.ZipFile(r'$srcArchive').extractall(r'$srcTmp')"
    if ($LASTEXITCODE -ne 0) { Expand-Archive -Path $srcArchive -DestinationPath $srcTmp -Force }

    # Detect source root
    $sourceRoot = $null
    if ((Test-Path (Join-Path $srcTmp "apps")) -and (Test-Path (Join-Path $srcTmp "cores"))) {
        $sourceRoot = $srcTmp
    } else {
        $sourceRoot = Get-ChildItem -Path $srcTmp -Directory | Where-Object {
            (Test-Path (Join-Path $_.FullName "apps")) -and (Test-Path (Join-Path $_.FullName "cores"))
        } | Select-Object -First 1 -ExpandProperty FullName
    }
    if (!$sourceRoot) { Die "Source extraction failed: apps\ and cores\ not found" }

    foreach ($name in @("apps", "cores", "skills")) {
        $sourcePath = Join-Path $sourceRoot $name
        if (Test-Path $sourcePath) { Copy-Item -Path $sourcePath -Destination (Join-Path $pkgDir $name) -Recurse -Force }
    }
    Remove-Item -Path $srcTmp -Recurse -Force

    $pkgJson = Join-Path $pkgDir "apps\ui-tui\package.json"
    $pyproject = Join-Path $pkgDir "cores\python\packages\drsai\pyproject.toml"
    if (!(Test-Path $pkgJson)) { Die "apps\ui-tui\package.json not found" }
    if (!(Test-Path $pyproject)) { Die "drsai\pyproject.toml not found" }
    Write-Ok "Source installed under: $pkgDir (apps + cores + skills)"
    $script:SrcRoot = $pkgDir

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

    if ($script:UseSystemNode) {
        # Using system or DrSai portable node — find pnpm/npm
        $sysPnpm = $null
        $sysNpm = $null

        # Check NodeDir first (DrSai portable case)
        $portablePnpm = Join-Path $script:NodeDir "pnpm.cmd"
        if (-not (Test-Path $portablePnpm)) { $portablePnpm = Join-Path $script:NodeDir "bin\pnpm.cmd" }
        $portableNpm = Join-Path $script:NodeDir "npm.cmd"
        if (-not (Test-Path $portableNpm)) { $portableNpm = Join-Path $script:NodeDir "bin\npm.cmd" }

        if (Test-Path $portablePnpm) {
            $sysPnpm = $portablePnpm
        } else {
            $sysPnpm = (Get-Command pnpm -ErrorAction SilentlyContinue).Source
        }
        if (Test-Path $portableNpm) {
            $sysNpm = $portableNpm
        } else {
            $sysNpm = (Get-Command npm -ErrorAction SilentlyContinue).Source
        }

        if ($sysPnpm) {
            $pnpmVer = & $sysPnpm -v 2>&1
            Write-Ok "Using pnpm: $pnpmVer"
        } elseif ($sysNpm) {
            Write-Info "Installing pnpm via npm..."
            & $sysNpm install -g pnpm 2>$null
            $sysPnpm = (Get-Command pnpm -ErrorAction SilentlyContinue).Source
            if ($sysPnpm) {
                $pnpmVer = & $sysPnpm -v 2>&1
                Write-Ok "pnpm: $pnpmVer"
            } else {
                Write-Warn "pnpm install failed, will use npm to build TUI"
            }
        } else {
            Write-Warn "No pnpm or npm found, will try npm to build TUI"
        }
        return
    }

    # Portable node — original logic
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

    # Ensure the resolved Node directory is on PATH for child processes.
    # Required when reusing a DrSai portable Node: UseSystemNode is $true but
    # the portable dir (packages\node) is NOT on the system PATH, so `pnpm build`
    # must be able to spawn `node scripts/build.mjs`. Idempotent and harmless
    # when NodeDir is already on PATH (true system-node case).
    if ($script:NodeDir -and ($env:PATH -notlike "*$($script:NodeDir)*")) {
        $env:PATH = "$($script:NodeDir);$env:PATH"
    }

    $pnpmBin = $null
    $npmBin = $null

    if ($script:UseSystemNode) {
        # Check NodeDir first (DrSai portable), then system PATH
        $portablePnpm = Join-Path $script:NodeDir "pnpm.cmd"
        if (-not (Test-Path $portablePnpm)) { $portablePnpm = Join-Path $script:NodeDir "bin\pnpm.cmd" }
        $portableNpm = Join-Path $script:NodeDir "npm.cmd"
        if (-not (Test-Path $portableNpm)) { $portableNpm = Join-Path $script:NodeDir "bin\npm.cmd" }

        if (Test-Path $portablePnpm) {
            $pnpmBin = $portablePnpm
        } else {
            $pnpmBin = (Get-Command pnpm -ErrorAction SilentlyContinue).Source
        }
        if (Test-Path $portableNpm) {
            $npmBin = $portableNpm
        } else {
            $npmBin = (Get-Command npm -ErrorAction SilentlyContinue).Source
        }
    } else {
        $pnpmBin = Join-Path $script:NodeDir "pnpm.cmd"
        $npmBin = Join-Path $script:NodeDir "npm.cmd"
    }

    Push-Location $tuiDir

    $retry = 0
    while ($retry -lt 3) {
        $retry++
        Write-Info "Installing TUI dependencies (attempt $retry/3)..."
        try {
            if ($pnpmBin -and (Test-Path $pnpmBin)) {
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
    if ($pnpmBin -and (Test-Path $pnpmBin)) {
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
if exist "%INSTALL_DIR%\packages\node" set "PATH=%INSTALL_DIR%\packages\node;%PATH%"
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
if (Test-Path "`$INSTALL_DIR\packages\node") { `$env:PATH = "`$INSTALL_DIR\packages\node;`$env:PATH" }
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

    # Show Python info (system, DrSai portable, or freshly installed)
    $pyVer = & $script:PythonBin --version 2>&1
    Write-Ok "Python: $pyVer"

    # Show Node info (system, DrSai portable, or freshly installed)
    if ($script:UseSystemNode) {
        $nodeExe = Join-Path $script:NodeDir "node.exe"
    } else {
        $nodeExe = Join-Path $script:InstallDir "packages\node\node.exe"
    }
    if (Test-Path $nodeExe) {
        $nodeVer = & $nodeExe -v 2>&1
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
    Detect-SystemDeps
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
Write-Host "  Source:      $(Join-Path $script:InstallDir 'packages')"
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
