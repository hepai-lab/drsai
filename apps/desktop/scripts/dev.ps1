# DrSai Desktop — Windows Dev Mode (hot reload)
# ==============================================
# Starts API gateway with uvicorn --reload + Electron dev server.
# For daily development when you're modifying both Python and Electron code.
#
# Usage:
#   .\desktop\scripts\dev.ps1
#
# Prerequisites:
#   - Run .\desktop\scripts\setup_dev_stubs.ps1 once first
#   - Python 3.10+ with drsai package on PYTHONPATH
#   - Node.js 18+

param(
    [int]$Port = 18642
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
# desktop\scripts\ → desktop\ → project root
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$DesktopDir = Join-Path $ProjectRoot "desktop\drsai-desktop"
$DrsaiSrc = Join-Path $ProjectRoot "python\packages\drsai\src"

Write-Host @"
╔══════════════════════════════════════════════╗
║      DrSai Desktop — Dev Mode (Win)          ║
╚══════════════════════════════════════════════╝
"@ -ForegroundColor Cyan

# ── Prerequisites ──────────────────────────────────────
Write-Host "[1/4] Checking prerequisites..." -ForegroundColor Yellow

try { $n = node --version; Write-Host "  Node.js: $n" -ForegroundColor Green } catch {
    Write-Host "  ERROR: Node.js not found" -ForegroundColor Red; exit 1
}
try { $p = python --version 2>&1; Write-Host "  Python:  $p" -ForegroundColor Green } catch {
    Write-Host "  ERROR: Python not found" -ForegroundColor Red; exit 1
}
if (-not (Test-Path $DrsaiSrc)) {
    Write-Host "  ERROR: drsai package not found at $DrsaiSrc" -ForegroundColor Red; exit 1
}
Write-Host "  drsai src: $DrsaiSrc" -ForegroundColor Green

# ── Install deps (if needed) ───────────────────────────
if (-not (Test-Path (Join-Path $DesktopDir "node_modules"))) {
    Write-Host "[2/4] Installing npm dependencies..." -ForegroundColor Yellow
    Push-Location $DesktopDir; npm install; Pop-Location
} else {
    Write-Host "[2/4] Dependencies OK" -ForegroundColor Green
}

# ── Start API gateway (hot reload) ─────────────────────
Write-Host "[3/4] Starting API gateway (hot reload) on port $Port..." -ForegroundColor Yellow

$env:PYTHONPATH = "$DrsaiSrc;$env:PYTHONPATH"
$env:DRSAI_API_PORT = "$Port"
$env:DRSAI_DEV_SKIP_INSTALL = "1"    # Skip Electron install check in dev mode
$env:DRSAI_HOME = if ($env:DRSAI_HOME) { $env:DRSAI_HOME } else { Join-Path $env:USERPROFILE ".drsai" }

$apiJob = Start-Job -ScriptBlock {
    param($src, $port)
    $env:PYTHONPATH = $src
    $env:DRSAI_API_PORT = "$port"
    Set-Location $using:ProjectRoot
    python -m uvicorn drsai.backend.gateway:app --host 127.0.0.1 --port $port --reload
} -ArgumentList $DrsaiSrc, $Port

# Wait for gateway
Write-Host "  Waiting for gateway..." -NoNewline
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:${Port}/health" -TimeoutSec 1 -UseBasicParsing
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
    Write-Host "." -NoNewline
    Start-Sleep 1
}
if ($ready) {
    Write-Host " ready" -ForegroundColor Green
} else {
    Write-Host " FAILED" -ForegroundColor Red
    Stop-Job $apiJob; exit 1
}

# ── Start Electron ─────────────────────────────────────
Write-Host "[4/4] Starting Electron dev server..." -ForegroundColor Yellow
Write-Host ""
Write-Host "  Press Ctrl+C to stop all services" -ForegroundColor Cyan
Write-Host ""

Push-Location $DesktopDir
try {
    npm run dev
} finally {
    Pop-Location
    Write-Host "Stopping gateway..." -ForegroundColor Yellow
    Stop-Job $apiJob -ErrorAction SilentlyContinue
    Remove-Job $apiJob -ErrorAction SilentlyContinue
}
