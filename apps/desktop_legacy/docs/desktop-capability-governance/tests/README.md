# Desktop Test Definitions

本目录存放 Desktop Agent 的**测试定义（Test Definition）**。

- 测试定义只描述"什么行为算正确"。
- **不**记录某个版本、某次实际执行的通过/失败结果——那属于 [`../verification/`](../verification/)。
- Feature 实现状态**只**在 [`../01_Desktop_Agent_Capability_Catalog.md`](../01_Desktop_Agent_Capability_Catalog.md) 维护，不要在这里出现 `🟩 / 🟨 / 🟥 / ⬜ / ➖`。

---

## 组织方式

- 按**能力模块**组织，一个模块一个 Markdown 文件（例如 `session.md`、`streaming.md`、`knowledge.md`……）。
- **不要**为每个 Feature 单独建文件。
- **只在真正需要测试时**才逐步添加文件；不要预先为所有模块创建空壳文档。
- 一个 Feature 可以对应多个 Test Case；同一个 Test Case 只能引用一个 Feature ID（若跨多个 Feature，考虑拆分或写 Feature Specification）。

---

## Test ID 规范

```text
T-<MODULE>-<FEATURE>-<SEQ>
```

- `<MODULE>`：能力模块缩写（例如 `SES` 表示 Session、`STR` 表示 Streaming）。
- `<FEATURE>`：Feature 序号，与 `01_Desktop_Agent_Capability_Catalog.md` 中的 Feature ID 对齐。
- `<SEQ>`：同一 Feature 下的测试序号，从 `01` 开始。

例：`T-SES-003-02`。

---

## Test Case 最小格式

```markdown
### T-<MODULE>-<FEATURE>-<SEQ> 测试名称

Feature: `<Feature ID>`

**Scenario**
测试场景。

**Preconditions**
- 必要前提

**Action**
- 用户或系统执行的关键动作

**Expected**
- 可明确判断 Pass / Fail 的预期行为
```

---

## Test Oracle

`Expected` 是**测试判定准则**，必须回答：

> 什么结果才算正确？

书写要求：

- **优先用 Given / When / Then 层面的行为语义**，而不是 UI 操作细节。
- 不要大量记录鼠标移动、点击坐标、像素颜色等**脆弱的 UI 操作**——它们会随界面调整频繁失效，且不表达真实语义。
- 简单 Feature 的功能语义可以直接由 Test Case 的 `Expected` 定义，无需另写 Feature Specification。
- 对于复杂功能，先在 [`../features/`](../features/) 写 Feature Specification，再从中派生具体 Test Case。

---

## 与其他文档的关系

- Feature 是否实现 → [`../01_Desktop_Agent_Capability_Catalog.md`](../01_Desktop_Agent_Capability_Catalog.md)
- 复杂功能整体规范 → [`../features/`](../features/)
- 某版本上的实际执行结果 → [`../verification/Verification_Registry.md`](../verification/Verification_Registry.md)
