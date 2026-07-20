#Requires -Version 5.1
# ══════════════════════════════════════════════════════════════════════════════
#  OpenDrSai Installer — PowerShell (Windows)
#
#  Fully self-contained: downloads portable Python 3.12 + Node.js v22 + source
#  from ihepbox cloud storage. ZERO system pollution — no admin needed.
#
#  Usage:
#    .\install_drsai.ps1                          # 交互式安装
#    .\install_drsai.ps1 -InstallDir "C:\drsai"  # 指定目录
#    .\install_drsai.ps1 -Force                   # 强制覆盖
#    iwr -UseBasicParsing <URL> | iex              # 一行安装
# ══════════════════════════════════════════════════════════════════════════════
[CmdletBinding()]
param(
    [string]$InstallDir = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

# ══════════════════════════════════════════════════════════════════════════════
#  CONFIG — 在这里修改所有下载地址
# ══════════════════════════════════════════════════════════════════════════════
$IHEPBOX = "https://ihepbox.ihep.ac.cn/ihepbox/index.php/s"

# 源码包 (完整项目结构, .zip 格式, 不含预构建 dist/entry.mjs)
$SRC_URL = "$IHEPBOX/hv9iGTJHvuQbRxE/download"

# Python 3.12.13 便携版 (python-build-standalone, .tar.gz)
$PYTHON_URL = "$IHEPBOX/ZjS6pFmcXbnjeaD/download"

# Node.js v22.22.3 便携版 (官方分发, .zip)
$NODE_URL = "$IHEPBOX/SwjEFncFIEqOXYK/download"

# 安装参数
$DEFAULT_INSTALL_DIR = "$env:USERPROFILE\.drsai"
$REQUIRED_SPACE_GB = 2
$REQUIRED_SPACE_BYTES = $REQUIRED_SPACE_GB * 1GB

# ── Logging ────────────────────────────────────────────────────────────────────
function Write-Section($msg) { Write-Host "`n━━━ $msg ━━━" -ForegroundColor Cyan }
function Write-Log($msg)     { Write-Host "▸ $msg" }
function Write-Info($msg)    { Write-Host "ℹ  $msg" -ForegroundColor Blue }
function Write-Ok($msg)      { Write-Host "✓  $msg" -ForegroundColor Green }
function Write-Warn($msg)    { Write-Host "⚠  $msg" -ForegroundColor Yellow }
function Write-Err($msg)     { Write-Host "✗  $msg" -ForegroundColor Red }
function Die($msg)           { Write-Err $msg; exit 1 }

# ══════════════════════════════════════════════════════════════════════════════
#  1. PLATFORM DETECTION
# ══════════════════════════════════════════════════════════════════════════════
function Detect-Platform {
    Write-Section "平台检测"

    $os = "windows"
    $arch = if ($env:PROCESSOR_ARCHITECTURE -match "ARM") { "arm64" } else { "x64" }
    $script:PLATFORM = "$os-$arch"

    if ($arch -eq "arm64") {
        Die "Windows ARM64 暂不支持 (Python/Node 便携版未提供 ARM64 Windows 构建)"
    }

    Write-Ok "平台: $script:PLATFORM"
}

# ══════════════════════════════════════════════════════════════════════════════
#  2. INSTALL DIRECTORY SELECTION (≥2GB)
# ══════════════════════════════════════════════════════════════════════════════
function Select-InstallDir {
    Write-Section "安装目录"

    if ([string]::IsNullOrWhiteSpace($InstallDir)) {
        $script:InstallDir = $DEFAULT_INSTALL_DIR
    }
    Write-Info "默认安装目录: $script:InstallDir"

    # 确保父目录存在
    $parent = Split-Path $script:InstallDir -Parent
    if ($parent -and !(Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    # 检查磁盘空间
    $checkDir = if (Test-Path $script:InstallDir) { $script:InstallDir } else { $parent }
    if (!$checkDir) { $checkDir = $env:USERPROFILE }

    do {
        $drive = (Get-Item $checkDir).PSDrive.Name
        $driveInfo = Get-PSDrive -Name $drive -ErrorAction SilentlyContinue
        if (!$driveInfo) {
            $availBytes = $REQUIRED_SPACE_BYTES * 2  # 无法检测，假设充足
        } else {
            $availBytes = $driveInfo.Free
        }
        $availGB = [math]::Round($availBytes / 1GB, 1)

        if ($availBytes -ge $REQUIRED_SPACE_BYTES) {
            break
        }

        Write-Warn "磁盘空间不足: ${availGB}GB < ${REQUIRED_SPACE_GB}GB"
        $userDir = Read-Host "请输入新的安装目录 (或按 Enter 取消)"
        if ([string]::IsNullOrWhiteSpace($userDir)) { Die "用户取消安装" }
        $script:InstallDir = $userDir
        New-Item -ItemType Directory -Path $script:InstallDir -Force | Out-Null
        $checkDir = $script:InstallDir
    } while ($true)

    Write-Ok "可用空间: ${availGB}GB (≥ ${REQUIRED_SPACE_GB}GB)"
    Write-Ok "安装目录: $script:InstallDir"
}

# ══════════════════════════════════════════════════════════════════════════════
#  3. EXISTING INSTALLATION CHECK
# ══════════════════════════════════════════════════════════════════════════════
function Check-Existing {
    Write-Section "检测已有安装"

    $launcher = Join-Path $script:InstallDir "bin\opendrsai.cmd"

    if (Test-Path $launcher) {
        Write-Warn "检测到已有 opendrsai 安装: $launcher"

        if ($Force) {
            Write-Info "使用 -Force, 直接覆盖"
            $overwrite = $true
        } else {
            $response = Read-Host "是否覆盖安装? (将删除所有文件) [y/N]"
            $overwrite = ($response -match "^[yY]")
        }

        if ($overwrite) {
            Write-Info "清除旧安装..."
            Get-ChildItem -Path $script:InstallDir -Force | Remove-Item -Recurse -Force
            Write-Ok "已清除旧安装"
        } else {
            Die "用户取消安装"
        }
    } else {
        Write-Ok "无已有安装"
    }
}

# ══════════════════════════════════════════════════════════════════════════════
#  4. DOWNLOAD
# ══════════════════════════════════════════════════════════════════════════════
function Download-Files {
    Write-Section "下载文件"

    $downloadDir = Join-Path $script:InstallDir ".download"
    New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null

    # 源码
    Write-Info "下载源码 (drsai.zip)..."
    $srcFile = Join-Path $downloadDir "drsai.zip"
    try {
        Invoke-WebRequest -Uri $SRC_URL -OutFile $srcFile -UseBasicParsing
    } catch {
        Die "源码下载失败: $_"
    }
    $size = [math]::Round((Get-Item $srcFile).Length / 1MB, 1)
    Write-Ok "源码: ${size}MB"

    # Python
    Write-Info "下载 Python 3.12.13 ($($script:PLATFORM))..."
    $pyFile = Join-Path $downloadDir "python.tar.gz"
    try {
        Invoke-WebRequest -Uri $PYTHON_URL -OutFile $pyFile -UseBasicParsing
    } catch {
        Die "Python 下载失败: $_"
    }
    $size = [math]::Round((Get-Item $pyFile).Length / 1MB, 1)
    Write-Ok "Python: ${size}MB"

    # Node
    Write-Info "下载 Node.js v22.22.3 ($($script:PLATFORM))..."
    $nodeFile = Join-Path $downloadDir "node.zip"
    try {
        Invoke-WebRequest -Uri $NODE_URL -OutFile $nodeFile -UseBasicParsing
    } catch {
        Die "Node 下载失败: $_"
    }
    $size = [math]::Round((Get-Item $nodeFile).Length / 1MB, 1)
    Write-Ok "Node: ${size}MB"

    $script:DownloadDir = $downloadDir
}

# ══════════════════════════════════════════════════════════════════════════════
#  5. EXTRACT
# ══════════════════════════════════════════════════════════════════════════════
function Extract-All {
    Write-Section "解压文件"

    $pkgDir = Join-Path $script:InstallDir "packages"
    New-Item -ItemType Directory -Path $pkgDir -Force | Out-Null

    # ── Python (tar.gz → packages\python\) ──
    Write-Info "解压 Python..."
    $pyTmp = Join-Path $pkgDir "_py_tmp"
    New-Item -ItemType Directory -Path $pyTmp -Force | Out-Null

    # tar (Windows 10 1803+ 自带 bsdtar)
    $pyArchive = Join-Path $script:DownloadDir "python.tar.gz"
    & tar xzf "$pyArchive" -C "$pyTmp" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Die "Python 解压失败 (tar)"
    }

    # 查找含 bin\python.exe 的目录
    $pySrcDir = $null
    $candidate = Join-Path $pyTmp "python"
    if (Test-Path (Join-Path $candidate "python.exe")) {
        $pySrcDir = $candidate
    }
    if (!$pySrcDir) {
        # 查找任意子目录
        $subDirs = Get-ChildItem -Path $pyTmp -Directory
        if ($subDirs.Count -gt 0) { $pySrcDir = $subDirs[0].FullName }
    }
    if (!$pySrcDir) { Die "Python 解压失败: 找不到 python 目录" }

    $pyDest = Join-Path $pkgDir "python"
    Move-Item -Path $pySrcDir -Destination $pyDest -Force
    Remove-Item -Path $pyTmp -Recurse -Force

    $pyBin = Join-Path $pyDest "python.exe"
    if (!(Test-Path $pyBin)) {
        # python-build-standalone 可能放在 bin\python.exe
        $pyBin = Join-Path $pyDest "bin\python.exe"
    }
    if (!(Test-Path $pyBin)) { Die "Python 可执行文件未找到: $pyDest" }

    $pyVer = & $pyBin --version 2>&1
    Write-Ok "Python: $pyVer"

    $script:PythonBin = $pyBin

    # ── Node (.zip → packages\node\) ──
    Write-Info "解压 Node..."
    $nodeTmp = Join-Path $pkgDir "_node_tmp"
    New-Item -ItemType Directory -Path $nodeTmp -Force | Out-Null

    $nodeArchive = Join-Path $script:DownloadDir "node.zip"
    Expand-Archive -Path $nodeArchive -DestinationPath $nodeTmp -Force

    # 查找含 node.exe 的目录
    $nodeSrcDir = $null
    $subDirs = Get-ChildItem -Path $nodeTmp -Directory
    if ($subDirs.Count -gt 0) { $nodeSrcDir = $subDirs[0].FullName }
    if (!$nodeSrcDir) { Die "Node 解压失败: 找不到 node 目录" }

    $nodeDest = Join-Path $pkgDir "node"
    Move-Item -Path $nodeSrcDir -Destination $nodeDest -Force
    Remove-Item -Path $nodeTmp -Recurse -Force

    $nodeBin = Join-Path $nodeDest "node.exe"
    if (!(Test-Path $nodeBin)) { Die "Node 可执行文件未找到: $nodeDest" }

    $nodeVer = & $nodeBin -v 2>&1
    Write-Ok "Node: $nodeVer"

    $script:NodeDir = $nodeDest

    # ── 源码 (zip → packages\src\) ──
    Write-Info "解压源码..."
    $srcDir = Join-Path $pkgDir "src"
    New-Item -ItemType Directory -Path $srcDir -Force | Out-Null

    # 使用便携 Python 解压 zip
    $srcArchive = Join-Path $script:DownloadDir "drsai.zip"
    & $pyBin -c "import zipfile; zipfile.ZipFile(r'$srcArchive').extractall(r'$srcDir')"
    if ($LASTEXITCODE -ne 0) {
        # 回退到 PowerShell 原生解压
        Expand-Archive -Path $srcArchive -DestinationPath $srcDir -Force
    }

    # 检测源码根目录
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
    if (!$script:SrcRoot) { Die "源码解压失败: 找不到 apps/ 和 cores/ 目录" }
    Write-Ok "源码根目录: $($script:SrcRoot)"

    # 验证关键文件
    $pkgJson = Join-Path $script:SrcRoot "apps\ui-tui\package.json"
    $pyproject = Join-Path $script:SrcRoot "cores\python\packages\drsai\pyproject.toml"
    if (!(Test-Path $pkgJson)) { Die "找不到 apps\ui-tui\package.json" }
    if (!(Test-Path $pyproject)) { Die "找不到 drsai\pyproject.toml" }
    Write-Ok "源码验证通过"

    # 清理下载的压缩包
    Remove-Item -Path $script:DownloadDir -Recurse -Force
    Write-Ok "已清理临时下载文件"
}

# ══════════════════════════════════════════════════════════════════════════════
#  6. SETUP PYTHON VENV + INSTALL BACKEND
# ══════════════════════════════════════════════════════════════════════════════
function Setup-Python {
    Write-Section "Python 环境配置"

    $venvDir = Join-Path $script:InstallDir "packages\venv"
    Write-Info "创建虚拟环境..."
    & $script:PythonBin -m venv $venvDir

    $venvPython = Join-Path $venvDir "Scripts\python.exe"
    if (!(Test-Path $venvPython)) { Die "venv 创建失败: $venvPython" }

    Write-Info "升级 pip..."
    & $venvPython -m pip install --upgrade pip setuptools wheel --quiet 2>$null

    Write-Info "安装 DrSai 后端 (editable)..."
    $drsaiPkg = Join-Path $script:SrcRoot "cores\python\packages\drsai"
    $env:DRSAI_SKIP_TUI_BUILD = "1"
    & $venvPython -m pip install -e $drsaiPkg --quiet
    Remove-Item env:\DRSAI_SKIP_TUI_BUILD -ErrorAction SilentlyContinue

    $version = & $venvPython -c "from drsai.version import __version__; print(__version__)" 2>$null
    Write-Ok "DrSai 后端版本: $version"

    $script:VenvPython = $venvPython
}

# ══════════════════════════════════════════════════════════════════════════════
#  7. SETUP NODE + PNPM
# ══════════════════════════════════════════════════════════════════════════════
function Setup-Node {
    Write-Section "Node.js 环境配置"

    $nodeDir = $script:NodeDir
    $npmBin = Join-Path $nodeDir "npm.cmd"
    if (!(Test-Path $npmBin)) { $npmBin = Join-Path $nodeDir "npm" }

    if (!(Test-Path $npmBin)) { Die "npm 未找到: $nodeDir" }

    # 安装 pnpm 到 node 目录
    Write-Info "安装 pnpm..."
    & $npmBin install -g pnpm --prefix="$nodeDir" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "npm install pnpm 失败，尝试 corepack..."
        & (Join-Path $nodeDir "corepack.cmd") enable 2>$null
        & (Join-Path $nodeDir "corepack.cmd") prepare pnpm@latest --activate 2>$null
    }

    $pnpmBin = Join-Path $nodeDir "pnpm.cmd"
    if (Test-Path $pnpmBin) {
        $pnpmVer = & $pnpmBin -v 2>&1
        Write-Ok "pnpm: $pnpmVer"
    } else {
        Write-Warn "pnpm 安装失败，将尝试用 npm 构建 TUI"
    }
}

# ══════════════════════════════════════════════════════════════════════════════
#  8. BUILD TUI
# ══════════════════════════════════════════════════════════════════════════════
function Build-Tui {
    Write-Section "构建 TUI"

    $tuiDir = Join-Path $script:SrcRoot "apps\ui-tui"

    # 如果已有预构建 bundle，跳过
    $entryFile = Join-Path $tuiDir "dist\entry.mjs"
    if (Test-Path $entryFile) {
        Write-Ok "已有预构建 bundle: dist\entry.mjs"
        return
    }

    # 将 node 目录加入 PATH
    $env:PATH = "$($script:NodeDir);$env:PATH"

    $pnpmBin = Join-Path $script:NodeDir "pnpm.cmd"
    $npmBin = Join-Path $script:NodeDir "npm.cmd"

    Push-Location $tuiDir

    # 安装依赖 (最多重试 3 次)
    $retry = 0
    while ($retry -lt 3) {
        $retry++
        Write-Info "安装 TUI 依赖 (尝试 $retry/3)..."
        try {
            if (Test-Path $pnpmBin) {
                & $pnpmBin install --frozen-lockfile 2>$null
                if ($LASTEXITCODE -ne 0) { & $pnpmBin install }
            } else {
                & $npmBin install
            }
            if ($LASTEXITCODE -eq 0) { break }
        } catch { }
        Write-Warn "依赖安装失败，重试..."
        if ($retry -eq 3) { Pop-Location; Die "TUI 依赖安装失败 (3 次重试后放弃)" }
    }

    # 构建
    Write-Info "构建 TUI bundle..."
    if (Test-Path $pnpmBin) {
        & $pnpmBin build
        if ($LASTEXITCODE -ne 0) { Pop-Location; Die "pnpm build 失败" }
    } else {
        & $npmBin run build
        if ($LASTEXITCODE -ne 0) { Pop-Location; Die "npm build 失败" }
    }

    if (!(Test-Path $entryFile)) { Pop-Location; Die "TUI 构建失败: dist\entry.mjs 未生成" }
    $size = [math]::Round((Get-Item $entryFile).Length / 1KB, 1)
    Write-Ok "TUI 构建成功: ${size}KB"

    Pop-Location
}

# ══════════════════════════════════════════════════════════════════════════════
#  9. CREATE LAUNCHER
# ═════════════════════════════════════════════════ Windows: .cmd file ─────────
function Create-Launcher {
    Write-Section "创建启动脚本"

    $binDir = Join-Path $script:InstallDir "bin"
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null

    $launcher = Join-Path $binDir "opendrsai.cmd"
    $tuiDir = Join-Path $script:SrcRoot "apps\ui-tui"
    # 转为反斜杠路径
    $tuiDir = $tuiDir -replace '/', '\'

    $content = @"
@echo off
setlocal
REM ── OpenDrSai 启动脚本 (自包含，不依赖系统 Python/Node) ──
set "INSTALL_DIR=%~dp0.."
set "DRSAI_HOME=%INSTALL_DIR%"
set "DRSAI_UI_TUI_DIR=$tuiDir"
set "PATH=%INSTALL_DIR%\packages\node;%PATH%"
"%INSTALL_DIR%\packages\venv\Scripts\python.exe" -m drsai.backend.run_cli %*
"@
    Set-Content -Path $launcher -Value $content -Encoding ASCII
    Write-Ok "启动脚本: $launcher"

    # 也创建一个 PowerShell 版本 (opendrsai.ps1)
    $psLauncher = Join-Path $binDir "opendrsai.ps1"
    $psContent = @"
# OpenDrSai 启动脚本 (PowerShell)
`$INSTALL_DIR = Resolve-Path "`$PSScriptRoot\.."
`$env:DRSAI_HOME = `$INSTALL_DIR.Path
`$env:DRSAI_UI_TUI_DIR = "$tuiDir"
`$env:PATH = "`$INSTALL_DIR\packages\node;`$env:PATH"
& "`$INSTALL_DIR\packages\venv\Scripts\python.exe" -m drsai.backend.run_cli `$args
"@
    Set-Content -Path $psLauncher -Value $psContent -Encoding UTF8
    Write-Ok "PS 脚本: $psLauncher"
}

# ══════════════════════════════════════════════════════════════════════════════
#  10. VERIFY
# ══════════════════════════════════════════════════════════════════════════════
function Verify-Install {
    Write-Section "验证安装"

    Write-Info "检查 drsai 导入..."
    $r = & $script:VenvPython -c "import drsai; print('ok')" 2>&1
    if ($r -eq "ok") { Write-Ok "drsai 导入成功" }
    else { Write-Err "导入失败: $r" }

    Write-Info "检查版本..."
    $v = & $script:VenvPython -c "from drsai.version import __version__; print(__version__)" 2>$null
    Write-Ok "drsai 版本: $v"

    $launcher = Join-Path $script:InstallDir "bin\opendrsai.cmd"
    if (Test-Path $launcher) { Write-Ok "启动脚本: $launcher" }

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

# ══════════════════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║           OpenDrSai Installer — Self-Contained           ║" -ForegroundColor Cyan
Write-Host "  ║    便携 Python + Node — 零系统污染                      ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
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
    Write-Err "安装失败: $_"
    exit 1
}

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║                    安装完成!                             ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

$binPath = Join-Path $script:InstallDir "bin"
Write-Host "  安装目录:    $script:InstallDir"
Write-Host "  Python:       $(Join-Path $script:InstallDir 'packages\python')"
Write-Host "  Node:         $(Join-Path $script:InstallDir 'packages\node')"
Write-Host "  虚拟环境:    $(Join-Path $script:InstallDir 'packages\venv')"
Write-Host "  源码:         $(Join-Path $script:InstallDir 'packages\src')"
Write-Host "  启动脚本:    $binPath"
Write-Host ""
Write-Host "  下一步:" -ForegroundColor Yellow
Write-Host "    将以下路径添加到环境变量:" -ForegroundColor White
Write-Host "    setx PATH `"$binPath;%PATH%`"" -ForegroundColor White
Write-Host ""
Write-Host "    然后运行: opendrsai" -ForegroundColor White
Write-Host "    首次运行会触发 API 密钥配置向导" -ForegroundColor White
Write-Host ""
Write-Host "  未修改系统 Python/Node，所有环境自包含。" -ForegroundColor DarkGray
Write-Host ""
