# DrSai Desktop — Local Dev Setup Stub
# ======================================
# 在 ~/.drsai 下创建安装桩，跳过 install.ps1 下载流程
# 执行后重启 Electron 即可
#
# 现在的启动方式: Electron → spawn(python, ["-m", "drsai.backend.gateway"])
# 不再依赖 DRSAI_API_SCRIPT，直接通过模块路径启动

$ErrorActionPreference = "Stop"

# ── Auto-detect project root ──────────────────────────
# This script lives in desktop/scripts/ → go up 2 levels to project root
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
Write-Host "Project root: $ProjectRoot" -ForegroundColor Green

# ── 找到实际 Python 路径（跳过 Windows Store 桩） ────
$pythonPath = $null
foreach ($name in @("python", "python3")) {
    $c = Get-Command $name -ErrorAction SilentlyContinue
    if ($c -and $c.Source -notmatch 'WindowsApps') {
        $pythonPath = $c.Source
        break
    }
}
if (-not $pythonPath) {
    Write-Host "ERROR: Python not found." -ForegroundColor Red
    Write-Host "        Install via: conda / scoop / winget / python.org" -ForegroundColor Yellow
    Write-Host "        Do NOT use the Microsoft Store version." -ForegroundColor Yellow
    exit 1
}
Write-Host "Python: $pythonPath" -ForegroundColor Green

# ── 创建桩目录 ──────────────────────────────────────────
$stubDir = "$env:USERPROFILE\.drsai\drsai-agent\venv\Scripts"
New-Item -ItemType Directory -Force -Path $stubDir | Out-Null

# ── python.exe 桩 — 直接 symlink 到实际 Python ──────────
$pythonStub = Join-Path $stubDir "python.exe"
if (-not (Test-Path $pythonStub)) {
    cmd /c mklink "$pythonStub" "$pythonPath" 2>$null
    if ($LASTEXITCODE -ne 0) {
        cmd /c mklink /H "$pythonStub" "$pythonPath" 2>$null
        if ($LASTEXITCODE -ne 0) {
            @"
@echo off
"$pythonPath" %*
"@ | Out-File -Encoding ASCII "$pythonStub.bat"
            Write-Host "python.exe wrapper: $pythonStub.bat" -ForegroundColor Yellow
        }
    }
    Write-Host "python.exe stub created" -ForegroundColor Green
} else {
    Write-Host "python.exe stub already exists" -ForegroundColor Green
}

# ── drsai CLI stub — 调用 python -m drsai.backend.run_cli ──
$drsaiStub = Join-Path $stubDir "drsai.cmd"
@"
@echo off
"$pythonPath" -m drsai.backend.run_cli %*
"@ | Out-File -Encoding ASCII $drsaiStub
Write-Host "drsai.cmd stub: $drsaiStub" -ForegroundColor Green

# ── DRSAI_HOME 确保正确 ─────────────────────────────────
$env:DRSAI_HOME = "$env:USERPROFILE\.drsai"
[Environment]::SetEnvironmentVariable("DRSAI_HOME", $env:DRSAI_HOME, "User")

Write-Host ""
Write-Host "Done! Stub install created." -ForegroundColor Cyan
Write-Host "Restart Electron and the install prompt should be gone." -ForegroundColor Cyan
Write-Host ""
Write-Host "Gateway will auto-start via: python -m drsai.backend.gateway" -ForegroundColor Green
