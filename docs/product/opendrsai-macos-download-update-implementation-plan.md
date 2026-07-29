# OpenDrSai macOS 下载与更新完整链路规划

## 1. 目标与当前结论

本规划把 macOS Apple Silicon 桌面端接入 OpenDrSai 统一下载架构，形成以下闭环：

1. 版本化 DMG/ZIP 同时发布到阿里云 OSS/CDN 和 GitHub Release；
2. App 默认从 `download-opendrsai.ihep.ac.cn` 检查并下载更新；
3. CDN 的连接、元数据、资产或完整性校验失败时，受控回退 GitHub；
4. 大文件先发布并验证，`latest-mac.yml` 最后原子切换；
5. unsigned CI 验证分发和回退逻辑，signed L6 验证真实安装、健康确认与回滚；
6. 未达到 signed L6 时不更新生产 stable channel。

当前 `electron-updater` 已实现手动检查、下载、取消、退出安装、禁止降级、启动健康确认和 watchdog 回滚；`electron-builder.yml` 仍以 GitHub 为唯一 Provider，生产 CDN、双源回退和 OSS 发布尚未接入。现有在线更新脚本强制验证签名，不能在无 Developer ID 时作为通过证据。

## 2. 生产目录与资产契约

```text
https://download-opendrsai.ihep.ac.cn/
├── releases/v1.5.2/macos/
│   ├── OpenDrSai-macOS-v1.5.2-arm64.dmg
│   └── OpenDrSai-macOS-v1.5.2-arm64.zip
└── channels/stable/macos/arm64/
    ├── OpenDrSai-macOS-v1.5.2-arm64.zip
    └── latest-mac.yml
```

GitHub Release 必须保存与 CDN 字节完全相同的更新 ZIP 和 `latest-mac.yml`。GitHub 官方限制单个 Release 文件必须小于 2 GiB，因此包含完整 Runtime 的 DMG 只上传 OSS/CDN；更新 ZIP 不重复携带已经原子安装到 `~/.drsai` 的 Runtime。Channel 下的版本化 ZIP 是权威版本 ZIP 的同字节别名，使元数据可以使用相对文件名并同时适配 Generic CDN 与 GitHub Provider。

资产约束：

- 版本目录不可覆盖，`Cache-Control: public, max-age=31536000, immutable`；
- Channel 元数据缓存 30～60 秒，上传时使用临时对象，验证后原子替换正式 key；
- DMG 负责首次安装并包含 Runtime；ZIP 是不含 Runtime tarball 的 macOS App 自动更新资产，更新后继续使用 `~/.drsai` 中已安装且独立校验的 Runtime；
- 更新 ZIP 必须小于 2 GiB，超过即在资产门禁失败，不得创建 GitHub Release；
- `latest-mac.yml` 必须携带 `opendrsaiRuntimeVersion` 和 `opendrsaiRuntimeSha256`；App 下载薄更新前与 `~/.drsai/drsai-agent/.opendrsai-runtime.json` 比对。版本或归档摘要不同则停止自动更新并引导安装完整 DMG，避免新 App 静默搭配不兼容旧 Runtime；
- `latest-mac.yml` 中的 URL、size、sha512 和版本必须与 ZIP 一致；
- 发布回执额外记录两个源的 SHA-256、Content-Length、ETag、Range、TLS host 和上传时间；
- CDN 与 GitHub 的 ZIP digest 不一致时必须阻断 stable channel 更新。

## 3. Feed 与客户端回退设计

### 3.1 electron-builder 配置

将 `apps/desktop/macos/electron-builder.yml` 的内置生产 Feed 改为 generic CDN：

```yaml
publish:
  provider: generic
  url: https://download-opendrsai.ihep.ac.cn/channels/stable/macos/arm64/
  channel: latest
```

GitHub 不再作为打包进 App 的唯一 Provider。工作流显式上传 GitHub Release，客户端只在 CDN 失败后临时切换到 GitHub Release Feed。开发版和 unsigned dir 包继续禁用生产更新源，避免污染正式 channel 和用户数据。

正式构建应把以下常量固化进主进程，而不是接受普通用户环境变量覆盖：

```text
primary:  https://download-opendrsai.ihep.ac.cn/channels/stable/macos/arm64/
fallback: https://github.com/hepai-lab/drsai/releases/latest/download/
```

仅测试构建可通过现有 `OPENDRSAI_MACOS_UPDATE_FEED_URL` 注入隔离 Feed；生产包必须拒绝任意 host 覆盖。

### 3.2 updater 状态机

在 `src/main/updater.ts` 增加 `primary-cdn`、`fallback-github` 两个明确来源和单次操作上下文：

```text
检查 CDN
  ├─ 有更新/无更新且响应有效 → 结束，不访问 GitHub
  └─ 网络、HTTP、YAML、超时或完整性错误 → 检查 GitHub
       ├─ 成功 → 标记 source=github-fallback
       └─ 失败 → 返回聚合后的脱敏错误

从选定来源下载 ZIP
  ├─ 成功且 electron-updater 校验通过 → ready
  └─ CDN 下载失败 → 切 GitHub、重新检查同一目标版本、重新下载
       └─ GitHub 版本或 digest 与 CDN 元数据冲突 → fail closed
```

规则：

- 404、超时、连接失败、非法元数据和资产校验失败允许回退；
- “当前已是最新版”不是失败，不访问备用源；
- TLS、host 白名单或版本回退攻击不能通过关闭校验解决；
- 一次操作最多切换一次来源，禁止循环重试；
- 回退后必须重新获取 GitHub 元数据，不能把 CDN URL 简单替换为 GitHub URL；
- 日志记录 source、phase、HTTP 类别和 request id，不记录 token、Cookie、授权头或带签名 OSS URL；
- `UpdateStatus` 增加 `source`、`fallbackUsed` 和稳定错误码，UI 可显示“CDN 不可用，已切换备用下载源”。

## 4. 发布流水线

### 4.1 构建与暂存

在 `.github/workflows/macos-desktop.yml` 中把发布拆为五段：

1. `build-macos-candidate`：一次性构建 DMG、ZIP、`latest-mac.yml` 和资产清单；
2. `verify-distribution-unsigned`：不需要 Apple 身份，验证元数据、双源一致性脚本和回退状态机；
3. `release-macos-l6-real-device`：需要 Developer ID、公证凭据和上一签名稳定版本；
4. `stage-macos-assets`：L6 通过后上传版本化 OSS 资产并创建暂存或 draft GitHub Release；
5. `promote-macos-stable`：验证两个源后最后上传 stable `latest-mac.yml`，随后把 GitHub Release 转为正式发布。

推荐发布顺序：

```text
构建一次
→ 签名/公证/L6
→ OSS 版本化 DMG/ZIP
→ CDN HEAD + Range + digest
→ GitHub draft DMG/ZIP/latest-mac.yml
→ 双源一致性
→ OSS 临时 latest-mac.yml
→ 从临时 Feed 做在线更新演练
→ GitHub Release publish
→ 原子替换 stable latest-mac.yml
→ stable CDN + GitHub fallback 冒烟
```

如果 GitHub 必须先公开才能进行最终回退测试，可先发布不可变版本 tag，但 stable channel 仍必须最后切换。任何一步失败都保留旧 stable 元数据，不删除上一稳定资产。

### 4.2 OSS/CDN 权限和工作流密钥

发布 Runner 只获得以下最小权限：

- 写入当前版本的 `releases/vX/macos/arm64/*`；
- 写入 `channels/stable/macos/arm64/latest-mac.yml.tmp-*`；
- 在 promote job 中替换唯一 stable key；
- 读取并校验既有版本资产；
- 不允许删除或覆盖历史版本目录。

凭据拆分为“版本资产上传”和“stable 晋级”两套，只有受保护的 environment 可以使用 stable 凭据。工作流日志不得输出 OSS secret、预签名 URL 或 Apple 凭据。

## 5. 无签名条件下的实现和验证

无 Developer ID 时仍可完成大部分工程实现，但必须把“分发正确”和“系统可安装”分开。

### 5.1 可以真实完成的内容

- 生成 DMG、ZIP 和 `latest-mac.yml`，校验 version、size、sha512；
- 使用本地或测试 HTTPS generic Feed 执行检查更新；
- 验证 CDN 首选、GitHub 回退、无更新不回退和双失败错误聚合；
- 下载完整 ZIP，验证进度、取消、超时、404、Range 和损坏资产失败；
- 用临时目录模拟 OSS 的“版本资产先上传、元数据最后切换”；
- 验证 CDN/GitHub 字节一致性、缓存头、HEAD 和 Range；
- 静态验证 updater 只接受允许的 HTTPS host；
- 验证开发包不会访问生产 Feed；
- 在 CI 产出 `unsigned-update-distribution.json`，明确 `installVerified: false`。

测试 Feed 使用专门域名或 localhost HTTPS 代理，证书必须受测试机信任。不要为测试关闭 TLS 校验。

### 5.2 不能标记为通过的内容

- `quitAndInstall()` 后新 App 成功替换旧 App；
- 新旧版本 Apple Team ID/Designated Requirement 一致；
- Gatekeeper、notarization、stapling；
- 从真实上一稳定签名版本升级；
- 更新失败后恢复上一已签名 App；
- 更新后 Keychain、TCC 和通知授权连续性；
- 正式 stable channel 晋级。

unsigned 测试可以在调用安装前停止，并断言下载状态为 `ready`。不得通过 ad-hoc 签名、关闭签名验证或修改 `electron-updater` 校验逻辑冒充正式在线升级。

### 5.3 unsigned 门禁拆分

新增建议脚本：

```text
scripts/generate-update-manifest.mjs
scripts/verify-update-assets.mjs
scripts/verify-update-feed-fallback.mjs
scripts/verify-update-publish-order.mjs
scripts/verify-update-origins.mjs
```

对应 CI 命令建议为：

```text
npm run verify:update-assets:unsigned
npm run verify:update-fallback:unsigned
npm run verify:update-publish-order:unsigned
npm run record:update-distribution:unsigned
```

回执至少包含：commit、version、arch、asset digest、两个 Feed URL、失败注入矩阵、fallbackUsed、TLS 验证状态、`downloadVerified: true`、`installVerified: false` 和生成时间。

## 6. 签名到位后的 L6 晋级

Developer ID 和公证凭据到位后，复用并扩展现有：

- `preflight:release`；
- `verify:release:l6-auto`；
- `stage:update-lab-feed`；
- `prepare:previous-release`；
- `verify:online-update:l6`；
- `record:signed-update-evidence`。

L6 必须覆盖：

1. 上一稳定签名版从 CDN 更新成功；
2. CDN 故障时从 GitHub 更新成功；
3. 下载损坏或签名不一致时拒绝安装；
4. 新版本启动并在时限内确认健康；
5. 注入启动失败时 watchdog 恢复旧签名 App；
6. 用户数据、工作区、Keychain 引用和允许保留的授权状态不丢失；
7. 安装后的 App 重新通过 `codesign --deep --strict`、`spctl` 和版本/digest 比对。

只有 signed L6 回执中 `cdnUpdateInstalled`、`githubFallbackInstalled`、`healthConfirmed`、`rollbackVerified`、`userDataPreserved` 全为 true，`promote-macos-stable` 才能运行。

## 7. 故障与回滚策略

- 版本化资产上传失败：不创建或更新 channel；
- CDN 校验失败：不发布 GitHub 正式 Release，不更新 channel；
- GitHub 上传失败：保留 OSS 版本资产，但不更新 channel；
- 临时 Feed 在线升级失败：删除临时元数据，不更新 channel；
- stable 元数据已切换后发现问题：原子恢复上一版 `latest-mac.yml`，不覆盖或删除问题版本资产；
- stable 晋级前通过 OSS server-side copy 保存当前元数据；晋级后 CDN 校验失败时自动恢复该快照。首次发布没有旧元数据时只删除本次创建的唯一 stable key；
- 客户端安装失败：保留当前 App；已替换但启动不健康时由 watchdog 恢复备份；
- 用户数据 schema 必须向前兼容；App 回滚不得尝试自动回滚用户数据。

## 8. 实施阶段与完成定义

### 阶段 A：文档与契约

- 固定路径、命名、缓存、源优先级、错误码和回执 schema；
- 更新 release contract，防止 Feed 或门禁被意外移除。

完成定义：静态契约和元数据 fixture 测试通过。

### 阶段 B：客户端双源更新

- generic CDN 为默认 Feed；
- 实现检查和下载阶段的一次性 GitHub 回退；
- UI 展示来源和回退状态；
- 开发构建与生产 Feed 隔离。

完成定义：unsigned 故障矩阵全部通过，尚不宣称安装成功。

### 阶段 C：分发流水线

- 增加一次构建、OSS 版本上传、GitHub draft、双源校验和元数据最后晋级；
- 使用受保护 environment 和最小权限凭据；
- stable 更新失败时保持上一版本。

完成定义：测试 Bucket/测试 GitHub Release 完整演练通过，生产 promote job 保持禁用。

### 阶段 D：签名 L6

- 配置 Developer ID、公证和 release runner；
- 准备真实上一稳定签名版本；
- 完成 CDN、GitHub 回退、健康确认和失败回滚真机验收。

完成定义：signed L6 全部通过，才启用生产 `promote-macos-stable`。

### 阶段 E：首发和观测

- 小流量发布并预热；
- 监控 channel 请求、ZIP 下载成功率、回退率、完整性失败和带宽；
- 验证官网下载 DMG、App 内 CDN 更新及 GitHub 回退。

完成定义：首发观察窗口无阻断问题，发布回执与监控记录归档。

## 9. 明确的发布判定

在当前无签名条件下，项目最多达到：

```text
distribution-ready / install-unverified / production-promotion-blocked
```

不得写成“macOS 自动更新已上线”或“L6 通过”。Developer ID、公证、上一稳定签名版本和真实 Apple Silicon 更新/回滚证据齐备后，才允许达到：

```text
signed-update-verified / production-promotion-enabled
```
