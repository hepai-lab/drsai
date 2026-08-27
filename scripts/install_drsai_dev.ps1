#Requires -Version 5.1
# ==============================================================================
#  OpenDrSai Dev Installer -- PowerShell (Windows)
#
#  Live-development installer: copies the LOCAL repo source (apps/ui-tui and
#  cores only) into ~/.drsai so you can test edits in real time. The Python
#  venv + portable Python/Node are still downloaded from ihepbox (online),
#  exactly like install_drsai.ps1.
#
#  Because the backend is installed editable (pip install -e) against the
#  copied source, edits you make in the LOCAL repo can be synced to the
#  install dir with the -Sync action (robocopy). The TUI is rebuilt from the
#  copied source so dist/entry.mjs stays in sync too.
#
#  Usage:
#    .\install_drsai_dev.ps1                          # install (default ~/.drsai)
#    .\install_drsai_dev.ps1 -InstallDir "C:\drsai"  # custom install dir
#    .\install_drsai_dev.ps1 -Force                   # overwrite existing
#    .\install_drsai_dev.ps1 -Sync                    # re-copy source + rebuild TUI
#    .\install_drsai_dev.ps1 -Sync -NoRebuild        # sync source only, no TUI rebuild
#
#  Requirements: PowerShell 5.1+, tar (built into Windows 10 1803+)
# ==============================================================================
[CmdletBinding()]
param(
    [string]$InstallDir = "",
    [switch]$Force,
    [switch]$Sync,
    [switch]$NoRebuild
)

$ErrorActionPreference = "Stop"

# ==============================================================================
#  CONFIG -- online deps URLs (same as install_drsai.ps1)
# ==============================================================================
$IHEPBOX = "https://ihepbox.ihep.ac.cn/ihepbox/index.php/s"

# Python 3.12.13 portable (python-build-standalone, .tar.gz)
$PYTHON_URL = "$IHEPBOX/ZjS6pFmcXbnjeaD/download"

# Node.js v22.22.3 portable (official distribution, .zip)
$NODE_URL = "$IHEPBOX/SwjEFncFIEqOXYK/download"

# Install parameters
$DEFAULT_INSTALL_DIR = "$env:USERPROFILE\.drsai"
$REQUIRED_SPACE_GB = 2
$REQUIRED_SPACE_BYTES = $REQUIRED_SPACE_GB * 1GB

# Repo root = parent directory of the scripts/ folder containing this script
# Use $PSScriptRoot (PS 3.0+) -- always available at script level, more reliable
# than $MyInvocation.MyCommand.Path which can be null in some execution contexts
if ($PSScriptRoot) {
    $script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} elseif ($MyInvocation.MyCommand.Path) {
    $script:RepoRoot = (Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "..")).Path
} else {
    Die "Cannot determine script directory. Please run as: .\scripts\install_drsai_dev.ps1"
}

# -- Logging -------------------------------------------------------------------
function Write-Section($msg) { Write-Host "`n--- $msg ---" -ForegroundColor Cyan }
function Write-Log($msg)     { Write-Host "> $msg" }
function Write-Info($msg)    { Write-Host "i  $msg" -ForegroundColor Blue }
function Write-Ok($msg)      { Write-Host "OK $msg" -ForegroundColor Green }
function Write-Warn($msg)    { Write-Host "!  $msg" -ForegroundColor Yellow }
function Write-Err($msg)     { Write-Host "X  $msg" -ForegroundColor Red }
function Die($msg)           { Write-Err $msg; exit 1 }

# ==============================================================================
#  Source copy helpers (robocopy apps/ui-tui + cores only)
# ==============================================================================
function Copy-RepoSource {
    param([string]$DstRoot)

    Write-Section "Copying Local Repo Source -> $DstRoot"

    # Verify repo layout
    $repoAppsTui = Join-Path $script:RepoRoot "apps\ui-tui"
    $repoCores   = Join-Path $script:RepoRoot "cores"
    if (!(Test-Path $repoAppsTui)) { Die "Repo missing apps\ui-tui at $($script:RepoRoot)" }
    if (!(Test-Path $repoCores))   { Die "Repo missing cores at $($script:RepoRoot)" }

    Write-Info "Repo root: $($script:RepoRoot)"

    # -- Copy apps\ui-tui (excluding node_modules) --
    Write-Info "Copying apps\ui-tui (excluding node_modules)..."
    $dstApps = Join-Path $DstRoot "apps"
    New-Item -ItemType Directory -Path $dstApps -Force | Out-Null
    $dstAppsTui = Join-Path $dstApps "ui-tui"
    # robocopy exit codes 0-7 are OK, 8+ is failure
    & robocopy $repoAppsTui $dstAppsTui /MIR /XD node_modules .cache /XF *.log | Out-Null
    if ($LASTEXITCODE -ge 8) { Die "robocopy failed for apps\ui-tui (exit code: $LASTEXITCODE)" }

    # -- Copy cores (excluding __pycache__, *.pyc, dist) --
    Write-Info "Copying cores..."
    $dstCores = Join-Path $DstRoot "cores"
    & robocopy $repoCores $dstCores /MIR /XD __pycache__ dist /XF *.pyc | Out-Null
    if ($LASTEXITCODE -ge 8) { Die "robocopy failed for cores (exit code: $LASTEXITCODE)" }

    # -- Copy skills\skills (pre-built skills catalog) --
    $repoSkillsSkills = Join-Path $script:RepoRoot "skills\skills"
    if (Test-Path $repoSkillsSkills) {
        Write-Info "Copying skills\skills..."
        $dstSkills = Join-Path $DstRoot "skills"
        $dstSkillsSkills = Join-Path $dstSkills "skills"
        & robocopy $repoSkillsSkills $dstSkillsSkills /MIR | Out-Null
        if ($LASTEXITCODE -ge 8) { Die "robocopy failed for skills\skills (exit code: $LASTEXITCODE)" }
    } else {
        Write-Warn "skills\skills not found in repo - skipping (skill selection will be unavailable)"
    }

    # Verify the copied layout
    $pkgJson   = Join-Path $dstAppsTui "package.json"
    $pyproject = Join-Path $dstCores "python\packages\drsai\pyproject.toml"
    if (!(Test-Path $pkgJson))   { Die "Copy failed: apps\ui-tui\package.json missing" }
    if (!(Test-Path $pyproject)) { Die "Copy failed: drsai pyproject.toml missing" }

    Write-Ok "Source copied: apps\ui-tui + cores + skills\skills -> $DstRoot"
}

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

    Write-Ok "Platform: $($script:PLATFORM)"
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
            Write-Ok "DrSai portable Python found at $($script:InstallDir)\packages\python - will reuse it"
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
            Write-Ok "DrSai portable Node found at $($script:InstallDir)\packages\node - will reuse it"
            Write-Ok "  $drsaiNodeVer (skip download)"
            $script:UseSystemNode = $true
            $script:NodeDir = Join-Path $script:InstallDir "packages\node"
        }
    }
}

# ==============================================================================
#  2. INSTALL DIRECTORY SELECTION (>=2GB)
# ==============================================================================
function Select-InstallDir {
    Write-Section "Install Directory"

    if ([string]::IsNullOrWhiteSpace($InstallDir)) {
        $script:InstallDir = $DEFAULT_INSTALL_DIR
    } else {
        $script:InstallDir = $InstallDir
    }
    Write-Info "Install dir: $($script:InstallDir)"

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
    Write-Ok "Install directory: $($script:InstallDir)"
}

# ==============================================================================
#  2b. CHECK FOR RUNNING DRSAI PROCESSES
# ==============================================================================
function Check-Running {
    Write-Section "Checking for Running DrSai Processes"

    $running = @()

    # Check for node processes running entry.mjs or drsai.backend
    try {
        $nodeProcs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and ($_.CommandLine -match "entry\.mjs" -or $_.CommandLine -match "drsai\.backend") }
        foreach ($p in $nodeProcs) {
            $running += [PSCustomObject]@{ Id = $p.ProcessId; Name = "node.exe" }
        }
    } catch { }

    # Check for python processes running drsai
    try {
        $pyProcs = Get-CimInstance Win32_Process -Filter "Name LIKE 'python%'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and ($_.CommandLine -match "drsai\.backend" -or $_.CommandLine -match "opendrsai") }
        foreach ($p in $pyProcs) {
            $running += [PSCustomObject]@{ Id = $p.ProcessId; Name = $p.Name }
        }
    } catch { }

    # Deduplicate by Id
    $running = $running | Sort-Object Id -Unique

    if ($running.Count -gt 0) {
        Write-Warn "DrSai is currently running. Please stop ALL instances before updating:"
        foreach ($p in $running) {
            Write-Warn "  PID $($p.Id): $($p.Name)"
        }
        Die "Please close all running DrSai terminals/processes, then re-run this installer."
    } else {
        Write-Ok "No running DrSai processes found"
    }
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
            $response = Read-Host "Overwrite? (only bin/ and packages/venv will be deleted; source, configs and data are preserved) [y/N]"
            $overwrite = ($response -match "^[yY]")
        }

        if ($overwrite) {
            Write-Info "Cleaning old installation (preserving source, configs, workspace, logs)..."
            $binPath  = Join-Path $script:InstallDir "bin"
            $venvPath = Join-Path $script:InstallDir "packages\venv"
            $dlPath   = Join-Path $script:InstallDir "packages\.download"
            if (Test-Path $binPath)  { Remove-Item -Path $binPath -Recurse -Force }
            if (Test-Path $venvPath) { Remove-Item -Path $venvPath -Recurse -Force }
            if (Test-Path $dlPath)   { Remove-Item -Path $dlPath -Recurse -Force }
            # Preserve portable Python/Node if they were detected for reuse
            if (-not $script:UseSystemPython) {
                $pyPath = Join-Path $script:InstallDir "packages\python"
                if (Test-Path $pyPath) { Remove-Item -Path $pyPath -Recurse -Force }
            }
            if (-not $script:UseSystemNode) {
                $nodePath = Join-Path $script:InstallDir "packages\node"
                if (Test-Path $nodePath) { Remove-Item -Path $nodePath -Recurse -Force }
            }
            Write-Ok "Old installation cleared (bin/ + venv; python/node preserved if reused)"
        } else {
            Die "Installation cancelled by user"
        }
    } else {
        Write-Ok "No existing installation found"
    }
}

# ==============================================================================
#  4. DOWNLOAD (Python + Node only -- source comes from local repo)
# ==============================================================================
function Download-Files {
    Write-Section "Downloading Runtime Dependencies"

    $downloadDir = Join-Path $script:InstallDir "packages\.download"
    New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null

    $jobs = @()

    if (-not $script:UseSystemPython) {
        Write-Info "Queueing Python download: $PYTHON_URL"
        $pyFile = Join-Path $downloadDir "python.tar.gz"
        $jobs += [PSCustomObject]@{ Name="Python"; Url=$PYTHON_URL; Dest=$pyFile }
    }

    if (-not $script:UseSystemNode) {
        Write-Info "Queueing Node download: $NODE_URL"
        $nodeFile = Join-Path $downloadDir "node.zip"
        $jobs += [PSCustomObject]@{ Name="Node"; Url=$NODE_URL; Dest=$nodeFile }
    }

    if ($jobs.Count -eq 0) {
        Write-Ok "All runtime deps already available - no downloads needed"
        return
    }

    foreach ($job in $jobs) {
        Write-Info "Downloading $($job.Name)..."
        try {
            # Use TLS 1.2 for compatibility with ihepbox
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            $ProgressPreference = 'SilentlyContinue'
            Invoke-WebRequest -Uri $job.Url -OutFile $job.Dest -UseBasicParsing -ErrorAction Stop
            $fileSize = [math]::Round((Get-Item $job.Dest).Length / 1MB, 1)
            Write-Ok "$($job.Name) downloaded: $fileSize MB -> $($job.Dest)"
        } catch {
            Die "Failed to download $($job.Name): $_"
        }
    }

    Write-Ok "All downloads complete"
}

# ==============================================================================
#  5. EXTRACT (Python .tar.gz + Node .zip)
# ==============================================================================
function Extract-All {
    Write-Section "Extracting Runtime Dependencies"

    $downloadDir = Join-Path $script:InstallDir "packages\.download"
    $pkgDir = Join-Path $script:InstallDir "packages"
    New-Item -ItemType Directory -Path $pkgDir -Force | Out-Null

    # -- Extract Python (.tar.gz) --
    if (-not $script:UseSystemPython) {
        $pyArchive = Join-Path $downloadDir "python.tar.gz"
        if (!(Test-Path $pyArchive)) { Die "Python archive not found: $pyArchive" }
        $pyExtractDir = Join-Path $pkgDir "python"
        Write-Info "Extracting Python -> $pyExtractDir"
        if (Test-Path $pyExtractDir) { Remove-Item -Path $pyExtractDir -Recurse -Force }
        # Use tar (built into Windows 10 1803+)
        & tar -xzf $pyArchive -C $pkgDir 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { Die "tar extraction failed for Python (exit code: $LASTEXITCODE)" }
        # python-build-standalone extracts to 'python' subdir
        if (!(Test-Path $pyExtractDir)) {
            # Try finding the extracted python directory
            $extractedDir = Get-ChildItem $pkgDir -Directory | Where-Object { Test-Path (Join-Path $_.FullName "python.exe") -or Test-Path (Join-Path $_.FullName "bin\python.exe") } | Select-Object -First 1
            if ($extractedDir) {
                Rename-Item -Path $extractedDir.FullName -NewName "python" -Force
            } else {
                Die "Could not find extracted Python directory"
            }
        }
        $script:PythonBin = Join-Path $pyExtractDir "python.exe"
        if (!(Test-Path $script:PythonBin)) {
            $script:PythonBin = Join-Path $pyExtractDir "bin\python.exe"
        }
        if (!(Test-Path $script:PythonBin)) { Die "Python binary not found after extraction" }
        Write-Ok "Python extracted: $script:PythonBin"
    }

    # -- Extract Node (.zip) --
    if (-not $script:UseSystemNode) {
        $nodeArchive = Join-Path $downloadDir "node.zip"
        if (!(Test-Path $nodeArchive)) { Die "Node archive not found: $nodeArchive" }
        $nodeExtractDir = Join-Path $pkgDir "node"
        Write-Info "Extracting Node -> $nodeExtractDir"
        if (Test-Path $nodeExtractDir) { Remove-Item -Path $nodeExtractDir -Recurse -Force }
        Expand-Archive -Path $nodeArchive -DestinationPath $nodeExtractDir -Force
        # Node .zip extracts to a versioned subdir (e.g. node-v22.22.3-win-x64)
        $nodeSubDir = Get-ChildItem $nodeExtractDir -Directory | Select-Object -First 1
        if ($nodeSubDir) {
            # Move contents up one level
            $innerPath = $nodeSubDir.FullName
            Get-ChildItem $innerPath | Move-Item -Destination $nodeExtractDir -Force
            Remove-Item -Path $innerPath -Force -Recurse
        }
        $script:NodeDir = $nodeExtractDir
        $nodeExe = Join-Path $script:NodeDir "node.exe"
        if (!(Test-Path $nodeExe)) { Die "Node binary not found after extraction" }
        Write-Ok "Node extracted: $nodeExe"
    }
}

# ==============================================================================
#  6. PYTHON VENV + EDITABLE INSTALL
# ==============================================================================
function Setup-Python {
    Write-Section "Setting Up Python Virtual Environment"

    $venvDir = Join-Path $script:InstallDir "packages\venv"
    $pyExe   = $script:PythonBin

    Write-Info "Using Python: $pyExe"

    # Create venv (delete if exists for clean install)
    if (Test-Path $venvDir) {
        Write-Info "Removing existing venv..."
        Remove-Item -Path $venvDir -Recurse -Force
    }

    Write-Info "Creating venv -> $venvDir"
    & $pyExe -m venv $venvDir 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Die "venv creation failed (exit code: $LASTEXITCODE)" }

    $venvPython = Join-Path $venvDir "Scripts\python.exe"
    $venvPip    = Join-Path $venvDir "Scripts\pip.exe"
    if (!(Test-Path $venvPython)) { Die "venv python.exe not found at $venvPython" }

    # Upgrade pip
    Write-Info "Upgrading pip..."
    & $venvPython -m pip install --upgrade pip setuptools wheel 2>&1 | ForEach-Object { Write-Host "  $_" }

    # Editable install of drsai from the COPIED source (not the local repo)
    # This allows pip to install dependencies while keeping the package editable
    $drsaiPkgDir = Join-Path $script:InstallDir "cores\python\packages\drsai"
    $pyproject = Join-Path $drsaiPkgDir "pyproject.toml"
    if (!(Test-Path $pyproject)) { Die "drsai pyproject.toml not found at $pyproject" }

    Write-Info "Installing drsai (editable) from: $drsaiPkgDir"
    $env:DRSAI_SKIP_TUI_BUILD = "1"
    & $venvPip install -e "$drsaiPkgDir" 2>&1 | ForEach-Object { Write-Host "  $_" }
    $pipExit = $LASTEXITCODE
    Remove-Item Env:\DRSAI_SKIP_TUI_BUILD -ErrorAction SilentlyContinue
    if ($pipExit -ne 0) { Die "pip install -e drsai failed (exit code: $pipExit)" }

    # Verify drsai is importable (use version submodule to avoid heavy __init__.py)
    Write-Info "Verifying drsai import..."
    $version = & $venvPython -c "from drsai.version import __version__; print(__version__)" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  $version"  # show error
        Die "drsai import verification failed"
    }
    Write-Ok "drsai version: $version"

    Write-Ok "Python venv + editable drsai installed"
    $script:VenvPython = $venvPython
}

# ==============================================================================
#  7. NODE + PNPM SETUP
# ==============================================================================
function Setup-Node {
    Write-Section "Setting Up Node.js + pnpm"

    $nodeExe = Join-Path $script:NodeDir "node.exe"
    $npmCmd  = Join-Path $script:NodeDir "npm.cmd"
    if (!(Test-Path $nodeExe)) { Die "node.exe not found at $nodeExe" }

    Write-Info "Using Node: $nodeExe"
    & $nodeExe -v 2>&1 | ForEach-Object { Write-Host "  $_" }

    # Check if pnpm is already available (via corepack)
    $pnpmCmd = Join-Path $script:NodeDir "pnpm.cmd"
    if (-not (Test-Path $pnpmCmd)) {
        Write-Info "Installing pnpm via corepack..."
        $env:PATH = "$script:NodeDir;$env:PATH"
        & $nodeExe "$script:NodeDir\node_modules\corepack\dist\corepack.js" enable 2>&1 | ForEach-Object { Write-Host "  $_" }
        # If corepack enable did not create pnpm.cmd, try npm install -g
        if (-not (Test-Path $pnpmCmd)) {
            Write-Info "corepack enable did not create pnpm, trying npm install -g pnpm..."
            & $npmCmd install -g pnpm 2>&1 | ForEach-Object { Write-Host "  $_" }
        }
    }

    if (Test-Path $pnpmCmd) {
        Write-Ok "pnpm available: $pnpmCmd"
        & $pnpmCmd -v 2>&1 | ForEach-Object { Write-Host "  $_" }
    } else {
        # Try npx pnpm fallback
        $npxPnpm = Join-Path $script:NodeDir "npx.cmd"
        if (Test-Path $npxPnpm) {
            Write-Warn "Using npx pnpm fallback"
            $pnpmCmd = $null  # will use npx pnpm in build
        } else {
            Die "Could not set up pnpm. Please install pnpm manually."
        }
    }

    $script:NodeExe = $nodeExe
    $script:PnpmCmd = $pnpmCmd
    $script:NpmCmd  = $npmCmd
}

# ==============================================================================
#  8. BUILD TUI (pnpm install + build, 3 retries)
# ==============================================================================
function Build-Tui {
    Write-Section "Building TUI (pnpm install + build)"

    $tuiDir = Join-Path $script:InstallDir "apps\ui-tui"
    if (!(Test-Path (Join-Path $tuiDir "package.json"))) { Die "TUI package.json not found at $tuiDir" }

    # Set PATH so node/pnpm are available
    $env:PATH = "$script:NodeDir;$env:PATH"

    $maxRetries = 3
    $retry = 0
    $success = $false

    while ($retry -lt $maxRetries -and -not $success) {
        $retry++
        Write-Info "Build attempt $retry/$maxRetries..."

        # Step 1: pnpm install
        Write-Info "  pnpm install..."
        if ($script:PnpmCmd) {
            & $script:PnpmCmd install --dir $tuiDir 2>&1 | ForEach-Object { Write-Host "    $_" }
        } else {
            & $script:NpmCmd install --prefix $tuiDir 2>&1 | ForEach-Object { Write-Host "    $_" }
        }
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "  pnpm install failed (exit code: $LASTEXITCODE), retrying..."
            continue
        }

        # Step 2: pnpm build
        Write-Info "  pnpm build..."
        if ($script:PnpmCmd) {
            & $script:PnpmCmd run --dir $tuiDir build 2>&1 | ForEach-Object { Write-Host "    $_" }
        } else {
            & $script:NpmCmd run --prefix $tuiDir build 2>&1 | ForEach-Object { Write-Host "    $_" }
        }
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "  pnpm build failed (exit code: $LASTEXITCODE), retrying..."
            continue
        }

        $success = $true
    }

    if (-not $success) {
        Die "TUI build failed after $maxRetries attempts. Check network and pnpm cache."
    }

    # Verify dist/entry.mjs exists
    $entryMjs = Join-Path $tuiDir "dist\entry.mjs"
    if (!(Test-Path $entryMjs)) { Die "Build succeeded but dist/entry.mjs not found" }

    Write-Ok "TUI built: $entryMjs"
}

# ==============================================================================
#  9. INSTALL SKILLS (multi-select menu from skills/skills/)
# ==============================================================================
function Install-Skills {
    Write-Section "Installing Skills"

    $skillsDir = Join-Path $script:InstallDir "skills\skills"
    if (!(Test-Path $skillsDir)) {
        Write-Warn "skills/skills directory not found - skipping skill installation"
        return
    }

    $skillSubdirs = Get-ChildItem $skillsDir -Directory -ErrorAction SilentlyContinue | Sort-Object Name
    if ($skillSubdirs.Count -eq 0) {
        Write-Warn "No skills found in skills/skills - skipping"
        return
    }

    Write-Info "Available skills:"
    for ($i = 0; $i -lt $skillSubdirs.Count; $i++) {
        $skillName = $skillSubdirs[$i].Name
        $skillMd = Join-Path $skillSubdirs[$i].FullName "SKILL.md"
        $desc = ""
        if (Test-Path $skillMd) {
            $firstLine = Get-Content $skillMd -TotalCount 1 -ErrorAction SilentlyContinue
            if ($firstLine) { $desc = $firstLine.TrimStart('#').Trim() }
        }
        Write-Host ("  [{0}] {1} - {2}" -f ($i + 1), $skillName, $desc)
    }

    Write-Host ""
    Write-Host "Enter skill numbers to install (comma-separated), 'all' for all, or Enter to skip:"
    $selection = Read-Host

    $selected = @()
    if ($selection -match "^all\$" -or $selection -match "^a\$") {
        $selected = $skillSubdirs | ForEach-Object { $_.Name }
    } elseif ($selection.Trim()) {
        $nums = $selection -split '[,\s]+' | Where-Object { $_ -match '^\d+\$' }
        foreach ($n in $nums) {
            $idx = [int]$n - 1
            if ($idx -ge 0 -and $idx -lt $skillSubdirs.Count) {
                $selected += $skillSubdirs[$idx].Name
            }
        }
    }

    if ($selected.Count -eq 0) {
        Write-Info "No skills selected - skipping"
        return
    }

    # Skills are already copied by Copy-RepoSource, just create the skills config
    $skillsConfigDir = Join-Path $script:InstallDir ".drsai\workspace\runs\$env:USERNAME\configs\skills"
    New-Item -ItemType Directory -Path $skillsConfigDir -Force | Out-Null

    foreach ($skillName in $selected) {
        $srcSkillDir = Join-Path $skillsDir $skillName
        $dstSkillDir = Join-Path $skillsConfigDir $skillName
        if (Test-Path $srcSkillDir) {
            # Copy the skill to the user's config directory
            if (Test-Path $dstSkillDir) { Remove-Item -Path $dstSkillDir -Recurse -Force }
            Copy-Item -Path $srcSkillDir -Destination $dstSkillDir -Recurse -Force
            Write-Ok "Skill installed: $skillName"
        }
    }

    Write-Ok "$($selected.Count) skill(s) installed"
}

# ==============================================================================
#  10. CREATE LAUNCHER (.cmd batch file)
# ==============================================================================
function Create-Launcher {
    Write-Section "Creating Launcher"

    $binDir = Join-Path $script:InstallDir "bin"
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null

    # Build the PATH prefix: node dir + venv Scripts dir
    $venvScripts = Join-Path $script:InstallDir "packages\venv\Scripts"
    $pathPrefix = "$script:NodeDir;$venvScripts"

    # .cmd launcher that sets up environment and runs the TUI
    $launcherPath = Join-Path $binDir "opendrsai.cmd"
    $launcherContent = @"
@echo off
setlocal
set PATH=$pathPrefix;%PATH%
set DRSAI_HOME=$script:InstallDir
cd /d %USERPROFILE%
"$script:NodeExe" "$script:InstallDir\apps\ui-tui\dist\entry.mjs" %*
endlocal
"@

    Set-Content -Path $launcherPath -Value $launcherContent -Encoding ASCII
    Write-Ok "Launcher created: $launcherPath"

    # Add to user PATH (permanent)
    $currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($currentPath -notlike "*$binDir*") {
        Write-Info "Adding $binDir to user PATH..."
        $newPath = "$binDir;$currentPath"
        [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
        Write-Ok "Added to user PATH (new terminals will have it)"
    } else {
        Write-Ok "$binDir already in user PATH"
    }
}

# ==============================================================================
#  11. VERIFY INSTALLATION
# ==============================================================================
function Verify-Install {
    Write-Section "Verifying Installation"

    $allOk = $true

    # Check drsai import (lightweight: only version submodule, avoids heavy __init__.py)
    Write-Info "Checking drsai import..."
    $venvPy = Join-Path $script:InstallDir "packages\venv\Scripts\python.exe"
    if (Test-Path $venvPy) {
        $ver = & $venvPy -c "from drsai.version import __version__; print(__version__)" 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "drsai version: $ver"
        } else {
            Write-Err "drsai import failed: $ver"
            $allOk = $false
        }
    }

    $checks = @(
        @{ Name="Python venv";       Path=(Join-Path $script:InstallDir "packages\venv\Scripts\python.exe") },
        @{ Name="drsai package";     Path=(Join-Path $script:InstallDir "cores\python\packages\drsai\pyproject.toml") },
        @{ Name="TUI source";        Path=(Join-Path $script:InstallDir "apps\ui-tui\package.json") },
        @{ Name="TUI build output"; Path=(Join-Path $script:InstallDir "apps\ui-tui\dist\entry.mjs") },
        @{ Name="Launcher";          Path=(Join-Path $script:InstallDir "bin\opendrsai.cmd") }
    )

    foreach ($check in $checks) {
        if (Test-Path $check.Path) {
            Write-Ok "$($check.Name): OK"
        } else {
            Write-Err "$($check.Name): MISSING ($($check.Path))"
            $allOk = $false
        }
    }

    if ($allOk) {
        Write-Host ""
        Write-Host "======================================================" -ForegroundColor Green
        Write-Host "  OpenDrSai Dev installation complete!" -ForegroundColor Green
        Write-Host "======================================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "  Install dir: $($script:InstallDir)"
        Write-Host "  Launcher:    $($script:InstallDir)\bin\opendrsai.cmd"
        Write-Host ""
        Write-Host "  Open a NEW terminal and run: opendrsai"
        Write-Host ""
        Write-Host "  To sync source edits (after modifying code in the repo):"
        Write-Host "    .\install_drsai_dev.ps1 -Sync"
        Write-Host ""
    } else {
        Die "Verification failed - some components are missing"
    }
}

# ==============================================================================
#  12. SYNC ACTION (re-copy source + optionally rebuild TUI)
# ==============================================================================
function Do-Sync {
    Write-Section "Sync Action: Re-copying source from local repo"

    # Check running processes first
    Check-Running

    # Re-copy source
    Copy-RepoSource -DstRoot $script:InstallDir

    if (-not $NoRebuild) {
        # Rebuild TUI
        Build-Tui
    } else {
        Write-Info "-NoRebuild specified, skipping TUI rebuild"
    }

    Write-Host ""
    Write-Host "======================================================" -ForegroundColor Green
    Write-Host "  Sync complete!" -ForegroundColor Green
    Write-Host "======================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Source re-copied from: $($script:RepoRoot)"
    Write-Host "  Install dir: $($script:InstallDir)"
    if (-not $NoRebuild) {
        Write-Host "  TUI rebuilt: Yes"
    } else {
        Write-Host "  TUI rebuilt: No (-NoRebuild)"
    }
    Write-Host ""
}

# ==============================================================================
#  MAIN
# ==============================================================================
function Main {
    # -- Repo root already set at script level via $PSScriptRoot --
    # (do not re-compute here; $MyInvocation inside a function refers to
    #  the function call, not the script, so $MyInvocation.MyCommand.Path
    #  would be empty)

    # -- Handle -Sync action (quick path: skip most setup) --
    if ($Sync) {
        # For sync, we need the install dir
        if ([string]::IsNullOrWhiteSpace($InstallDir)) {
            $script:InstallDir = $DEFAULT_INSTALL_DIR
        } else {
            $script:InstallDir = $InstallDir
        }
        Do-Sync
        return
    }

    # -- Normal install flow --

    # 1. Platform detection
    Detect-Platform

    # 2. Select install directory (also sets $script:InstallDir)
    Select-InstallDir

    # 3. Detect system deps (also sets $script:UseSystemPython/Node flags)
    Detect-SystemDeps

    # 4. Check for running DrSai processes
    Check-Running

    # 5. Check existing installation
    Check-Existing

    # 6. Copy local repo source (apps/ui-tui + cores + skills/skills)
    Copy-RepoSource -DstRoot $script:InstallDir

    # 7. Download runtime deps (Python + Node, if not using system)
    Download-Files

    # 8. Extract runtime deps
    Extract-All

    # 9. Setup Python venv + editable install
    Setup-Python

    # 10. Setup Node + pnpm
    Setup-Node

    # 11. Build TUI
    Build-Tui

    # 12. Install skills
    Install-Skills

    # 13. Create launcher
    Create-Launcher

    # 14. Verify
    Verify-Install
}

# -- Run main --
Main
