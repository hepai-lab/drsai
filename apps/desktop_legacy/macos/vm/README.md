# OpenDrSai macOS VM 验收 Harness

本目录实现 `docs/desktop/macos/macos-v1.5.8-beta-vm-automation-acceptance-plan.md`。当前先落地 P0：宿主机 preflight、固定 Tart 版本、基础镜像配置和一次性 VM 生命周期验证。

## 当前状态

- Tart 固定为 `2.32.1`；
- 当前开发机是 Apple Silicon/macOS 26/16 GiB；
- 宿主机 preflight 已通过，基础镜像下载后仍保有足够空间；
- macOS 26 基础镜像已经下载并封存为 `opendrsai-pristine-macos26`；
- 固定 guest 为 macOS `26.6.1` / Build `25G76`；
- 固定 OCI digest 为 `sha256:1214590cd279a1ff82897d802624362ced1ff960d7b9f99a6ced5bbf8071e319`。

## 宿主机准备

推荐将 Tart 数据放在单独的 APFS 外置 SSD，并至少预留 150 GiB。不要把 VM 放进 Git 仓库。

```bash
export TART_HOME="/Volumes/OpenDrSai-QA/tart"
mkdir -p "$TART_HOME"
cd /path/to/drsai
nvm use
cd apps/desktop
npm run verify:beta:vm:preflight --workspace opendrsai-macos-desktop
```

若使用系统盘，则不设置 `TART_HOME`，Tart 默认使用 `~/.tart`。系统盘可用空间仍须至少 80 GiB，建议 100 GiB。

preflight 会检查：

- Apple Silicon、macOS 和内存；
- Virtualization.framework；
- Node、Xcode、签名、公证、DMG、SSH 和摘要工具；
- Tart 精确版本；
- `TART_HOME` 是否位于仓库外、是否可写、剩余空间是否达标；
- Tart home 是否能正常初始化和列出镜像。

## P0 生命周期

首次 bootstrap 下载完成后，先配置并封存基础镜像：

```bash
npm run prepare:beta:vm:base --workspace opendrsai-macos-desktop
```

该命令会把基础镜像配置为 4 vCPU、6 GiB RAM、70 GiB 稀疏磁盘，启动 guest 后核对 macOS 版本、build、arm64、自动化用户和 OpenDrSai 残留，并写出 `build/acceptance/macos-vm/base-images/macos26-pristine.json`。确认 receipt 后，必须将 guest 版本/build 和 OCI digest 回填 `images.json`，才能作为正式验收基线。

基础镜像准备并封存后，查看生命周期计划：

```bash
npm run verify:beta:vm:p0 --workspace opendrsai-macos-desktop -- --dry-run
```

执行 5 轮一次性 VM 验收：

```bash
npm run verify:beta:vm:p0 --workspace opendrsai-macos-desktop
```

每轮执行：

1. 从 `opendrsai-pristine-macos26` 本地基础镜像 clone；
2. 配置 4 vCPU、6 GiB RAM 和独立随机 MAC；
3. 使用无图形、无音频、无剪贴板和 Tart 标准共享 NAT 启动；
4. 通过 Tart Guest Agent 检查 macOS 版本、build 和 arm64 架构；
5. 关机并删除一次性 clone；
6. 将结构化结果写入 `build/acceptance/macos-vm/p0/<runId>/summary.json`。

失败时仍默认清理 VM。仅人工诊断时可使用 `--keep-failed`，诊断结束后必须手动删除对应 `opendrsai-p0-*` VM。

## 安全边界

- P0 脚本不会自动拉取浮动远端镜像；
- 永远不会删除 `images.json` 配置的基础镜像；
- 不在基础镜像中保存生产凭据、签名私钥或真实账号密码；
- 正式验收必须使用固定 digest，不能直接消费 `latest`；
- VM 共享目录默认只读，后续场景仅通过专用证据目录导出结果。

本机 P0 使用 Tart 标准共享 NAT。Softnet 需要 root 权限或专用发布机配置，本方案不会为了启用它而给开发账号配置无密码 sudo；迁移到 self-hosted 发布 Mac 后，再把 Softnet 作为增强网络隔离门禁启用。

## P1 最终 DMG 验收

P1 只接受最终候选 OSS/CDN 字节，不接受本地开发 App 或旧版本 DMG。先做无网络 dry-run：

```bash
npm run verify:beta:vm:p1 --workspace opendrsai-macos-desktop -- \
  --url "https://download-opendrsai.ihep.ac.cn/releases/v1.5.8-beta.2/macos/OpenDrSai-macOS-v1.5.8-beta.2-arm64.dmg" \
  --sha256 "<64 位小写 SHA-256>" \
  --commit "<40 位完整 Git commit>" \
  --version "1.5.8-beta.2" \
  --dry-run
```

去掉 `--dry-run` 后执行真实验收。runner 会：

1. 强制 HTTPS、批准域名、不可变文件名、完整 SHA/commit/version；
2. 从固定 digest 的 pristine 镜像创建一次性 VM；
3. guest 内下载 DMG 并校验 SHA-256；
4. 校验 codesign、Gatekeeper、App/DMG staple 和 Bundle 版本；
5. 比较 App build metadata、Runtime provenance 与预期 commit/version；
6. 安装至 `/Applications`，黑盒启动，通过 Tart VNC 新增窗口定向截图，退出并检查残留进程；
7. 导出 receipt、启动日志和截图，最后删除 clone。

v1.5.8-beta.2 已在固定 digest 的 pristine macOS 26.6.1 VM 中完成真实 P1；证据位于 `build/acceptance/macos-vm/p1/2026-08-14T03-45-25-467Z-cda14a/`。
