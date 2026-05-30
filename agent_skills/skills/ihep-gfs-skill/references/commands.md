# jcli 命令完整清单

`jcli` 内置 `jcli help` 和 `jcli help {命令}`，下表是高频命令速查。所有命令默认作用于 `jcli config` 配置的默认桶，加 `-bucket {桶名}` 可临时切换。

## 文件操作

| 命令 | 别名 | 说明 |
|------|------|------|
| `jcli ls [{路径}]` | `list`, `ll` | 列文件。`-l` 详细信息 |
| `jcli put {本地} {远端}` | `push`, `upload` | 上传。`-r` 递归上传目录 |
| `jcli get {远端} {本地}` | `pull`, `download` | 下载。`-r` 递归下载目录 |
| `jcli rm {远端}` | `delete`, `del` | 删除。`-r` 递归删除目录 |
| `jcli cp {源} {目标}` | `copy` | 桶内/跨桶复制 |
| `jcli mv {源} {目标}` | `move`, `rename` | 移动或重命名 |
| `jcli sync {源} {目标}` | — | 同步目录，自动跳过未变更文件，支持断点续传。大文件批量传输优先用它 |
| `jcli mkdir {路径}` | — | 创建目录 |

## 查看与计算

| 命令 | 说明 |
|------|------|
| `jcli cat {文件}` | 输出文件全部内容 |
| `jcli head {文件}` | 文件首部 |
| `jcli tail {文件}` | 文件尾部 |
| `jcli stat {路径}` | 文件/目录元信息（大小、修改时间、ETag） |
| `jcli du {路径}` | 计算目录占用大小 |
| `jcli md5sum {文件}` | 计算 MD5 |
| `jcli etag {文件}` | 计算 ETag（用于校验上传一致性） |
| `jcli quota [{桶}]` | 查看桶配额和已用空间 |

## 权限管理（挂载场景）

| 命令 | 说明 |
|------|------|
| `jcli chmod {mode} {路径}` | 修改对象权限位 |
| `jcli chown {user} {路径}` | 修改对象 owner |

## 认证与配置

| 命令 | 说明 |
|------|------|
| `jcli auth` | 交互式配置（首次推荐，会列出可用桶） |
| `jcli auth -e` | 重置并重新配置 |
| `jcli config -ak {AK} -sk {SK} -endpoint {URL} -bucket {桶} -default -f` | 非交互式覆盖写入配置（脚本/自动化用） |
| `jcli config -a` | 查看所有已保存的认证配置 |
| `jcli config -delete` | 删除当前认证配置 |
| `jcli expire` | 查看 AK/SK 过期时间 |
| `jcli token` | 创建临时 AK/SK |

## 挂载与服务

| 命令 | 说明 |
|------|------|
| `jcli mount -f {挂载点} --daemon` | 后台挂载（见 mount.md） |
| `jcli ftp` | 启动 FTP 服务供局域网访问 |
| `jcli file-server` | 启动 HTTP 文件服务器 |
| `jcli cron` | 定时任务管理（备份、同步） |

## 全局参数

加在子命令前，可临时覆盖配置：

```bash
jcli -ak {AK} -sk {SK} -endpoint {URL} -bucket {桶} {子命令}
```

| 参数 | 说明 |
|------|------|
| `-ak` / `-sk` | 临时认证 |
| `-endpoint` | 临时切换网关 |
| `-bucket` | 临时切换桶 |
| `-auth {文件}` | 用指定的认证文件 |

## 桶管理

桶的创建、删除、扩容、回收站都在网页 https://gfs.ihep.ac.cn/ 操作。

- 桶名规则：小写字母 + 数字 + 短划线，以字母或数字开头结尾
- 删除文件进回收站，默认保留 30 天
- 新账户默认 1 TB 配额

## 官方文档

- jwanfs 手册：https://docs.jwanfs.com/docs/guide
- 网页管理端：https://gfs.ihep.ac.cn/
