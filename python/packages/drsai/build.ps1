#!/usr/bin/env pwsh
# ==============================================================================
# DrSai Tray — Windows Build Script (PowerShell)
# ==============================================================================
#
# Usage:
#   .\build.ps1                  # Full build (package + installer)
#   .\build.ps1 -SkipInstaller   # PyInstaller only, skip NSIS installer
#   .\build.ps1 -Clean           # Clean rebuild from scratch
#   .\build.ps1 -Version "1.2.4" # Override version number
#   .\build.ps1 -SkipTest        # Skip post-build manual test prompt
#
# ==============================================================================

param(
    [string]$Version = "",
    [bool]$Clean = $false,
    [bool]$SkipInstaller = $false,
    [bool]$SkipTest = $false
)
# Version: override version number; Clean: rebuild from scratch
# SkipInstaller: skip NSIS installer; SkipTest: skip post-build manual test

$ErrorActionPreference = "Stop"

# ── Color output functions ────────────────────────────────────────────────
function Write-Step([string]$msg) {
    Write-Host "`n  ██████  $msg" -ForegroundColor Cyan
}
function Write-Info([string]$msg) {
    Write-Host "  ┃  $msg" -ForegroundColor Gray
}
function Write-Ok([string]$msg) {
    Write-Host "  ┃  ✅ $msg" -ForegroundColor Green
}
function Write-Warn([string]$msg) {
    Write-Host "  ┃  ⚠️  $msg" -ForegroundColor Yellow
}
function Write-Err([string]$msg) {
    Write-Host "  ┃  ❌ $msg" -ForegroundColor Red
}

# ── Project paths ─────────────────────────────────────────────────────────
$PROJECT_ROOT = $PSScriptRoot
$SRC_DIR      = Join-Path $PROJECT_ROOT "src"
$BUILD_DIR    = Join-Path $PROJECT_ROOT "build"
$DIST_DIR     = Join-Path $PROJECT_ROOT "dist"
$ICON_DIR     = Join-Path $BUILD_DIR "icons"
$SPEC_FILE    = Join-Path $PROJECT_ROOT "drsai-tray.spec"
$NSIS_FILE    = Join-Path $PROJECT_ROOT "installer.nsi"

Write-Host "`n╔══════════════════════════════════════════════════════════════╗"
Write-Host "║         DrSai Tray — Windows Build System                   ║"
Write-Host "╚══════════════════════════════════════════════════════════════╝"

# ── Step 0: Clean (optional) ──────────────────────────────────────────────
if ($Clean) {
    Write-Step "Step 0: Clean old build artifacts"
    if (Test-Path $BUILD_DIR)  { Remove-Item -Recurse -Force $BUILD_DIR;  Write-Info "Removed build/" }
    if (Test-Path $DIST_DIR)   { Remove-Item -Recurse -Force $DIST_DIR;   Write-Info "Removed dist/" }
    Write-Ok "Clean complete"
}

# ── Step 1: Environment check ─────────────────────────────────────────────
Write-Step "Step 1: Environment check"

# NOTE: $ErrorActionPreference = "Stop" makes any stderr from native commands
# a terminating error (RemoteException). We use two strategies:
#   1. 2>$null + try/catch  for quick import checks (discard stderr)
#   2. Temporarily set $ErrorActionPreference = "Continue" for commands
#      whose stderr we want to capture (e.g. PyInstaller, makensis).

# Python
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
$pythonExe = if ($pythonCmd) { $pythonCmd.Source } else { $null }
if (-not $pythonExe) {
    Write-Err "Python not found. Install Python 3.11+ and add to PATH."
    exit 1
}
$pyVersion = & python --version 2>$null
Write-Ok "Python: $pyVersion"

# drsai importable — use importlib.metadata (more reliable than drsai.__version__)
try {
    $drsaiCheck = & python -c "import importlib.metadata; print(importlib.metadata.version('drsai'))" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Err "drsai not installed. Run: pip install -e .[tray]"
        exit 1
    }
    Write-Ok "drsai: $drsaiCheck"
} catch {
    Write-Err "drsai not installed. Run: pip install -e .[tray]"
    exit 1
}

# pystray importable
try {
    $pystrayCheck = & python -c "import pystray; print('OK')" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Err "pystray not installed. Run: pip install drsai[tray]"
        exit 1
    }
    Write-Ok "pystray: installed"
} catch {
    Write-Err "pystray not installed. Run: pip install drsai[tray]"
    exit 1
}

# tkinter importable
try {
    $tkCheck = & python -c "import tkinter; print('OK')" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Err "tkinter not available. Ensure Python includes tkinter."
        exit 1
    }
    Write-Ok "tkinter: installed"
} catch {
    Write-Err "tkinter not available. Ensure Python includes tkinter."
    exit 1
}

# PyInstaller — use importlib.metadata for reliable version
try {
    $pyinstallerCheck = & python -c "import importlib.metadata; print(importlib.metadata.version('pyinstaller'))" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Err "PyInstaller not installed. Run: pip install pyinstaller"
        exit 1
    }
    Write-Ok "PyInstaller: $pyinstallerCheck"
} catch {
    Write-Err "PyInstaller not installed. Run: pip install pyinstaller"
    exit 1
}

# NSIS (only checked when building installer)
if (-not $SkipInstaller) {
    $makensisCmd = Get-Command makensis -ErrorAction SilentlyContinue
    $makensis = if ($makensisCmd) { $makensisCmd.Source } else { $null }
    if (-not $makensis) {
        Write-Warn "makensis not found. Will skip installer build."
        Write-Info "  Download NSIS: https://nsis.sourceforge.io/Download"
        $SkipInstaller = $true
    } else {
        $nsisVersion = & makensis /VERSION 2>$null
        Write-Ok "NSIS: $nsisVersion"
    }
}

# ── Step 2: Read/set version ──────────────────────────────────────────────
Write-Step "Step 2: Read version number"

$versionFile = Join-Path (Join-Path $SRC_DIR "drsai") "version.py"
$versionContent = Get-Content $versionFile -Raw

if ($Version) {
    Write-Info "Using specified version: $Version"
    $currentVersion = $Version
} else {
    # Use \x27 (hex for single quote) to avoid PS string-quoting issues.
    # Regex equivalent: __version__\s*=\s*["']([^"']+)["']
    $match = [regex]::Match($versionContent, '__version__\s*=\s*["\x27]([^"\x27]+)["\x27]')
    if ($match.Success) {
        $currentVersion = $match.Groups[1].Value
    } else {
        Write-Err "Cannot read version from version.py"
        exit 1
    }
    Write-Info "Read version from version.py: $currentVersion"
}
Write-Ok "Version: v$currentVersion"

# ── Step 3: Generate icon files ───────────────────────────────────────────
Write-Step "Step 3: Generate icon files"

New-Item -ItemType Directory -Force -Path $ICON_DIR | Out-Null

$icoFile = Join-Path $ICON_DIR "drsai_robot.ico"
if (Test-Path $icoFile) {
    Write-Ok "Icon file exists: $icoFile"
} else {
    Write-Info "Generating robot icon..."
    try {
        & python -c @"
from drsai.backend.gui.icon_generator import draw_robot_icon, save_icon_set
img = draw_robot_icon(256)
files = save_icon_set(img, '$ICON_DIR')
for k, v in files.items():
    print(f'  {k}: {v}')
"@ 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Icon generation failed, will use default icon"
        } else {
            Write-Ok "Icon generation complete"
        }
    } catch {
        Write-Warn "Icon generation failed, will use default icon"
    }
}

# ── Step 4: Prepare LICENSE.rtf ───────────────────────────────────────────
Write-Step "Step 4: Prepare LICENSE.rtf (required by NSIS installer)"

$licenseRtf = Join-Path $PROJECT_ROOT "LICENSE.rtf"
if (-not (Test-Path $licenseRtf)) {
    Write-Info "LICENSE.rtf missing, generating from LICENSE..."

    $licenseFile = Join-Path $PROJECT_ROOT "LICENSE"
    if (Test-Path $licenseFile) {
        $licenseText = Get-Content $licenseFile -Raw
        $rtfContent = @"
{\rtf1\ansi\deff0
{\fonttbl{\f0\fswiss Arial;}}
\f0\fs20
$licenseText
}
"@
        Set-Content -Path $licenseRtf -Value $rtfContent -Encoding Unicode
        Write-Ok "Generated LICENSE.rtf"
    } else {
        Write-Warn "LICENSE file missing, creating placeholder"
        $rtfContent = @"
{\rtf1\ansi\deff0
{\fonttbl{\f0\fswiss Arial;}}
\f0\fs20
MIT License - DrSai Project
}
"@
        Set-Content -Path $licenseRtf -Value $rtfContent -Encoding Unicode
        Write-Ok "Generated placeholder LICENSE.rtf"
    }
} else {
    Write-Ok "LICENSE.rtf already exists"
}

# ── Step 5: PyInstaller packaging ─────────────────────────────────────────
Write-Step "Step 5: PyInstaller packaging (onedir)"

Write-Info "Running PyInstaller..."
# Temporarily relax ErrorActionPreference: PyInstaller writes routine
# warnings to stderr; "Stop" would treat them as terminating errors.
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$pyinstallerResult = & pyinstaller $SPEC_FILE --noconfirm 2>&1
$ErrorActionPreference = $prevEAP

if ($LASTEXITCODE -ne 0) {
    Write-Err "PyInstaller packaging failed!"
    Write-Info "Check hiddenimports in drsai-tray.spec"
    Write-Info "Common fix: ModuleNotFoundError -> add --hidden-import"
    exit 1
}

$distExe = Join-Path (Join-Path $DIST_DIR "drsai-tray") "drsai-tray.exe"
if (-not (Test-Path $distExe)) {
    Write-Err "Packaged exe not found: $distExe"
    exit 1
}

$distDirSize = (Get-ChildItem (Join-Path $DIST_DIR "drsai-tray") -Recurse |
    Measure-Object -Property Length -Sum).Sum / 1MB
Write-Ok "Packaging complete! Output: dist/drsai-tray/"
Write-Info "Package size: $([math]::Round($distDirSize, 1)) MB"

# ── Step 6: Post-build test ───────────────────────────────────────────────
if (-not $SkipTest) {
    Write-Step "Step 6: Post-build verification test"

    Write-Host "`n  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓" -ForegroundColor Yellow
    Write-Host "  ┃  ⚠️  Please manually test drsai-tray.exe                      ┃" -ForegroundColor Yellow
    Write-Host "  ┃                                                          ┃" -ForegroundColor Yellow
    Write-Host "  ┃  Test checklist:                                          ┃" -ForegroundColor Yellow
    Write-Host "  ┃    1. Double-click dist\drsai-tray\drsai-tray.exe          ┃" -ForegroundColor Yellow
    Write-Host "  ┃    2. System tray icon appears?                            ┃" -ForegroundColor Yellow
    Write-Host "  ┃    3. Double-click tray icon -> chat window?               ┃" -ForegroundColor Yellow
    Write-Host "  ┃    4. Send message -> get reply?                           ┃" -ForegroundColor Yellow
    Write-Host "  ┃    5. Close window -> minimize to tray?                    ┃" -ForegroundColor Yellow
    Write-Host "  ┃    6. Right-click tray -> Exit -> clean shutdown?          ┃" -ForegroundColor Yellow
    Write-Host "  ┃                                                          ┃" -ForegroundColor Yellow
    Write-Host "  ┃  If issues found, fix drsai-tray.spec and rebuild.        ┃" -ForegroundColor Yellow
    Write-Host "  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛" -ForegroundColor Yellow

    $response = Read-Host "`n  Did tests pass? (Y/n)"
    if ($response -ne "Y" -and $response -ne "y" -and $response -ne "") {
        Write-Err "Tests failed. Fix issues and rerun build.ps1"
        exit 1
    }
    Write-Ok "Tests passed"
}

# ── Step 7: Update NSIS version ───────────────────────────────────────────
if (-not $SkipInstaller) {
    Write-Step "Step 7: Update NSIS installer version"

    Write-Info "Setting version to v$currentVersion in installer.nsi"

    $nsisContent = Get-Content $NSIS_FILE -Raw
    $nsisContent = $nsisContent -replace '!define VERSION\s+"[^"]*"', "!define VERSION        `"$currentVersion`""
    Set-Content -Path $NSIS_FILE -Value $nsisContent -NoNewline
    Write-Ok "NSIS version updated to v$currentVersion"

    # ── Step 8: NSIS compile ──────────────────────────────────────────────
    Write-Step "Step 8: NSIS installer compile"

    $setupExe = Join-Path $PROJECT_ROOT "DrSai-Setup-v$currentVersion.exe"

    Write-Info "Compiling installer.nsi..."
    # Temporarily relax ErrorActionPreference: makensis outputs info
    # to stderr; "Stop" would treat them as terminating errors.
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $nsisResult = & makensis $NSIS_FILE 2>&1
    $ErrorActionPreference = $prevEAP

    if ($LASTEXITCODE -ne 0) {
        Write-Err "NSIS compile failed!"
        Write-Info "Error details:"
        Write-Host $nsisResult
        Write-Info "Common issues:"
        Write-Info "  - LICENSE.rtf format incorrect"
        Write-Info "  - Icon file path missing"
        Write-Info "  - dist/drsai-tray/ directory missing"
        exit 1
    }

    if (-not (Test-Path $setupExe)) {
        Write-Err "Installer exe not generated: $setupExe"
        Write-Info "NSIS output:"
        Write-Host $nsisResult
        exit 1
    }

    $setupSize = (Get-Item $setupExe).Length / 1MB
    Write-Ok "Installer compile complete!"
    Write-Ok "Installer: $setupExe"
    Write-Info "Installer size: $([math]::Round($setupSize, 1)) MB"
}

# ── Step 9: Build complete ────────────────────────────────────────────────
Write-Step "Build complete!"

Write-Host "`n  ╔════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║  🎉 DrSai v$currentVersion Windows build successful!             ║" -ForegroundColor Green
Write-Host "  ╠════════════════════════════════════════════════════════════╣" -ForegroundColor Green

if (-not $SkipInstaller) {
    Write-Host "  ║  Installer: DrSai-Setup-v$currentVersion.exe                  ║" -ForegroundColor Green
    Write-Host "  ║  PyInstaller output: dist/drsai-tray/                      ║" -ForegroundColor Green
} else {
    Write-Host "  ║  PyInstaller output: dist/drsai-tray/                      ║" -ForegroundColor Green
    Write-Host "  ║  (NSIS installer skipped)                                  ║" -ForegroundColor Green
}

Write-Host "  ╠════════════════════════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "  ║  Next steps:                                               ║" -ForegroundColor Green

if (-not $SkipInstaller) {
    Write-Host "  ║  1. Test installer on a clean Windows machine              ║" -ForegroundColor Green
} else {
    Write-Host "  ║  1. Test dist/drsai-tray/drsai-tray.exe                   ║" -ForegroundColor Green
    Write-Host "  ║  2. Install NSIS then run build.ps1 for installer          ║" -ForegroundColor Green
}

Write-Host "  ║  2. Upload to GitHub Releases                              ║" -ForegroundColor Green
Write-Host "  ╚════════════════════════════════════════════════════════════╝`n" -ForegroundColor Green