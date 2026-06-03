---
name: ihep-gfs-skill
description: 当用户需要操作高能所 gfs 对象存储（jwanfs/jcli）时立即使用。覆盖：安装 jcli、配置认证、上传/下载/同步文件、挂载存储桶为本地目录、Pod 重启后重新挂载、FUSE 相关排障。
allowed-tools: Bash(jcli:*) Bash(curl:*) Bash(wget:*) Bash(haik8s-fuse-doctor:*) Bash(umount:*) Bash(sudo apt-get:*) Bash(sudo yum:*) Bash(df:*) Bash(ls:*) Bash(mkdir:*)
---

# 高能所 gfs 对象存储

操作高能所基于 JWanFS 构建的对象存储，命令行客户端是 `jcli`。

| 关键参数 | 值 |
|----------|----|
| 网页入口 | https://gfs.ihep.ac.cn/ |
| Endpoint | `https://fgws3-gfs.ihep.ac.cn` |
| 默认配额 | 1 TB/用户 |
| 配置文件 | `~/.jcli/token/auth` |

## 快速流程

```bash
# 1. 装 jcli（首次或 Pod 重建后）
[ -x $HOME/bin/jcli ] || {
    mkdir -p $HOME/bin
    wget -q https://file-ocloud.ihep.ac.cn/jcli/amd64/jcli -O $HOME/bin/jcli
    chmod +x $HOME/bin/jcli
}
export PATH=$PATH:$HOME/bin

# 2. 写认证（覆盖式，需要桶名）
jcli config -ak {AK} -sk {SK} -endpoint https://fgws3-gfs.ihep.ac.cn \
            -bucket {BUCKET} -default -f

# 3. 验证（应列出桶内文件）
jcli ls
```

**首次不知道桶名时**：先 `jcli auth` 交互式运行，输入 AK/SK/Endpoint 后系统会列出可用桶（按 Ctrl+C 终止即可获得桶名），然后回到上面步骤 2 用 `jcli config` 持久化。

## 常用操作

```bash
jcli ls [{桶}/{路径}]                          # 列文件
jcli put {本地} {桶}/{远端}                     # 上传（-r 递归）
jcli get {桶}/{远端} {本地}                     # 下载（-r 递归）
jcli rm {桶}/{路径}                             # 删除（-r 递归）
jcli sync {本地目录} {桶}/{远端目录}             # 同步（双向均可）
jcli cp / mv {桶}/{源} {桶}/{目标}              # 复制/移动
jcli stat / du / cat / head / tail              # 查信息/算大小/看内容
jcli quota {桶}                                 # 查配额
```

完整命令清单见 [references/commands.md](references/commands.md)。

## 挂载为本地目录

把桶挂成 `~/gfs_mount`，之后像本地目录一样读写：

```bash
mkdir -p ~/gfs_mount
jcli mount -f ~/gfs_mount --daemon
ls ~/gfs_mount                # 看到桶内文件即成功
umount ~/gfs_mount            # 卸载
```

**挂载失败**（容器/FUSE 相关错误）→ 见 [references/mount.md](references/mount.md)，里面包含 hai-k8s 容器、原生 Linux、Windows（NetMount）、macOS 的完整流程和排障。

## hai-k8s 容器内的注意事项

- **Pod 重启后挂载和 fuse3 都会丢**：jcli 装在 `$HOME/bin` 通过 lustre 持久化，但 `fuse3` 是 apt 装的会消失，挂载点也会消失。重启后重跑「快速流程」+「挂载」即可。
- **`haik8s-fuse-doctor` 是内置 FUSE 自检工具**，三段输出直接定位问题（详见 mount.md）。
- **enable_fuse 开关**：hai-k8s v1.0.37+ 的应用配置里需勾选「启用 FUSE 挂载」，重启实例后 `/dev/fuse` 才会被 CRI 加入 cgroup 白名单。
