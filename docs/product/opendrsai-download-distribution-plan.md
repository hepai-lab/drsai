# OpenDrSai 下载与更新发布方案

## 生产架构

- GitHub Release 保留版本记录和备用下载。
- 阿里云北京 OSS 私有 Bucket `hepai-release` 保存发布资产。
- `download-opendrsai.ihep.ac.cn` 通过 CNAME 接入阿里云 CDN，使用 `*.ihep.ac.cn` 证书。
- CDN 开启同账号私有 Bucket 回源、HTTPS 强制跳转、2 MB Range 回源和带宽告警。
- OpenDrSai 优先使用 CDN；连接、下载或校验失败时回退 GitHub。

## 路径与缓存

```text
/releases/v1.5.2/windows/OpenDrSai-Windows-Installer-x64.msi
/releases/v1.5.2/windows/OpenDrSai-Windows-v1.5.2-x64.zip
/releases/v1.5.2/android/OpenDrSai-Android-v1.5.2.apk
/channels/stable/latest-windows.json
/channels/stable/latest-android.json
```

- Windows MSI 固定命名为 `OpenDrSai-Windows-Installer-x64.msi`；Runtime ZIP 使用 `OpenDrSai-Windows-v{version}-x64.zip`。
- `/releases/v版本/`：不可覆盖，缓存一年，发布后预热 MSI、ZIP、APK。
- `/channels/stable/`：缓存 30～60 秒，不预热；更新清单最后上传。
- 不压缩 MSI、ZIP、APK；客户端必须校验版本、文件大小和 SHA-256。

## 发布顺序

1. 完成构建、测试和签名检查。
2. 上传版本化资产到 OSS，并通过 CDN 验证 `HEAD`、Range、大小和 SHA-256。
3. 预热大文件，再上传版本清单和 `channels/stable` 清单。
4. 创建包含相同资产的 GitHub Release。
5. 验证 CDN 下载、自动更新和 GitHub 回退。

## 自建对象存储

可部署 MinIO 等 S3 兼容对象存储，并保持上述路径和清单格式不变。最低要求：

- 使用多磁盘或多节点纠删码，另做异地备份。
- 通过独立域名和 HTTPS 对外服务，支持 `GET`、`HEAD`、Range/断点续传。
- 发布账号仅有指定目录上传权限，下载文件公开只读。
- 版本文件不可覆盖；更新清单必须最后原子更新。
- 配置带宽、流量、磁盘、可用性监控及限流防护。
- 国内大规模分发仍建议在自建存储前接 CDN，否则出口带宽和跨运营商速度会成为瓶颈。

由于 App 始终访问 `download-opendrsai.ihep.ac.cn`，以后从阿里云 OSS 切换到自建存储时，只需修改 CDN 源站，不需要修改客户端。
