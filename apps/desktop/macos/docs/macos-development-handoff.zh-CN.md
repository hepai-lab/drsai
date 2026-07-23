# macOS 桌面端开发交接与恢复说明

更新时间：2026-07-22  
当前分支：`feature/desktop`  
当前 Git HEAD：`9438b52a release: bump desktop refactor to v1.5.1`  
交接状态：**R112 已完成本机自动化验证；R113 正在开发且尚未验证；尚无 Apple 真机验收证据。**

## 1. 恢复时先看什么

1. 完整开发与验收计划：`apps/desktop/macos/docs/macos-full-function-development-plan.zh-CN.md`。
2. 本文件：用于区分最后一次全绿基线、当前半成品和 macOS 恢复步骤。
3. 功能目录：`apps/desktop/shared/test-kit/macosFeatureCatalog.mjs`，固定为 12 个模块、72 个功能点。
4. 自动化套件目录：`apps/desktop/shared/test-kit/macosVerificationSuites.mjs`，最后全绿基线为 62/62。
5. 真机证据与验收：`acceptanceEvidence.mjs`、`platformFeatureEvidence.mjs`、`record-macos-platform-evidence.mjs`、`record-macos-l5-evidence.mjs`、`record-macos-l6-evidence.mjs`。

## 2. 最后一次可信的全绿基线：R112

R112 已完成 F06.1 与 F06.3 的 packaged 旅程，并修复 packaged Agent runner 的认证前置缺口。Windows 环境中执行的 macOS 源码自动化结果为：

- 自动化套件：62/62 通过。
- IPC inventory：270/270/270 一致。
- 共享业务行覆盖率：93.71%。
- 核心状态机分支覆盖率：92.17%。
- adapter 行覆盖率：59.37%。
- P0/P1 缺陷：0。
- L5 精确 journey 覆盖：25 个唯一功能点。
- packaged product checks：16 项。
- Apple 验收：0 accepted / 72 partial；原因是尚未在 Apple Silicon 上形成 L4～L6 真机回执。
- R112 代码测试完成时 source snapshot：files=688，SHA-256 `4d295c3539cc5330d969c15413e3f7706f1d1492be033814067bd6e95e857c07`，`clean=false`。后续文档刷新曾生成摘要 `f2f95e54299bc3f60d2e8e007655b656cfedf2c823cdd1c282a190db8a5ed02a`；恢复时应重新生成快照，不应把任一旧摘要当作当前工作树摘要。

R112 之后、R113 之前的代码可以作为“最近已验证实现基线”。但当前工作树已经包含 R113 修改，不能直接用当前目录宣称复现 R112。

## 3. 当前进行中的 R113：F06.2，不得标记为完成

目标是用真实 packaged App/Gateway 验证不完整 SSE 后的断线重连、resume cursor、服务端 replay 与客户端去重。当前已经写入但**尚未执行 typecheck、Python 编译、release contract 或全量 verify**的修改如下：

- `cores/python/packages/drsai/src/drsai/backend/gateway.py`
  - 增加严格门控的 packaged recovery fixture。
  - 仅在 recovery fixture、dev auth bypass、offline header auth、固定 E2E user/request/metadata 全部匹配时生效。
  - 第一次 `(attempt=0,cursor=0)` 发送 `alpha` 后故意不发送 `[DONE]`；第二次 `(attempt=1,cursor=5)` replay `alpha`、发送 ` beta` 后结束；其他 cursor 返回 409。
- `apps/desktop/macos/src/main/packagedSmoke.ts`
  - 增加 Chat recovery 场景，要求出现 `connection.retrying` 与 `connection.restored`。
  - 最终内容必须严格为 `alpha beta`，`alpha` 只能出现一次，事件序号单调且唯一，journal 恢复后结果一致。
- `apps/desktop/macos/scripts/verify-packaged-l5.mjs`
  - 注入 `OPENDRSAI_PACKAGED_CHAT_RECOVERY_FIXTURE=1`。
  - 暂时把 product checks 从 16 提升为 17，并预加入 F06.2 与 journey `chat-incomplete-sse-resume-cursor-replay-dedup`。
- `apps/desktop/shared/test-kit/record-macos-l5-evidence.mjs`
  - 暂时把最低 product check 数从 16 提升为 17。

尚未完成：

- `verify-macos-release-contract.mjs` 还没有锁定 Gateway fixture 的全部安全门、metadata、journey 与 product result token。
- 尚未执行 Python compile/typecheck/全量 verify。
- 尚未证明现有 Chat reconnect 实现实际发送预期的 attempt/cursor。
- 尚未把 R113 作为已完成轮次写入主计划。
- 尚未在 Apple Silicon 上执行 packaged L5。

因此恢复开发时，若 R113 任一步失败，应继续修复，不得把 F06.2、17 checks 或 26 个 L5 功能点写成已完成事实。

## 4. 工作树迁移警告

当前大量桌面端文件处于 modified 或 untracked 状态，且许多 macOS/shared 实现尚未进入当前 Git HEAD。**仅在 Mac 上 clone/switch `feature/desktop` 会丢失这些本地进度。** `git diff` 生成的普通 patch 也不会包含 untracked 文件。

迁移前必须采用能够携带 tracked 与 untracked 源文件的方式，例如：

1. 审核改动范围后，在 `feature/desktop` 上创建专门的 WIP/交接提交并推送；或
2. 完整复制当前仓库工作目录（包括未跟踪源码），但排除可重建的 `node_modules`、`out`、`dist` 和临时证据目录。

不要使用 `git clean`、`git reset --hard` 或只复制 Git 提交记录。`apps/desktop/macos/resources/runtime/*.tar.gz` 与 `runtime-manifest.json` 属于生成物并被局部 `.gitignore` 忽略；迁移后应在 Mac 上重新构建。`apps/desktop/macos/build/` 只保留受版本控制的 entitlements 配置，其他构建输出也应重新生成。

## 5. 在 macOS 上的恢复顺序

前提：Apple Silicon Mac、Xcode Command Line Tools、项目所需 Node/npm 与 Python 3。先确认当前目录确实包含本交接文件和 R113 四处修改。

```bash
git branch --show-current
git status --short
cd apps/desktop/macos
npm install
bash scripts/setup-dev.sh
```

先完成 R113 静态门禁，再做全量自动化：

```bash
python3 -m py_compile ../../../cores/python/packages/drsai/src/drsai/backend/gateway.py
npm run typecheck
npm run verify:release-contract
npm run verify
```

如果全量验证通过，重新生成的 source snapshot、覆盖率、suite、IPC 与缺陷结果必须写入主计划新的 R113 行；旧摘要不能复用。

## 6. Apple Silicon 自动化验收顺序

先构建可分发运行时和 arm64 App，再执行平台与 packaged 旅程：

```bash
cd apps/desktop/macos
npm run prepare:runtime:macos
npm run verify:runtime-reproducibility
npm run build:mac:arm64
npm run record:l4-evidence
npm run verify:packaged:l5
npm run record:l5-evidence
npm run verify:platform-evidence
npm run verify:acceptance
```

注意：L5 最终验收包含 100 次重启与 2 小时 soak 的最低要求。调试期间可以用脚本支持的较小参数快速定位问题，但这种回执不能替代最终证据。L6 还涉及 TCC 真实权限、签名/公证/更新实验室等独立前置条件，应在 L4/L5 稳定后按主计划执行：

```bash
npm run verify:tcc:l6
npm run verify:online-update:l6
npm run verify:release:l6-auto
npm run record:l6-evidence
npm run verify:acceptance
```

## 7. R113 的完成判定

只有同时满足以下条件，才能把 R113/F06.2 标为完成：

- Gateway fixture 只有在全部测试门控同时满足时才可触发，普通生产请求路径不受影响。
- Python 编译、TypeScript typecheck、release contract 与 `npm run verify` 全部通过。
- packaged L5 真实观察到 retrying/restored，最终内容严格为 `alpha beta`，没有 replay 重复，seq 单调唯一，journal 恢复一致。
- `packaged-product-journeys` 回执为 17 checks，精确包含 F06.2 与新 journey，且聚合器能够拒绝旧 16-check 回执。
- 证据文件绑定当前 source snapshot 与 packaged artifact hash。
- 主计划新增 R113 记录，明确 Windows 静态验证与 Apple 真机执行各自的结果，不混淆两类证据。

## 8. 下一步开发优先级

1. 完成 R113 release contract 与自动化修复。
2. 在 Apple Silicon 上跑通 R112 已定义但尚未实际执行的 packaged journeys，并形成真实 L4/L5 回执。
3. 完成 R113 F06.2 真机 L5。
4. 按主计划逐功能补齐其余缺失的 L4～L6 journey；只有功能自身被相应层级 `featureIds` 精确覆盖时才能从 partial 升级为 accepted。

