# DrSai Desktop — Windows PowerShell Launch Script
# ==================================================
# Usage: .\launch.ps1 [dev|build|clean]
#
# Requirements:
#   - Node.js 18+ (with npm)
#   - Python 3.10+ (for DrSai API server)
#   - Git (for cloning drsai-agent if needed)
#
# The dev command starts both the DrSai API server and the Electron dev server.

param(
    [ValidateSet("dev", "build", "clean")]
    [string]$Command = "dev"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopDir = Join-Path $ProjectRoot "desktop\drsai-desktop"

Write-Host @"
╔══════════════════════════════════════════════╗
║         DrSai Desktop Launcher               ║
║         v0.1.0 — HepAI Team, IHEP            ║
╚══════════════════════════════════════════════╝
"@ -ForegroundColor Cyan

# ── Prerequisite Checks ──────────────────────────────────

Write-Host "[1/4] Checking prerequisites..." -ForegroundColor Yellow

# Node.js
try {
    $nodeVer = (node --version 2>&1).Trim()
    Write-Host "  Node.js: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Node.js not found. Install from https://nodejs.org/" -ForegroundColor Red
    exit 1
}

# npm
try {
    $npmVer = (npm --version 2>&1).Trim()
    Write-Host "  npm:     v$npmVer" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: npm not found." -ForegroundColor Red
    exit 1
}

# Python
try {
    $pyVer = (python --version 2>&1).Trim()
    Write-Host "  Python:  $pyVer" -ForegroundColor Green
} catch {
    Write-Host "  WARNING: Python not found. DrSai API server won't start." -ForegroundColor Yellow
}

Write-Host ""

# ── Command Dispatch ─────────────────────────────────────

switch ($Command) {
    "clean" {
        Write-Host "[2/4] Cleaning build artifacts..." -ForegroundColor Yellow
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $DesktopDir "out")
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $DesktopDir "node_modules")
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $DesktopDir "dist")
        Write-Host "  Done. Run 'launch.ps1 dev' to start fresh." -ForegroundColor Green
        exit 0
    }
    "build" {
        Write-Host "[2/4] Installing dependencies..." -ForegroundColor Yellow
        Push-Location $DesktopDir
        npm install
        Write-Host "[3/4] Building TypeScript + Vite..." -ForegroundColor Yellow
        npm run build
        Write-Host "[4/4] Packaging for Windows..." -ForegroundColor Yellow
        npm run build:win
        Pop-Location
        Write-Host "  Build complete! Check dist/ folder." -ForegroundColor Green
        exit 0
    }
    "dev" {
        # Check if node_modules exists
        if (-not (Test-Path (Join-Path $DesktopDir "node_modules"))) {
            Write-Host "[2/4] Installing dependencies (first run)..." -ForegroundColor Yellow
            Push-Location $DesktopDir
            npm install
            Pop-Location
        } else {
            Write-Host "[2/4] Dependencies already installed." -ForegroundColor Green
        }

        Write-Host "[3/4] Setting environment..." -ForegroundColor Yellow

        # ── Dev mode: skip install checks ──────────────────────────
        $env:DRSAI_DEV_SKIP_INSTALL = "1"
        Write-Host "  DRSAI_DEV_SKIP_INSTALL = 1" -ForegroundColor Green

        # Set DrSai home (use user's .drsai directory)
        if (-not $env:DRSAI_HOME) {
            $env:DRSAI_HOME = Join-Path $env:USERPROFILE ".drsai"
            Write-Host "  DRSAI_HOME = $env:DRSAI_HOME" -ForegroundColor Green
        }

        # Ensure drsai package is importable
        $drsaiSrc = Join-Path $ProjectRoot "python\packages\drsai\src"
        $env:PYTHONPATH = "$drsaiSrc;$env:PYTHONPATH"
        Write-Host "  PYTHONPATH += $drsaiSrc" -ForegroundColor Green

        Write-Host "[4/4] Starting DrSai Desktop (dev mode)..." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  Electron window will open shortly." -ForegroundColor Cyan
        Write-Host "  Press Ctrl+C to stop." -ForegroundColor Cyan
        Write-Host ""

        Push-Location $DesktopDir
        try {
            npm run dev
            if ($LASTEXITCODE -ne 0) { throw "npm run dev failed" }
        } finally {
            Pop-Location
        }
    }
}

Write-Host "Done." -ForegroundColor Green
