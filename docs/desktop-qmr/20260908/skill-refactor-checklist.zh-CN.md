# Skill 改造清单（定稿）

> **日期**: 2026-09-08  
> **依据**: 智能体 Skill 技术沟通纪要 + 现码对照  
> **范围**: Desktop Renderer / Main；后端扫描机制不改；`@skill` 下期

---

## 定稿决策

| 项 | 决定 |
|----|------|
| Square 下载 | **安装进** `WORKDIR/{uid}/configs/skills`（可保留「仅保存 ZIP」次要入口） |
| 本地导入 | 保留文件夹；补齐 **ZIP** UI |
| 本地列表 | = 后端扫描目录镜像；不做「再发给后端」操作 |
| Policy 启停开关 | **去掉**（桌面不再调 policy 做日常启停；删除 409 清引用可暂留） |
| Composer chip | **去掉**（桌面不再传 `selected_skill_id`） |
| `@skill` | **下期** |
| 后端 API | `selected_skill_id` / policy 路由可暂留兼容 |

---

## P0 — 下载/导入 = 落入扫描目录

| # | 项 | 文件 | 状态 |
|---|----|------|------|
| 1 | Square 一键装本地 | `SkillsSquarePanel.tsx` / `skillsSquare.ts` | **已做**（先 SKILL.md，再尽力 ZIP） |
| 2 | 文案：安装 vs 仅存 ZIP | 同上 | **已做**（已去掉仅存 ZIP） |
| 3 | ZIP 导入 UI | `SkillsManager.tsx` | **已做** |
| 4 | 安装汇入 `materializeSkillTree` | `skillArchive.ts`（少改） | 已有，验收 |
| 5 | Mock 对齐 | `mockDesktopApi.ts` | 既有 mock 已覆盖 |

**验收**: Square 安装 / ZIP·文件夹导入后，`GET /v1/skills` 与本地列表一致。

---

## P1 — 列表语义

| # | 项 | 文件 | 状态 |
|---|----|------|------|
| 6 | 本地 tab = 目录镜像；弱化多余操作 | `SkillsManager.tsx` | **已做** |
| 7 | Square ≠ 已安装文案 | `SkillsSquarePanel.tsx` | **已做** |
| 8 | `projectSkills` 旁路目录 | `projectSkills.ts` | 本期仅文档备注，不迁路径 |
| 9 | 同步运行时报告 | `skill-management-report.zh-CN.md` | **已做** |

---

## P2 — 调用逻辑（本期）

| # | 项 | 文件 | 状态 |
|---|----|------|------|
| 10 | 移除 Composer chip / picker | `ChatWorkspace.tsx` | **已做** |
| 11 | 桌面不再传 `selected_skill_id` | `useDesktopChatAdapter.ts` | **已做**（可选字段保留） |
| 12 | `@skill` | — | **下期不做** |
| 13 | 移除 Policy 启停 UI | `SkillsManager.tsx` | **已做** |

默认对话：Agent 经 Skill 工具按需加载；装进目录即对下一轮可见。

---

## P3 — 收口

| # | 项 | 说明 |
|---|----|------|
| 14 | 安装单一入口 | 文件夹 / ZIP / Square → `materializeSkillTree`（已有） |
| 15 | Gateway Square 代理 | 暂留；桌面主路径仍 Main→WebUI |
| 16 | 遗留 `SkillSquareView` | 有入口再清；本期不强制 |
| 17 | 测试 | 既有 `test_desktop_selected_skill.py` 保留（后端兼容）；桌面不再依赖 chip |

---

## 明确不做（本期）

- 不改后端「只扫指定用户 skills 目录」机制  
- 不把 Square 收藏当成安装  
- 不把 skill 正文每轮 POST 给后端  
- 不做 `@skill` 提及调用  

---

## 实施顺序

```text
P0(1–3) → P1(6–7) → P2(10,11,13) → P1(9) 文档 → 验收
```
