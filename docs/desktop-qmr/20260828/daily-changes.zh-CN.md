# Desktop 当日改动总结

> **日期**: 2026-08-28  
> **范围**: `apps/desktop` 侧栏 / GFS / Skills / 智能体广场 / 开发启动 + `desktop_gateway`  
> **目的**: 记录当天全部代码与文档改动（不仅限于智能体广场）

---

## 一、当天做了哪些事

| 主题 | 内容 |
|------|------|
| 侧栏交互 | 隐藏「已安排」「成果库」；对话列表右键菜单改为三点菜单 |
| GFS 云盘 | 重新启用入口与页面，放在「新建任务」旁 |
| Skills | 重新启用 Skills 入口与管理页；gateway 挂载 Skills API；安装/更新后可 evict 用户 agent 缓存 |
| 智能体广场 | 恢复平台托管列表；广场 UI/样式；与 WebUI 测试环境名单差异排查 |
| 开发启动 | `windows-desktop-dev.cmd` / `dev.ps1`：ai-dev OIDC + aiapi DDF |
| 稳定性 | 白屏（`AgentLogo`）、样式被误覆盖、`index.ts` 编码损坏导致启动失败；GFS/Skills **IPC 未注册**导致连不上 / 列表为空 |
| 文档 | `docs/desktop-qmr/` 当日笔记；若干 runtime / workbench 设计稿 |

---

## 二、改动概览（按模块）

### 2.1 侧栏 / 工作区（`WorkspaceShell` + 样式）

- 隐藏「已安排」「成果库」导航项  
- 对话/线程操作从右键改为行内 **三点菜单**（`thread-menu-button` 等样式）  
- 侧栏增加 **GFS 云盘**、**Skills** 快捷入口  

涉及：`WorkspaceShell.tsx`、`styles.css`

### 2.2 GFS 云盘

- `App.tsx` 重新引入并渲染 `GfsView`  
- 侧栏在「新建任务」附近展示云盘入口  
- **后续修复**：主进程重新注册 `desktop:gfs-*` IPC（此前 V2 注释掉，UI 恢复后仍报 `No handler registered`）  
- **后续修复**：`dev.ps1` 从仓库根目录 `.env` 注入 `DRSAI_GFS_*` / `GFS_*`，供 gateway `/v1/gfs/*` 使用  

涉及：`App.tsx`、`WorkspaceShell.tsx`、`windows/src/main/index.ts`、`windows/src/main/gfs.ts`、`dev.ps1`  
Gateway：`desktop_gateway/app.py` 调用 `register_gfs_routes(app)`

### 2.3 Skills

- 恢复 `SkillsManager` 页面与导航（含 localStorage 一次性把旧默认 `skills:false` 纠正为可用）  
- 新增 `skills_api.py`（从 legacy gateway 抽出的 Skills REST，供 workbench/desktop_gateway 使用）  
- `app.py`：`register_skills_routes(app)`  
- `_agent_manager.py`：新增 `evict_user()`，技能/工具变更后丢掉该用户缓存 agent  
- **后续修复**：主进程重新注册 `desktop:list-installed-skills` / install / uninstall / update / reload 等 IPC（UI 已开、handler 仍注释时 Skills「没数据」）  

涉及：`App.tsx`、`navigation.ts`、`skills_api.py`、`desktop_gateway/app.py`、`_agent_manager.py`、`windows/src/main/index.ts`、`windows/src/main/skills.ts`

### 2.4 智能体广场

- Portal Native 为空/失败时，回退 DDF `list_agents` + `get_info`（与 WebUI `get_ddf_agents` 同源）  
- 广场 UI：本机精选卡 + 平台官方分组 + 筛选；导出 `AgentLogo`（修复设置页白屏）  
- 双语 description 解析（避免 Rongzai 显示原始 JSON）  
- 新增托管目录 / 远程智能体 / 偏好模块  

**与 WebUI 测试环境名单不一致的结论**（接口相同，凭据不同）：

- WebUI：设置 / 服务端 personal Key → 常见为 **OpenDrSai**  
- Desktop：`~/.drsai-dev/.env` 的 `HEPAI_API_KEY` → 常见为 **My Dr.Sai**；同 Key 下 OpenDrSai `get_info` 可 400  
- Desktop 另有「本机 OpenDrSai」本地 runtime 卡，WebUI 无对应项  

### 2.5 开发环境与平台配置

- `windows-desktop-dev.cmd` / `dev.ps1`：`OPENDRSAI_DDF_API_BASE_URL=https://aiapi.ihep.ac.cn/apiv2` 等  
- `platformConfig.ts`：development 平台 URL  

### 2.6 编码 / 启动事故

| 问题 | 原因 | 处理 |
|------|------|------|
| 启动 `Unterminated string literal`（`index.ts`） | PowerShell `Set-Content` 破坏 UTF-8 | `git checkout` 恢复 `index.ts` |
| `windows/.../agents.ts` 带 BOM | 同上 | Node 重写无 BOM re-export |
| GFS 连不上 / Skills 列表空 | UI 与 gateway 路由已恢复，但 `index.ts` 里 GFS/Skills `secureHandle` 仍被注释；日志 `No handler registered` | 重新注册全部相关 IPC；`dev.ps1` 加载仓库 `.env` 中的 GFS 变量 |

**结论**：改 Windows 源文件请用编辑器 / Node 写 UTF-8。恢复 GFS/Skills **页面**时必须同时恢复主进程 **IPC**，并保证 gateway 能读到 GFS 环境变量。

---

## 三、文件清单

### 3.1 新增

| 文件 | 作用 |
|------|------|
| `apps/desktop/shared/main/hostedAgentCatalog.ts` | 托管智能体目录（DDF list + get_info） |
| `apps/desktop/shared/main/remoteAgents.ts` | 设备侧远程智能体连接 |
| `apps/desktop/shared/main/agentPreferences.ts` | 默认 / 最近使用等偏好 |
| `apps/desktop/shared/renderer/src/components/RemoteAgentModal.tsx` | 远程智能体弹窗 |
| `cores/python/.../skills_api.py` | Desktop gateway Skills REST |
| `apps/desktop/windows/resources/backend/*` | 后端源码包（`backend-source.json` + zip） |
| `docs/desktop-qmr/20260828/*` | 当日笔记（本文件） |
| `docs/desktop/*.zh-CN.md` | runtime / workbench 设计文档（若干） |

### 3.2 修改

| 文件 | 改动要点 |
|------|----------|
| `WorkspaceShell.tsx` | 隐藏项、三点菜单、GFS/Skills 入口 |
| `App.tsx` | 恢复 GFS / Skills 页面装配 |
| `navigation.ts` | Skills 导航可用 |
| `styles.css` | 侧栏三点菜单 + 智能体广场等样式（增量很大） |
| `AgentSquareView.tsx` | 广场 UI、`AgentLogo`、描述本地化 |
| `agents.ts`（shared/main） | 平台目录 + hosted 回退 |
| `desktopApi.ts` / `preload.ts` / `mockDesktopApi.ts` | API / IPC / mock |
| `SettingsPanel.tsx` | 依赖 `AgentLogo` |
| `chat.ts` / `useDesktopChatAdapter.ts` | 智能体选择相关 |
| `platformConfig.ts` / `settings.ts` | 平台与 Key |
| `windows-desktop-dev.cmd` / `dev.ps1` | 开发启动环境变量；`dev.ps1` 从仓库 `.env` 注入 GFS_* |
| `windows/src/main/index.ts` | 恢复 GFS / Skills IPC `secureHandle` 注册 |
| `windows/src/main/gfs.ts` / `skills.ts` | 已有 gateway 客户端（经 IPC 调用） |
| `windows/src/main/agents.ts` | re-export shared agents |
| `desktop_gateway/app.py` | 注册 GFS + Skills 路由 |
| `desktop_gateway/_agent_manager.py` | `evict_user` |

### 3.3 临时 / 勿提交建议

| 路径 | 说明 |
|------|------|
| `.tmp-agent-square-compare/` | 对比用临时文件 |

---

## 四、关键链路（简图）

```
侧栏
  ├─ 新建任务
  ├─ GFS 云盘  → GfsView → IPC desktop:gfs-* → gateway /v1/gfs/*
  ├─ Skills    → SkillsManager → IPC desktop:*-skills → gateway /v1/skills*
  └─ 智能体广场 → AgentSquareView → listAgents
                    ├─ Portal Native（ai-dev）
                    └─ 回退 hostedAgentCatalog（aiapi DDF）

对话列表行 → 三点菜单（替代右键）
```

---

## 五、验证建议

1. 侧栏：无「已安排 / 成果库」；有 GFS、Skills；对话行三点菜单可用  
2. Skills / GFS 页面可打开；**主进程日志无** `No handler registered for desktop:gfs-healthcheck` / `list-installed-skills`  
3. GFS healthcheck 在仓库 `.env` 配好 `DRSAI_GFS_ENABLED` / `GFS_*` 且已登录后应可连通  
4. 智能体广场刷新后有平台托管卡；Rongzai 描述为中文而非 JSON  
5. `windows-desktop-dev.cmd` 可正常启动（无 `index.ts` 字符串语法错误）  
6. 若要与 WebUI 个人智能体同名：同步 WebUI 设置中的 HepAI API Key 到桌面 `.env`

---

## 六、遗留

- [ ] WebUI / Desktop 使用同一 HepAI API Key，验证个人智能体名单一致  
- [ ] 是否长期保留「本机 OpenDrSai」与托管个人智能体双卡  
- [ ] 清理 `.tmp-agent-square-compare/`  
- [ ] `docs/desktop/` 下设计文档是否纳入正式文档体系
