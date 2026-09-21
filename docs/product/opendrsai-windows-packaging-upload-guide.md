# OpenDrSai Windows 桌面版打包与上传指南

> 适用项目路径：`apps/desktop/windows`
> 分发目标：阿里云北京 OSS → CDN `download-opendrsai.ihep.ac.cn`

---

## 0. 打包前置检查（必做，先看这里）

打包和**运行中的 OpenDrSai Desktop 互斥**。开发态（`npm run dev` / `windows-desktop-dev.cmd`）启动的 Electron 会把 `apps\desktop\node_modules` 下的原生模块映射进进程内存，导致 `npm ci` 清理 `node_modules` 时报 `EPERM`。

### 0.1 关闭正在运行的 Desktop

```powershell
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.ExecutablePath -like '*\apps\desktop\*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# 确认已清空（主进程 + renderer + GPU + utility 都要退出）
Get-Process -Name electron -ErrorAction SilentlyContinue
```

> 只关窗口不够。窗口关闭后常有 renderer / GPU 残留进程。

### 0.2 验证关键原生模块已解锁

```powershell
$p = "apps\desktop\node_modules\lightningcss-win32-x64-msvc\lightningcss.win32-x64-msvc.node"
try { $fs = [IO.File]::Open($p, 'Open', 'ReadWrite', 'None'); $fs.Close(); "OPEN-OK 可以开始打包" }
catch { "仍被占用，不要继续：$($_.Exception.Message)" }
```

必须输出 `OPEN-OK` 才进入第 4 节。若仍被占用，见 §8.1。

---

## 1. 本地打包环境检查

首次在一台新机器上打包，或打包报出环境类错误时，**先跑自检脚本**：

```powershell
cd apps\desktop\windows
powershell -ExecutionPolicy Bypass -File scripts\check-packaging-env.ps1
```

脚本**只读**，不修改系统，逐项报告并给出修复命令。全部通过时退出码为 `0`，否则为 `1`。

### 1.1 完整环境要求

| # | 项目 | 要求 | 获取方式 |
|---|------|------|----------|
| 1 | 运行中的 Desktop | **必须全部关闭** | 见 §0.1 |
| 2 | 打包用 Python | **标准 CPython 3.12**（非 conda、非 Store 版） | `winget install --exact --id Python.Python.3.12` |
| 3 | 长路径支持 | `LongPathsEnabled = 1` | 见 §1.2 |
| 4 | WiX Toolset | **3.14**，`candle.exe` / `light.exe` 在 PATH | `choco install wixtoolset -y --no-progress` |
| 5 | .NET Framework | `v4.0.30319\csc.exe` 存在 | Windows 自带，缺失时启用 .NET Framework 4.x |
| 6 | Node.js | **22.x** | `winget install --exact --id OpenJS.NodeJS.LTS` |
| 7 | ossutil | 仅**发布**时需要 | `winget install Aliyun.ossutil`，见 §3.3 |

> **为什么这些都是硬性要求**：Python 与长路径决定 Runtime ZIP 能否构建（§8.3、§8.5），WiX 决定 MSI 能否构建（§8.6）。它们不是"可选优化"，缺任何一项 `npm run build:win` 都会中断。

### 1.2 启用长路径支持（必做）

Runtime 内的依赖路径会超过 Windows `MAX_PATH`（260 字符）。典型例子：

```
...\drsai-agent\venv\Lib\site-packages\hepai\components\haiddf\hclient\openai_api\adapted_openai\types\chat\__pycache__\chat_completion_assistant_message_param.cpython-312.pyc
```

未启用时，`Get-ChildItem` 能**枚举**这些路径，但 `Remove-Item` **无法删除**，表现为 `__pycache__` 清理不完整（§8.5）。

**管理员 PowerShell** 中执行：

```powershell
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
```

验证并**重开终端**（或重启机器）：

```powershell
(Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled).LongPathsEnabled
# 期望: 1
```

> CI（`windows-latest`）默认已启用长路径，因此该问题**只在本地出现**。启用后本地行为与 CI 一致。
>
> 辅助手段：把仓库放在较浅的目录（如 `D:\drsai`）可缩短路径前缀，但这是权宜之计；**长路径开关才是根本解**。

### 1.3 安装 WiX Toolset

`build-msi.ps1` 按以下顺序查找 WiX：

1. `installer\.tools\wix314\candle.exe`（便携版，需手动放置，已被 `.gitignore` 忽略）
2. **PATH 上的 `candle.exe`**

并且会从找到的 `bin` 目录的**上级**推导 SDK 目录（`..\SDK`），再校验：

- `Microsoft.Deployment.WindowsInstaller.dll`
- `MakeSfxCA.exe`
- `x64\sfxca.dll`

**推荐用 Chocolatey 安装完整版**（与 CI 一致），它会一并提供 SDK：

```powershell
# 管理员 PowerShell
choco install wixtoolset -y --no-progress
```

若没有 Chocolatey：

```powershell
# 管理员 PowerShell，先装 Chocolatey
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# 再装 WiX
choco install wixtoolset -y --no-progress
```

安装完成后需要**把 `bin` 加入 PATH**（Chocolatey 的 MSI 包不会自动加）：

```powershell
# 管理员 PowerShell
$wixBin = "${env:ProgramFiles(x86)}\WiX Toolset v3.14\bin"
$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
if ($machinePath -notlike "*$wixBin*") {
    [Environment]::SetEnvironmentVariable("Path", "$machinePath;$wixBin", "Machine")
}
```

**重开终端**后验证：

```powershell
candle.exe -?
light.exe -?
```

> 便携版方案：`wix314-binaries.zip` **只含 `bin`，不含 `SDK`**。若要用便携版，须自行把 SDK 目录（含 DTF 程序集与 `MakeSfxCA.exe`）一并放到 `..\SDK`，比装完整版更麻烦，不推荐。

---

## 2. 产物一览

| 产物 | 文件名 | 用途 |
|------|--------|------|
| Runtime ZIP | `OpenDrSai-Windows-v{版本}-x64.zip` | 应用内自更新 |
| MSI 安装包 | `OpenDrSai-Windows-v{版本}-Installer-x64.msi` | 首次安装 |
| 更新清单 | `latest-windows.json` | 客户端检查更新 |
| 发布摘要 | `release-summary.json` | 审计记录 |

产物输出目录：

| 路径 | 内容 |
|------|------|
| `apps/desktop/windows/release/bootstrapper/` | MSI、Runtime ZIP |
| `apps/desktop/windows/release/` | `latest-windows.json`、`release-summary.json` |

> 注意：清单和摘要在 `release\` 下，**不在** `release\bootstrapper\` 下。

### 通道候选清单（上传时生成）

`publish-windows-release-to-oss.ps1` 会额外派生：

- `release\latest-windows-{channel}.json`
- `release\release-summary-{channel}.json`

### OSS 路径布局

```text
oss://hepai-release/releases/v{版本}/windows/OpenDrSai-Windows-v{版本}-Installer-x64.msi
oss://hepai-release/releases/v{版本}/windows/OpenDrSai-Windows-v{版本}-x64.zip
oss://hepai-release/releases/v{版本}/windows/release-summary.json
oss://hepai-release/releases/v{版本}/windows/latest-windows-{channel}.json
oss://hepai-release/releases/v{版本}/windows/release-summary-{channel}.json
oss://hepai-release/channels/beta/latest-windows.json
oss://hepai-release/channels/stable/latest-windows.json    ← 最后写入
```

- 版本化资产（`/releases/v{版本}/`）：不可覆盖，Cache 1 年
- 通道清单（`/channels/`）：可覆盖，`no-cache,max-age=0`，CDN 刷新后生效

---

## 3. 一次性环境准备

### 3.1 安装打包用 Python 3.12（关键，必读）

**打包必须使用标准 CPython 3.12，不能用 conda/miniconda 环境。**

打包链路（CI 与本地一致）固定使用 **Python 3.12**，以下位置均已硬编码该版本：

| 位置 | 作用 |
|------|------|
| `.github/workflows/windows-desktop.yml` | CI 用 `actions/setup-python` 安装 3.12 |
| `installer/create-opendrsai-runtime.ps1` | 拷贝 `python312.dll`、生成 `python312._pth` |
| `installer/install-opendrsai.ps1` | 写入 `pyvenv.cfg` 的 `version = 3.12.0` |

#### 为什么不能用 conda

`create-opendrsai-runtime.ps1` 的 `Add-PortablePythonBase` + `Set-RelocatablePythonLauncher` 依赖**标准 CPython 的目录布局和自包含解释器**：

1. **目录布局不匹配** —— 脚本从 `pyvenv.cfg` 的 `home` 拷贝 `DLLs`、`libs`、`tcl`、`Lib`（排除 `site-packages`）。conda 根目录**没有 `libs`、`tcl`**，这些拷贝会被静默跳过，产物运行时缺件。
2. **`._pth` 隔离机制失效** —— conda 的 `python.exe` 是**转发器**，不是自包含解释器。即使把 `python.exe` 与 `python312._pth` 放在同一目录，`._pth` 也**不会被加载**，解释器会回落到构建机的 conda 绝对路径。典型症状：

   ```
   ModuleNotFoundError: No module named 'drsai'
   ```
   此时 `python -c "import sys; print(sys.path)"` 会显示 `D:\...\miniconda\Lib\site-packages` 等构建机路径，而 `venv\Lib\site-packages` **不在其中**。
3. **体积膨胀** —— conda 的 `Lib\` 含大量预装包与 conda 元数据，打进 Runtime 会让产物显著变大。标准 CPython 的 `Lib\` 只有标准库。

#### 安装标准 CPython 3.12

```powershell
winget install --exact --id Python.Python.3.12
```

验证安装位置（默认在用户目录）：

```powershell
Test-Path "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"   # 期望 True
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -V        # 期望 Python 3.12.x
```

> **不要**使用 Microsoft Store 版 Python —— 它是 alias stub，`-m venv` 行为异常。
> 若同时装了 conda，确保重建 agent 时**显式指定**标准解释器路径（见 §4.2）。

### 3.2 安装 Node.js 22

```powershell
winget install --exact --id OpenJS.NodeJS.LTS
node -v    # 期望 v22.x
```

### 3.3 安装 ossutil

```powershell
winget install Aliyun.ossutil
# 或从阿里云官网下载解压到 PATH
ossutil version
```

### 3.4 配置 OSS 凭证

```powershell
ossutil config -e oss-cn-beijing.aliyuncs.com -i <AccessKeyID> -k <AccessKeySecret> --language EN
```

配置文件：`%USERPROFILE%\.ossutilconfig`（仅当前用户可读，不要提交到 git）

验证连通：

```powershell
ossutil ls oss://hepai-release/
```

### 3.5 导出发布脚本需要的环境变量

`publish-windows-release-to-oss.ps1` **不读 `~\.ossutilconfig` 的默认位置**，必须显式提供 `ossutil` 可执行文件与配置文件路径：

```powershell
$env:OSSUTIL_PATH   = (Get-Command ossutil).Source
$env:OSSUTIL_CONFIG = Join-Path $env:USERPROFILE ".ossutilconfig"
```

> 建议用**受限的**专用配置文件（只授权 `hepai-release` 写入），而不是主账号全局凭证。

---

## 4. 打包

### 4.1 安装依赖

```powershell
cd apps\desktop\windows
npm ci
```

> **关于目录**：`npm ci` 在 `apps\desktop\windows` 下执行即可，但 `package-lock.json` 实际位于**工作区根** `apps\desktop\`（`apps\desktop\windows` 下没有独立 lock）。npm 会向上查找并安装整个 workspace 的依赖到 `apps\desktop\node_modules`。
>
> 因此：**源码开发态和打包共用同一份 `node_modules`**。这是"Desktop 开着 → 打包必失败"的结构性原因，务必先完成第 0 节。

`npm ci` 会先删除 `node_modules` 再全新安装（这是它与 `npm install` 的区别），所以对残留文件句柄零容忍。

### 4.2 准备 Python Agent（决定产物体积，必读）

`npm run build:win` 内部会调 `prepare-ci-python-agent`。它默认按顺序找解释器：

1. 仓库根的 `.venv\Scripts\python.exe`（若存在）
2. PATH 上的 `python`

**若你机器上同时装了 conda，PATH 里的 `python` 通常就是 conda** —— 这会导致 §3.1 描述的全部问题。因此**首次打包前先显式重建 agent**，指定标准 CPython 3.12：

```powershell
cd apps\desktop\windows

# 1) 清掉可能由 conda 生成的旧 agent（关键，否则问题持续复现）
Remove-Item -Recurse -Force ".tmp\bootstrapper-msi3" -ErrorAction SilentlyContinue

# 2) 用标准 CPython 3.12 重建
npm run prepare-ci-python-agent -- -Python "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"

# 3) 验证 home 指向标准 Python，而不是 conda
Get-Content ".tmp\bootstrapper-msi3\.drsai\drsai-agent\venv\pyvenv.cfg"
# 期望: home = C:\Users\<你>\AppData\Local\Programs\Python\Python312
# 反例: home = D:\software\miniconda     ← 必须重建
```

确认 agent 可正常导入：

```powershell
& ".tmp\bootstrapper-msi3\.drsai\drsai-agent\venv\Scripts\python.exe" -c "import drsai; print(drsai.__file__)"
```

> **为什么体积最小**：Runtime ZIP 会通过 `Add-PortablePythonBase` 把 `pyvenv.cfg` 指向的 base Python 的 `Lib\`、`DLLs` 一并打进产物。标准 CPython 的 `Lib\` 只有标准库（约 20–30 MB）；conda 的 `Lib\` 含大量预装包与元数据（通常上百 MB），会让产物显著膨胀。

### 4.3 一键构建

```powershell
npm run build:win
```

内部执行：`build`（typecheck + electron-vite）→ `build:unpack`（electron-builder）→ `prepare-ci-python-agent`（准备 Python Agent）→ `create-opendrsai-runtime.ps1`（生成 Runtime ZIP）→ `build-msi.ps1`（生成 MSI）

### 4.5 生成更新清单

```powershell
npm run manifest:win            # → release\latest-windows.json
npm run summary:win             # → release\release-summary.json
```

### 4.4 自检

```powershell
npm run verify:final-runtime    # Runtime ZIP 完整性
npm run verify:artifacts        # 全部产物校验
```

### 4.6 确认产物

```powershell
Get-ChildItem release, release\bootstrapper -File |
  Where-Object { $_.Name -match 'OpenDrSai-Windows|latest-windows|release-summary' } |
  Select-Object FullName, Length
```

期望看到 4 个文件：MSI、ZIP（在 `release\bootstrapper\`）+ `latest-windows.json`、`release-summary.json`（在 `release\`）

---

## 5. 上传到 OSS

### 5.1 推荐方式：使用仓库发布脚本

仓库已提供完整发布脚本，包含**不可覆盖检查 → 不可变资产上传 → 公网字节级校验 → 通道指针最后写入 → CDN 刷新**全流程。**不要手工敲 `ossutil cp` 逐条上传**，容易漏掉校验与顺序保证。

**Beta 通道：**

```powershell
cd apps\desktop\windows

# 先预演，确认命令序列正确
.\scripts\publish-windows-release-to-oss.ps1 `
  -Channel beta `
  -ReleaseDirectory release `
  -BuildLabel "Beta 3" `
  -StageVersionAssets `
  -DryRun

# 确认无误后正式执行
.\scripts\publish-windows-release-to-oss.ps1 `
  -Channel beta `
  -ReleaseDirectory release `
  -BuildLabel "Beta 3" `
  -StageVersionAssets `
  -VerifyOnline
```

**Stable 通道：**

```powershell
.\scripts\publish-windows-release-to-oss.ps1 `
  -Channel stable `
  -ReleaseDirectory release `
  -StageVersionAssets `
  -VerifyOnline
```

参数说明：

| 参数 | 说明 |
|------|------|
| `-Channel` | `beta` 或 `stable`（必填） |
| `-ReleaseDirectory` | 本地产物根目录，即 `release`（必填） |
| `-BuildLabel` | **仅 beta 需要**；stable 必须不带，否则脚本直接报错 |
| `-StageVersionAssets` | 首次发布该版本时使用，上传 MSI / ZIP / summary 到 `/releases/v{版本}/` |
| `-DryRun` | 只打印将执行的命令，不实际写入 OSS |
| `-VerifyOnline` | 发布后回读 CDN 通道清单做端到端校验 |
| `-Report <路径>` | 把本次发布结果 JSON 写到指定文件（审计留档） |

脚本内置的关键保障：

1. 版本化资产用 `--ignore-existing`，**永不覆盖**已发布版本；若已存在，后续严格校验会比对字节一致性。
2. **Stable 门禁**：MSI 与 Runtime 内的 `OpenDrSai.app/OpenDrSai.exe` 必须通过 Authenticode 校验，且摘要中 `publicDistributionReady = true`，否则脚本拒绝提升 stable。
3. Stable 清单不得含 `buildLabel`，且必须 `requireSignature: true`。
4. **先验证后改指针**：不可变资产在公网（CDN）校验通过后才写 `channels/` 清单，避免"指针变了但资产拉不到"。
5. 通道清单是**最后一步 OSS 写入**，缓存头为 `no-cache,max-age=0`。

脚本会调用同目录的以下 4 个辅助文件，它们都在 `apps/desktop/windows/scripts/` 下：

| 文件 | 作用 |
|------|------|
| `create-windows-channel-manifest.mjs` | 由 `latest-windows.json` 派生通道清单（beta 带 `buildLabel`，stable 强制 `requireSignature`） |
| `create-windows-channel-summary.mjs` | 由 `release-summary.json` 派生通道摘要 |
| `verify-public-runtime-release.mjs` | 公网严格校验：Range 请求、size/sha256、签名证据比对 |
| `refresh-aliyun-cdn-object.ps1` | 调阿里云 CDN `RefreshObjectCaches` API 刷新缓存 |

自检命令（确认发布链路的依赖闭包完整）：

```powershell
npm run verify:oss-publishing
```

> 该命令会校验发布脚本与通道生成器、公网校验器之间的契约关系。若报缺少文件，说明 checkout 不完整。

### 5.2 手工方式（仅排障参考）

仅在脚本不可用、需要人工干预时使用。顺序**不可颠倒**：

```powershell
$VER = "1.5.8"                          # 替换为实际版本
$BUCKET = "hepai-release"
$RELEASE = "apps\desktop\windows\release"
Set-Location $RELEASE

# 1) 不可覆盖检查：期望 404，若已存在说明已发过版，禁止覆盖
ossutil stat "oss://$BUCKET/releases/v$VER/windows/OpenDrSai-Windows-v$VER-x64.zip"

# 2) 上传不可变资产（缓存 1 年）
ossutil cp "bootstrapper\OpenDrSai-Windows-v$VER-Installer-x64.msi" `
  "oss://$BUCKET/releases/v$VER/windows/OpenDrSai-Windows-v$VER-Installer-x64.msi" `
  --force --meta "Cache-Control:public, max-age=31536000, immutable"

ossutil cp "bootstrapper\OpenDrSai-Windows-v$VER-x64.zip" `
  "oss://$BUCKET/releases/v$VER/windows/OpenDrSai-Windows-v$VER-x64.zip" `
  --force --meta "Cache-Control:public, max-age=31536000, immutable"

# 3) 公网验证（见 §5.3），必须通过后再做第 5 步

# 4) 通道清单最后写入
ossutil cp "latest-windows.json" "oss://$BUCKET/channels/beta/latest-windows.json" `
  --force --cache-control "no-cache,max-age=0" --content-type "application/json"

ossutil cp "latest-windows.json" "oss://$BUCKET/channels/stable/latest-windows.json" `
  --force --cache-control "no-cache,max-age=0" --content-type "application/json"
```

### 5.3 CDN 验证

```powershell
curl.exe -I "https://download-opendrsai.ihep.ac.cn/releases/v$VER/windows/OpenDrSai-Windows-v$VER-x64.zip"
curl.exe -L -o temp.zip "https://download-opendrsai.ihep.ac.cn/releases/v$VER/windows/OpenDrSai-Windows-v$VER-x64.zip"
Get-FileHash temp.zip -Algorithm SHA256
# 对比 release-summary.json 中 artifacts[].sha256
```

也可直接用仓库的严格校验器（含 Range 请求与字节一致性比对）：

```powershell
cd apps\desktop\windows
$env:OPENDRSAI_RELEASE_BASE_URL       = "https://download-opendrsai.ihep.ac.cn/releases/v$VER/windows"
$env:OPENDRSAI_RELEASE_METADATA_BASE_URL = $env:OPENDRSAI_RELEASE_BASE_URL
$env:OPENDRSAI_RELEASE_SUMMARY_URL    = "$env:OPENDRSAI_RELEASE_BASE_URL/release-summary-beta.json"
$env:OPENDRSAI_UPDATE_MANIFEST_URL    = "https://download-opendrsai.ihep.ac.cn/channels/beta/latest-windows.json"
$env:VERIFY_PUBLIC_RELEASE_DOWNLOAD   = "1"
$env:OPENDRSAI_LOCAL_ARTIFACT_ROOT    = "release"
node --use-system-ca scripts\verify-public-runtime-release.mjs
```

---

## 6. 发布后验证

```powershell
# 检查通道清单
curl.exe -L "https://download-opendrsai.ihep.ac.cn/channels/beta/latest-windows.json"

# 重新下载校验
curl.exe -L -o verify.zip "https://download-opendrsai.ihep.ac.cn/releases/v$VER/windows/OpenDrSai-Windows-v$VER-x64.zip"
Get-FileHash verify.zip -Algorithm SHA256
```

稳定版发布另需在 GitHub 上走 `Windows Release Promote` workflow：它要求 **OSS stable 指针先提升并验证通过**，才会把 draft release 正式发布。

---

## 7. 发布检查表

```
□ 关闭所有运行中的 OpenDrSai Desktop（electron.exe 已清空）
□ 验证 lightningcss .node 文件已解锁（OPEN-OK）
□ 运行环境自检：scripts\check-packaging-env.ps1（须全部 OK）
□ 确认打包用 Python 为标准 CPython 3.12（非 conda）
□ 确认 agent 的 pyvenv.cfg 中 home 指向标准 Python
□ 确认 LongPathsEnabled = 1
□ 确认 candle.exe / light.exe 在 PATH 且 WiX SDK 齐备
□ cd apps\desktop\windows && npm ci
□ npm run build:win
□ npm run verify:final-runtime
□ npm run verify:artifacts
□ npm run manifest:win
□ npm run summary:win
□ 确认 release\ 与 release\bootstrapper\ 下 4 个产物齐全
□ export OSSUTIL_PATH / OSSUTIL_CONFIG
□ npm run verify:oss-publishing   （发布链路依赖闭包自检）
□ publish-windows-release-to-oss.ps1 -Channel beta  -StageVersionAssets -DryRun  （预演）
□ publish-windows-release-to-oss.ps1 -Channel beta  -StageVersionAssets -VerifyOnline
□ CDN 验证（HEAD / 下载 / SHA256）
□ 签名验证（stable 前置：verify:signatures / verify:signing-evidence）
□ publish-windows-release-to-oss.ps1 -Channel stable -StageVersionAssets -VerifyOnline
□ 端到端下载验证
```

---

## 8. 常见问题

### 8.1 `npm ci` 报 `EPERM: operation not permitted, unlink`

```text
npm error code EPERM
npm error syscall unlink
npm error path ...\node_modules\lightningcss-win32-x64-msvc\lightningcss.win32-x64-msvc.node
npm error errno: -4048
```

**原因**：该 `.node` 文件正被进程映射（Windows 不允许 unlink 已映射的二进制）。绝大多数情况是**还在运行中的 OpenDrSai Desktop / Electron**；`lightningcss` 是 Tailwind v4（`@tailwindcss/vite`）的 CSS 引擎，被 renderer 加载后即被锁定。

**处理**：

```powershell
# 1) 结束所有本项目 Electron 进程
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.ExecutablePath -like '*\apps\desktop\*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# 2) 验证解锁（见 §0.2），必须 OPEN-OK

# 3) 重新 npm ci
```

若仍被占用，按顺序排查：

```powershell
# a) 杀软/Defender 实时扫描（常见诱因）
Add-MpPreference -ExclusionPath "D:\work\projects\drsai\apps\desktop"
Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\npm-cache"

# b) 用 Sysinternals 定位真正持有句柄的进程
handle64.exe "lightningcss.win32-x64-msvc.node"

# c) 重启终端（释放本会话继承的目录句柄）后重试
```

### 8.2 其他常见问题

| 问题 | 原因 | 处理 |
|------|------|------|
| 清单与版本不一致 | 打包后未重建清单 | 重新执行 `manifest:win` |
| stable 清单拉不到新版 | 传了 beta 路径或缓存未过期 | 确认路径 + 等 CDN 刷新（清单为 `no-cache`，刷新后立即生效） |
| 版本号不匹配 | `package.json` version 与 git tag 不一致 | 统一为 `v{版本}` |
| 找不到 `release\latest-windows.json` | 在 `release\bootstrapper\` 下找 | 清单在 `release\` 根目录 |
| 脚本报 `OSSUTIL_PATH must point to ossutil` | 未导出环境变量 | 见 §3.5 |
| 脚本报缺少 `refresh-aliyun-cdn-object.ps1` 等文件 | checkout 不完整，发布链路脚本缺失 | 运行 `npm run verify:oss-publishing` 定位缺失文件 |
| Stable 提升被拒：`publicDistributionReady` 为 false | MSI 或 Runtime 内 `OpenDrSai.exe` 未签名 | 先执行 `sign:bootstrapper`，再重建 summary |
| Beta 提升报 `must not carry a buildLabel` | 给 stable 传了 `-BuildLabel` | stable 不传该参数 |

### 8.3 构建报 `ModuleNotFoundError: No module named 'drsai'`

```text
python.exe : ...\OpenDrSaiRuntime-win-x64\drsai-agent\venv\Scripts\python.exe:
Error while finding module specification for 'drsai.backend.run_cli'
(ModuleNotFoundError: No module named 'drsai')
At ...\installer\create-opendrsai-runtime.ps1:281 char:23
```

**原因**：agent 的 venv 由 **conda Python** 创建。`Set-RelocatablePythonLauncher` 会删掉 `pyvenv.cfg` 并生成 `python312._pth`，但 conda 的 `python.exe` 是转发器，**不加载 `._pth`** —— 于是解释器既没有 venv 的 site-packages，也没有隔离搜索路径，回落到构建机的 conda 目录。

**诊断**（确认是否命中此问题）：

```powershell
$agent = "apps\desktop\windows\.tmp\bootstrapper-msi3\.drsai\drsai-agent"
Get-Content "$agent\venv\pyvenv.cfg"
# 若 home 指向 miniconda → 命中

# 在产物上直接观察 sys.path
& "apps\desktop\windows\release\bootstrapper\opendrsai-runtime-work\OpenDrSaiRuntime-win-x64\drsai-agent\venv\Scripts\python.exe" -c "import sys; print(chr(10).join(sys.path))"
# 若出现 miniconda 路径、且无 venv\Lib\site-packages → 命中
```

**处理**：按 §4.2 用标准 CPython 3.12 重建 agent。

### 8.4 构建报 `Could not find a part of the path ... .pyc`

```text
Remove-Item : Cannot remove item ...\__pycache__\files.cpython-312.pyc:
Could not find a part of the path 'files.cpython-312.pyc'.
At ...\installer\create-opendrsai-runtime.ps1:51 char:9
```

**原因**：`Remove-PythonCaches` 曾先枚举整棵 `__pycache__` 目录树再逐个删除。当某个**父级目录**被删除后，队列里更深层的子路径已失效，`Remove-Item` 便报 `DirectoryNotFoundException`。脚本设置了 `$ErrorActionPreference = "Stop"`，该非终止性错误被升级为致命错误。

**处理**：该函数的删除策略已修正为"先删 `.pyc`/`.pyo` 文件、再逐个 `-LiteralPath` 删目录"，避免父目录删除导致子路径失效。

```powershell
# 清掉上次失败的残留工作目录后重跑
Remove-Item -Recurse -Force "apps\desktop\windows\release\bootstrapper\opendrsai-runtime-work" -ErrorAction SilentlyContinue
```

> 若修正后仍报错，多半是**路径长度**问题，转 §8.5。

### 8.5 构建报 `Python cache cleanup was incomplete; found N cache path(s)`

```text
Python cache cleanup was incomplete; found 229 cache path(s).
At ...\installer\create-opendrsai-runtime.ps1:293 char:5
```

**原因**：**Windows `MAX_PATH`（260 字符）限制**。Runtime 内的依赖路径极深（`hepai\components\haiddf\hclient\openai_api\adapted_openai\types\...`），生成的 `.pyc` 路径可达 **284 字符**。

关键特征：

- `Get-ChildItem` **能枚举**这些路径（它逐级遍历）
- `Remove-Item` **无法删除**（它必须解析完整路径才能操作）

于是清理"看似"跑了，实际一个都没删掉，最后由硬校验拦下。

**诊断**（确认是否命中）：

```powershell
$agent = "apps\desktop\windows\release\bootstrapper\opendrsai-runtime-work\OpenDrSaiRuntime-win-x64\drsai-agent"
Get-ChildItem -LiteralPath $agent -Recurse -File -Force |
  Where-Object { $_.Extension -eq ".pyc" } |
  ForEach-Object { $_.FullName.Length } | Sort-Object -Descending | Select-Object -First 5

# 系统开关
(Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled).LongPathsEnabled
# 0 = 未启用（命中）
```

**处理**：启用长路径支持，见 §1.2。启用后需**重开终端**（或重启机器），再清理残留并重跑：

```powershell
Remove-Item -Recurse -Force "apps\desktop\windows\release\bootstrapper\opendrsai-runtime-work" -ErrorAction SilentlyContinue
npm run build:win
```

> CI（`windows-latest`）默认启用长路径，因此该问题**只在本地出现**。

### 8.6 构建报 `candle.exe was not found`

```text
candle.exe was not found. Download WiX portable binaries or install WiX Toolset.
At ...\installer\build-msi.ps1:90 char:5
```

**原因**：未安装 WiX Toolset，或装好后 `bin` 目录不在 PATH。

`build-msi.ps1` 的查找顺序：先看 `installer\.tools\wix314\candle.exe`，再找 PATH 上的 `candle.exe`。**Chocolatey 的 MSI 包不会自动把 WiX 加入 PATH**，因此"装了但找不到"很常见。

**诊断**：

```powershell
Get-Command candle.exe -ErrorAction SilentlyContinue | Select-Object Source
Get-Command light.exe  -ErrorAction SilentlyContinue | Select-Object Source
Test-Path "${env:ProgramFiles(x86)}\WiX Toolset v3.14\bin\candle.exe"
```

**处理**：见 §1.3。要点：

1. `choco install wixtoolset -y --no-progress`
2. 把 `...\WiX Toolset v3.14\bin` 加入机器级 PATH
3. **重开终端**后验证 `candle.exe -?`

> 注意：脚本还会从 `bin` 的上级目录推导 SDK（`..\SDK`）并校验 `Microsoft.Deployment.WindowsInstaller.dll`、`MakeSfxCA.exe`、`x64\sfxca.dll`。**便携版 `wix314-binaries.zip` 不含 SDK**，用便携版会在此处失败。

### 8.7 构建报 `Cannot find path '...\WindowsApps\...\Lib'`

```text
Get-ChildItem : Cannot find path
'C:\Users\<user>\AppData\Local\Microsoft\WindowsApps\PythonSoftwareFoundation.Python.3.12_qbz5n2kfra8p0\Lib'
because it does not exist.
At ...\installer\create-opendrsai-runtime.ps1:138 char:5
```

**原因**：agent 的 venv 由 **Microsoft Store 版 Python** 创建。Store 版把 `sys.executable` 指向 `WindowsApps` 下的**执行别名（alias stub）目录**，该目录**不含** `Lib`、`DLLs`、`libs`、`tcl`：

```
home = C:\Users\<user>\AppData\Local\Microsoft\WindowsApps\PythonSoftwareFoundation.Python.3.12_...
```

真实安装在 `C:\Program Files\WindowsApps\PythonSoftwareFoundation.Python.3.12_<版本>_x64__...`（受系统保护，无法读取拷贝）。

**处理**：

```powershell
# 1) 确认命中：pyvenv.cfg 的 home 指向 WindowsApps
Get-Content "apps\desktop\windows\.tmp\bootstrapper-msi3\.drsai\drsai-agent\venv\pyvenv.cfg"

# 2) 清掉 Store 版建的 agent
Remove-Item -Recurse -Force "apps\desktop\windows\.tmp\bootstrapper-msi3"

# 3) 用标准 CPython 3.12 重建（见 §4.2）
cd apps\desktop\windows
npm run prepare-ci-python-agent -- -Python "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
```

建议同时**关闭 Store 版执行别名**，避免 PATH 抢占：设置 → 应用 → 高级应用设置 → 应用执行别名 → 关闭 `python.exe` / `python3.exe`。

