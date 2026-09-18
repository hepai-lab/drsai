# OpenDrSai Windows 2.0.1 重新打包操作手册

> 版本：v2.0.1（已由助手同步完成）
> 目的：修复 `runtime-missing` 启动报错（运行时路径推导多一层 `app`）
> 全程在 **PowerShell** 中执行，工作目录 `D:\work\projects\drsai`
> 预计耗时：构建 15–30 分钟 + 发布 5 分钟

---

## 0. 本次修复内容回顾（背景，可跳过）

本轮共修复 **三个** 问题：两个会阻断启动，一个会让「修复运行时」装回旧代码。

### 问题 1：运行时路径推导多一层 `app` → `runtime-missing`

`apps\desktop\shared\main\desktopPaths.ts` 原用 `dirname(resourcesPath)` 推导管理运行时，
但 Windows 打包布局中 `resources` 位于 `app\` 之下：

```
<installRoot>\                  ← D:\software\opendrsai
  app\OpenDrSai.exe
  app\resources\                ← process.resourcesPath
  drsai-agent\                  ← 实际运行时（应与 app\ 平级）
  install-state.json
```

`dirname(resourcesPath)` 得到 `<installRoot>\app`，再拼 `drsai-agent` 就多出一层 `app`，
于是启动自检找不到仓库 / Python / drsai-cli，界面报 **`runtime-missing`**。

### 问题 2：`backend-source.json` 陈旧 → `runtime-version-mismatch`

路径修好后，自检能读到运行时版本 `2.0.1`，随即与桌面端内置的后端期望版本比对——
后者来自 `resources\backend\backend-source.json`，该文件**冻结在 `1.5.3`**（生成于 2026/9/11）。
`2.0.1 ≠ 1.5.3`，界面报 **`runtime-version-mismatch`**。

**根因**：生成它的脚本 `create-backend-source-archive.mjs` 只在 `desktop_legacy`，
新树缺失，`build:win` 也没有调用它，因此该文件从未随版本更新。

**为什么更严重**：`install.ts` 会把这个陈旧 zip 当作后端源码交给安装器
（`-SourceArchive` + `-ExpectedVersion 1.5.3`），所以点「修复并重试运行时」
**会把后端降级回 1.5.3**，下一轮又报 mismatch —— 自我强化的死循环。

### 问题 3：Runtime 元数据 `channel` 恒为 `dev`

`create-opendrsai-runtime.ps1` 的 `-Channel` 默认值硬编码 `"dev"`，
`build:win` 调用时不传参，于是每个包的 `opendrsai-runtime.json` 都标 `channel: dev`。

### 已改动文件

| 文件 | 改动 |
|------|------|
| `apps/desktop/shared/main/desktopPaths.ts` | 用 `dirname(dirname(...))` 得到真正 install root；新增 `readManagedAgentPath` 注入，优先采用 `install-state.json` 的 `agentPath` |
| `apps/desktop/shared/main/paths.ts` | 注入真实 `install-state.json` 读取实现（读不到则安全回退） |
| `apps/desktop/shared/test-kit/verify-platform-contract.mjs` | fixture 改为真实布局；新增「install-state 优先」断言（原 fixture 虚构，导致 CI 漏掉此 bug） |
| `apps/desktop/windows/scripts/create-backend-source-archive.mjs` | **新增**（从 legacy 移植）：生成 `backend-source.json` + `drsai-backend-source.zip`，支持 `--check` |
| `apps/desktop/windows/installer/create-opendrsai-runtime.ps1` | `-Channel` 默认值 `"dev"` → 读 `OPENDRSAI_UPDATE_CHANNEL`，否则 `"stable"` |
| `apps/desktop/windows/package.json` | 新增 `prepare:backend-source`、`verify:backend-source`；`build:runtime` 与 `verify:artifacts` 前置该校验 |
| `apps/desktop/windows/resources/backend/*` | **已重新生成**为 2.0.1（484 B + 49.9 MB，993 条） |

### 后端源码包的体积说明

新脚本按 **「git 是否跟踪」** 决定打包内容，而不是按目录名拉黑：

- ✅ 打包所有 git 跟踪文件（993 个，含 `presentations/vendor/@oai/**` 等 vendor 依赖）
- ❌ 排除未跟踪的构建产物（3914 个，约 113 MB，可 `npm install` 重装）

因此包体从"若不过滤则 138 MB"降到 **49.9 MB**。其中约 19 MB 是
`presentations/node_modules/@oai` 与 `presentations/vendor/@oai` 两份**完全相同的副本**——
属仓库本身的冗余，减少它需改仓库结构，不在本次修复范围。

> 打包链路新增了 `verify:backend-source` 前置校验：若 `backend-source.json` 版本与
> `package.json` 不一致，`build:win` 与 `verify:artifacts` 会**直接失败并提示重新生成**，
> 防止再次产出"外壳与后端版本错位"的包。

版本号已整体同步为 **2.0.1**（一条命令：`python scripts\sync_version.py 2.0.1`）：

- `cores\VERSION` → `2.0.1`（产品版本真源）
- `cores\python\packages\drsai\src\drsai\version.py` → `__version__ = "2.0.1"`（**后端**，runtime 自检读的就是这里）
- `apps\webui\backend\src\drsai_ui\ui_backend\version.py` → `2.0.1`
- `apps\ui-tui\src\version.ts` → `2.0.1`
- `apps\desktop\windows\package.json` → `"version": "2.0.1"`（**换版本就改这里的话，请改用上面那条命令**）
- `apps\desktop\windows\package-lock.json` → 2 处
- `apps\desktop\package-lock.json` → workspace `windows` 1 处

> 只改 `windows\package.json` 会留下"外壳 2.0.1 / 后端 2.0.0"的错位，
> `npm run build:win` 会在 `create-opendrsai-runtime.ps1` 的版本自检处直接 throw。
> 同理，桌面端运行时也会因版本不一致弹「后端版本不匹配，需要更新」。

---

## 1. 前置检查：关闭所有 Desktop 进程

打包与运行中的 Desktop **互斥**。开发态 Electron 会把 `node_modules` 下的原生模块映射进
进程内存，导致后续 `npm ci` 报 `EPERM`。

```powershell
cd D:\work\projects\drsai

# 结束所有本项目 Electron 进程
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.ExecutablePath -like '*\apps\desktop\*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# 确认已清空（应无输出）
Get-Process -Name electron -ErrorAction SilentlyContinue
```

验证关键原生模块已解锁 —— **必须输出 `OPEN-OK` 才继续**：

```powershell
$p = "apps\desktop\node_modules\lightningcss-win32-x64-msvc\lightningcss.win32-x64-msvc.node"
try { $fs = [IO.File]::Open($p, 'Open', 'ReadWrite', 'None'); $fs.Close(); "OPEN-OK 可以开始打包" }
catch { "仍被占用，不要继续：$($_.Exception.Message)" }
```

> 若报 `EPERM`，见打包指南 §8.1。

---

## 2. 确认修复与版本已就位

```powershell
cd D:\work\projects\drsai

# 应显示修复涉及的文件有改动
git diff --stat apps/desktop/shared/main/desktopPaths.ts `
                apps/desktop/shared/main/paths.ts `
                apps/desktop/shared/test-kit/verify-platform-contract.mjs `
                apps/desktop/windows/installer/create-opendrsai-runtime.ps1 `
                apps/desktop/windows/package.json `
                apps/desktop/windows/resources/backend

# 应输出 2.0.1
(Get-Content apps\desktop\windows\package.json -Raw | ConvertFrom-Json).version

# 也应输出 2.0.1（后端/code 版本，runtime 自检就比这里）
Get-Content cores\VERSION
```

**期望**：4 个文件有 diff，两个版本输出都是 `2.0.1`。
任一不符请先停下：版本不一致时先跑 `python scripts\sync_version.py 2.0.1`。

---

## 3. 安装依赖

```powershell
cd D:\work\projects\drsai\apps\desktop\windows
npm ci
```

> `npm ci` 会先删除 `node_modules` 再全新安装，因此对残留文件句柄零容忍 —— 第 1 步必须先做完。

---

## 4. 重建 Python Agent（关键，勿跳过）

`npm run build:win` 内部会调 `prepare-ci-python-agent`，它按顺序找解释器：

1. 仓库根的 `.venv\Scripts\python.exe`
2. PATH 上的 `python`

**若机器上装了 conda，PATH 里的 `python` 通常就是 conda**，会导致运行时缺件或体积膨胀。
因此显式指定标准 CPython 3.12：

```powershell
cd D:\work\projects\drsai\apps\desktop\windows

# 1) 清掉可能由 conda/旧流程生成的 agent
Remove-Item -Recurse -Force ".tmp\bootstrapper-msi3" -ErrorAction SilentlyContinue

# 2) 用标准 CPython 3.12 重建
npm run prepare-ci-python-agent -- -Python "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"

# 3) 验证 home 指向标准 Python（不能是 miniconda）
Get-Content ".tmp\bootstrapper-msi3\.drsai\drsai-agent\venv\pyvenv.cfg"
```

**期望**：`home = C:\Users\26364\AppData\Local\Programs\Python\Python312`
**反例**：`home = D:\software\miniconda` → 必须重做本步。

验证 agent 可导入：

```powershell
& ".tmp\bootstrapper-msi3\.drsai\drsai-agent\venv\Scripts\python.exe" -c "import drsai; print(drsai.__file__)"
```

---

## 5. 一键构建

```powershell
cd D:\work\projects\drsai\apps\desktop\windows

# 先确认后端源码包与 package.json 版本一致
# （build:runtime 与 verify:artifacts 都已内置该校验，这里先跑一次便于早点发现问题）
npm run verify:backend-source
```

若报 `version does not match` 或 `sha256 does not match`，重新生成后再继续：

```powershell
npm run prepare:backend-source
```

> 该命令会重写 `resources\backend\backend-source.json` 与 `drsai-backend-source.zip`
> （约 49.9 MB / 993 个 git 跟踪文件），耗时约 1 分钟。**这两个文件必须提交到 git**
> —— CI 与安装器都依赖它们，且 `install.ts` 把它当作「修复运行时」的后端源码来源。

然后构建：

```powershell
npm run build:win
```

内部执行链：

```
build（typecheck + electron-vite）
  → build:unpack（electron-builder）
  → prepare-ci-python-agent
  → create-opendrsai-runtime.ps1（生成 Runtime ZIP）
  → build-msi.ps1（生成 MSI）
```

> 这一步最久（含 320 MB ZIP 压缩），请耐心等待，**不要中断**。

### 构建后立即验证 channel 元数据

`opendrsai-runtime.json` 的 `channel` 由**环境变量 `OPENDRSAI_UPDATE_CHANNEL`** 决定
（未设置时回落 `stable`），优先级：

```
显式 -Channel 参数  →  $env:OPENDRSAI_UPDATE_CHANNEL  →  "stable"
```

```powershell
cd D:\work\projects\drsai\apps\desktop\windows
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = Resolve-Path "release\bootstrapper\OpenDrSai-Windows-v2.0.1-x64.zip"
$z = [IO.Compression.ZipFile]::OpenRead($zip)
try {
  $e = $z.Entries | Where-Object { $_.FullName -match 'opendrsai-runtime\.json$' } | Select-Object -First 1
  $r = New-Object IO.StreamReader($e.Open())
  try { $r.ReadToEnd() } finally { $r.Dispose() }
} finally { $z.Dispose() }
```

**判定标准**：

| 检查项 | 期望 |
|--------|------|
| `channel` | 与你打算发布的通道**一致**（发 beta → `beta`；发 stable → `stable`） |
| `channel` | **绝不能是 `dev`**（那是修复前的错误默认值） |
| `buildLabel` | 若存在，应与本次发布标签一致（如 `Beta 4`），不能残留上一版的 `Beta 3` |

> ⚠️ **会话变量会污染构建产物。** `OPENDRSAI_UPDATE_CHANNEL` 与 `OPENDRSAI_BUILD_LABEL`
> 若残留在当前终端，会被写进 ZIP 内清单。构建前建议先确认：

```powershell
"UPDATE_CHANNEL = '$env:OPENDRSAI_UPDATE_CHANNEL'"
"BUILD_LABEL    = '$env:OPENDRSAI_BUILD_LABEL'"
```

> `channel` 是**纯元数据**，不参与路径推导或更新检查（客户端按 URL 路径 `channels/beta/`
> 区分通道）。真正决定发布通道的是 `publish-windows-release-to-oss.ps1` 的 `-Channel` 参数。
> 但 `buildLabel` 需要留意：发布时不传 `-BuildLabel`，脚本会从 `latest-windows.json`
> 继承旧值，导致版本号与标签错配。

### 构建后验证内置 Skill 目录

**内置 skill 不需要手动导入** —— `create-opendrsai-runtime.ps1` 的 `Add-BundledSkills`
已把仓库根的 `skills\skills` 复制进 Runtime。

#### 它为什么放在 `drsai-agent\skills\skills`

运行时通过「从当前目录一路向上找 `skills/skills`」来定位内置 skill
（`drsai/modules/components/skills/discovery.py`）：

```python
for root in (anchor, *anchor.parents):          # anchor = cwd 或本文件所在目录
    candidate = resolved_root / "skills" / "skills"
    if candidate.is_dir(): return candidate
```

由于 gateway 以 `cwd = DRSAI_REPO`（即 `<InstallRoot>\drsai-agent`）启动，
所以目录必须落在：

```
<InstallRoot>\drsai-agent\skills\skills\<skill名>\SKILL.md
```

Desktop 另外会导出 `SYSTEM_SKILLS_DIR` 指向同一路径，**该变量优先级最高**，
可直接短路上述自动发现：

```python
configured = explicit if explicit is not None else os.environ.get("SYSTEM_SKILLS_DIR")
if configured:
    return Path(configured).resolve() if candidate.is_dir() else None
```

#### 验证 Runtime ZIP 内确实带上了 skill

```powershell
cd D:\work\projects\drsai\apps\desktop\windows
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::OpenRead((Resolve-Path "release\bootstrapper\OpenDrSai-Windows-v2.0.1-x64.zip"))
try {
  $z.Entries | Where-Object { $_.FullName -match 'drsai-agent/skills/skills/[^/]+/SKILL\.md$' } |
    ForEach-Object { $_.FullName }
} finally { $z.Dispose() }
```

**期望**：列出 6 个 skill 的 `SKILL.md`（`anysearch`、`docx`、
`drsai-document-operations`、`drsai-knowledge`、`presentations`、`system-setting`）。

安装后也可直接在磁盘上确认：

```powershell
Get-ChildItem D:\software\opendrsai\drsai-agent\skills\skills | Select-Object Name
```

#### 关于 `node_modules`

`Add-BundledSkills` 用 robocopy `/XD node_modules` **刻意排除** `node_modules`，理由写在源码注释里：

> `presentations` vendors an ~113 MB reinstalable tree of npm output, and Runtime trust sealing
> (`runtime-build-trust.mjs` walk()) skips `node_modules` too — shipping it would make disk
> contents and the sealed file manifest disagree.

即：**Runtime 封印清单本身会跳过 `node_modules`**。若强行装进去，磁盘内容与封印清单
不一致，会导致 Runtime 信任校验失败。这与 `prepare:backend-source` 排除未跟踪文件的判据一致。

#### 如果你确实要临时覆盖 skill（仅用于排查，不进包）

**不要**改动 `release\win-unpacked\` 或 `app.asar`：

- `app.asar` 开了 `enableEmbeddedAsarIntegrityValidation`，手动改会**破坏完整性校验**，
  Electron 将拒绝加载 app（表现为白屏）
- 改 `drsai-agent\venv\Lib\site-packages\drsai\` 会被下次「修复运行时」覆盖

正确做法是设 `SYSTEM_SKILLS_DIR` 指向你的 skill 目录，然后**完全退出再启动**：

```powershell
# 注意指向内层 skills\skills（该目录下直接是 <skill名>\SKILL.md）
[Environment]::SetEnvironmentVariable("SYSTEM_SKILLS_DIR", "D:\work\projects\drsai\skills\skills", "User")
```

> 补充：`gateway_legacy.py` 的 skill 扫描根是
> `[_get_skills_dir(user_id), *_get_available_skills_dirs()]`，即「用户目录优先 + 内置目录」。
> 用户目录是 `WORKDIR/<uid>/configs`。同名 skill 按 `seen` 去重，**先出现的（用户目录）胜出**，
> 因此往用户目录放同名 skill 也能覆盖内置版本。

> ⚠️ 注意 `skills\` 根下还有 `skills_hepai`、`anthropic_skills_collection`、
> `clawhub_ai_collection`、`superpowers` 等集合。源码注释明确：**只有 `skills/skills`
> 是产品内置目录**，其余仅用于 source/兼容/开发，**不会**被 `resolve_builtin_skills_dir()`
> 采纳。手动指向它们不会生效。

---

## 6. 构建后验证：`out\` 必须与 `release\` 同步

**这是"dev 正常、打包后异常"最常见的原因，务必检查。**

`electron-vite build` 会**分别增量重建** main / preload / renderer。如果你只跑了 `npm run build`
而没跟 `build:unpack`，`out\` 更新了但 `release\win-unpacked\` 还是旧的。

```powershell
cd D:\work\projects\drsai\apps\desktop\windows

# 对比两者时间戳
"out/main        : " + (Get-Item 'out\main\index.js').LastWriteTime
"out/renderer    : " + (Get-Item 'out\renderer\assets\index-*.js').LastWriteTime
"win-unpacked    : " + (Get-Item 'release\win-unpacked\resources\app.asar').LastWriteTime
```

**`win-unpacked` 必须晚于 `out\`。** 若更早，说明包是旧的 —— 重新 `npm run build:unpack`。

> ⚠️ 关键：**`npm run build` 不清理 `out\`**。若某次 renderer 构建失败，`out\renderer` 会残留
> 上一次的旧文件，而 `index.html` 引用的 hash 名可能已变 → 白屏或加载旧 bundle。
> 怀疑这类问题时，先清干净再重建：
>
> ```powershell
> Remove-Item -Recurse -Force out, release\win-unpacked -ErrorAction SilentlyContinue
> npm run build:unpack
> ```

#### 为什么 dev 看不出问题

| | `npm run dev` | 打包后 |
|---|---|---|
| 渲染层来源 | Vite dev server **实时**读 `shared/renderer/src` | `app.asar` 内**冻结**的 bundle |
| 主进程来源 | 实时 | `app.asar` 内冻结的 |
| 改代码后 | HMR 立即生效 | **必须重新 build + 重新 pack** |

所以 dev 永远是最新的；打包产物反映的是**上次打包那一刻**的 `out\` 快照。

#### 渲染层被打了两份（正常设计，但需知道）

`electron-builder.yml` 同时配置：

```yaml
files:
  - out/**            # ① asar 内: app.asar/out/renderer/...
extraResources:
  - from: out/renderer
    to: renderer      # ② asar 外: resources/renderer/...（供运行时更新渲染层）
```

两份内容在**同一次打包内**相同。因此只要 `out\` 是新的、且打包紧跟构建，两份都是新的；
反之两份都是旧的。排查时两份都要比对：

```powershell
# 比对包内渲染层与 out/renderer 是否一致（SHA256 应相同）
$h1 = (Get-FileHash (Get-Item 'release\win-unpacked\resources\renderer\assets\index-*.js').FullName -Algorithm SHA256).Hash
$h2 = (Get-FileHash (Get-Item 'out\renderer\assets\index-*.js').FullName -Algorithm SHA256).Hash
"resources/renderer = $h1"
"out/renderer       = $h2"
"一致 = " + ($h1 -eq $h2)
```

---

## 7. 生成更新清单与发布摘要

```powershell
cd D:\work\projects\drsai\apps\desktop\windows
npm run manifest:win   # → release\latest-windows.json
npm run summary:win    # → release\release-summary.json
```

---

## 8. 自检

```powershell
cd D:\work\projects\drsai\apps\desktop\windows
npm run verify:final-runtime
npm run verify:artifacts
```

**两者都必须通过。**

> 若 `verify:artifacts` 报 `Missing release artifact: latest-windows.json`，
> 原因是漏跑了第 6 步，补跑即可。
> 若报 `Cannot find module './runtime-update-policy.mjs'`，说明迁移遗漏的文件没补齐 —— 告知助手。

---

## 9. 确认产物齐全

```powershell
cd D:\work\projects\drsai\apps\desktop\windows
Get-ChildItem release, release\bootstrapper -File |
  Where-Object { $_.Name -match 'OpenDrSai-Windows|latest-windows|release-summary' } |
  Select-Object FullName, Length
```

**期望 4 个文件**：

| 路径 | 说明 |
|------|------|
| `release\bootstrapper\OpenDrSai-Windows-v2.0.1-Installer-x64.msi` | 安装包 |
| `release\bootstrapper\OpenDrSai-Windows-v2.0.1-x64.zip` | 运行时（约 320 MB） |
| `release\latest-windows.json` | 更新清单 |
| `release\release-summary.json` | 发布摘要 |

> 注意：清单和摘要在 `release\` 根目录，**不在** `release\bootstrapper\` 下。

---

## 10. 本地安装验证（最关键 —— 验证 bug 真的修好了）

**不要跳过这步。** 用自己的机器复现原始场景。

```powershell
cd D:\work\projects\drsai\apps\desktop\windows

# 装到你原来的自定义目录，复现问题场景
msiexec /i "release\bootstrapper\OpenDrSai-Windows-v2.0.1-Installer-x64.msi" INSTALLFOLDER="D:\software\opendrsai"
```

安装完成后**先别启动**，检查目录结构：

```powershell
Get-ChildItem D:\software\opendrsai -Force | Select-Object Name
```

**期望看到**：`app`、`drsai-agent`、`defaults`、`cache`、`install-state.json`
（`app` 与 `drsai-agent` **平级**）

然后启动 OpenDrSai。

### 判定标准

| 结果 | 结论 |
|------|------|
| ✅ 正常进入界面，**无**「本地运行环境需要修复」 | 修复成功，继续第 10 步 |
| ❌ 仍报 `runtime-missing` | 修复未生效 —— 把界面诊断内容（点「复制脱敏诊断」）发给助手 |

> 也可先用第 1 步的方式关闭旧进程，确保启动的是新装的版本。

---

## 11. 发布到 OSS（本地验证通过后再做）

### 11.1 导出发布所需环境变量

发布脚本**不读** `~\.ossutilconfig` 的默认位置，必须显式提供：

```powershell
$env:OSSUTIL_PATH   = 'D:\work\release\ossutil-2.4.0-windows-amd64\ossutil.exe'
$env:OSSUTIL_CONFIG = Join-Path $env:USERPROFILE '.ossutilconfig'
```

> 每个新开终端都要重设。若想持久化：
> ```powershell
> [Environment]::SetEnvironmentVariable("OSSUTIL_PATH",   'D:\work\release\ossutil-2.4.0-windows-amd64\ossutil.exe', "User")
> [Environment]::SetEnvironmentVariable("OSSUTIL_CONFIG", (Join-Path $env:USERPROFILE '.ossutilconfig'), "User")
> ```
> 设置后需重开终端生效。

验证连通性：

```powershell
& $env:OSSUTIL_PATH ls oss://hepai-release/ -c $env:OSSUTIL_CONFIG --region cn-beijing
```

### 11.2 预演（强烈建议）

```powershell
cd D:\work\projects\drsai\apps\desktop\windows
.\scripts\publish-windows-release-to-oss.ps1 `
  -Channel beta `
  -ReleaseDirectory release `
  -BuildLabel "Beta 4" `
  -StageVersionAssets `
  -DryRun
```

`-DryRun` 只打印将执行的命令，不写 OSS。

### 11.3 正式发布

```powershell
cd D:\work\projects\drsai\apps\desktop\windows
.\scripts\publish-windows-release-to-oss.ps1 `
  -Channel beta `
  -ReleaseDirectory release `
  -BuildLabel "Beta 4" `
  -StageVersionAssets `
  -VerifyOnline
```

> ⚠️ **全程约 5 分钟，不要中途关闭终端。**
> 流程：上传不可变资产（320 MB）→ CDN 刷新 → 公网字节级校验 → 写通道指针（最后一步）。
> 若中途失败，**原样重跑即可** —— 版本化资产用 `--ignore-existing`，不会重复上传或覆盖。

### 11.4 验证发布结果

```powershell
curl.exe -L "https://download-opendrsai.ihep.ac.cn/channels/beta/latest-windows.json"
```

**期望**：`"version": "2.0.1"`、`"buildLabel": "Beta 4"`。

---

## 12. 完成检查表

```
□ 关闭所有 electron 进程（OPEN-OK）
□ 确认修复涉及的文件有 diff
□ 确认 package.json 版本为 2.0.1
□ npm ci
□ npm run verify:backend-source（不符则先 prepare:backend-source）
□ 重建 Python Agent（pyvenv.cfg 指向标准 CPython 3.12）
□ npm run build:win
□ ZIP 内 opendrsai-runtime.json 的 channel 与目标通道一致（非 dev）
□ ZIP 内含 drsai-agent/skills/skills/*/SKILL.md（6 个）
□ release\win-unpacked 时间戳晚于 out\（渲染层未脱节）
□ npm run manifest:win
□ npm run summary:win
□ npm run verify:final-runtime          （通过）
□ npm run verify:artifacts              （通过）
□ release\ 与 release\bootstrapper\ 下 4 个产物齐全
□ 本地安装到 D:\software\opendrsai 并启动 —— 无 runtime-missing
□ export OSSUTIL_PATH / OSSUTIL_CONFIG
□ publish ... -DryRun                    （预演）
□ publish ... -StageVersionAssets -VerifyOnline
□ CDN 通道清单返回 version 2.0.1
```

---

## 13. 常见问题速查

| 现象 | 处理 |
|------|------|
| `npm ci` 报 `EPERM: operation not permitted, unlink` | 还有 Electron 进程占用，回到第 1 步 |
| `Materialized backend version does not match runtime 2.0.1`（`Output: version: 2.0.0`） | 后端(core)版本没跟上 —— 跑 `python scripts\sync_version.py 2.0.1`，它会同步 `cores/VERSION`、`drsai/version.py`、webui、ui-tui、windows package+lock |
| `ModuleNotFoundError: No module named 'drsai'` | agent 由 conda 建的，重做第 4 步 |
| `Python cache cleanup was incomplete` | 长路径未启用，见打包指南 §1.2 |
| `candle.exe was not found` | WiX 未装或不在 PATH，见打包指南 §1.3 |
| `Missing release artifact: latest-windows.json` | 漏跑第 6 步 |
| build 报 `backend-source.json version … does not match package …` | 后端源码包陈旧 —— 跑 `npm run prepare:backend-source` |
| 安装后报 `runtime-version-mismatch` | `backend-source.json` 与运行时版本不一致 —— 重新生成并重打 |
| `OSSUTIL_PATH must point to ossutil` | 未导出环境变量，见 11.1 |
| 通道清单里版本与 buildLabel 错配 | 发布时未传 `-BuildLabel`，脚本继承了旧值 —— 重新发布并显式指定 |
| dev 正常但打包后渲染异常 | `out\` 与 `release\win-unpacked\` 脱节 —— 见第 6 节，清 `out` 后重跑 `build:unpack` |
| 打包后 skill 少了 / 是旧版本 | 检查 ZIP 内 `drsai-agent/skills/skills/**`；`Add-BundledSkills` 会在每次 build:win 重新拷贝 |
| `verify:artifacts` 通过但安装后仍报 runtime-missing | 修复未进入构建物 —— 把界面诊断发给助手 |
| 发布中断 | 原样重跑，幂等安全 |

---

## 14. 参考文档

- 打包与上传指南：`docs\product\opendrsai-windows-packaging-upload-guide.md`
- 安装契约：`apps\desktop\windows\installer\contract\docs\install-contract.md`
