# Gateway 冻结与退役方案

- 分支：`feature/desktop-v2`
- 状态：**已决策，P0/P1 已执行**
- 取代：本文件取代原 `gateway-modularization-plan.zh-CN.md`（全量模块化拆分方案，已作废）
- 日期：2026-08-25

---

## 0. 结论

**不重构 `gateway_legacy.py`，冻结它，等 V2 上线后整体删除。**

原方案计划把 13,083 行、211 条路由的网关按 8 批拆成模块化路由。执行完 P0（安全网）和 P1（删除死路由）之后，两项实测数据推翻了后续阶段：

1. **测试介入面比预估大 4 倍。** 214 处测试通过 `gateway.__dict__` 介入（184 处 `monkeypatch.setattr` + 30 处单例直接重置）。`exec` 脚手架保住的只是**读**；符号一旦物理搬走，对 `gateway.X` 的**写**就到不了新家，重置与打桩静默失效。要真正删掉 legacy，这 214 处必须全部重指向——它不是重构的附加成本，它就是重构本身。

2. **保留下来的路由要在 V2 里收敛掉七成。** 用户确认的 10 项保留能力覆盖 151/211 条路由，但折算成 V2 的最小端点只有约 39 个。差额是分层冗余：两套模型别名系统、provider 配置的完整管理面、git/worktree/checkpoint 操作面、threads 与 sessions 双套会话路径。

把这两条放在一起：**拆分的 6–8 天和 214 处测试迁移，绝大部分花在马上要被收敛掉的冗余上。** 重构的收益只在还要继续编辑的代码上兑现；冻结不动的代码，多大都不构成负担。

---

## 1. 已执行

| commit | 内容 | 保留理由 |
|---|---|---|
| `c7899562` | 5 个基线测试 + 2 份 fixture（211 条 OpenAPI 路径 / 259 条注册序） | 角色从「重构护栏」转为**冻结锁**：legacy 被误改立即报警 |
| `a88906b9` | 删除 24 条无引用路由，`gateway_legacy.py` −661 行 | 净删除，与是否重构无关 |
| `c3780238` | 证据摘要覆盖修复（静态清单改为扫描 `backend/gateway/`）+ 两个非同义反复的测试 | 正确性修复 |

**验证**：改动前后失败集完全一致（35/35 全为既有失败），零新增回归。三个快照测试均经注入验证——删路由、改 handler 名、调换 `/v1/threads/search` 与 `/v1/threads/{thread_id}` 顺序，全部捕获。

### 已取消

```
P2  填充 _state.py        取消（撞上 214 处测试介入点）
P3  8 批路由抽取           取消
P4  删除 exec 脚手架       推迟：随 gateway 整体退役
```

---

## 2. 冻结期的规则

`gateway_legacy.py` 保持 13,083 行、`exec` 脚手架保留、已抽出的 6 个路由模块（18 条路由）保持挂载。它继续服务现网桌面端。

**冻结不是「禁止修改」，是「修改必须有意识」：**

1. 任何触及 `gateway_legacy.py` 的 PR，三个快照测试必须绿。
2. fixture 文件变更须在 PR 描述中说明变更内容与受影响客户端。
3. 现网桌面端的紧急修复照常落在 legacy 里——这是冻结的唯一真实成本，前提是 V2 上线前不大规模迭代现网功能。
4. **不做任何「顺手整理」**：不拆文件、不改函数名、不统一错误处理。函数名尤其重要，见下。

> **函数名不能改。** FastAPI 的 `operationId` 由「函数名 + 路径 + 方法」拼成，经 `app.openapi()` → `apps/desktop/windows/resources/remote-gateway-openapi.json` → `generate-remote-gateway-client.mjs` → `src/main/remoteGatewayClient.generated.ts`。改名会让桌面端主进程编译失败。

---

## 3. 退役条件与动作

**条件**：V2 桌面端替代现网桌面端，且 §4 的保留能力在 V2 侧全部可用。

**动作**（一次性，不分批）：

```
删除  cores/python/packages/drsai/src/drsai/backend/gateway_legacy.py
删除  cores/python/packages/drsai/src/drsai/backend/gateway/
删除  cores/python/packages/drsai/tests/test_gateway_refactor_baseline.py
      + fixtures/gateway_openapi_paths.json
      + fixtures/gateway_route_order.json
删除  214 处测试介入点所在的用例（随被测代码一起退役）
清理  _RUNTIME_EVIDENCE_SOURCE_FILES 中的 gateway 条目
清理  apps/desktop/windows/ 下的 OpenAPI 导出与生成客户端链路
```

届时不需要「先拆干净再删」——整目录删除。

---

## 4. 保留能力与端点收敛

用户确认保留 10 项能力，覆盖现有 151/211 条路由，在 V2 中收敛为约 39 个端点：

| # | 能力组 | 现有路由 | V2 端点 | 收敛掉的内容 |
|---|---|---|---|---|
| 1 | 鉴权 | 10 | 4 | 细粒度授权审计、remote handshake |
| 2 | 配置持久化 | 19 | 4 | agents/tools/env/cli/platforms 各自的 CRUD |
| 3 | 运行时 | 28 | 6 | goal propose/confirm、diagnostics、side-effects |
| 4 | 模型切换 | 23 | 2 | provider CRUD、能力探针、doctor、两套别名系统 |
| 5 | 工作区 | 38 | 4 | git 9 + worktrees 8 + checkpoints 4 + watch/permissions |
| 6 | session | 20 | 7 | legacy conversation 双路径、backend 绑定同步 |
| 7 | skills | 8 | 3 | preview/reload |
| 8 | 语音输入 | 2 | 1 | 实时 WS 双工 |
| 9 | gfs | **0** | 8 | 见下 |
| 10 | 网络检索 | 4 | **0** | 表达为 `tool_call`，不需要端点 |
| | **合计** | **151** | **≈39** | |

### 不保留（60 条）

```
mobile-pairing                                    12
experiments + run-comparisons + adoptions
  + replay-plans                                  13
channels(wechat)                                  10   独立模块 gateway_wechat.py
feedback                                           7   独立模块 feedback_service.py
knowledge-bases                                    6   ← 见下
memory                                             4
hepai / logs                                       4
chat / migrations / owop / 根路径                   4
```

### 三处需要注意

**gfs 是新工作，不是保留。** `backend/gfs_api.py` 定义了 9 条路由，但**当前 gateway 从未挂载它**——live app 的 OpenAPI 中 gfs 为 0 条。实际在用 GFS 的是 `apps/webui`，走 API key 直连外部服务。V2 接入需要从零验证鉴权传递与 personal mode 判定。

**知识库暂不暴露端点，但实现完整保留。** 6 条 `/v1/config/knowledge-bases/*` 不进 V2 v1。`backend/runtime/` 下的检索实现（分块、sqlite-vec 向量检索、embedding provider 接口）不受影响，随时可以重新接出端点。

**`/v1/logs` 2 条已抽到 `routes/logs.py`。** 归在不保留清单，但保留它零成本；如需日志面板可随时移回。

---

## 5. 复用策略：从 import 复用，不从重构复用

真正的实现不在网关里：

```
backend/runtime/            48,917 行   RuntimeEngine、OAEP、artifacts、agent_kernel、web_search
modules/                    32,975 行   DrSaiAssistant、工具、skills
────────────────────────────────────
                           ~82,000 行   V2 直接 import，零迁移成本
backend/gateway_legacy.py   13,083 行   HTTP 适配层
```

网关内部，与 V2 相关的 112 个 handler 共 2,958 行，分布极不均匀：

- **7 个厚 handler（≥60 行）合计 1,266 行** —— 有真实逻辑，需通读后按 V2 契约重写
- **89 个薄 handler（<30 行）合计 1,055 行** —— 平均 12 行，参数校验加转调，需要时照抄

最厚的是 `POST /v1/runs/{run_id}/execute`，690 行。它是唯一的核心资产，但**即使把网关拆得再干净也不能原样复用**：它在 HTTP 响应上做流式输出，与 V2 的 `202 + 会话事件流` 契约冲突；开头 40 行是内嵌在生产路径中的 E2E 夹具分支；587 行挤在单个 `try` 块内。V2 要提炼的是其中的回合执行逻辑——如何驱动 kernel、如何发射 OAEP 事件、如何处理取消——而不是它的 HTTP 外壳。这项工作与网关是否重构无关。

---

## 6. 若冻结假设失效

冻结成立的前提是 **V2 上线前不大规模迭代现网桌面端功能**。若该前提改变：

- **单组功能需要持续演进**（例如 `sessions`/`runs`）→ 只抽出那一组，其余维持冻结。局部抽取需同步迁移该组涉及的测试介入点，参见 `git show c7899562` 的安全网用法。
- **V2 停滞、网关重新成为长期主力** → 重新评估全量拆分。届时本文件 §1 的实测数据（214 处介入点、7 个厚 handler、fan-in 分布）仍然有效，可直接复用。
