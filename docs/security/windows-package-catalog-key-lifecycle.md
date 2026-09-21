# Windows Package Catalog Key Lifecycle

## 信任分层

Windows package catalog signing key 不直接硬编码为永久静态 map。Runtime 只固化数量很少、离线保管的 Ed25519 root public key；root key 签署 `windows-package-catalog-key-policy/1`，该 policy 再授权短生命周期 catalog signing key。

root private key 不进入普通 release runner。catalog private key 可以在线于受保护的发布签名环境，但其泄露能够通过 root-signed policy 吊销，而无需接受用户配置或修改客户端。

## Policy 内容

policy 精确绑定：

- policy ID/version、product/channel、有效期；
- emergency-disable 状态；
- 按 key ID 排序且无重复的 catalog key 列表；
- 每个 key 的 raw Ed25519 public key、activation、retirement、可选 revoked-at 和低基数 revocation reason code。

key ID 只允许小写字母、数字、点、下划线和连字符；revocation reason 只允许小写低基数 code。任意自由文本、控制字符或秘密都不能进入安全审计。

## 状态规则

`SignedWindowsPackageKeyPolicyLoader` 使用 root-key pin 验证 canonical signature，并持久执行以下不可逆规则：

- policy version 单调增加；同版本内容不能重定义；
- 已出现的 key 不能从后续 policy 消失，退役/吊销 key 仍保留历史；
- 同一 key ID 的 public key 和 activation 不可改变；
- retirement 可以缩短，不能延长；
- 一旦出现 revoked-at/reason，后续版本不能删除、移动或改写，key 永远不能复活；
- root-key rotation 可以 overlap，但不能重置 policy version 或 key history。

每个成功版本写入 append-only `runtime_windows_package_key_policy_versions`，当前状态写入独立表。policy acceptance、每个新吊销以及 emergency disable/enable 转换与安全哈希链事件在同一 SQLite 事务提交。

## 生效语义

只有同时满足以下条件的 key 才返回给 catalog loader：

- policy 本身当前有效；
- emergency disable 为 false；
- 当前时间位于 key activation/retirement 窗口；
- 当前时间早于 revoked-at，或 key 从未吊销。

`SignedWindowsSecurityPackageCatalogLoader.from_verified_key_policy()` 是生产构造入口。它在构造时要求至少一个 active key，并在每次 `load()` 时重新计算 policy/key 状态；因此缓存 loader 不能在 key 退役、policy 过期或 emergency disable 后继续使用旧 key map。

## Rotation 与应急流程

正常 rotation：

1. root-signed policy 增加 new key，设定未来 activation；old/new overlap；
2. release runner 切到 new key，并提升 catalog version；
3. 观察所有受支持 Runtime 已取得新 policy；
4. 新 policy 缩短 old key retirement，历史 entry 不删除。

key compromise：

1. 使用离线 root key 发布更高版本 policy，设置精确 revoked-at/reason；
2. 如无法判断其他 key 安全性，设置 emergency disable；
3. Runtime 在任何 catalog 验证前加载新 policy；旧签名即使 cryptographically valid 也返回 key-untrusted/inactive；
4. 恢复必须发布新的 root-signed policy、增加新 catalog key 和更高 catalog version，不能清除旧 key 的 revoked 状态。

当前实现仍使用测试临时 root/catalog key。正式验收需要 HSM/offline ceremony、root rotation、分发延迟、时钟偏差、断网恢复和 emergency drill 证据。
