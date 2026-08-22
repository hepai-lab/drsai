# OpenDrSai 下载与更新发布方案

## 生产架构

- GitHub Release 可选地保留版本记录和备用下载，不是 OSS 生产发布的硬依赖。
- 阿里云北京 OSS 私有 Bucket `hepai-release` 保存发布资产。
- `download-opendrsai.ihep.ac.cn` 通过 CNAME 接入阿里云 CDN，使用 `*.ihep.ac.cn` 证书。
- CDN 开启同账号私有 Bucket 回源、HTTPS 强制跳转、2 MB Range 回源和带宽告警。
- OpenDrSai 生产更新使用 OSS/CDN；只在显式启用并验证了 GitHub 备份渠道时才允许回退。

## 路径与缓存

```text
/releases/v1.5.2/windows/OpenDrSai-Windows-Installer-x64.msi
/releases/v1.5.2/windows/OpenDrSai-Windows-v1.5.2-x64.zip
/releases/v1.5.2/android/OpenDrSai-Android-v1.5.2.apk
/channels/beta/latest-windows.json
/channels/beta/latest-android.json
/releases/v1.5.2/macos/OpenDrSai-macOS-v1.5.2-arm64.dmg
/releases/v1.5.2/macos/OpenDrSai-macOS-v1.5.2-arm64.zip
/channels/stable/latest-windows.json
/channels/stable/latest-android.json
/channels/stable/macos/arm64/latest-mac.yml
/channels/stable/macos/arm64/OpenDrSai-macOS-v1.5.2-arm64.zip
```

- Windows MSI 固定命名为 `OpenDrSai-Windows-Installer-x64.msi`；Runtime ZIP 使用 `OpenDrSai-Windows-v{version}-x64.zip`。
- macOS 完整 DMG（含首次安装 Runtime）用于 CDN 首次安装；应用内更新 ZIP 不重复携带已持久化到 `~/.drsai` 的 Runtime。DMG、ZIP 和 `latest-mac.yml` 发布到 OSS/CDN；首发只支持 Apple Silicon arm64。
- macOS Channel 目录保留同字节的版本化 ZIP 别名，使相对 URL `latest-mac.yml` 在 Generic CDN 上可用；该 ZIP 名含版本和架构且不可覆盖，权威归档位于 `/releases/v版本/macos/`。
- `/releases/v版本/`：不可覆盖，缓存一年，发布后预热 MSI、ZIP、APK、DMG。
- `/channels/stable/`：缓存 30～60 秒，不预热；更新清单最后上传。
- 不对 MSI、ZIP、APK、DMG 做 CDN 动态压缩；客户端必须校验版本、文件大小和 SHA-256。macOS 还必须通过 Apple 代码签名验证后才允许安装。

## 发布顺序

1. 完成构建、测试和签名检查。
2. 上传版本化资产到 OSS，并通过 CDN 验证 `HEAD`、Range、大小和 SHA-256。
3. 预热大文件，再上传版本清单和 `channels/stable` 清单。
4. 最后晋级 `channels/stable` 清单，失败时恢复上一份 stable 快照。
5. 验证 CDN 下载、自动更新和 `opendrsai-dev.ihep.ac.cn` 发布入口。

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
