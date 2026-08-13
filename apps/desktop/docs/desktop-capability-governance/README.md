# Desktop Agent Capability Governance

本目录用于长期维护 Desktop Agent 的**能力目录**、**测试定义**与**版本验证记录**。
目标是让 Desktop 开发人员以最低成本持续维护，而不是一次性生成大量文档。

---

## 体系结构

```text
Capability Catalog
        ↓
Test Definition
        ↓
Verification Record
```

复杂功能例外：

```text
Capability Catalog
        ↓
Feature Specification
        ↓
Test Definition
        ↓
Verification Record
```

---

## 四类文档的职责边界

### 1. `01_Desktop_Agent_Capability_Catalog.md`

回答：

> Desktop 应该有什么？当前项目有没有？

它是 Feature ID 与**粗粒度实现状态**的唯一事实源。

状态标记（仅在本文件维护）：

- `⬜ 未确认`
- `🟩 已实现`
- `🟨 部分实现`
- `🟥 未实现`
- `➖ 不适用`

**禁止**在其他任何文档中重复维护：

- Feature 实现状态；
- `🟩 / 🟨 / 🟥 / ⬜ / ➖` 状态标记。

---

### 2. `tests/`

回答：

> 一个功能怎样才算正确？

测试文档同时承担**简单功能的可执行语义定义**——简单 Feature 的行为语义可以直接由 Test Case 的 `Expected` 表达，无需另写 Feature Specification。

原则：

- 一个 Feature 可以对应多个 Test Case；
- Test Case 必须引用 `Feature ID`；
- **不要为每个 Feature 单独创建文件**；
- 按能力模块组织测试文档；
- **只有真正需要测试时才逐步增加文件**。

Test Definition 与某一次实际的测试执行结果必须**分离**。测试定义只描述"应该验证什么"，不记录"某次跑出了什么"。

---

### 3. `features/`

只用于**复杂功能规范**。

默认：

> 不创建 Feature Specification。

仅当出现以下情况才创建：

- 有复杂状态机；
- 多条测试不足以表达整体行为；
- Desktop / Runtime 职责边界容易产生争议；
- 存在重要产品设计决策；
- 功能跨多个模块；
- 异常路径明显复杂。

Feature Specification **不维护** Feature 实现状态，也**不记录**版本测试结果。

---

### 4. `verification/`

回答：

> 某个版本上，某条测试实际执行的结果是什么？

Verification Record 与 Test Definition 严格分离。每条记录至少能够关联：

```text
Test ID
Version
Commit
Environment
Result
Date
Evidence / Notes
```

---

## 关键约束

- 不要在多个文件重复维护 Feature 状态。
- 不要把 Runtime 内部 Agent 逻辑纳入 Desktop Feature。
- 不要把 "Implemented" 与 "Tested / Passed" 混为一谈：
  - "Implemented" 由 `01_Desktop_Agent_Capability_Catalog.md` 表达；
  - "Tested / Passed" 由 `verification/` 表达。
- 保持体系尽可能轻量：Feature Specification 是**例外机制**，不是默认要求。
