# OpenDrSai Codex Adapter OAEP V4：会话语义一致性与结构化渲染开发方案

状态：实施中  
目标：让同一个 Codex Thread 在 Codex Desktop 与 OpenDrSai 中具有一致的轮次顺序、用户文本、最终回答和结构化活动归属，同时所有跨 Backend 展示继续只依赖 OAEP。

## 1. 已确认问题

1. OAEP `Item.sequence` 的作用域是 Run，Desktop 当前却跨 Run 全局排序，导致各 Turn 的第 1、2、3 个 Item 分别聚集。
2. Codex `userMessage.content` 是 text/image/localImage/audio/localAudio 的结构化数组，当前 Adapter 会把数组字符串化。
3. Desktop 将 OAEP Item 逐条拍平成 ChatMessage，没有按 `Session -> Run -> Item` 重建一轮对话。
4. 历史 fixture 使用简化的 `userMessage.text`，没有覆盖真实 app-server 结构。
5. 已导入历史是派生投影；Adapter 映射升级后需要显式、幂等地重新投影。

## 2. 协议原则

- 保留 OAEP 的 `Session -> Run -> Item` 领域模型以及 append-only Event。
- Event `sequence` 是 Session 范围的回放游标。
- Run `sequence` 是 Session 范围的稳定轮次顺序。
- Item `sequence` 只在所属 Run 内排序。
- 历史 `thread/read(includeTurns=true)` 与实时 `item/*` 事件归约必须生成语义等价的 OAEP Snapshot。
- Desktop、Android、Relay 不理解 Codex 私有协议，只消费 OAEP。

## 3. OAEP 1.1 扩展

1. Run 增加可选 `sequence` 和 `source`，记录 backend run id/index、backend/adapter/mapping version。
2. Message 增加可选 `parts`，权威保存 text/image/audio/file/resource_ref；`text` 保留为简单客户端兼容投影。
3. 本地媒体路径必须转换为 OWOP Resource Reference，不直接暴露宿主机绝对路径。
4. 明确 Snapshot 中 Run 按 `(sequence, created_at, id)`、Item 按 `(run_id, sequence, id)` 排序。
5. 未知 Backend 类型降级为可观测 Notice，不允许静默丢失或把原始私有对象直接显示给用户。

## 4. 模块与功能点

### M1 Codex 协议基线（5）

1. 使用当前 Codex 二进制生成版本匹配的 JSON Schema/TypeScript。
2. 保存 Codex 版本和 Schema digest。
3. 建立完整 ThreadItem/notification/server request 覆盖矩阵。
4. 从真实会话生成脱敏 golden fixtures。
5. CI 输出 Codex 版本升级的协议差异与未知类型。

### M2 OAEP 1.1（6）

1. Run sequence。
2. Run source identity。
3. Message parts。
4. OWOP 多媒体资源引用。
5. adapter/mapping version。
6. 历史与实时等价不变量。

### M3 Codex Adapter（8）

1. UserInput 数组规范化。
2. Agent message phase 规范化。
3. Reasoning summary/content 分段。
4. Plan text/steps 合并。
5. Command 完整字段映射。
6. File/MCP/Web/Image/Collab/Sleep 映射。
7. status/error/approval 映射。
8. unknown 类型降级与覆盖率统计。

### M4 历史同步与迁移（5）

1. 从 `thread.turns[]` 生成稳定 Run sequence。
2. 保存 backend turn/item identity。
3. 检测 mapping version。
4. 只重建 Codex 派生投影，不影响 Session 绑定和非 Codex 内容。
5. 迁移可中断回滚、可重复执行且结果幂等。

### M5 OAEP UI Projector（6）

1. 按 run_id 分组。
2. 按 Run.sequence 排轮次。
3. 按 Item.sequence 排轮内内容。
4. OAEP Item 转 Structured Part/Activity。
5. 同一 Run 的多个 agentMessage 合并为一个 Assistant Turn。
6. Snapshot 与实时 Event 共享 reducer。

### M6 Desktop 渲染（5）

1. 用户多模态气泡。
2. Assistant 最终 Markdown。
3. reasoning/plan 折叠区。
4. command/tool/file/subtask 活动区。
5. artifact/interaction/notice 专用卡片。

### M7 性能与恢复（3）

1. Run 级历史分页和虚拟化。
2. 重型工具输出、diff 和媒体延迟展开。
3. 基于 Session Event cursor 重连，不重复、不乱序。

### M8 自动测试验收（4）

1. Adapter contract suite。
2. OAEP conformance 和 snapshot/replay parity suite。
3. Desktop projector/render golden suite。
4. Windows 宿主 Codex 真实 Thread 端到端验收。

总计：8 个模块、42 个功能点。

## 5. 实施顺序

### P0 正确性

- 修复跨 Run 排序。
- 增加 Run sequence。
- 修复 `userMessage.content[]`。
- 按 Run 聚合 UI。
- 使用真实 app-server fixture。

### P1 语义完整性

- 发布 OAEP 1.1 向后兼容扩展。
- 完成 Reasoning、Command、File、MCP、Subtask 等字段级映射。
- OAEP 直接投影 StructuredTurnState。
- 执行旧 Codex 历史重新投影。

### P2 产品化

- 历史分页、虚拟化和重型内容延迟加载。
- 协议覆盖率、诊断和恢复。
- Windows 宿主 Codex 全自动端到端验收。

## 6. 完成门槛

1. 同一真实 Codex Thread 在两端的用户消息和最终回答逐轮一致。
2. Run 顺序和 Run 内 Item 顺序一致。
3. reasoning、command、tool、file change、subtask 均归属于正确 Run。
4. OpenDrSai UI 不显示 Python/JSON 原始对象字符串。
5. 历史和实时 OAEP 投影 digest 等价。
6. 重复同步和重连不产生重复 Item。
7. 旧错误投影可以安全迁移。
8. Windows Desktop 类型检查、Python 测试、OAEP contract、真实 Thread E2E 全部通过。

