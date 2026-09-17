# Windows Installer SCM Actions

## 安全目标

`WindowsInstallerScmActionJournal` 将 service missing/existing snapshot、CreateService、disabled registration、SID/delayed-start 配置、owned delete 和 exact restore 变成持久 action。它与 filesystem action 一样绑定既有 installer operation，不接受客户端、Agent 或模型 authority。

## Pre-disable snapshot

Installer begin 必须先停止并 disable 旧服务，但恢复升级前配置需要知道修改前 start type。`NativeWindowsInstallerSafetyController` 现在在修改前读取 start type，并将以下 evidence 写入 `WindowsInstallerOperation`：

- `prior_service_registered`；
- `prior_service_start_type`，只能是 automatic、manual、disabled；service 不存在时必须是 null。

旧数据库启动时通过 additive SQLite migration 增加这两个字段。SCM action 在 begin 之后读取其余当前配置，并用 operation 中的 pre-disable start type重建完整旧 snapshot，避免把 installer 临时写入的 disabled 误当作升级前产品配置。

## Durable identity

SCM action 持久绑定：

- operation/action ID 和 service name；
- prior registered/missing；
- prior binary、account、start type、service type、SID type、delayed-auto-start、description；
- desired promoted binary 和 installer-safe disabled 配置；
- snapshot/desired canonical SHA-256；
- operation-specific ownership marker：`OpenDrSai installer ownership/<operation-id>`。

SQLite trigger 禁止修改上述 identity 字段；只有 state、error 和 timestamp 可更新。每次读取 action 还会重新计算两个 digest并验证 marker，不能通过直接写数据库重新定义 snapshot 或 desired service。

## Registration

顺序为：

1. installer operation 必须处于 `artifacts_staged`，binary 必须是 promoted install root 内的现存绝对文件；
2. existing service 必须与 pre-change snapshot 完全相同，仅 start type允许是 safety controller 写入的 disabled；missing snapshot 后出现同名 service 则视为 collision；
3. action 先 durable 写入 `prepared/registering`；
4. 新服务使用 `CreateServiceW` 创建为 LocalSystem、own-process、disabled；旧服务只在 snapshot仍精确匹配时调用 `ChangeServiceConfigW`；
5. `ChangeServiceConfig2W` 写入 unrestricted/restricted service SID type、delayed-auto-start 和 ownership marker；
6. 回读 SCM，只有 desired config + exact marker 全部一致才进入 `registered`；
7. installation verifier 和 installer commit 后，重新回读 exact disabled owned service才允许 action committed。

Native adapter 不接受参数化 binary、相对路径、环境变量展开或多重 quoting。当前实现只支持不需要密码材料的 LocalSystem own-process service。

## Crash recovery 与所有权

- CreateService/ChangeService 完成、DB commit 前崩溃：重启仅在当前 config 和 marker 精确匹配时采用；同名但无 marker 的服务不采用。
- 新安装 rollback：只有 marker、binary、SID、account、disabled state 和全部 desired config 均匹配时才调用 DeleteService；marker 丢失或配置漂移时保留未知 service并进入 rollback-failed。
- 升级 rollback：marker 仍在时恢复完整旧 snapshot；若 restore 已完成但进程在 DB commit 前崩溃，下一次 safety recovery会把旧服务再次 disabled，此时只接受“旧 snapshot 除 start type=disabled 外逐字段完全一致”的状态并再次恢复。
- restore/delete/register 失败或 ownership 无法证明时调用 safety controller，要求 service disabled、stopped、PID=0；无法证明安全状态不会报告成功。
- DeleteService 后有界轮询，必须确认服务对象消失；marked-for-delete 不等于删除完成。

SCM action 可作为 installer journal 的 transactional rollback handler，复用同一 SQLite writer connection，action 与 operation 的 rolled-back/rollback-failed 结果原子提交。

## 当前限制

- Native missing-service inspection 在本机真实运行，但当前非 elevated 测试没有创建或删除真实 Windows service；CreateService/restore/delete 仍须专用管理员 runner 验收。
- 尚未把 filesystem、SCM、installation verify、envelope 和 final activation组合为单一 installer coordinator。
- 尚缺 SCM API fault injection、系统重启、marked-for-delete 长尾和真实服务 handle 泄漏测试。
