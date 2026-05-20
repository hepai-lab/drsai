# DrSai Desktop — Skill 管理功能打通

> 日期：2026-05-20

---

## 一、Skill 目录路径修正

### 1.1 修复 `_get_skills_dir()` 路径缺少 `configs/` 层

**问题：** 桌面端 Skills → Installed 列表始终为 0，后端 API 返回空。

**根因：** `gateway.py` 的 `_get_skills_dir()` 返回 `WORKDIR/{user_id}/skills/`，但实际的 skill 存储路径（由 `UserProfileManager` 管理）是 `WORKDIR/{user_id}/configs/skills/`，少了一层 `configs/`。

**修改文件：**

| 文件 | 修改 |
|---|---|
| `python/packages/drsai/src/drsai/backend/gateway.py` | `_get_skills_dir()` 改为 `WORKDIR/uid/configs/skills`，注释与 `UserProfileManager` 对齐 |

```python
# 修改前
return Path(WORKDIR) / uid / "skills"

# 修改后
return Path(WORKDIR) / uid / "configs" / "skills"
```

---

## 二、Skill 列表结构扁平化

### 2.1 `GET /v1/skills` 两层 → 单层

**问题：** 原 `list_skills` 按 `category_dir/skill_dir/SKILL.md` 两层遍历，但 install 端点创建的是 `skill_dir/SKILL.md`（单层），导致安装的 skill 列表查不到。

**修改：** 去掉外层 `category_dir` 遍历，直接在 `skills_dir` 下扫描 `*/SKILL.md`。`category` 改为从 SKILL.md frontmatter 中解析（新增 `category:` 字段支持），无则留空。

**修改文件：** `gateway.py`

| 位置 | 修改前 | 修改后 |
|---|---|---|
| `list_skills` 遍历逻辑 | `for category_dir → for skill_dir`（双层） | `for skill_dir`（单层扁平） |
| `_parse_skill_frontmatter` 返回值 | `(name, description)` | `(name, description, category)` |

---

## 三、Skill 浏览与安装打通

### 3.1 新增 `GET /v1/skills/available` 端点

**功能：** 列出 `agent_skills/` 目录下所有内置 Skill 集合（skills、skills_hepai、superpowers 等），每个 skill 带 `installed` 布尔标记是否已安装在用户目录。

**实现：**

| 函数 | 说明 |
|---|---|
| `_get_available_skills_dirs()` | 从 `SYSTEM_SKILLS_DIR`/`AGENT_SKILLS_DIR` 环境变量 + 项目根 `agent_skills/` 发现集合目录 |
| `list_available_skills` | 扫描每个集合的 `*/SKILL.md`，与用户已安装对比，去重后返回 |

**返回格式：**
```json
{
  "data": [
    {"name": "academic-search", "description": "...", "category": "skills", "source": "skills", "installed": true},
    ...
  ]
}
```

### 3.2 修复 `POST /v1/skills/install` — 支持从内置集合安装

**问题：** 旧的 install 只能通过传入完整 `content` 安装，但桌面端 Browse 页面只知道 skill 名称，不知道 SKILL.md 内容。

**修改：**

| 文件 | 位置 | 修改 |
|---|---|---|
| `gateway.py` | `SkillInstallRequest` | `content` 改为可选（`default=""`），新增 `source: str \| None` 字段 |
| `gateway.py` | `install_skill` | 若 `source` 非空且 `content` 为空 → 从 `agent_skills/{source}/{name}/SKILL.md` 读取；若 `content` 为空且无 `source` → 返回 400 |
| `gateway.py` | `_find_bundled_skill_md()` | 新增辅助函数：在可用集合中按 `name` + `source` 查找 SKILL.md |

### 3.3 桌面端 `skills.ts` — API 对接

| 函数 | 修改 |
|---|---|
| `listBundledSkillsAsync()` | ✨ 新增，调用 `GET /v1/skills/available?user_id=xxx` |
| `listBundledSkills()` | 保留同步 fallback，返回 `[]` |
| `installSkillAsync(name, content, source?)` | 新增 `source` 可选参数，传给后端 |

**修改文件：** `src/main/skills.ts`

### 3.4 IPC 层串联

**修改文件：**

| 文件 | 修改 |
|---|---|
| `src/main/index.ts` | 导入 `listBundledSkillsAsync`；`list-bundled-skills` handler 改为 async 调用新函数；`install-skill` handler 新增 `source` 参数并传递给 `installSkillAsync` |
| `src/preload/index.ts` | `installSkill` 桥接增加 `source` 参数 |
| `src/preload/index.d.ts` | 类型声明同步 |

### 3.5 UI 层串联

**修改文件：** `src/renderer/src/screens/Skills/Skills.tsx`

| 函数 | 修改 |
|---|---|
| `handleInstall(name, source?)` | 新增 `source` 参数，传给 `window.drsaiAPI.installSkill(name, source, profile)` |
| onClick 安装按钮 | `handleInstall(skill.name)` → `handleInstall(skill.name, skill.source)` |

---

## 四、端到端数据流

```
┌─ Browse Tab ─────────────────────────────────────────────────────┐
│  listBundledSkillsAsync()                                         │
│    → GET /v1/skills/available?user_id=xiongdb                     │
│    → 扫描 agent_skills/{skills,skills_hepai,superpowers,...}/     │
│    → 返回 ~60 个内置 skill（标记 installed/not）                   │
└──────────────────────────────────────────────────────────────────┘

┌─ 点击 [Install] ─────────────────────────────────────────────────┐
│  handleInstall("academic-search", "skills")                        │
│    → POST /v1/skills/install?user_id=xiongdb                      │
│      {"name":"academic-search","content":"","source":"skills"}    │
│    → 后端从 agent_skills/skills/academic-search/SKILL.md 读取     │
│    → 写入 ~/.drsai/workspace/runs/xiongdb/configs/skills/         │
│      academic-search/SKILL.md                                     │
│    → 刷新 Installed 列表                                          │
└──────────────────────────────────────────────────────────────────┘

┌─ Installed Tab ──────────────────────────────────────────────────┐
│  listInstalledSkillsAsync()                                        │
│    → GET /v1/skills?user_id=xiongdb                               │
│    → 扫描 ~/.drsai/.../configs/skills/*/SKILL.md                  │
│    → 返回已安装 skill 列表（当前 9 个）                             │
└──────────────────────────────────────────────────────────────────┘

┌─ 点击 [Uninstall] ───────────────────────────────────────────────┐
│  handleUninstall("academic-search")                                │
│    → DELETE /v1/skills/academic-search?user_id=xiongdb             │
│    → shutil.rmtree(configs/skills/academic-search/)               │
│    → 刷新 Installed 列表                                          │
└──────────────────────────────────────────────────────────────────┘
```

---

## 五、涉及文件一览

| 文件 | 修改类型 | 说明 |
|---|---|---|
| `python/.../gateway.py` | **重写** | `_get_skills_dir` 路径修正；`list_skills` 扁平化；新增 `list_available_skills`；`install_skill` 支持 source；`_parse_skill_frontmatter` 返回 category；新增 `_get_available_skills_dirs` + `_find_bundled_skill_md` |
| `src/main/skills.ts` | **扩展** | 新增 `listBundledSkillsAsync`；`installSkillAsync` 加 source |
| `src/main/index.ts` | **修正** | 导入 + handler 串联 source 参数 |
| `src/preload/index.ts` | **修正** | `installSkill` 桥接加 source |
| `src/preload/index.d.ts` | **修正** | 类型同步 |
| `src/renderer/src/screens/Skills/Skills.tsx` | **修正** | `handleInstall` 传递 source |

**总计：** 6 个文件，+199 行，−50 行