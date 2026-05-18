# DrSai Desktop — Local Dev Setup Stub
# ======================================
# 在 ~/.drsai 下创建安装桩，跳过 install.ps1 下载流程
# 执行后重启 Electron 即可

$ErrorActionPreference = "Stop"

# ── 找到你的实际 Python 路径 ────────────────────────────
$pythonPath = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $pythonPath) {
    Write-Host "ERROR: python not found. Activate your conda env first!" -ForegroundColor Red
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
        # symlink 失败（非管理员），改用硬链接
        cmd /c mklink /H "$pythonStub" "$pythonPath" 2>$null
        if ($LASTEXITCODE -ne 0) {
            # 都失败，创建一个简单的 bat wrapper
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

# ── drsai.exe 桩 — 调用 python -m drsai ─────────────────
$drsaiStub = Join-Path $stubDir "drsai.cmd"
@"
@echo off
"$pythonPath" -m drsai.backend.run_cli %*
"@ | Out-File -Encoding ASCII $drsaiStub
Write-Host "drsai.cmd stub: $drsaiStub" -ForegroundColor Green

# ── DRSAI_HOME 确保正确 ─────────────────────────────────
$env:DRSAI_HOME = "$env:USERPROFILE\.drsai"
[Environment]::SetEnvironmentVariable("DRSAI_HOME", $env:DRSAI_HOME, "User")

# ── DRSAI_API_SCRIPT 指向实际 API Server ────────────────
$apiScript = "D:\work\DrSai\drsai\desktop\drsai_api_server.py"
if (Test-Path $apiScript) {
    $env:DRSAI_API_SCRIPT = $apiScript
    [Environment]::SetEnvironmentVariable("DRSAI_API_SCRIPT", $apiScript, "User")
    Write-Host "DRSAI_API_SCRIPT set: $apiScript" -ForegroundColor Green
}

Write-Host ""
Write-Host "Done! Stub install created." -ForegroundColor Cyan
Write-Host "Restart Electron and the install prompt should be gone." -ForegroundColor Cyan
Write-Host ""
Write-Host "To run the desktop app:" -ForegroundColor Yellow
Write-Host "  1. Start API server: python D:\work\DrSai\drsai\desktop\drsai_api_server.py" -ForegroundColor White
Write-Host "  2. Start Electron:   cd D:\work\DrSai\drsai\desktop\drsai-desktop; npm run dev" -ForegroundColor White
