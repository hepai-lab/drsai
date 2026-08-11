# Windows 可信构建链

可信构建链用于避免“开发环境运行的是新源码，但最终 ZIP、MSI 或 Sandbox 安装的是旧 Runtime”这一类问题。它不替代功能测试，而是证明被测试、安装和发布的是同一次构建产生的内容。

## 构建流程

正式 Windows Runtime 构建按以下顺序执行：

1. 在受控 `.tmp` 目录重新创建 Python venv，不复用上一轮 venv。
2. 构建 Electron 应用并物化当前 `drsai` 源码。
3. 生成 `build-identity.json`，绑定源码内容、Git 状态、Python 依赖、版本和渠道。
4. 生成 `runtime-files.sha256.json`，记录 Runtime 中每个受控文件的路径、大小和 SHA-256。
5. 创建最终 Runtime ZIP。
6. 生成 `<runtime.zip>.receipt.json` 完成态回执。
7. 重新解包 ZIP，复验文件清单、Build ID 和 Python 的实际导入路径。
8. 只有复验通过的 Runtime 才能用于构建 MSI、启动 Candidate/Upgrade Sandbox 验收或上传发布资产。

任一步失败时，本次不完整 ZIP 和回执都会被删除。磁盘上遗留的旧 ZIP 没有与其内容匹配的完成态回执，因此不能进入后续正式流程。

## 三类信任文件

- `build-identity.json`：标识本次源码和依赖组合；同时写入 Runtime 根目录与 `drsai-agent`。
- `runtime-files.sha256.json`：约束最终 Runtime 的完整文件集合，能够发现缺失、修改和额外的陈旧文件。
- `<runtime.zip>.receipt.json`：标记 ZIP 已完整生成，并绑定 ZIP 哈希、大小、Build ID 和 Runtime Manifest 哈希。

Sandbox Candidate/Upgrade 安装后会再次读取安装目录中的 Build ID，并把结果写入 `installed-build-identity.json`。预期 Build ID、Runtime Build ID 或 Python Agent Build ID 不一致时，验收会在启动应用前失败。

## 常用命令

在 `apps/desktop/windows` 下运行：

```powershell
npm run verify:runtime-build-trust
npm run build:runtime
npm run verify:final-runtime
npm run build:bootstrapper
```

- `verify:runtime-build-trust`：执行故障注入回归，包括文件被修改、混入陈旧文件和 ZIP 在回执后被篡改。
- `build:runtime`：重新创建受控 Python venv，构建并复验最终 Runtime。
- `verify:final-runtime`：独立验证当前版本的最终 ZIP 与完成态回执。
- `build:bootstrapper`：只接受已通过可信 Runtime 验证的输入。

不要直接挑选目录中“最新”的 ZIP，也不要手工复制一个旧回执给新 ZIP。自动化和人工验收都应使用本次 `build:runtime` 明确产生的 ZIP、同名回执及其 Build ID。

## 能力边界

可信构建链解决的是产物身份、内容漂移、缓存污染和旧包误用。它不能证明所有业务行为都正确，也不能替代模型、网络、OIDC、更新和真实 Sandbox E2E。功能门禁通过后，仍须按照发布清单完成真实 Sandbox 验收和证据封存。

