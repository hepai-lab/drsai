# 挂载 gfs 桶到本地目录

挂载后可像访问本地目录一样读写远端对象存储。jcli 用 FUSE 实现，所以需要 FUSE 用户态工具 + 内核能开 `/dev/fuse`。

## hai-k8s 容器（最常见环境）

容器里有 `haik8s-fuse-doctor` 自检工具，先跑它定位问题：

```bash
haik8s-fuse-doctor
```

三段输出对应三个前提条件，按下表处理：

| 输出 | 含义 | 处理 |
|------|------|------|
| `[OK] /dev/fuse 存在且为字符设备` | 设备就位 | — |
| `[ERR] /dev/fuse 不存在` | Pod spec 没开 enable_fuse | 去前端「应用配置 → 存储配置 → 启用 FUSE 挂载」勾选，保存后**停止 + 启动**实例（不是 exec 重启） |
| `[WARN] fusermount 未安装` | 缺用户态工具 | `sudo apt-get install -y fuse3` |
| `[ERR] /dev/fuse 无法 open` | 设备存在但 device cgroup 阻断 | 联系管理员确认 Pod spec 的 hostPath 是 `type: CharDevice`（少了这个 CRI 不会更新 cgroup 白名单） |
| 三段全 OK | 就绪 | 跳到下面「挂载」 |

### 挂载

```bash
export PATH=$PATH:$HOME/bin
mkdir -p ~/gfs_mount
jcli mount -f ~/gfs_mount --daemon
ls ~/gfs_mount                # 看到桶内文件即成功
df -h | grep gfs_mount        # 看挂载状态
```

### 卸载

```bash
umount ~/gfs_mount            # 个人挂载点
sudo umount ~/gfs_mount       # 必要时用 sudo
```

### Pod 重启后

容器重建会丢失：apt 装的 `fuse3`、`/etc/passwd` 等系统改动、挂载点。但 `~/bin/jcli` 和 `~/.jcli/` 配置在 lustre 上不丢。重启后跑：

```bash
sudo apt-get install -y fuse3
export PATH=$PATH:$HOME/bin
mkdir -p ~/gfs_mount
jcli mount -f ~/gfs_mount --daemon
```

## 原生 Linux（非容器）

```bash
# 装 FUSE（按发行版二选一）
sudo apt-get install -y fuse3              # Debian/Ubuntu
sudo yum install -y fuse fuse3             # CentOS/openEuler

# 挂载
mkdir -p ~/gfs_mount
jcli mount -f ~/gfs_mount --daemon
```

### 指定桶和权限挂载

默认挂载用 `jcli config` 配的默认桶。需要换桶或定制权限：

```bash
jcli mount -f {挂载点} \
    -bucket {桶名} \
    -mode-mnt 0770 \       # 挂载点目录权限
    -mode-mnt-uid 0 \      # 挂载点 owner uid
    -mode-mnt-gid 1000 \   # 挂载点 owner gid
    -mode-uid 0 \          # 桶内文件 uid
    -mode-gid 1000 \       # 桶内文件 gid
    --daemon
```

挂载后修改文件权限/所有者：

```bash
jcli chmod 0644 {挂载点}/{文件}
jcli chown root {挂载点}/{文件}
```

## Windows（NetMount）

不用 jcli，用 [NetMount](https://www.netmount.cn/) 图形客户端：

1. 装 NetMount（首次挂载时会自动安装 WinFsp 驱动）
2. **管理 → 添加 → 存储类型 S3**，填：
   - Endpoint: `https://fgws3-gfs.ihep.ac.cn`
   - Access Key ID / Secret：从网页密钥管理页获取
   - Bucket：你的桶名
   - Region：留空或 `default`
3. **挂载 → 添加 → 选刚加的 S3 存储 → 本地磁盘 → 盘符 Z:**
4. 「此电脑」里出现盘符即成功

> 重启电脑后需重新挂载，NetMount 设置里可开「开机自动挂载」。

## macOS

```bash
# 装 MacFUSE: https://macfuse.github.io/
mkdir -p ~/gfs_mount
jcli mount -f ~/gfs_mount --daemon
```

## 排障速查

| 错误信息 | 原因 | 处理 |
|----------|------|------|
| `fusermount: executable file not found` | 没装 FUSE 用户态工具 | `sudo apt-get install fuse3` |
| `fuse: device not found, try 'modprobe fuse'` | 内核模块未加载 | 联系管理员，容器内通常已加载，看 `/proc/filesystems` 有 `fuse` 即 OK |
| `failed to open /dev/fuse: Operation not permitted` | device cgroup 阻断 | Pod spec 缺 `hostPath: type=CharDevice`，重启实例或联系管理员 |
| 挂载命令"成功"但目录为空 | daemon 进程退出了 | 去掉 `--daemon` 前台跑看错误，常见仍是 FUSE 问题 |
| `umount: target is busy` | 有进程占用挂载点 | `cd` 离开挂载点，或 `lsof ~/gfs_mount` 找占用者 |
