# Desktop Feature Specifications

本目录存放**复杂功能规范（Feature Specification）**。

> Feature Specification 是**例外机制，不是默认要求。**

绝大多数 Feature 的语义可以直接由 [`../tests/`](../tests/) 中 Test Case 的 `Expected` 表达；**不要**为每个 Feature 都创建一份 Specification。

---

## 何时才需要 Feature Specification

只有在出现以下**任意一种**情况时才创建：

- 存在复杂状态机；
- 多条测试用例不足以表达整体行为；
- Desktop / Runtime 职责边界容易产生争议；
- 存在重要产品设计决策，需要记录 Why；
- 功能跨多个模块；
- 异常路径明显复杂。

---

## 边界

Feature Specification **不**做以下事情：

- **不**维护 Feature 实现状态（在 [`../01_Desktop_Agent_Capability_Catalog.md`](../01_Desktop_Agent_Capability_Catalog.md)）；
- **不**记录版本测试结果（在 [`../verification/`](../verification/)）；
- **不**代替 Test Definition（在 [`../tests/`](../tests/)），只描述整体行为与约束，不逐条列出可判定的通过条件。

---

## 命名

按 Feature 或复杂子系统命名，例如：

```text
features/
├── streaming-session-switch.md
├── knowledge-grounded-answering.md
└── attachment-context-lifecycle.md
```

---

## 轻量模板

````markdown
# <Feature Name>

Related Features:
- `<Feature ID>`

## Expected Behavior

描述用户视角下该复杂功能整体应该如何工作。

## State

如果存在状态机，在这里描述。

例如：

```text
Idle
  ↓
Running
  ├── Completed
  ├── Failed
  └── Cancelled
```

## Boundary

### Desktop 负责

- ...

### Desktop 不负责

- ...

## Edge Cases / Decisions

- ...

## Known Gaps

- [ ] ...
````
