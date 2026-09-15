# 有据回答（grounded answering）迁移到共用路径

> 最近更新：2026-08-14
> 面向读者：将来要把该能力接到 TUI / Android 的维护者
> 当前实现：桌面局部（`f14967eb`），共用部分见下
> 相关文档：[共享后端改动交接](grounded-answering-shared-backend-handoff.md)

---

## 1. 为什么现在是桌面局部的

产出 `citations[]` 的天然位置是 `backend/runtime/agent.py`（那里目前硬编码 `"citations": []`），但该文件为多个 Backend 共用。当时的决定是不扩大影响面，改在桌面独有的 `desktop_kernel_events.py`。

代价：TUI 与 Android 拿不到 grounded 引用；要给它们时，这部分需要重做。

---

## 2. 不用迁的部分

以下已是共用的纯函数或桌面 UI，迁移时**一行都不用改**：

| 位置 | 内容 |
| --- | --- |
| `backend/runtime/grounded.py` | `detect_grounded_request` / `partition_grounded_tools` / `build_claim_support` |
| `backend/runtime/agent_kernel.py` | `GROUNDED_PROMPT`、`grounded_prompt_layer()`、`tool_decision_domain()`、`AgentRunConfig.grounded` |
| `backend/runtime/mobile_core/engine.py` | 逐句依据校验与重写循环（已在共用引擎内，按 `state.grounded` 开关） |
| `apps/desktop/shared/api/citations.ts` | 引用投影，属桌面 UI |

**提示层完全不用迁。** 它通过 `AgentRunConfig.grounded` 生效，`assemble_agent_context` 读的就是这个配置——其他端只要在自己发的 agent 配置里带上该标志，提示层自动生效。

**逐句校验也不用迁。** 它已经在共用运行循环里，其他端开启 grounded 后自动获得。

---

## 3. 要迁的三处

### 3.1 引用候选的构造

**现在**：`desktop_kernel_events.py` 的 `translate_kernel_event`，在 `tool.result` 且 `name == "knowledge_search"` 分支里把 evidence 行转成引用候选。

**迁移**：抽成纯函数，输入 `knowledge_search` 结果，输出引用负载列表。建议放 `backend/runtime/grounded.py`（已是共用、无外部依赖）。

```python
def build_citation_payloads(result: Mapping[str, Any]) -> list[dict[str, Any]]:
```

抽出后桌面改为调用它，行为不变；`agent.py` 也调它。

### 3.2 引用的选择与产出

**现在**：`DesktopKernelTurnState.message_metadata`。两条规则并存——URL 出现在正文里（web 场景），或正文带 `[E<n>]` 标记（grounded 场景）；grounded 且无标记时回落到 `searched_scope`（拒答仍要说明查过什么）。

**迁移**：同样抽成纯函数，在 `agent.py` 的 `ITEM_COMPLETED` 负载里填 `citations`，**仅在 grounded 开启时**填，其余 Backend 行为不变。

注意 `agent.py` 目前不累积一轮内的 `knowledge_search` 结果，需要新加。

### 3.3 各端入口的触发与收工具

**现在**：只有 `desktop_agent_kernel_adapter.py` 做了三件事——调 `detect_grounded_request`、过滤工具 `schemas`、写 `agent["grounded"]`。

**迁移**：TUI 与 Android 各自入口做同样三件事，每处约十行。

---

## 4. 必须一起做的事：收紧 OAEP schema

`cores/protocol/oaep/oaep.schema.json` 里 `citations` 目前是无约束的 `{"type":"array","items":{"type":"object"}}`。产出方从一个变成多个时必须固化契约，否则各端各自理解、各自走样。

**已经走样过一次**：TS 类型曾声明 `knowledge_base_revision`，而线上传的字段是 `revision`（`f14967eb` 已修）。没有 schema，这类错不会被任何东西发现。

**代价必须提前知道**（曾尝试并回退）：

1. `scripts/generate-oaep-types.py` 一次生成 Python / TypeScript / **Kotlin** 三份类型，改 schema 必然改 Android 生成文件
2. `cores/protocol/relay/runtime-relay.schema.json` 的哈希跟着变
3. **`apps/desktop/shared/main/runtimeProtocolSelection.ts:8` 钉着 `OAEP_SCHEMA_SHA256`，运行时用它做协议握手**（`oaepProtocol.schema_sha256 === OAEP_SCHEMA_SHA256`）。schema 一改，桌面与运行时版本不一致就会握手失败

这是**需要协调发布的协议变更**。迁移本来就要协调三端发布，顺带做掉成本最低。

**先修既有漂移**：当前 HEAD 上 `test_oaep_codegen` 就是失败的——已提交的生成文件与已提交的 schema 不一致。动 schema 前先跑一次 `python scripts/generate-oaep-types.py` 并手工同步 `runtimeProtocolSelection.ts` 里的摘要常量（生成器只检查、不修改该文件），否则新旧漂移会混在一起。

---

## 5. 迁移时的坑

**不要动 `AGENT_RUN_CONFIG_SCHEMA_VERSION`。** `grounded` 字段是故意不进 schema 版本的。版本一旦 +1，所有仍在发当前版本的端会直接抛 `agent_config_schema_unsupported`，全部起不来。

**`mobile_core` 下不能用跨包相对导入。** Android 通过 Chaquopy 以独立源码集加载这些文件。引入新依赖要走 `mobile_core/context.py` 既有的双路导入（`try: from drsai... / except ImportError: from ...`）。该约束由 `test_agent_kernel_production_parity` 守护。

**`citations_json` 这个 metadata 字段 TUI 已经在读**（`tui_gateway/adapter/event_translator.py:148`，字段见 `:189`）。且**桌面复用了同一个翻译器**（`gateway.py` 将其导入为 `translate_conversation_event`），改产出形状时只能加字段，不能改名或删字段。

**引用必须带可打开目标。** `projectCitationParts` 会丢弃没有 `path` / `document_path` / `url` 的引用（故意如此：指不到位置却显得有出处更糟）。产出端漏了这些字段，症状是**引用静默变成零条**，而验收要求至少 1 条。

**引用应带 `excerpt`。** 只有公开 URL 能被打开；知识库引用指向的是聊天侧解析不了的语料内文件，界面改为就地展开被引原文，没有 `excerpt` 的这类引用会渲染成不可点击的死条目。

**非 grounded 回合必须逐字不变。** 有测试锁着：`test_ungrounded_turn_keeps_url_only_citation_behaviour`（引用选择）、`test_agent_kernel_production_parity` 与 `test_p9_production_behavior_parity`（提示词 sha256）、`test_ungrounded_run_never_pays_for_the_per_sentence_check`（逐句校验不介入）。迁移后这些必须仍然通过。

---

## 6. 引用链路的完整路径（迁移前务必看懂）

这条链路我在实现时判断错过两次，都是因为**按目录名推断归属而没查调用关系**。实际路径：

```
desktop_kernel_events.py  →  TextMessage metadata 的 citations_json
  → gateway.py 的 translate_conversation_event（其实是 TUI 的 translate）
    → extract_citation_payloads → citation.added 事件
      → gateway.py:2849 收集 → agent.completed 的 citations
        → conversation.py:151 → 结构化引用部件
          → OAEP → 桌面 UI
```

两个反直觉之处：

- `desktop_kernel_events.py` 名字带 desktop，产出的却是 **Autogen 消息元数据**，TUI 也消费
- `tui_gateway/adapter/event_translator.py` 名字带 tui，**桌面也在用**

判断某段代码属于哪个端，要查 import 与调用方，不能看路径。

---

## 7. 迁移之外仍欠的一项

端到端已在桌面用真实模型跑通（结果见[交接文档第 9 节](grounded-answering-shared-backend-handoff.md)），因此这条设计不再是未经验证就往三个端复制。

仍欠的是**切块粒度**：固定语料整份被切成一个块，只有 `[E1]` 可用，模型为多个结论配引用时会编出 `[E2]` 及以后并被拦下。这是检索侧的问题，`index_local_files` 只按锚点（页 / 幻灯片 / 标题段）切，单标题文档因此不分块。迁移前修掉更省事——否则三个端会同时暴露同一个症状，而症状看起来像校验过严，实际原因在索引。
