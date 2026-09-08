# Desktop Skill 管理逻辑与运行流程

> **日期**: 2026-09-08（2026-09-08 按改造清单修订）  
> **范围**: Desktop Renderer / Main / `desktop_gateway` — 本地 Skill、Skills Square  
> **结论先行**: Skill 分 **两条平面**（本地运行时 vs Skills Square），只在装进 `configs/skills` 时汇合。进对话靠 **磁盘安装**；桌面 **不再** 使用 Agent policy 启停 UI，也 **不再** 使用 Composer chip / `selected_skill_id`。按需由 Agent Skill 工具被动调度；`@skill` 下期。

配套施工单：[`skill-refactor-checklist.zh-CN.md`](./skill-refactor-checklist.zh-CN.md)。

---

## 1. 一句话心智模型

| 平面 | 作用 | 是否进对话 |
|------|------|------------|
| **本地运行时 Skill** | 磁盘 `SKILL.md`，后端扫描目录 | 是（按需工具调用） |
| **Skills Square（市场）** | 公开目录、收藏、发布、安装/存 ZIP | 否（须「安装到本地」） |

| 概念 | 管什么 | 真相来源 |
|------|--------|----------|
| **本地安装** | 磁盘上有没有 | `GET/POST/DELETE /v1/skills*` |
| ~~Agent 启停（policy）~~ | 桌面已去掉日常启停 | API 可暂留；UI 不用 |
| ~~Composer chip~~ | 桌面已去掉强制注入 | `selected_skill_id` API 可暂留 |

---

## 2. 分层架构

```text
Renderer
  ├── SkillsManager          本地列表 / 新建 / 文件夹·ZIP 导入 / 删除
  ├── SkillsSquarePanel      市场浏览 / 收藏 / 安装到本地 / 仅存 ZIP / 发布
  └── ChatWorkspace          无 skill chip；历史消息可仍显示旧 skillName 徽章
        │  desktopApi（preload IPC）
        ▼
Electron Main
  ├── skills.ts / gatewayManagedResources.ts
  │     → loopback HTTP  /v1/skills*
  ├── skillsSquare.ts
  │     → HTTPS 直连 WebUI /api/skills*（HepAI OIDC）
  ├── skillArchive.ts
  │     → ZIP / 文件夹 / Square → materializeSkillTree → configs/skills
  └── chat.ts + runtimeClient.ts
        → POST /v1/runs/{run_id}/execute（桌面不再传 selected_skill_id）
        ▼
desktop_gateway（Python）
  ├── skills_api                    本地 CRUD + reload
  ├── routes/config_agents.py       Agent skill policy（兼容保留）
  ├── routes/skills_square.py       WebUI 代理（桌面主路径是直连）
  ├── routes/runs.py                仍可解析 selected_skill_id（下期 @skill）
  └── DrSaiAssistant + SkillLoader
        每轮扫描用户 skills 目录 → Skill 工具按需加载
```

---

## 3. 磁盘与身份

| 位置 | 内容 |
|------|------|
| `{WORKDIR}/{user_id}/configs/skills/{installName}/SKILL.md` | 用户已安装（可含 `scripts/` 等） |
| `UserProfileManager.skills_dir` | Agent 实际加载根（通常同上） |
| 市场存储 | WebUI 侧；未「安装到本地」前不在扫描目录 |

安装名 = **文件夹名**。本地列表与该目录 **一一对应**。

| 场景 | 身份 |
|------|------|
| `/v1/skills*` 本地路径 | **OIDC subject** |
| Square 收藏 / 创建归属 | **账号 email** |

---

## 4. 用户流程

### 4.1 列表

1. `listInstalledSkills` → `GET /v1/skills?user_id=<OIDC sub>`
2. 无启停徽章；装上即可被扫描

### 4.2 新建 / 导入 / 删除

| 动作 | 路径 |
|------|------|
| 新建/编辑 | `installSkill` / `updateSkill` |
| 导入文件夹 | `importSkillFolder` → `materializeSkillTree` |
| 导入 ZIP | `installSkillZip` → `materializeSkillTree` |
| 删除 | `uninstallSkill`；若 policy 仍引用 → 409 后可清引用再删 |

### 4.3 Skills Square

| 能力 | 状态 |
|------|------|
| 浏览 / 收藏 / 发布 | 已实现 |
| **安装到本地** | UI 调 `installSkillsSquare` → 扫描目录 |
| 仅保存 ZIP | 次要入口；**不**等于安装 |

### 4.4 对话调用

- 默认：Agent 经 Skill 工具按目录内 skill **被动**调用
- 桌面 **不传** `selected_skill_id`
- `@skill`：**下期**

---

## 5. API / IPC 速查

| 面 | 入口 |
|----|------|
| 本地 Skill | `/v1/skills`、`/install`、`DELETE`、`/reload`；IPC `importSkillFolder` / `installSkillZip` |
| Square | `installSkillsSquare`、`downloadSkillsSquare`；Main→WebUI `/api/skills*` |
| Run | execute metadata 可选 `selected_skill_id`（桌面不用） |

---

## 6. 边界与已知缺口

1. `@skill` 尚未做  
2. Policy API / `selected_skill_id` 后端仍在，桌面 UI 已摘掉  
3. `projectSkills` 旁路目录与网关扫描目录不同，勿与本地列表混淆  
4. reload = evict，下一轮重建  
5. Gateway `/v1/skills-square/*` 代理并行存在，桌面主路径是直连  

---

## 7. 流程总图

```text
[Skills Square]                 [本地 Skills UI]              [Chat]
 浏览/收藏/发布                  列表/新建/导入删               无 chip
 安装到本地 ──┐                 文件夹 / ZIP ──┐
 仅存 ZIP（不装）               │              │
                 └──────────────► configs/skills/{name}/SKILL.md
                                        │
                              后端每轮扫描该目录
                                        │
                              Skill 工具按需加载 SKILL.md
```
