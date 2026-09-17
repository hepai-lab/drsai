# DrSai Home 目录整合方案

**对象**：桌面生产 profile `~/.drsai-prod`（由 `apps/desktop/windows-desktop-production.cmd` 启动产生）
**参照**：TUI 安装布局 `scripts/install_drsai_tui.sh`（默认 `INSTALL_DIR=$HOME/.drsai`）
**日期**：2026-09-17

---

## 0. 结论（TL;DR）

### 0.1 一句话
> **两边的"数据区"早就是同一套代码生成的，乱的只有"安装区"的名字和位置。**

两个 home 的 `configs/ workspace/ runtime/ logs/ auth/ credentials/ assets/ desktop/ wechat/`
全部来自同一份实现：
- `cores/python/packages/drsai/src/drsai/configs/constant.py`
- `cores/python/packages/drsai/src/drsai/backend/desktop_gateway/_state.py`
- `apps/desktop/shared/main/{threads,chatRunJournal,productionDiagnostics,feedback}.ts`

真正不一致的只有一件事——**Python 解释器与源码放在哪、叫什么**：

| 形态 | `DRSAI_HOME` | 安装区目录 | 安装区内容 |
|---|---|---|---|
| TUI 安装态 | `=$INSTALL_DIR` | `$INSTALL_DIR/packages/` | `venv/ python/ node/ apps/ cores/ skills/` |
| 桌面（源码态） | `~/.drsai-prod`，源码在 git repo | `~/.drsai-prod/drsai-agent/` | `venv/ .dev-source` |
| 桌面（打包态） | `~/.drsai` | `<AppDir>/drsai-agent/`（在 App 目录，**不在 home**） | `venv/ + 内联 drsai 包` |

### 0.2 推荐做法
**统一到 TUI 的"两区"契约**：

```
$DRSAI_HOME/{bin, packages}   →  安装区：可整体删除、可重装
$DRSAI_HOME/其余一切          →  数据区：升级/重装必须保留
```

其中 `packages/` 就是今天桌面里的 `drsai-agent/`（**仅指 home 下那一个**，App 目录旁的那个不动）。

### 0.3 关键发现：只有"home 型"安装区需要改名
`drsai-agent` 这个名字在仓库里指**两个不同的东西**：

| 用途 | 路径 | 是否属于 `DRSAI_HOME` | 是否要改名 |
|---|---|---|---|
| 桌面**源码/dev** 的托管 Runtime | `$DRSAI_HOME/drsai-agent` | ✅ 是（就是"乱"的来源） | **改** → `packages` |
| 桌面**打包态** App 旁的处理载荷 | `<AppDir>/drsai-agent`（`%PROGRAMFILES%\OpenDrSai\drsai-agent`） | ❌ 否 | **不改**（发布契约，且从不出现在 home 列表里） |

据此，改名只涉及 **约 7 个真实源文件**，而不是全仓库 20+ 处。
安装器/`manifest.schema.json`/`install-contract.md` 等**全部属于打包载荷，无需改动**。

### 0.4 明确不做
**不推荐把 TUI 与桌面合并成一个 home。**
- `runtime/instance-token` 是单实例锁，两者同时跑会互相拒绝启动；
- `.drsai-prod` 的存在意义就是 OIDC 生产端点隔离，合并会把 dev 数据污染成 prod。

---

## 1. 现状对照

### 1.1 `~/.drsai`（TUI 装出来的；`DRSAI_HOME=INSTALL_DIR`）

```
~/.drsai/
├── bin/                        ← 启动器 opendrsai
├── packages/                   ← 【安装区】升级时整体删除
│   ├── python/  node/          ←   便携运行时（复用则不删）
│   ├── venv/                   ←   Python venv（pip install -e）
│   ├── apps/ cores/ skills/    ←   源码树
│   └── .download/
├── configs/  workspace/  runtime/  regression/   ← 【数据区】升级保留
├── files/   runs/   wechat/                     ← 空目录（legacy 无条件创建）
└── config.toml  config.toml.bak  tui_prompt_history.json
```

升级语义（`install_drsai_tui.sh:266-267,404-413`，原话）：

> Remove existing installation? (**bin/ and packages/ will be deleted; configs and data are preserved**)

### 1.2 `~/.drsai-prod`（桌面生产 profile）

```
~/.drsai-prod/
├── drsai-agent/                ← 【安装区】venv + .dev-source → git repo
│   ├── venv/
│   └── .dev-source             ("D:\work\projects\drsai")
├── auth/                       ← 登录态 auth.json / user-aliases.json
├── assets/                     ← 内置 agent 定义
├── configs/                    ← agents/ models/ cli_config.json
├── desktop/                    ← Electron 侧状态 threads / snapshots / feedback / diagnostics / scheduled-tasks
├── logs/                       ← gateway.log / diag-trace.log / desktop-prod/
├── runtime/                    ← engine.sqlite3 / runtime.sqlite3 / artifacts.sqlite3 / payloads/ / instance-token
├── workspace/                  ← drsai/(thread 库) + runs/
├── cache/                      ← dev.ps1 指纹缓存（desktop-dev/ desktop-prod/）
├── electron-user-data/         ← Chromium profile（Cache/GPUCache/DawnCache…，体积最大且可随时删）
├── files/  runs/  wechat/      ← 空目录
└── .env  config.toml  config.toml.bak  config.yaml
```

### 1.3 差异矩阵

| 项 | TUI | 桌面生产 | 判定 |
|---|---|---|---|
| **安装区名** | `packages/` | `drsai-agent/` | ❌ **唯一命名冲突** |
| `bin/` | 有 | 无 | OK（桌面从 exe 起，不需要） |
| `files/ runs/ wechat/` | 空 | 空 | ❌ **死目录** |
| `cache/` | 无 | 有 | ⚠️ dev.ps1 专属 |
| `electron-user-data/` | 无 | 有 | ⚠️ Electron 专属 |
| `auth/ assets/ desktop/ logs/` | 无* | 有 | OK（惰性创建） |
| `configs/ workspace/ runtime/` | 同 | 同 | ✅ 已统一 |

\* `~/.drsai` 没有它们只是因为 TUI 还没触发对应功能（未登录 / 未用桌面面板），**不是结构差异**。

---

## 2. 根因

1. **三条独立 mkdir 路径**：
   - `constant.py:38-42` —— Python `import` 时**无条件**创建 `FS_DIR/{runs,files,wechat,configs,workspace,workspace/runs}`。
     其中 `RUNS_DIR` / `FILE_DIR` 的注释原文就写着"**旧的 runs 兜底目录**"/"**旧的 file 兜底目录**"。
   - `apps/desktop/shared/main/*.ts` + `windows/src/main/*.ts` —— Electron **惰性**创建 `desktop/ auth/ logs/`。
   - `desktop_gateway/_state.py` —— Runtime **惰性**创建 `runtime/*.sqlite3 assets/`。
2. **三套"安装区"命名**：TUI `packages/`；桌面源码态 `drsai-agent/`（在 home）；桌面打包态 `drsai-agent/`（在 App 目录）。
3. **`DRSAI_HOME` 语义不一致**：TUI 里是"安装根"，桌面里是"纯数据根"（安装区硬塞了一个子目录进去）。

---

## 3. 目标契约

```
$DRSAI_HOME/
├── bin/                     ┐  安装区：可整体删除、可重装、可共享
├── packages/                │  桌面：venv/ + .dev-source
│   ├── venv/                │  TUI ：venv/ + python/ node/ apps/ cores/ skills/
│   ├── .dev-source          │
│   └── (apps|cores|skills)/ ┘
├── configs/                 ┐
├── workspace/               │
├── runtime/                 │  数据区：升级/重装必须保留
├── logs/                    │
├── auth/                    │
├── credentials/             │
├── assets/                  │
├── desktop/                 │
├── wechat/                  │
├── regression/              │
└── .env config.toml config.yaml ┘
├── cache/                   ← 桌面本地（可删）
└── electron-user-data/      ← Chromium profile（可删）
```

**验收规则（一句话）**：
> 删掉 `$DRSAI_HOME/{bin,packages}` 后，应只损失"重装即可恢复的东西"。

这条规则今天在 TUI 成立，在桌面不成立（`drsai-agent/` 与数据混在一起、名字还不同）。

---

## 4. 改造清单

### Tier 0 —— 止血（零风险，建议立即单独提交）

**停止制造 3 个空目录。**

`cores/python/packages/drsai/src/drsai/configs/constant.py:38-42`

```python
directories = [
    FS_DIR, CONFIG_DIR, WORKSPACE_DIR, WORKSPACE_RUNS_DIR,
    # RUNS_DIR / FILE_DIR / WECHAT_DIR 改为惰性创建（写入方自建）
]
```

**安全性已逐个验证** —— 三个目录的真实写入点都会自建：

| 常量 | 写入点 | 是否自建 |
|---|---|---|
| `FILE_DIR` | `tui_gateway/handlers/paste.py:_paste_dir()` | ✅ `mkdir(parents=True, exist_ok=True)` |
| `FILE_DIR` | `modules/baseagent/drsaiagent.py:317-319` | ✅ `mkdir(parents=True)` |
| `RUNS_DIR` | `modules/agents/skills_agent/assistant_skill.py:148` | ✅ `mkdir(parents=True, exist_ok=True)` |
| `RUNS_DIR` | `modules/agents/skills_agent/drsai_assistant.py:541` | ✅ `mkdir(parents=True)` |
| `WECHAT_DIR` | `backend/wechat/wechat_client.py:85` | ✅ `os.makedirs(..., exist_ok=True)` |

**效果**：新 home 顶层少 3 个目录。**风险：可忽略。**

### Tier 1 —— 核心整合：`$DRSAI_HOME/drsai-agent` → `$DRSAI_HOME/packages`

**只改 home 型引用**（打包型 `<AppDir>/drsai-agent` 保持不动）。

| # | 文件 | 位置 | 改法 |
|---|---|---|---|
| 1 | `apps/desktop/shared/main/desktopPaths.ts` | `:25` `join(home,"drsai-agent")` | → `join(home,"packages")` |
| 2 | `apps/desktop/windows/src/main/developmentLaunchEnvironment.ts` | `:35` repository 兜底、`:44` `OPENDRSAI_RUNTIME_ROOT` | → `join(home,"packages")` |
| 3 | `apps/desktop/windows/src/main/index.ts` | `:919` python 兜底路径 | → `packages` |
| 4 | `apps/desktop/windows/scripts/dev.ps1` | `:188`(legacy link 探测) `:207` `:220`(备份名) `:759` `$InstallDir` `:764`(备份名) | → `packages` |
| 5 | `apps/desktop/windows-desktop-dev.ps1` | Runtime 根 | → `packages` |
| 6 | `scripts/install.ps1` | 默认 `$InstallDir = Join-Path $DrsaiHome "drsai-agent"` | → `"packages"` |
| 7 | `apps/desktop/shared/test-kit/verify-platform-contract.mjs` | `:76,:82`（developer-win）`:100,:101`（macos） | 更新断言 |
| 8 | `apps/desktop/shared/test-kit/verify-macos-dev-setup.mjs` | `:21` | 更新断言 |
| 9 | `apps/desktop/windows/scripts/verify-dev-workspace-startup.mjs` | Runtime 根 | 更新 |
| 10 | `apps/desktop/shared/renderer/src/mockDesktopApi.ts` | `:121,123,125` | 演示数据（可选） |

**保持不变（打包载荷 / 冻结 / 生成物）**：
- `desktopPaths.ts:22`、`paths.ts:10`（`<AppDir>/drsai-agent`）
- `installer/**`：`install-opendrsai.ps1`、`create-opendrsai-runtime.ps1`、`uninstall-opendrsai.ps1:77`、`contract/**`、`manifest.schema.json`
- `windows/scripts/{verify-runtime-defaults,verify-runtime-updater,runtime-build-trust,prepare-ci-python-agent}`
- `apps/desktop/windows/out/**`（构建产物）、`apps/desktop_legacy/**`（冻结副本）

**兼容策略（关键）**：
解析顺序 `packages/` 优先 → 不存在则回退 `drsai-agent/`。
→ 老 home（`~/.drsai-prod/drsai-agent`）**零改动继续可用**；只有新装/迁移才写 `packages/`。

> ⚠️ **venv 不可搬迁**：`pyvenv.cfg`、`Scripts/*.exe`、`site-packages/*.pth` 里烘焙了绝对路径。
> 迁移 = **重建** venv（`install.ps1` 本来就幂等，目录名变了即触发重建）。见 §5。

### Tier 2 —— 收拢桌面专有目录（可选，纯观感）

| 现在 | 建议 | 改动点 |
|---|---|---|
| `cache/` | `$DRSAI_HOME/.dev/cache/`（隐藏）或并入 `logs/` | `dev.ps1` 的 `$DevCacheDir` |
| `electron-user-data/` | `desktop/electron-user-data/`（与其它 Electron 状态内聚） | `developmentLaunchEnvironment.ts:45`、`windows-desktop-production.cmd`、`dev.ps1` |

（`bin/`：桌面若想完全对齐 TUI，可在 home 写 `bin/opendrsai.cmd`；非必需。）

### Tier 3 —— 跨 profile 共享安装区（Tier 1 落地后才安全）

`~/.drsai-prod` / `~/.drsai-dev` 通过 `OPENDRSAI_RUNTIME_ROOT` 指向同一份 `packages/venv`，
省下 ~424MB × N。（前提：两端 editable 源指向同一 git repo。）

---

## 5. 迁移（已有 `~/.drsai-prod`）

```powershell
# 0) 停机：关闭桌面与 TUI
# 1) 搬安装区（venv 丢弃，数据全部原地不动）
Rename-Item "$HOME\.drsai-prod\drsai-agent" "drsai-agent.old"
New-Item -ItemType Directory "$HOME\.drsai-prod\packages" | Out-Null
Move-Item "$HOME\.drsai-prod\drsai-agent.old\.dev-source" "$HOME\.drsai-prod\packages\.dev-source"
Remove-Item -Recurse -Force "$HOME\.drsai-prod\drsai-agent.old"

# 2) 在新位置重建 venv（约 3-5 分钟）
.\scripts\install.ps1 -DevSource "D:\work\projects\drsai" -DrsaiHome "$HOME\.drsai-prod"

# 3) 启动桌面校验（并顺手清 Tier 0 遗留的空目录）
Remove-Item "$HOME\.drsai-prod\files","$HOME\.drsai-prod\runs","$HOME\.drsai-prod\wechat" -Recurse -Force -ErrorAction SilentlyContinue
.\apps\desktop\windows-desktop-production.cmd
```

---

## 6. 风险与不做的事

| 项 | 判断 | 说明 |
|---|---|---|
| venv 绝对路径烘焙 | **高风险** | 必须重建，绝不能 `Move-Item` |
| 安装器 manifest / contract | **低** | 本次不改（属打包载荷，与 home 无关） |
| 老 home 兼容 | **低** | 解析回退 `drsai-agent/` 兜住 |
| legacy `runs/ files/ wechat/` | **低** | §4 Tier 0 已逐个验证写入点自建 |
| TUI 与桌面共享 home | **不做** | `instance-token` 单实例锁互斥 + prod/dev 端点隔离失效 |
| `apps/desktop_legacy/**` | **不动** | 冻结副本 |

---

## 7. 验证清单

- [ ] 新建空 home + `python -c "import drsai"`：只出现 `configs/ workspace/ workspace/runs/`（Tier 0 生效）
- [ ] `node apps/desktop/shared/test-kit/verify-platform-contract.mjs` 全绿（Tier 1 更新后）
- [ ] `dev.ps1 -LaunchMode Production` 从零装到能启动（`packages/venv` 生效）
- [ ] 老 home（保留 `drsai-agent/`）启动仍正常（回退路径生效）
- [ ] TUI `install_drsai_tui.sh` 重装：`packages/` 被清、`configs/`+数据保留（语义未回归）
- [ ] `apps/desktop/windows/installer/install-opendrsai.ps1` 打包安装 + 卸载（确认未受影响）
