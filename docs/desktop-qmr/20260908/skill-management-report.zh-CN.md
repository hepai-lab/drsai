# Desktop Skill 管理逻辑与运行流程

> **日期**: 2026-09-08  
> **范围**: Desktop Renderer / Main / `desktop_gateway` — 本地 Skill、Agent Skill Policy、Composer 选中、Skills Square  
> **结论先行**: Skill 分 **两条平面**（本地运行时 vs Skills Square），只在装进 `configs/skills` 时汇合。进对话靠三件事别混：① 磁盘安装 ② Agent policy 启停 ③ Composer `selected_skill_id`。Square 收藏不进对话；一键装本地 UI 尚未接上。

---

## 1. 一句话心智模型

| 平面 | 作用 | 是否进对话 |
|------|------|------------|
| **本地运行时 Skill** | 磁盘 `SKILL.md` + Agent Policy + Composer chip | 是 |
| **Skills Square（市场）** | 公开目录、收藏、发布、下载 ZIP | 否（收藏=书签；下载后需再导入本地） |

三类「开关」：

| 概念 | 管什么 | 真相来源 |
|------|--------|----------|
| **本地安装** | 磁盘上有没有 | `GET/POST/DELETE /v1/skills*` |
| **Agent 启停（policy）** | Skill 工具目录是否对该 Agent 可见 | `GET/PUT /v1/config/agents/{id}/skills` |
| **Composer chip** | 本轮强制注入某个已安装 skill | Run `metadata.selected_skill_id` |

---

## 2. 分层架构

```text
Renderer
  ├── SkillsManager          本地列表 / 启停 / 新建导入删除
  ├── SkillsSquarePanel      市场浏览 / 收藏 / 下载 / 发布
  └── ChatWorkspace          Composer Skill chip
        │  desktopApi（preload IPC）
        ▼
Electron Main
  ├── skills.ts / gatewayManagedResources.ts
  │     → loopback HTTP  /v1/skills*
  ├── skillsSquare.ts
  │     → HTTPS 直连 WebUI /api/skills*（HepAI OIDC）
  ├── skillArchive.ts
  │     → ZIP / 文件夹物化到本地 skills 目录
  └── chat.ts + runtimeClient.ts
        → POST /v1/runs/{run_id}/execute（metadata.selected_skill_id）
        ▼
desktop_gateway（Python）
  ├── skills_api                    本地 CRUD + reload
  ├── routes/config_agents.py       Agent skill policy
  ├── routes/skills_square.py       WebUI 代理（桌面 UI 几乎不依赖）
  ├── routes/runs.py                解析 selected_skill_id
  └── _agent_manager.apply_selected_skill_to_agent
        ▼
DrSaiAssistant + SkillLoader
  读 SKILL.md → 本轮注入 → scripts / tools → artifacts
```

**说明**：`gateway.ts` 不承载 Skill IPC；本地 Skill HTTP 客户端在 `skills.ts` / `gatewayManagedResources.ts`。

涉及实现（主路径）：

- UI：`SkillsManager.tsx`、`SkillsSquarePanel.tsx`、`ChatWorkspace.tsx`、`useDesktopChatAdapter.ts`
- Main：`skills.ts`、`skillsSquare.ts`、`skillArchive.ts`、`preload.ts`
- Gateway：`skills_api.py`、`config_agents.py`、`runs.py`、`_agent_manager.py`
- Agent：`drsai_assistant.py`（`update_user_skills` / `filter_agent_skills` / `_elevate_tools_for_skill`）

---

## 3. 磁盘与身份

### 3.1 目录布局

| 位置 | 内容 |
|------|------|
| `{WORKDIR}/{user_id}/configs/skills/{installName}/SKILL.md` | 用户已安装（可含 `scripts/` 等） |
| `UserProfileManager.skills_dir` | Agent 实际加载根（通常同上） |
| Electron 回退 | `{DRSAI_HOME}/workspace/runs/{uid}/configs/skills` |
| 仓库内置 | `skills/skills`、`skills_hepai` 等；`docx` 等在 `anthropic_skills_collection` |
| 市场存储 | WebUI 侧 skill 对象存储 + DB（未安装前不在本地） |
| 取消收藏 overlay | `{DRSAI_HOME}/desktop/skills-square-uncollect.json` |

安装名 = **文件夹名**。Frontmatter `name` 可不同；`resolve_loaded_skill_name` 同时匹配 loader key / 文件夹 / frontmatter。

### 3.2 用户身份

| 场景 | 身份 |
|------|------|
| `/v1/skills*` 本地路径 | **OIDC subject**（email 可能 `subject_mismatch`） |
| Square 收藏 / 创建归属 | **账号 email**（与 WebUI 对齐） |

---

## 4. 关键数据模型

**Desktop TS**：`GatewaySkill`、`GatewayAvailableSkill`、`AgentSkillPolicy`（`mode`: `inherit` / `all_enabled` / `explicit`）、Square 列表类型、Run metadata `selected_skill_id`。

**Python**：`SkillInstallRequest` / `_selected_skill_id` 名正则 `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`；`SkillLoader.skills`；本轮 `_selected_skill_for_turn` / `_selected_skill_required_tools`（finally 清空）。

---

## 5. 用户流程

### 5.1 列表 / 启停

1. `listInstalledSkills` → `GET /v1/skills?user_id=<OIDC sub>`
2. 启停徽章：`getMyDrSaiAgentSkillPolicy("opendrsai")`
3. Toggle → `PUT /v1/config/agents/opendrsai/skills` → `reloadSkills`（`evict_user`，下一轮重建 Agent）

判定：`disabled` 关；`explicit` 须在 `enabled`；`inherit`/`all_enabled` 默认开除非 disabled。

### 5.2 新建 / 导入 / 删除

| 动作 | 路径 |
|------|------|
| 新建/编辑 | `installSkill` / `updateSkill` |
| 导入文件夹/ZIP | `findSkillRoot` → `materializeSkillTree` |
| 删除 | `uninstallSkill`；policy 仍引用 → **409** |
| 重载 | `POST /v1/skills/reload`（evict，非热改 loader） |

### 5.3 Skills Square

模式：`public` / `created` / `collected` / `publish`。

| 能力 | 状态 |
|------|------|
| 浏览 / 下载 ZIP / 收藏 / 发布 | 已实现 |
| **一键安装到本地** | Main 有 `installSkillsSquare`，**UI 未调用** |

实用路径：`下载 ZIP → 本地页导入 → Policy 启用和/或 Composer 选中`。

双客户端：Electron **直连 WebUI**；Gateway `/v1/skills-square/*` 代理并行存在，桌面主路径是直连。

### 5.4 Composer chip

- 仅本地 OpenDrSai；不改用户可见正文
- `metadata.selected_skill_id`；Picker 按 policy 过滤，执行时为 **thread override**（§6）
- 无 chip 时 Agent 可经 Skill 工具自行加载；`operater_funs` 是脚本执行栈，不是 CRUD

---

## 6. 运行时：selected_skill 如何进 Agent

```text
ChatWorkspace chip
  → useDesktopChatAdapter（metadata.selected_skill_id）
  → POST /v1/runs/{id}/execute
  → runs._selected_skill_id
  → DesktopAgentManager.run_stream
       ├─ apply_selected_skill_to_agent
       │    update_user_skills → resolve（loader / 磁盘 override）
       │    设本轮属性 → system suffix <skill-loaded>
       ├─ inject_system_prompt + annotate_task（隐藏 [Selected skill: …]）
       ├─ run_stream → _elevate_tools_for_skill
       └─ finally 清空本轮属性
```

**Policy vs Chip**：chip 可从磁盘加载被 policy 藏掉的 skill（见 `_agent_manager.py`、`test_desktop_selected_skill.py`）。

另：`cli_config.enabled_skills` 名单同步可能 **rmtree** 未列用户 skill，与 UI policy 不同机制。

产物：`artifacts/` → `deliver_artifact`，与选中逻辑正交。

---

## 7. API / IPC 速查

| 面 | 入口 |
|----|------|
| 本地 Skill | `/v1/skills`、`/available`、`/install`、`DELETE`、`/reload` |
| Policy | `GET/PUT /v1/config/agents/{id}/skills`；preview / reload |
| Square | Main→WebUI `/api/skills*`；或 Gateway `/v1/skills-square/*` |
| Run | execute metadata `selected_skill_id` |

默认本地管理 `agent_id = opendrsai`。

---

## 8. 代码地图（精简）

| 层 | 关键路径 |
|----|----------|
| Renderer | `SkillsManager.tsx`、`SkillsSquarePanel.tsx`、`skillsSquarePack.ts`、`ChatWorkspace.tsx`、`useDesktopChatAdapter.ts` |
| Main | `skills.ts`、`skillsSquare.ts`、`skillArchive.ts`、`preload.ts`、`chat.ts` / `runtimeClient.ts` |
| Gateway | `skills_api.py`、`config_agents.py`、`skills_square.py`、`runs.py`、`_agent_manager.py` |
| Agent | `drsai_assistant.py`、`skill_loader.py`、`operater_funs.py` |
| 测试 | `tests/test_desktop_selected_skill.py` |

---

## 9. 边界与已知缺口

1. Square → 本地安装 **UI 未闭环**（有 API 无调用）
2. 收藏 ≠ 安装 ≠ 启用
3. Chip 可 override policy；Picker 按 policy 隐藏
4. 删除仅当出现在 policy enabled/disabled 列表才 409
5. reload = evict，下一轮重建
6. `enabled_skills` 同步可能删用户目录
7. 遗留 `SkillSquareView` 与现行 `SkillsManager` 并存

---

## 10. 流程总图

```text
[Skills Square]              [本地 Skills UI]            [Chat Composer]
 浏览/收藏/发布               列表/启停/导入删除           选 chip
 下载 ZIP only               policy /v1/config/...       selected_skill_id
        │                          │                          │
        └─────────► configs/skills/{name}/SKILL.md ◄───────────┘
                       （须已安装；chip 可 override 目录过滤）
                                  │
                       DrSaiAssistant 本轮注入
                                  │
                       scripts / tools → artifacts/
```
