# OpenDrSai DeepSeek Harness Inspired 方案拆分索引

> 状态：已拆分，不再作为实施方案
> 拆分日期：2026-08-15
> 原因：原文同时包含 OpenDrSai 内核演进与 DSH Runtime 集成，变更边界、权威模型、发布节奏和回退方式不同，不适合继续共用一个实施计划。

## 1. 两份独立方案

| 方案 | 目标 | 允许修改 | 明确禁止 | 实施依赖 |
| --- | --- | --- | --- | --- |
| [DSH 启发的 OpenDrSai 内核演进方案 P1](./opendrsai-dsh-inspired-kernel-evolution-p1-plan.md) | 将 Session 事实投影、Prepared Model Call、Provider Codec、确定性 Tool 调度和 Lifecycle 所有权落实到 OpenDrSai 原生 Kernel | OpenDrSai Agent Core、Runtime/Kernel 协作边界和必要迁移代码 | 安装或依赖 DSH；为 DSH 增加专用产品协议 | 不依赖 DSH Runtime P1 |
| [DSH 作为 OAEP Agent Runtime 的集成方案 P1](./opendrsai-dsh-agent-runtime-integration-p1-plan.md) | 用独立 Bridge 把 DSH 包装为 Runtime Control + OAEP Agent Runtime，并支持持续版本升级 | 独立 Bridge、Native Driver、协议 SDK、Runtime/Relay 外围接口和 capability-driven 接线 | 修改 OpenDrSai Kernel/Runtime Engine；调用 Web 私有 API；把 DSH 私有事件暴露给客户端 | 不依赖内核演进 P1 |

## 2. 冻结的拆分原则

1. 两份 P1 分开立项、分开分支、分开验收、分开发版；
2. 内核 P1 的测试环境中不要求安装 DSH；
3. Runtime 集成 P1 的构建不能导入 OpenDrSai Agent Kernel 私有实现；
4. 两者只共享 OAEP、Runtime Control、OWOP、Relay、Workspace、Approval 等稳定公共协议；
5. 不设置“内核 P1 完成后才能实施 DSH Runtime P1”或反向依赖；
6. 同一变更若同时修改 Kernel 与 DSH Bridge，默认视为越界，必须拆成两个独立变更并分别说明公共接口原因；
7. 原混合方案中的 P0～P7 编号停止使用，以两份新文档各自的 P1.x 阶段为准。

## 3. 关键架构决定

### 3.1 内核演进

OpenDrSai 原生 Run 继续由 OpenDrSai Runtime Engine 持有权威，原生 Kernel 从 canonical Runtime facts 构造模型上下文。DSH 只提供设计启发，不进入该执行链。

### 3.2 DSH Runtime 集成

DSH P1 采用 standalone authority：

```text
OpenDrSai Client / Runtime Relay
  → Runtime Control v1 + OAEP Stable 1.0
  → DSH OAEP Runtime Bridge
  → versioned Native Driver
  → dsh-sdk-jsonrpc-server
  → DeepSeek Harness
```

Bridge 是其 Session、Run、Item 和 OAEP Event 的唯一权威。OpenDrSai 不为同一 Session 建第二套 Journal。未来如果需要把 DSH 作为 OpenDrSai `AgentBackendRouter` 内的 Backend，应另立 P2，不与 standalone P1 混合。

### 3.3 持续升级

DSH 升级通过 `NativeDriver + ProtocolProfile + schema digest + event disposition + mapping version` 隔离。未知版本默认不可用于 production；旧 Session 冻结 native profile 和 mapping，升级不得重写旧 OAEP 历史。

## 4. 共享架构基线

- [OpenDrSai 总体架构 V1](../OpenDrSai总体架构V1.md)
- [Desktop/TUI Runtime 统一方案](../desktop-tui-runtime-unification-plan.md)
- [OAEP Stable 1.0](../../cores/protocol/oaep/README.md)
- [Runtime Protocol Suite](../../cores/protocol/runtime/runtime-protocol-suite.json)
- [Codex Agent Backend 实现计划 V1](../remote_workespace/OpenDrSaiCodexAgentBackend实现计划V1.md)
- [Codex Adapter OAEP 重构 V2](../remote_workespace/OpenDrSaiCodexAdapter_OAEP重构开发方案V2.md)
- [BAMS 资源配置架构](./opendrsai-bams-resource-configuration-architecture.md)

后续讨论和实施应直接更新对应的新方案；本索引只维护拆分关系和跨方案架构决定。
