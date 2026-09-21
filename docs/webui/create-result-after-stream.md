# CreateResult 之后发生了什么

主聊天路径：`DrSaiAssistant.on_messages_stream`  
文件：`cores/python/packages/drsai/src/drsai/modules/agents/skills_agent/drsai_assistant.py`

不要拿基类 `DrSaiAgent` 对这段。子类整段重写了 `on_messages_stream`。基类仍是底座（HepAIWorkerAgent 等），OpenDrSai 主助手本体是 `DrSaiAssistant`。

相关总览：[`chat-user-message-ws-agent-flow.md`](./chat-user-message-ws-agent-flow.md)

---

## CreateResult 是什么

流结束时 Model Client 拼出的终态（`content` + `thought` + usage）。**不发给前端**。token 早已以 `ModelClientStreamingChunkEvent` 出去。

真正打模型：`_call_llm`（约 1821 行），不是后面的 ThoughtEvent。

---

## 谁接住

入口约 1703。接到处约 **1836**：

- `CreateResult` → 赋给 `model_result`，不往外 yield
- 其它（chunk 等）→ 立刻 `yield`

---

## 1836–1942 旁路（成功时整段跳过）

| 情况 | 行为 |
|---|---|
| `content` 是空白 `str` | 当失败重试（默认 1 次调用 + 3 次重试），不写 context；用尽 → 1930 报错 `return` |
| API 可重试异常 | 同一套循环 |
| `content` 是工具 `list` | 不走空正文分支 |

空重试不管已流出的 chunk；只看 `content`、不看 `thought`。属边角，不是主路径。

---

## 成功路径（1945 起）

1. 有 `thought` → `ThoughtEvent`（前端 reasoning **快照**，不是再追加 token）
2. `AssistantMessage(content, thought)` 写入 context，给下一轮 API replay
3. 按 `content` 类型分叉：

| `content` | 行为 |
|---|---|
| 非空 `str` | `_clear_elevated_tools` → `handle_str_reponse` → `yield Response` → **`break` 本轮结束** |
| `list[FunctionCall]` | assert 形状 → `_process_model_result` 跑工具 |

`source`：UI / ThoughtEvent 用展示名 `agent_name`；context 用 `self._name`（factory 里常是 `"Assistant"`）。

`first_time_setup`（约 1971）：新工作区还没有 `AGENTS.md` 时，纯文本终稿前多一条引导气泡。有该文件则跳过。与传输主路径无关。

---

## 要不要下一跳 assistant

外层 `while turn_count < max_turn_count`（约 1807）：

```
纯文本  → yield Response → break     → 没有下一跳 LLM
工具    → _process_model_result
       → turn_count += 1
       → 到顶：道歉 return
       → 未到顶：回到 while，再 _call_llm
```

「下一跳 assistant」= **同一次 `on_messages_stream` 里的下一跳 ReAct**，不是用户又发了一句话。用户下一句要等整个函数结束，GroupChat 才轮到 `user_proxy`。

`_process_model_result` 里的 `reflect_on_tool_use` 在子类中未使用。工具路径把 `Response` 拆成 `chat_message` 再 yield，不当 AutoGen 终态。

---

## 工具结果从哪来

**不是** `_sanitize_api_messages()`。

| 来源 | 作用 |
|---|---|
| `_process_model_result` 末尾约 3185：`add_message(FunctionExecutionResultMessage)` | 真结果 |
| `finally` 约 2070：末尾悬空 tool call 时补 `"xxx was cancelled."` | 假结果，不重跑工具 |
| `_sanitize_api_messages()`（约 1811，签名 `-> None`） | 每次 LLM **前**原地修历史：删孤儿 result、补缺失 stub、去掉空 assistant、拆开连续 user-role。不跑工具 |

下一跳 `_call_llm` 通过 `get_messages()` 从同一份 context 读到上一跳 result。

`finally` 只看 **context 末尾**是不是 `AssistantMessage([FunctionCall…])`。正常文本 / 已有 result 不进。中间孤儿靠 sanitize。

---

## 接下来

`_process_model_result`（约 2492）yield 什么 → `StreamProjector` 如何 `interrupt()` 当前气泡、开新 `message_id`。
