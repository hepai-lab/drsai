# OpenDrSai 下载与更新发布方案

## 生产架构

- GitHub Release 可选地保留版本记录和备用下载，不是 OSS 生产发布的硬依赖。
- 阿里云北京 OSS 私有 Bucket `hepai-release` 保存发布资产。
- `download-opendrsai.ihep.ac.cn` 通过 CNAME 接入阿里云 CDN，使用 `*.ihep.ac.cn` 证书。
- CDN 开启同账号私有 Bucket 回源、HTTPS 强制跳转、2 MB Range 回源和带宽告警。
- OpenDrSai 生产更新使用 OSS/CDN；只在显式启用并验证了 GitHub 备份渠道时才允许回退。

## 路径与缓存

```text
/releases/v1.5.2/windows/OpenDrSai-Windows-v1.5.2-Installer-x64.msi
/releases/v1.5.2/windows/OpenDrSai-Windows-v1.5.2-x64.zip
/releases/v1.5.2/android/OpenDrSai-Android-v1.5.2.apk
/channels/beta/latest-windows.json
/channels/beta/latest-android.json
/releases/v1.5.2/macos/OpenDrSai-macOS-v1.5.2-arm64.dmg
/releases/v1.5.2/macos/OpenDrSai-macOS-v1.5.2-arm64.zip
/releases/v1.5.2-beta.1/macos/latest-mac.yml
/channels/beta/macos/arm64/latest-mac.yml
/channels/stable/latest-windows.json
/channels/stable/latest-android.json
/channels/stable/macos/arm64/latest-mac.yml
/channels/stable/macos/arm64/OpenDrSai-macOS-v1.5.2-arm64.zip
```

- Windows MSI 使用 `OpenDrSai-Windows-v{version}-Installer-x64.msi`；Runtime ZIP 使用 `OpenDrSai-Windows-v{version}-x64.zip`。
- macOS 完整 DMG（含首次安装 Runtime）用于 CDN 首次安装；应用内更新 ZIP 不重复携带已持久化到 `~/.drsai` 的 Runtime。DMG、ZIP 和 `latest-mac.yml` 发布到 OSS/CDN；首发只支持 Apple Silicon arm64。
- macOS Channel 目录保留同字节的版本化 ZIP 别名，使相对 URL `latest-mac.yml` 在 Generic CDN 上可用；该 ZIP 名含版本和架构且不可覆盖，权威归档位于 `/releases/v版本/macos/`。
- `/releases/v版本/`：不可覆盖，缓存一年，发布后预热 MSI、ZIP、APK、DMG。
- `/channels/beta/`、`/channels/stable/`：仅保存引用 `/releases/v版本/` 不可变资产的可变指针，缓存 0～60 秒且不预热；对应频道清单必须在资产和版本清单完成上传及验收后，作为该次发布的最后一次 OSS 写入，覆盖后立即刷新精确 CDN URL。
- Beta 发布不得修改 Stable；Stable 清单只能消费已经通过完整发布门禁的不可变资产，更新前保存上一份指针以便失败时恢复。
- 不对 MSI、ZIP、APK、DMG 做 CDN 动态压缩；客户端必须校验版本、文件大小和 SHA-256。macOS 还必须通过 Apple 代码签名验证后才允许安装。

## Windows beta/stable 约定

- 版本资产先写入 `/releases/v{version}/windows/`，禁止覆盖；ossutil v2 对已存在对象使用 `--ignore-existing`，随后用公网字节身份校验拒绝同路径不同内容。MSI、Runtime ZIP、版本清单和发布摘要一经验收即保持不可变。
- beta 指针固定为 `/channels/beta/latest-windows.json`。beta 清单必须包含 `channel: "beta"` 和非空 `buildLabel`，例如当前 `version: "1.5.8"`、`buildLabel: "Beta 3"`。
- stable 指针固定为 `/channels/stable/latest-windows.json`。stable 晋级复用已验收的版本资产，但必须重新生成 `channel: "stable"`、`requireSignature: true` 的清单，并删除 `buildLabel`，不得把 `Beta 3` 原样带入生产频道。
- 开发站读取 beta，只有 beta 清单缺失或不可用时才回退 stable；生产站只读取 stable。WebUI 只消费频道清单，不用页面内硬编码版本替代发布状态。
- 晋级前必须完成 Sandbox/升级/签名验收；未完成时不得切换频道指针。当前已发布的 v1.5.8 Beta 3 不因 stable 链路建设而改变。

当前 Windows beta 基线（2026-08-14 公网复核）：`version=1.5.8`、`channel=beta`、`buildLabel="Beta 3"`；Runtime 为 `355495575` bytes，SHA-256 为 `e710fa6d0837ec7d6f5f8109d6c9d4801736b0452c2a844dd7c70748b6fd9ea1`；MSI 为 `643072` bytes，SHA-256 为 `ce641707e5a7dad889caffd195d42493efff66c72b9a7dac841c65ce8dc5de2b`。两者当前均为 `NotSigned`，因此只允许处于 beta，不能晋级 stable。

## 发布顺序

1. 完成构建、Sandbox/升级测试和签名检查，生成本地清单与摘要。
2. 以禁止覆盖方式上传版本化资产到 OSS；通过严格 TLS 从 CDN 验证 Range、大小、SHA-256、签名状态及与本地验收制品的字节身份。
3. 上传并验证版本清单，生成目标频道清单：beta 保留明确的 `buildLabel`；stable 删除 `buildLabel` 并强制签名。
4. 将目标频道清单作为最后一次 OSS 写入并刷新精确 CDN URL；macOS Beta 使用 `channels/beta/macos/arm64/latest-mac.yml`，写入前记录 Stable 基线。
5. Stable 晋级作为独立事务保存上一份 Stable 指针，失败时恢复；Beta 发布不得修改 Stable，也不得暴露半发布状态。
6. 从公网重新验证频道清单为 200、资产 Range 为 206，并核对大小、SHA-256、macOS SHA-512、Runtime SHA-256、签名状态及与本地验收制品的字节身份。
7. 验证 CDN 下载、自动更新和对应网站入口。macOS 开发站消费 Beta 时配置 `OPENDRSAI_MACOS_RELEASE_CHANNEL=beta`，默认仍为 Stable。

macOS 的详细实现、无签名开发边界、Feed 回退状态机和分层发布门禁见 [OpenDrSai macOS 下载与更新完整链路规划](./opendrsai-macos-download-update-implementation-plan.md)。在 Developer ID、公证凭据和上一稳定签名版本齐备前，只允许产出 unsigned 开发证据，不得更新生产 `channels/stable/macos/arm64/latest-mac.yml`。

## 自建对象存储

可部署 MinIO 等 S3 兼容对象存储，并保持上述路径和清单格式不变。最低要求：

- 使用多磁盘或多节点纠删码，另做异地备份。
- 通过独立域名和 HTTPS 对外服务，支持 `GET`、`HEAD`、Range/断点续传。
- 发布账号仅有指定目录上传权限，下载文件公开只读。
- 版本文件不可覆盖；更新清单必须最后原子更新。
- 配置带宽、流量、磁盘、可用性监控及限流防护。
- 国内大规模分发仍建议在自建存储前接 CDN，否则出口带宽和跨运营商速度会成为瓶颈。

由于 App 始终访问 `download-opendrsai.ihep.ac.cn`，以后从阿里云 OSS 切换到自建存储时，只需修改 CDN 源站，不需要修改客户端。
