# Windows Security Package Catalog

## 为什么需要独立 catalog

安装目录中的 `windows-security-installation.json` 不能自己声明“我是可信 metadata”。同时，把 metadata digest 直接嵌入待计算摘要的 Runtime executable 会形成循环依赖。

`windows-security-package-catalog/1` 采用非循环发布顺序：

1. 构建 Runtime service executable，计算稳定的完整文件 SHA-256；
2. 生成并签署 SLO policy、observability deployment 和 release pins；
3. 生成 installation metadata，绑定 service executable、worker、policy 和 deployment 文件摘要；
4. 根据实际 metadata/pins 文件派生 catalog payload；
5. 使用离线 release Ed25519 key 签署 catalog；
6. Runtime executable 只内置 release public key、catalog ID、product/channel 和 minimum catalog version；最终安装时从签名 catalog 获得 metadata digest、service identity 和 writer allowlist。

catalog 自身不需要被写回 Runtime executable。`runtime_build_digest` 是第一步已经确定的 service executable 文件摘要，因此不存在“最终文件摘要写入自身”的循环。

## 签名内容

catalog 精确绑定：

- catalog ID/version、product、channel、Runtime build digest；
- installation metadata filename/ID/digest/minimum version；
- release pins filename 和完整文件 SHA-256；
- service name/SID、start account/type、SID type、delayed-auto；
- 有序且无重复的 installer trusted-writer SID allowlist；
- 生效和过期时间。

service SID 不能进入 writer allowlist。SID type 只能是 `unrestricted`；其他值不会被签名 loader 接受。

## 离线 builder

`WindowsSecurityPackageCatalogTool.build()` 不让调用者手填 product、channel、Runtime build、metadata digest、release-pins digest 或 service identity。它从安装 staging 中的实际 metadata 和 pins 派生这些值，只接受 catalog ID/version、两个 basename、writer allowlist 和有效期。

输出采用 create-new 语义，绝不覆盖已有 catalog。写入完成后，builder 使用生产 `SignedWindowsSecurityPackageCatalogLoader` 自验；失败时删除本次创建的 catalog。

builder 仅供离线发布流水线使用，不得进入 Runtime、Gateway、Electron、Workspace 或客户端启动路径。

## Runtime loader

生产路径通过 root-signed key policy 获取 catalog key，详见 `windows-package-catalog-key-lifecycle.md`。`SignedWindowsSecurityPackageCatalogLoader.from_verified_key_policy()` 要求 Runtime 固化：

- 离线 root public-key allowlist与 key-policy identity/minimum version；
- catalog ID；
- product/channel；
- 当前 Runtime build digest；
- minimum catalog version。

key policy 解析当前 active/non-revoked catalog keys；loader 校验 canonical Ed25519 signature、有效期、release-pins 文件摘要和所有强类型字段。成功接受的最高版本及 payload digest 写入 SQLite；低版本回滚和同版本不同内容重定义均拒绝，并与 `windows_package.catalog_accepted` 哈希链事件同事务提交。每次 load 都重新检查 policy/key 生命周期，缓存 loader 不会保留已退役权限。

key rotation 使用显式 overlap：发布窗口内 Runtime 同时 pin old/new public key，新版本 catalog 改用 new key；一旦 Runtime 删除 old key，旧 key 即使版本更高也不再可信。catalog 版本仍必须单调增加，换 key 不能重置版本。

## Installation verifier 接线

生产路径应使用 `WindowsSecurityInstallationVerifier.from_verified_catalog()`，由 frozen verified catalog 派生 metadata digest、service configuration 和 writer allowlist。随后 verifier 还会：

- 解析磁盘上的 release pins，并与调用链中的 pins 对象逐字段比较；
- 校验 release-pins 完整文件摘要；
- 对 catalog 和 pins 文件执行同一 owner/DACL/reparse 门禁；
- 将 catalog、metadata、pins、deployment、policy、worker 和 service executable 纳入同一个安装证据结果。

在 catalog、installation、SCM 和正式 package signing 全部通过前，不得启动 service 或开启 host pipe，也不得回退为 Desktop 当前用户进程。
