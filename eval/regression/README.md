# OpenDrSai Agent Regression

该目录保存 OpenDrSai 智能体产品能力的可执行回归测试。Case YAML 是测试定义；真实输入、输出和 OAEP/Tool/Artifact/Manifest 过程由正式 Runtime 产生；Runner 将脱敏证据与断言结果写到 `tmp/eval-results/regression/`。

## 快速使用

```powershell
.\.venv\Scripts\python.exe eval\regression\run_regression.py validate
.\.venv\Scripts\python.exe eval\regression\run_regression.py list --suite smoke
```

在 OpenDrSai Desktop 中打开右侧“终端”，切到仓库根目录后运行同一组命令即可；Desktop 不需要专用 Runner。建议先执行 `validate`，再运行受控框架冒烟：

```powershell
.\.venv\Scripts\python.exe eval\regression\run_regression.py run --case qa.greeting.hello --adapter fixture --fixture-dir eval\regression\assets\evidence
```

`fixture` 只验证 Runner、断言和报告链路，结果会标记 `adapter=fixture`，P1 发布门禁会拒绝它。

连接正在运行的 OpenDrSai Gateway：

```powershell
$env:OPENDRSAI_REGRESSION_GATEWAY_URL = "http://127.0.0.1:8000"
$env:OPENDRSAI_REGRESSION_GATEWAY_TOKEN = "<local-instance-token>"
# 仅远程 OIDC 场景按需设置：
# $env:OPENDRSAI_REGRESSION_ACCESS_TOKEN = "<oidc-access-token>"
.\.venv\Scripts\python.exe eval\regression\run_regression.py run --suite smoke
```

Runner 会为每次 attempt 创建临时隔离 Workspace，并通过正式 `/v1/workspaces` 注册；`OPENDRSAI_REGRESSION_WORKSPACE_ID` 只作为无法动态注册时的兼容回退。附件被复制为隔离 Workspace 内的相对引用，不会把宿主机绝对路径发送给 Agent。

令牌只通过环境或系统凭据提供，不写入 Case 或结果。`run` 使用正式 `/v1/sessions`、`/v1/runs`、OAEP Snapshot、Run Inspection 和 Reproduction Manifest API，不直接创建 `DrSaiAssistant`。

## 当前状态

- Schema、Case/Suite Loader 和静态校验可用；
- 隔离 Environment、Gateway/Fixture Adapter 和结构化证据采集可用；
- 通用确定性断言、受控语义判定接口、JSONL、JUnit、Markdown 报告和 P1 Gate 可用；
- 自然语言要求没有对应 `semantic_judgments` 时返回 `inconclusive`，不会自动通过；
- `tool.failure.recovery` 所需的 Runtime Tool Attempt 与故障注入契约仍需产品 Runtime 实现，Runner 不会伪造通过结果。

恢复同一 execution 时增加 `--execution-id <id> --resume`。只有 Case revision、YAML 摘要和完整证据都匹配的终态才会跳过；改变用例后会自动重跑。发布结果执行：

```powershell
.\.venv\Scripts\python.exe eval\regression\run_regression.py gate --results tmp\eval-results\regression\<execution-id>\results.jsonl
```

## 数据职责

- `cases/`：版本化输入与预期；
- `assets/`：小型固定输入资产；
- `schemas/`：Case、Suite 和 Result 契约；
- `suites/`：执行集合；
- `policies/`：发布门禁；
- `tmp/eval-results/regression/`：不提交 Git 的运行结果和证据。

设计与完成标准见 `docs/development/opendrsai-agent-regression-testing-p1-completion-plan.md`。
