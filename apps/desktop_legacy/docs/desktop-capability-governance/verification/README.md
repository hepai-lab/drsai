# Desktop Verification

本目录记录**具体版本上某条测试的实际执行结果**——也就是"执行历史"。

- **不是**测试定义。测试定义在 [`../tests/`](../tests/)。
- **不是**Feature 实现状态。Feature 实现状态在 [`../01_Desktop_Agent_Capability_Catalog.md`](../01_Desktop_Agent_Capability_Catalog.md)。

Test Definition 与 Verification Record **必须分离**。

---

## 定义 vs 记录

测试定义（在 `../tests/`）：

```text
T-SES-003-02
Streaming 中切换 Session 应保持状态隔离
```

验证记录（在本目录 `Verification_Registry.md`）：

```text
T-SES-003-02
v1.x.x
commit abc123
Windows 11
PASS
2026-xx-xx
```

两者不得混在一起：

- 定义**不**写"某版本上 PASS/FAIL"；
- 记录**不**重写测试步骤或预期结果——只引用 `Test ID`。

---

## Result 取值

统一使用：

```text
PASS
FAIL
BLOCKED
SKIPPED
```

- `PASS`：按 Test Case 的 `Expected` 判定通过。
- `FAIL`：按 `Expected` 判定不通过。
- `BLOCKED`：由于环境、依赖或前置条件问题无法执行。
- `SKIPPED`：本次验证有意跳过（例如平台不适用、临时禁用）。

---

## 历史保留

如某个旧版本的验证结果已经失去参考意义，**不删除**历史记录。

- 追加新记录，不覆盖旧记录；
- 通过 `Version` / `Date` 区分不同批次；
- 需要淘汰某条 Test 时，在 [`../tests/`](../tests/) 修改或移除测试定义，历史 Verification Record 依然保留。

---

## 文件

- [`Verification_Registry.md`](./Verification_Registry.md) —— 所有版本验证记录的登记表。
