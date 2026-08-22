## 16 定时任务与通知推送

### 16.1 远程 Worker 模式

配置了 Worker URL (`--url` 或 `cfg.url`) 时，CLI 启动远程定时任务管理：

```
drsai --url http://localhost:42858/apiv2
# → ✓ 定时任务已连接到 worker
# → ✓ 通知轮询已启动 (每30秒)
```

- `RemoteScheduledTaskManager`: 定时任务委托给后台 Worker 进程执行
- 后台轮询器: 每 30 秒检查 Worker 的 `/notifications` 接口
- 有通知时打印到终端：

```
  ✅ 定时任务通知: nightly-build — 成功 (2026-03-01 03:00)
    构建完成，所有测试通过
```

### 16.2 本地模式

无 Worker URL 时，定时任务推送不可用，终端提示：

```
  ℹ 定时任务推送需要 worker 后端 (配置 --url)
```

---

---

