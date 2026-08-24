# Gateway 模块化重构方案

- 分支：`feature/desktop-v2`
- 目标文件：`cores/python/packages/drsai/src/drsai/backend/gateway_legacy.py`
- 状态：**待确认，确认后执行**
- 日期：2026-08-24

---

## 0. 现状基线（实测，非估计）

```
backend/
├── gateway/                       # 新包，已建
│   ├── __init__.py    60 行       # exec(compile(legacy)) 进包命名空间
│   ├── _app.py        28 行       # mount_routers()
│   ├── _state.py      14 行       # ← 空壳，只有 docstring
│   ├── _models.py / _agent_manager.py / _agent_backend.py   各 9 行（空壳）
│   └── routes/                    # 已抽出 18 条路由
│       ├── threads.py      145 行  7 条
│       ├── env.py          153 行  3 条
│       ├── hepai_workers.py 78 行  2 条
│       ├── logs.py          77 行  2 条
│       ├── cli_config.py    76 行  2 条
│       └── platforms.py     61 行  2 条
└── gateway_legacy.py  13,710 行   # ← 活代码，不是备份
```

**路由账目（已核对，零丢失）：**

| | 数量 |
|---|---|
| 重构前 `gateway.py`（commit `aa5df995`）`@app.*` 装饰器 | 259 |
| 现 `gateway_legacy.py` `@app.*` | 241（238 HTTP + 2 exception_handler + 1 middleware） |
| 现 `routes/*.py` `@api.*` | 18 |
| 合计 | **259 ✓** |
| `app.openapi()["paths"]` 唯一路径 | 229 |

**结构分布（`gateway_legacy.py`）：**

```
1 – 4,404      import + 约 40 个模块级单例 + 辅助函数   ← _state.py 抽取区
4,405 – 13,710 路由区，238 个 HTTP handler              ← routes/ 抽取区

413 个 def，其中 259 个是路由 handler → 154 个共享辅助函数
```

---

## 1. 三个必须保住的不变量

> **不变量 A：路由处理函数名一个都不能改。**
> FastAPI 的 `operationId` 由「函数名 + 路径 + 方法」拼成，例如
> `remote_workspace_files_v1_workspaces__workspace_id__files_get`。
> 这个值经 `app.openapi()` → `apps/desktop/windows/resources/remote-gateway-openapi.json`（412KB，253 个 operationId，已入库）→ `generate-remote-gateway-client.mjs` → `src/main/remoteGatewayClient.generated.ts`。
> 改函数名 → 生成表的 key 变 → **桌面端主进程编译失败**。

> **不变量 B：路由注册顺序是契约的一部分。**
> 现存实例：`/v1/threads/search` 必须注册在 `/v1/threads/{thread_id}` 之前，否则 `search` 被当作 `thread_id`，返回 404 且不报错。同类需检查 `/v1/sessions/{id}/runs/by-idempotency/{key}`、`/v1/workspaces/{id}/git/{operation}-hunk`。

> **不变量 C：移动代码与改变行为，永不在同一个 commit。**
> 拆分 commit 的 diff 应接近纯位移。发现的 bug、死代码、可统一的错误处理，全部记录后另开 commit。混在一起，快照一红就无法判断是移错了还是「改对了」。

---

## 2. 阶段总览

| 阶段 | 内容 | 估时 | 前置 |
|---|---|---|---|
| **P0** | 安全网：3 个快照测试 + 基线 fixture | 0.5 天 | — |
| **P1** | 删除 A 类死路由（24 条装饰器） | 0.5 天 | P0 |
| **P2** | 填充 `_state.py`（前 5 个访问器，覆盖 334 处调用） | 1.5 天 | P0 |
| **P3** | 分批抽取路由（8 批，220 条） | 6–7 天 | P2 |
| **P4** | 收尾：digest 清单、门面校验、文档 | 0.5 天 | P3 |
| | **合计** | **约 9–10 个工作日** | |

> 注：`exec(compile(...))` 脚手架已经保住了 monkeypatch 语义（`gateway.__dict__` 即 legacy 的 globals），因此 207 处 `setattr(gateway, ...)` **无需改动**，`_state.py` 也可以增量填充，不必一次搬完。这是当前方案相比原始估算（12 天）省下的部分。

---

## 3. P0 — 安全网

三个测试，位于 `cores/python/packages/drsai/tests/test_gateway_refactor_baseline.py`。

### P0-1 OpenAPI 路径快照

```python
def test_openapi_paths_unchanged():
    spec = gateway.app.openapi()
    assert spec["paths"] == json.loads(FIXTURE_OPENAPI_PATHS.read_text())
```

抓：路径丢失、方法变化、请求/响应模型漂移、**operationId 变化（不变量 A）**。

> ⚠️ **必须基于 `app.openapi()["paths"]`，不能基于 `app.routes`。**
> 本项目 FastAPI 版本为 **0.139.0**，`include_router` 不再把子路由摊平进 `app.routes`，而是塞进 `_IncludedRouter` 容器对象（无 `path` 属性）。基于 `app.routes` 的快照会在每次抽取后误报「路由消失」。

### P0-2 路由注册顺序快照

```python
def test_route_order_unchanged():
    order = _flatten_routes(gateway.app)     # 递归展开 _IncludedRouter
    actual = [(r.path, sorted(r.methods or [])) for r in order]
    assert actual == json.loads(FIXTURE_ROUTE_ORDER.read_text())   # 保序，不排序
```

抓：**不变量 B**。顺序本身是断言对象，不允许 sort。

### P0-3 evidence digest 覆盖完整性

```python
def test_evidence_digest_covers_all_route_modules():
    served = {p for p in _iter_backend_py() if _defines_routes(p)}   # 含 @app. 或 @api.
    covered = {Path(p).name for p in gateway._RUNTIME_EVIDENCE_SOURCE_FILES}
    assert {p.name for p in served} <= covered
```

抓：`_RUNTIME_EVIDENCE_SOURCE_DIGEST` 在导入期对硬编码文件列表算 sha256，经 `GET /v1/runtime` 的 `runtime_source_digest` 对外暴露，用途是「跑着旧代码的 Gateway 不能声称新代码的 digest」。

**当前已存在缺口**：清单已更新指向 `gateway_legacy.py`，但**未包含 `routes/` 下的 6 个模块**（约 590 行已在服务路由的代码不在指纹内）。P0 建立此测试后会立即变红——这是预期的，在 P1 一并修复。

### 交付物

```
tests/test_gateway_refactor_baseline.py
tests/fixtures/gateway_openapi_paths.json      ← 基线，此后禁止手改
tests/fixtures/gateway_route_order.json        ← 基线，此后禁止手改
```

**规则：fixture 文件的任何变更都必须在 PR 描述中说明变更理由与受影响客户端。**

---

## 4. P1 — 删除 A 类死路由

### 判定依据

对 16MB 客户端语料（`apps/desktop/shared` + `apps/desktop/windows/src` + `apps/desktop/windows/scripts` + `scripts/` + `backend/tui_gateway/`）做字面量检索，引用次数为 0：

| 关键词 | 客户端引用 | Python 测试引用 | 装饰器数 | 行号（`gateway_legacy.py`） |
|---|---|---|---|---|
| `kanban` | 0 | 0 | **10** | 13130–13290 区间 |
| `cronjob` | 0 | 0 | **6** | 12964–13052 |
| `agents-md` | 0 | 0 | 3 | 10121, 10134, 10146 |
| `user-md` | 0 | 0 | 2 | 10187, 10200 |
| `runtime-policy` | 0 | 0 | 1 | 11990 |
| `operation-metrics` | 0 | 0 | 1 | 5214 |
| `experiment-cleanup` | 0 | 0 | 1 | 5993 |
| **合计可删** | | | **24 条** | |

### 单独处理项

| `workspace-lifecycles` | 0 | **4 个测试文件** | 1 | 4787 |

`/v1/mobile-pairing/diagnostics/workspace-lifecycles` 客户端零引用，但有 4 个测试文件引用。**不纳入 P1**，转入 P3 的 mobile-pairing 批次，由该批次决定是保留还是连测试一起删。

### 执行步骤

1. 先跑 P0，确认三个快照绿（P0-3 预期红）。
2. 删除 24 条路由 handler 及其**专属**辅助函数（判定：该 helper 在删除后全文件零引用）。
3. 修复 P0-3：把 `routes/*.py` 六个模块加入 `_RUNTIME_EVIDENCE_SOURCE_FILES`，或改为按目录扫描 `backend/` 下所有含路由定义的文件。
4. 重跑快照，**diff 必须恰好是这 24 条路径消失，其余零变化**，然后更新 fixture 基线。
5. 单独 commit，PR 描述附本表。

> 提示：`gateway_legacy.py` 是活代码，删除就在它里面进行。备份在 git（`aa5df995:cores/python/packages/drsai/src/drsai/backend/gateway.py`），不需要也不应该另存文件副本。

---

## 5. P2 — 填充 `_state.py`

### 为什么必须先做

现有 `routes/threads.py` 的 7 个 handler 里有 7 个函数内懒加载：

```python
async def list_threads(...):
    from drsai.backend import gateway   # lazy: shared accessors still in legacy ns
    store = gateway._get_store(user_id)
```

原因是模块顶层 `from drsai.backend import gateway` 会循环 import（`gateway/__init__` → `_app` → `routes` → `threads` → `gateway` 尚未初始化完）。这个疤在 `gateway_wechat.py:64` 已经有一处，注释写明了：

> `# Imported lazily to avoid the gateway <-> channel router import cycle.`

按此模式推进到 238 条路由，结果是 **238 个函数内 import**。

`_state.py` 处于依赖树底部——**它不 import 任何 gateway 模块，只被别人 import**——循环因此断开，路由模块可以正常顶层 import：

```python
from .._state import _runtime_engine, _authorize_request, _workspace_root
```

### 填充顺序（按实测扇入倒序）

| 顺序 | 符号 | 调用点 |
|---|---|---|
| 1 | `_runtime_engine` | **153** |
| 2 | `_authorize_request` | 60 |
| 3 | `_get_config_dir` | 50 |
| 4 | `_workspace_root` | 37 |
| 5 | `_runtime_registry` | 34 |
| | **前 5 项小计** | **334 处** |
| 6 | `_effective_user_id` | 28 |
| 7 | `_git_worktree_service` | 26 |
| 8 | `_remote_audit` | 24 |
| 9 | `_runtime_agent_service` | 20 |
| 10 | `_runtime_security` | 13 |

连同这些访问器背后的约 40 个模块级单例（`_runtime_engine_instance`、`_store_cache`、`_remote_workspaces`、`_resource_service_instances` 等）一并搬入。

**P2 完成判据：前 5 项搬完。** 覆盖 334 处调用，足以让 P3 的全部 8 批用顶层 import。第 6–10 项可在 P3 过程中按需增量搬入。

### 搬迁手法（每个符号一个 commit）

```python
# 1. _state.py 中放置定义，名字与原来完全一致（保留下划线前缀）
# 2. gateway_legacy.py 中删除原定义，替换为：
from drsai.backend.gateway._state import _runtime_engine   # noqa: F401
# 3. 名字仍在 gateway.__dict__ 中 → 207 处 monkeypatch 原样生效
# 4. 跑 P0 三个快照 + 全量测试
```

> ⚠️ **名字必须一模一样。** 顺手改成 `runtime_engine()`（去掉下划线）会让 207 处 patch 静默失效——测试可能仍然通过，但测的是真实单例。

---

## 6. P3 — 分批抽取路由

**规则：一批一个 commit，批次之间 P0 三个快照必须绿。禁止两批合并提交。**

| 批次 | 内容 | 路由数 | 说明 |
|---|---|---|---|
| B1 | `gfs` / `memory` / `pipelines` | ~17 | 低耦合，验证机制 |
| B2 | `mobile-pairing` | 13 | 独立子系统；`workspace-lifecycles` 在此决断 |
| B3 | `experiments` + `replay-plans` + `run-comparisons` + `adoptions` | 16 | 自包含；**V2 非目标，M1 后可整块退役** |
| B4 | `config`（除已抽出的 env / cli / platforms） | ~65 | 单批最大，但内部同质 |
| B5 | `audio` / `models` / `skills` | 16 | |
| B6 | `agent-backends` / `runtime` / `security` / `approvals` / `identity` | ~15 | |
| B7 | `workspaces`（含 files / git / worktrees / checkpoints） | 45 | 开始密集碰共享状态 |
| B8 | `sessions` / `runs` / `chat` | 43 | **最后做**，含 693 行的 `POST /v1/runs/{run_id}/execute` |

### 每批的动作

1. 新建 `gateway/routes/<name>.py`，沿用现有 `api = APIRouter(...)` + `def router()` 约定。
2. 从 `gateway_legacy.py` 剪切 handler，**函数名逐字保留**（不变量 A）。
3. 判定该批专属的辅助函数（低扇入的 ~124 个中属于本批的），一并搬入模块内部。
4. `_app.py` 的 `mount_routers()` 中 `include_router`，**位置对应原始注册顺序**（不变量 B）。
5. 跑 P0 三个快照 + 全量测试；快照必须**零 diff**。
6. commit，message 格式：`refactor(gateway): extract <name> routes (N routes, no behavior change)`。

### B8 的特别说明

`POST /v1/runs/{run_id}/execute` 693 行，其中一个 `try:` 块跨越 587 行，开头 40 行是内嵌在生产路径中的 E2E 测试夹具分支（`packaged_crash_fixture` / `packaged_recovery_fixture`，由 6 个条件与 magic `user_id == "packaged-l5-user"` 触发）。

**P3 阶段只做位移，不动这段。** 夹具外提单独记录为后续任务（见 §9）。

---

## 7. P4 — 收尾

1. `_RUNTIME_EVIDENCE_SOURCE_FILES` 改为按目录扫描，杜绝再次漏项。
2. 校验 `gateway/__init__.py` 门面：`gateway_wechat.py`（2 处）、`run_cli.py`（1 处）、`apps/desktop/drsai_gateway_server.py`（1 处）、`apps/desktop/windows/scripts/` 下 5 个脚本、`scripts/verify-codex-runtime-online.py` 全部可正常解析符号。
3. 重新导出 OpenAPI 与生成客户端，确认 `remoteGatewayClient.generated.ts` **零 diff**（不变量 A 的最终验证）。
4. 若 `gateway_legacy.py` 已清空，删除 `exec(compile(...))` 脚手架，`gateway/__init__.py` 改为常规 import。

---

## 8. 与 Desktop V2 的关系

本方案与 [Desktop V2 契约](desktop-v2-architecture-and-runtime-contract.zh-CN.md) 独立推进，无技术依赖（V2 不 import `gateway`，其所需的 `RuntimeEngine` / agent kernel 位于 `backend/runtime/`）。

**建议优先级：P0 立即执行 → V2 的 M0 + M1 → 回头做 P1–P4。**

理由：P3 中至少 B3（16 条）与 B2（13 条）落在 V2 明确的非目标上，B4 的 65 条里 V2 只需要 1 条。**M1 跑通后再做 P3，这些批次可以直接标记退役而非精心拆分**，预计能把 P3 从 6–7 天压到 3–4 天。

P0 是唯一不依赖任何未决决策的步骤——它既是本方案的前置，也是 V2 的行为对照基线，因此现在就该做。

---

## 9. 遗留任务登记（不在本方案范围内，禁止顺手做）

| 项 | 位置 | 说明 |
|---|---|---|
| 生产路径中的 E2E 夹具 | `execute` 路由开头 40 行 | 应移出生产路径或改为能力位门控端点 |
| 本地/远程双实现 | `desktop:workspace-file-preview` 分支 | 本地绕过 runtime 直接读盘，远程走 HTTP，行为可能不一致 |
| 587 行单 `try` 块 | `execute` 路由 | 拆分后再处理 |
| `_get_store` 扇入仅 1 | `gateway_legacy.py` | 可能是死代码，待确认 |

---

## 10. 确认清单

开始前请确认：

- [ ] P1 删除的 24 条路由确实无业务需求（kanban 10 条、cronjobs 6 条为最大两组）
- [ ] `workspace-lifecycles` 转入 B2 处理，而非 P1 删除
- [ ] 接受「一批一 commit、快照零 diff」的节奏约束
- [ ] 接受先做 P0 + V2 M1、再回头做 P1–P4 的优先级安排（或明确要求连续做完 P0–P4）
- [ ] §9 的遗留任务确认不在本次范围内
