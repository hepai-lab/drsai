# OpenDrSai macOS 更新生产配置与首发手册

## 1. 当前发布判定

代码、unsigned 构建、CDN/GitHub 回退策略、OSS 发布事务和 stable 失败恢复已经实现。生产发布必须同时满足：

- Apple Silicon 自托管 Runner 标签：`self-hosted, macOS, ARM64, opendrsai-release`；
- 唯一有效的 `Developer ID Application` 身份；
- App Store Connect API 公证凭据；
- 可执行的 ossutil v1.7.19 或经兼容验证的版本；
- `hepai-release` Bucket 最小权限凭据；
- 一份早于当前候选版本的稳定签名 macOS Release；
- GitHub Environment `macos-production-release` 已设置 required reviewers。

缺少任意一项时，工作流必须保持失败，不得手工跳过 signed L6 或直接覆盖 stable 元数据。

## 2. GitHub 配置

在 `macos-production-release` Environment 配置：

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Secret | `MACOS_CSC_LINK` | Developer ID Application 证书 PKCS#12/base64 或 electron-builder 支持的位置 |
| Secret | `MACOS_CSC_KEY_PASSWORD` | PKCS#12 密码 |
| Secret | `APPLE_API_KEY` | App Store Connect API 私钥内容或受控文件位置 |
| Secret | `APPLE_API_KEY_ID` | API Key ID |
| Secret | `APPLE_API_ISSUER` | Issuer ID |
| Variable | `OPENDRSAI_OSSUTIL_BIN` | Runner 上 ossutil 的绝对路径，例如 `/usr/local/bin/ossutil` |

OSS AccessKey/STS 不通过命令行参数或工作流日志传递。由发布 Runner 的受限服务账号预配置 ossutil config，文件权限必须为 `0600`，Runner 不得被普通开发任务复用。

Environment 应至少启用一名 required reviewer。`publish_release=true` 的手动生产发布只允许从 `main` 运行；tag 发布必须严格等于 `v<apps/desktop/macos/package.json version>`。

## 3. OSS 最小权限边界

发布身份只需要：

- 读取/检查 `hepai-release` 中目标对象；
- 创建当前版本的 `releases/v*/macos/*`（文件名必须包含架构）；
- 创建版本化 `channels/stable/macos/arm64/OpenDrSai-macOS-v*-arm64.zip`；
- 创建 `channels/history/macos/arm64/v*/latest-mac.yml`；
- 创建 `channels/rollback/macos/arm64/before-v*/latest-mac.yml`；
- 覆盖唯一的 `channels/stable/macos/arm64/latest-mac.yml`；
- 仅在首次发布回滚时删除上述唯一 stable key。

历史版本、版本化 ZIP、DMG、history 和 rollback key 不允许覆盖或删除。Bucket 侧应使用 RAM Policy 进一步限制资源前缀；不能只依赖发布脚本中的 `stat` 检查。

## 4. Runner 预检

在 Runner 上人工执行一次：

```bash
security find-identity -v -p codesigning
/absolute/path/to/ossutil --version
/absolute/path/to/ossutil stat oss://hepai-release/channels/stable/macos/arm64/latest-mac.yml
```

验收：

- `security` 精确返回一个 `Developer ID Application`；
- ossutil 版本固定并记录；
- `stat` 返回对象信息或明确的 `NoSuchKey`/404，不能是鉴权、Endpoint、TLS 或网络错误；
- release Runner 有足够磁盘容纳完整 DMG、薄 ZIP、上一版本 App、解包副本和回滚副本。

随后在仓库执行：

```bash
npm --prefix apps/desktop ci
npm --prefix apps/desktop run preflight:release --workspace opendrsai-macos-desktop
```

`release-preflight.json` 必须为 `ready-to-build-signed-rc`，不得为 `blocked-on-signing`。

## 5. 首发流程

1. 合并所有发布修改，保证工作树干净；
2. 更新 macOS package/runtime 版本并生成 tag `vX.Y.Z`；
3. 推送 tag，触发 `.github/workflows/macos-desktop.yml`；
4. unsigned、L4、L5 通过；
5. release Runner 构建完整签名 DMG和不携带 Runtime archive 的签名更新 ZIP；
6. 完成 Gatekeeper、公证、stapling、干净安装和真实在线更新 L6；
7. 发布 job 预检 OSS，创建 GitHub draft；
8. 上传 OSS 不可变资产，不修改 stable；
9. 校验 CDN HEAD、Range、Content-Length、SHA-256 及 GitHub draft 字节一致性；
10. GitHub Release 转为正式；
11. 保存旧 stable 快照；
12. 最后覆盖 `latest-mac.yml`；
13. 校验 stable CDN；失败则自动恢复旧 stable 状态。

首次发布没有旧 stable 时，快照状态记录 `previousExists=false`；若晋级后校验失败，只删除本次创建的 stable key，不删除任何版本资产。

## 6. Runtime 兼容规则

完整 DMG 包含 Runtime archive，供首次安装或 Runtime 变更升级。自动更新 ZIP不包含 3.8 GB Runtime archive，只保留 manifest、SBOM 和 provenance。

`latest-mac.yml` 必须包含：

```yaml
opendrsaiRuntimeVersion: 1.5.1
opendrsaiRuntimeSha256: <64 lowercase hex>
```

App 下载 ZIP 前与 `~/.drsai/drsai-agent/.opendrsai-runtime.json` 比对。版本或 archive SHA-256 不同、Runtime 不健康或元数据缺失时，自动更新失败关闭，并要求用户安装完整 DMG。不得删除该检查以提高更新成功率。

## 7. 故障处置

- GitHub draft 创建失败：不上传 OSS，不影响 stable；
- OSS 版本对象已存在：视为不可变冲突，停止发布；
- CDN/GitHub 双源摘要不同：保持 GitHub draft，不晋级 stable；
- GitHub 正式发布失败：不晋级 stable；
- stable 校验失败：工作流调用 `--rollback-metadata`；
- 新 App 启动不健康：App 内 watchdog 恢复上一签名 App，用户数据不回滚；
- Runtime 不匹配：用户改用完整 DMG，不允许薄 ZIP强制安装；
- 发布 job 中断：先检查 GitHub Release 状态和 stable 当前摘要，再决定重跑；版本化对象不得使用 `--clobber` 或手工覆盖。

## 8. 完成证据

生产上线至少归档：

- `release-preflight.json`；
- L4/L5/L6 evidence；
- `macos-update-assets.json`；
- `online-signed-update.json`；
- signed update rollback receipt；
- CDN/GitHub 双源校验日志；
- stable 晋级或回滚日志；
- GitHub Release URL、tag、commit 和最终资产摘要。

只有上述证据全部通过，状态才可从 `production-promotion-blocked` 改为 `signed-update-verified / production-promotion-enabled`。
