# Windows Installer Filesystem Actions

## 安全目标

`WindowsInstallerFilesystemActionJournal` 把 package copy、旧版本 quarantine、新版本 promote 和 rollback 从不可审计的文件操作变成持久状态机。它不删除旧版本或失败版本；不确定状态优先保留数据并保持 service disabled。

该模块位于 Runtime security boundary，只能绑定现有 `WindowsInstallerOperation`，不接受 Agent、Workspace、Gateway、Electron、TUI、WebUI 或模型输出作为安装 authority。

## 路径布局

每个 operation 使用目标安装目录的同级 transaction root：

```text
<install-parent>/.opendrsai-windows-fs-<operation-id>/
  staging/
  quarantine/
  failed-promoted/
```

`staging` 与最终 install root 位于同一卷，目录切换使用 Windows `MoveFileExW(MOVEFILE_WRITE_THROUGH)`。目标存在时不覆盖。非 Windows 测试实现使用 rename 并 fsync parent directory。

package source 可以位于另一卷，因为 artifact 是复制到目标卷；禁止的是 staging/promote rename 跨卷。

## Windows ACL policy

ACL policy identity由排序后的 `trusted_writer_sids` 和精确 service SID 计算 SHA-256，并写入 action row。重启或恢复时传入不同 writer/service 集合会在任何文件操作前返回 `windows_installer_action_acl_policy_mismatch`。

- 创建 transaction root 前验证其 parent 不是 reparse point，owner 必须是 trusted writer、SYSTEM、Administrators 或 Windows Modules Installer，且不存在其他 identity 的 write/delete/ACL-takeover allow ACE；
- transaction root 使用 protected DACL，仅 trusted installer writer 有 full control，service 无访问权；
- staging/promoted root 使用 protected DACL，trusted writers 有 full control，service SID 仅 generic read/execute；
- 每个 artifact 在 copy+digest 后改为显式 protected DACL，禁止依赖 inherited child ACL；
- owner 必须属于 trusted writer；若 SYSTEM 在 writer policy 中则 owner 固定为 SYSTEM；
- ACL 只允许标准 allow ACE、精确 mask、精确 OI/CI flags，不允许额外 writer、重复 SID、继承 ACE 或未知 object ACE；
- old install tree 在 prepare 时复验，staging tree 在移动旧版本前复验，每次 rename 后再次递归验证 root 和全部 artifact。

DPAPI bootstrap envelope 的 service SID 可以写自己的 envelope，但 Runtime service 对安装树始终只有 read/execute，不能替换 executable、metadata、policy 或 ACL。

## Artifact staging

- 输入只接受唯一 basename 和 canonical SHA-256；artifact-set digest 对按 filename 排序后的 inventory 做 canonical JSON hash。
- package root、transaction root、每个 source/destination 必须是普通目录或普通文件；symlink、junction 和其他 reparse point 拒绝。
- destination 使用 create-new；已有部分 staging 只在 digest 完全一致时幂等采用，不覆盖不同内容。
- copy 使用 partial-write loop 和 file fsync；复制后同时验证 source identity/size/mtime 未变化、source digest 和 destination digest。
- staging 完成后要求目录 inventory 与签名输入精确相等，并持久记录 staging directory 的 volume/file identity。
- 只有 journal 仍是 `safe_disabled` 才能 staging；只有 exact artifact-set digest 已写入 installer journal 的 `artifacts_staged` 状态才能 promote。

## Promotion

升级顺序固定为：

1. 验证 staging identity 未被替换；
2. 将原 install root 原子 rename 到 `quarantine`；
3. 再次以持久 identity 确认旧版本；
4. 将 staging 原子 rename 为 install root；
5. 证明新 install root identity 等于原 staging identity；
6. package/SCM verification 和 installer commit 后，再把 filesystem action 标为 committed。

quarantine 已存在、staging 被替换、原目录 identity 消失、目标路径出现未知目录或跨卷时全部拒绝。`mark_committed()` 还会重新证明 install root 是 staged identity，且升级时 quarantine 仍是 original identity。

## Crash 与 rollback

SQLite writer transaction 覆盖每个 rename；进程被终止时 DB transaction 回滚，但已经完成的原子 rename 可能保留。恢复不依赖旧 state 猜测，而是比较 install/staging/quarantine/failed 四个路径的持久 volume/file identity：

- crash 在 old→quarantine 后：可继续 promote，或把 original identity 恢复到 install root；
- crash 在 staging→install 后：rollback 先把 staged identity 移回 staging/failed，再恢复 original；
- 新安装 rollback：promoted identity 移回 staging，最终 install root 消失，但内容保留；
- quarantine 被替换：不会把未知目录恢复为正式安装；action 与 installer operation 都进入 rollback-failed；
- rollback 重复执行幂等；installer journal 与 filesystem action 使用同一 SQLite transaction，避免 callback 再开 writer 导致锁反转或部分提交。

旧版本和失败新版本不会自动递归删除。后续 cleanup 必须是独立、身份绑定、可审计的 retention 操作。

## 当前限制

- native ACL 创建与精确复验已经实现；SYSTEM-owner 场景仍须 elevated installer runner 验收，当前本机原生测试使用当前用户作为临时 trusted writer验证 mask/ACE/parent-tamper 行为，未冒充 SYSTEM 证据。
- 尚未实现 CreateService/register snapshot/restore。
- 尚未运行 elevated Program Files、真实磁盘满、SQLite IOERR/CORRUPT 和逐阶段外部进程 kill runner。
