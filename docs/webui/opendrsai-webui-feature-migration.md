# OpenDrSai WebUI 功能迁移分析

> 日期：2026-09-04  
> 范围：把生产侧 `drsai-dev`（drsaiv2 / 旧仓库 WebUI）迁到 monorepo `apps/webui`（opendrsai.ihep.ac.cn）  
> 分支：`merge_latest`

本文回答三件事：**从哪迁到哪**、**已经迁了什么**、**迁完之后还差什么**。

---

## 1. 迁移背景

| 项 | 说明 |
|---|---|
| **源** | `drsai-dev/apps/webui`，对应历史上的仓库根 `frontend/` + `python/packages/drsai_ui`，长期跑在生产（drsaiv2 / 本机 8000） |
| **目标** | 当前仓库 `apps/webui/`（Gatsby 前端 + FastAPI 后端），部署域名 **opendrsai.ihep.ac.cn** |
| **方式** | 先整包同步，再按业务补齐；不是从 Magentic-UI 上游重写一遍 |

分两波：

1. **2026-08-10 整包同步**  
   - `fd045d443` `chore(backend): sync routes, models, and config with drsai-dev`（+5548 行）  
   - `a4e6b05dc` `chore(frontend): sync components, pages, and store with drsai-dev`（+8570 行）  
2. **2026-08-10 ～ 2026-09-04 持续补齐**  
   技能广场重构、Higraf 代理、OIDC、CSNS 嵌入登录、DocMaster 预览等。

对照现状：两边 `apps/webui` 的页面和后端路由文件已基本对齐，差异主要在后续增强和少量未合入的辅助文件。

---

## 2. 总览

状态约定：

- **已迁入**：源站能力在 `apps/webui` 有对应实现，可按 opendrsai 配置启用  
- **迁入后增强**：同步之后在目标仓继续改过，能力比源站更完整或结构不同  
- **部分迁入**：代码在，入口弱、占位、或依赖外部服务才能用  
- **未迁 / 刻意不做**：源站有、目标仓没有，或产品上已砍掉  

| 模块 | 状态 | 用户可见入口 |
|---|---|---|
| IHEP SSO 登录 | 已迁入 | `/welcome` → `/umt` |
| HepAI OIDC 登录 | 迁入后增强 | `/auth/login`、`/umt/oidc-login` |
| Science User iframe 嵌入 | 已迁入 | `?user_source=science_user` |
| CSNS user_agent 嵌入 | 迁入后增强 | `?user_source=user_agent` |
| 聊天 / 会话 / 流式 | 已迁入 | 左侧「开始聊天」 |
| 智能体广场 | 已迁入 | 左侧「智能体广场」 |
| 默认远程智能体（DocMaster 等） | 已迁入 | `DEFAULT_REMOTE_AGENTS` |
| 技能广场 + GFS | 迁入后增强 | 左侧「技能广场」 |
| 远程技能代理 | 迁入后增强 | `POST /api/agent/skills/download` |
| Deer Flow / Higraf | 迁入后增强 | `/api/deer-flow` |
| 云盘 / GFS 文件 | 已迁入 | 左侧「云盘」 |
| DocMaster 模板库 / PPT 预览 | 已迁入 | 聊天右侧栏（仅 DocMaster） |
| 关联业务 / 综合材料 | 已迁入 | DocMaster 右侧栏 |
| 会话分享 / 技能分享 | 已迁入 | 历史会话菜单、`/share` |
| 个人资料 / 合作信息 | 迁入后增强 | 设置 → 个人资料 |
| 使用分析 / 用户管理 | 已迁入 | 平台管理员设置 |
| 欢迎页 / 客户端下载 | 已迁入 | `/welcome` |
| 移动端 / 桌面鉴权 API | 已迁入 | `/api/mobile`、`/native`、`/desktop-auth` |
| VNC 远程桌面 | 部分迁入 | 聊天 Agent 面板 |
| BESIII 分析面板 | 部分迁入 | 指定 Agent 右侧栏 |
| LHAASO 受限技能 | 部分迁入 | 技能列表过滤 |
| 合作组广场 | 未迁 / 已砍 | 无入口（`/orgs` 只留管理员兼容） |
| Channels / Logs 设置页 | 部分迁入 | 路由还在，左侧菜单未挂 |

---

## 3. 分模块说明

### 3.1 认证与嵌入登录

这是从源站迁过来最关键的一块。`RouteGuard` 在普通登录之前先处理嵌入场景，避免 iframe 被踢去登录页。

| 能力 | 源 | 目标实现 | 说明 |
|---|---|---|---|
| IHEP SSO | `/umt` | `ihep_sso_router`，`SERVICE_MODE=PROD` 时挂载 | opendrsai 用自己的 `IHEP_SSO_*`，**不要**用 drsaiv2 的 App Key |
| HepAI OIDC | 源站 `.env` 已配 | `hepai_oidc_router`：`/auth/login`、`/auth/oidc/callback` | 2026-09-04 合入；issuer 用 ai-dev，回调只允许 opendrsai |
| 本地账号 | `/umtlocal` | `local_login.py` | 开发/兜底 |
| Science User 嵌入 | iframe `user_source=science_user` | `/api/auth/science-user` | 统一认证 `access_token+username`，或院平台 `tokenId` |
| CSNS user_agent 嵌入 | 源站已有 | `/api/auth/user-agent/verify` | 换 JWT 后跳到指定智能体（默认 iPanda） |
| 登录后恢复 agent 链接 | cookie `drsai_pending_search` | `RouteGuard.consumePendingSearch` | 保留 `share_agent` / `agentId` / `agentName` |
| 登出 | `POST /logout` | 清 refresh cookie | 技能广场重构时一并补上 |

Science User / CSNS 走**共享 HepAI Key**，不按个人账号去平台拉 key。

### 3.2 聊天与会话

上游 Magentic-UI 的会话骨架保留，源站把生产聊天体验叠上去。

**已迁入：**

- 会话 CRUD、历史搜索、删除、分享链接  
- WebSocket 流式：`message_chunk` / thought / 终稿密封  
- 工具调用时间线、执行日志抽屉、打字机消息、过程面板  
- 文件上传、拖拽、技能挂载、LLM 选择器  
- 计划（Plan）预览 / 保存  
- 画布产物、文件预览页  

**迁入后修过（不是简单拷贝）：**

- 流式草稿与 flush 正文拆平面（reply / thought / control）  
- 聊天滚动、过程面板紧凑样式  
- 输入区拆成 hooks + 小组件  

### 3.3 智能体广场

入口：左侧「智能体广场」。

| 能力 | 状态 |
|---|---|
| 官方 / 远程 / 自定义智能体列表 | 已迁入 |
| 连接远程智能体 | 已迁入（`RemoteAgentModal`） |
| 自定义智能体 | 已迁入（`CustomAgentModal`） |
| 设默认、开始聊天 | 已迁入 |
| 详情面板、统计卡片 | 迁入后增强（`AgentDetailPanel`） |
| 平台默认远程列表 | 已迁入：`DEFAULT_REMOTE_AGENTS` → 当前仓库 `remote_agents.json`（如 DocMaster） |
| 公共远程智能体禁止删除 | 迁入后增强 |
| 合作组「其他智能体」plaza | **已砍**：前端不再请求 `/orgs/plaza`，后端只留 `/orgs/access` 给管理员判断 |

### 3.4 技能广场（改动最大）

08-10 同步时还是单体 `skills_gfs.py`（约 2200 行）+ 双表 `SkillMeta` / `UserSkillMeta`。之后在目标仓重构，**已经不是源站原样**。

**已迁入的产品能力：**

- 全部技能 / 我的技能 / 发布技能  
- 上传 ZIP、更新、删除、下载、可见性  
- 技能分享页 `/share/skill/:id`  
- 聊天里挂载技能  

**迁入后增强：**

- 单表 `SkillMeta` + 懒加载 `SkillDetail`  
- 路由拆成 `skills_gfs/` 包  
- `source`（user / higraf）与 `uskills_type`（created / imported）分开  
- `category` 换成 `tags`（来自 SKILL.md）  
- 统计卡片、筛选栏、发布表单重做  
- HiGraf 同步引擎 `skills_sync/`  
- 远程 Agent 技能代理：`X-Skill-Proxy-Token` + `X-User-Id`  
- API Key 从 query 改为 `Authorization: Bearer`  

GFS 布局（当前设计）：

```
20294-skills-square/
├── higraf/{slug}.zip
└── user_skills/{user_id}/{slug}.zip
```

上架只写 DB 目录，不再复制 `public_skills/`。

### 3.5 Deer Flow / Higraf

源站用内部 token 换 Higraf JWT。目标仓在 08 月补了完整代理：

- `POST /api/deer-flow/auth/token-exchange`  
- Cookie 传递 `higraf_access_token` / refresh / kb_token  
- 后续 Higraf 请求走后端代理，不把内部 token 暴露给浏览器  

依赖：`DEER_FLOW_INTERNAL_AUTH_TOKEN`、`HIGRAF_BASE_URL`。

### 3.6 云盘 / GFS 文件

08-10 整包迁入，前后端都在：

- 后端：`/api/cloud` + `gfs_utils.py`（jcli、多 bucket、OpenAPI 刷新）  
- 前端：`CloudPage`、`WorkspaceFiles`（浏览、上传、预览、收藏、拉到工作区）  

这是源站相对上游 Magentic-UI **新增最多的文件能力**。

### 3.7 DocMaster 与关联业务

智能体侧能力，聊天页右侧栏只在 DocMaster 上出现。

| 能力 | 状态 |
|---|---|
| 模板库目录 / 预览 | 已迁入（`/api/docmaster`） |
| PPTX 缺 `defaultTextStyle` 补丁 | 迁入后修复 |
| 关联业务面板 | 已迁入 |
| 综合材料面板 | 已迁入 |
| 生成文件列表 | 已迁入 |

远程 Agent 配置在 `apps/webui/backend/remote_agents.json`（本地文件不进 git）。

### 3.8 设置、管理、欢迎页

| 能力 | 状态 |
|---|---|
| 个人资料、显示名、IHEP 合作信息 | 迁入后增强（SSO 登录时写入 cooper info） |
| 模型 / API Key / 主题 / 存储清理 | 已迁入 |
| 使用分析（打卡、今日次数） | 已迁入，管理员可见 |
| 用户管理 | 已迁入，管理员可见 |
| 欢迎页、Win/macOS/Android/TUI 下载 | 已迁入；渠道按部署选 beta/stable |
| iframe 嵌入白名单 | 已迁入（`IFRAME_ALLOWED_ORIGINS`） |

`ChannelsPage`、`LogsPage`、`AgentManagementPage`、`LibraryPage`、保存的 Plan 列表：**页面还在，左侧导航基本没挂**，属于半迁入。

### 3.9 跨端 API

源站给 App / 桌面用的接口已挂在 `app.py`：

- `/api/mobile/v1`  
- `/api/native/v1`  
- `/api/desktop-auth`  
- `/api/releases`（CDN `download-opendrsai.ihep.ac.cn`）  

### 3.10 部分迁入 / 依赖外部服务

| 能力 | 现状 |
|---|---|
| VNC | 路由 `/api/vncapi` + `VNCPanel` 在；`.env` 里 `VNC_SERVICE_URL` 仍是占位 `http://**/api/vncapi` |
| BESIII 面板 | 组件和 agent 配置在，标注「待开发」 |
| LHAASO 技能限制 | 有过滤逻辑；`lhasso_skills.py` 仍是空壳 |
| 技能收藏/评分等社交 | 未做（周报里列为后续） |

### 3.11 明确没迁或已砍

| 项 | 说明 |
|---|---|
| 合作组广场 / 申请加入 | 产品砍掉；`/orgs` 只保留 `GET /access` |
| `chatStreamReducer.ts` | 仅在 `drsai-dev`，目标仓用另一套 pipeline |
| `BrandLogo.tsx` | 仅在源站 |
| 仓库根旧 `frontend/` | 只剩 `node_modules` 残留，不是运行源 |

---

## 4. 后端路由对照（目标仓已挂载）

来自 `apps/webui/backend/.../web/app.py`：

| 前缀 | 模块 |
|---|---|
| `/sessions` `/plans` `/runs` `/teams` `/ws` | 会话与运行 |
| `/settings` `/agentmode` `/files` `/models` | 配置与文件 |
| `/agentworker` | 用户智能体目录 |
| `/auth` `/auth/science-user` `/auth/user-agent` `/umtlocal` | 登录 |
| `/umt` `/auth/login` `/auth/oidc/*` | SSO / OIDC |
| `/skills` `/skill-tags` `/agent/skills` | 技能广场与代理 |
| `/deer-flow` | Higraf |
| `/cloud` | GFS 云盘 |
| `/docmaster` | 模板库 |
| `/users` `/admin/analytics` `/orgs` | 用户与管理 |
| `/mobile/v1` `/native/v1` `/desktop-auth` `/releases` | 跨端 |
| `/vncapi` | VNC |

---

## 5. 和这次环境变量补齐的关系

从 `drsai-dev` 的 `.env` 补到 `apps/webui/.env` 的，对应的就是上面「代码已迁、配置刚对齐」的功能：

| 变量 | 对应功能 |
|---|---|
| `DRUSER_AGENT_DEFAULT_AGENT_NAME` / `USER_AGENT_VERIFY_API` | CSNS 嵌入登录 |
| `DEER_FLOW_INTERNAL_AUTH_TOKEN` / `HIGRAF_BASE_URL` | Higraf token exchange |
| `DRSAI_SKILL_PROXY_TOKEN` | 远程 Agent 拉技能 ZIP |
| `OIDC_*` / `SESSION_SECRET` | HepAI OIDC |

SSO、`DEFAULT_REMOTE_AGENTS`、GFS Skills AK/SK 在 opendrsai 侧本来就有，没有用 drsaiv2 的值覆盖。

---

## 6. 结论

生产 WebUI 的主路径已经迁到 `apps/webui`：

**登录（SSO + 嵌入）→ 聊天 → 智能体广场 → 技能广场 → 云盘 → DocMaster → 管理后台 → 客户端下载。**

不是 1:1 拷贝。技能广场、OIDC、CSNS、Higraf 代理、个人资料是在目标仓继续做完的。还没闭环的主要是 VNC 真实服务、BESIII、LHAASO 市场接入，以及设置里未挂导航的旧页。

下一步如果要验收，建议按第 2 节表格逐项在 opendrsai 上走一遍，而不是再 diff `drsai-dev` 文件名。
