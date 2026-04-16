# 后台任务管理系统使用指南

## 概述

新的后台任务管理系统解决了长时间运行命令的进程泄漏和超时管理问题。支持：

1. **进程组管理** - 确保超时时所有子进程被正确终止
2. **后台执行** - 长时间任务可在后台运行，不阻塞对话
3. **任务查询与控制** - 前端可查看和控制后台任务
4. **优雅终止** - 先发送 SIGTERM，2秒后才使用 SIGKILL

## 核心功能

### 1. `run_bash` - 执行 Bash 命令

#### 前台执行（默认）
```python
# 普通命令，300秒超时
result = run_bash("ls -la")

# 自定义超时
result = run_bash("python train.py", timeout=600)
```

#### 后台执行
```python
# 启动后台任务
task_info = run_bash(
    cmd="python train.py --epochs 100",
    timeout=3600,  # 1小时超时
    run_in_background=True
)
# 返回: {
#   "task_id": "bash_task_0",
#   "status": "running",
#   "message": "Task bash_task_0 started in background (timeout: 3600s)",
#   "timeout": 3600
# }
```

### 2. `get_bash_task` - 查询任务状态

```python
status = get_bash_task("bash_task_0")
# 返回: {
#   "task_id": "bash_task_0",
#   "command": "python train.py --epochs 100",
#   "status": "running",  # running | completed | timeout | killed | failed
#   "pid": 12345,
#   "pgid": 12345,
#   "start_time": "2026-04-16T10:30:00.123456",
#   "end_time": "2026-04-16T11:30:00.123456",  # 完成后才有
#   "output": "训练完成...",  # 完成后才有
#   "error": "错误信息"  # 失败时才有
# }
```

### 3. `list_bash_tasks` - 列出所有任务

```python
tasks = list_bash_tasks()
# 输出:
# Bash Background Tasks:
#   bash_task_0: running - python train.py --epochs 100
#     PID: 12345, PGID: 12345
#   bash_task_1: completed - npm run build
#     PID: 12346, PGID: 12346
```

### 4. `kill_bash_task` - 终止任务

```python
# 优雅终止（SIGTERM -> SIGKILL）
result = kill_bash_task("bash_task_0")

# 强制终止（直接 SIGKILL）
result = kill_bash_task("bash_task_0", force=True)
```

## 超时处理改进

### 之前的问题

```python
# 超时后的问题：
run_bash("uvicorn main:app --reload")  # 300秒后超时

# 问题1: 只杀死 shell 进程，uvicorn 进程继续运行
# 问题2: reload 产生的子进程成为孤儿进程
# 问题3: 端口被占用，下次启动失败
# 问题4: 进程泄漏，消耗系统资源
```

### 现在的解决方案

```python
# 使用进程组管理
proc = subprocess.Popen(
    cmd,
    shell=True,
    preexec_fn=os.setsid  # 创建新会话
)
pgid = os.getpgid(proc.pid)

# 超时时杀死整个进程组
try:
    os.killpg(pgid, signal.SIGTERM)  # 先优雅终止
    time.sleep(2)  # 给2秒时间清理
    os.killpg(pgid, signal.SIGKILL)  # 强制杀死
except ProcessLookupError:
    pass  # 进程已退出
```

## 使用场景

### 场景 1：长时间服务启动

```python
# ❌ 错误做法：前台启动会超时
run_bash("uvicorn main:app --reload")  # 300秒后被杀

# ✅ 正确做法：后台启动
task = run_bash(
    "uvicorn main:app --host 0.0.0.0 --port 8000",
    timeout=3600,
    run_in_background=True
)
# 稍后查询状态
status = get_bash_task(task["task_id"])

# 不需要时终止
kill_bash_task(task["task_id"])
```

### 场景 2：长时间数据处理

```python
# 启动数据处理任务
task = run_bash(
    "python process_data.py --input large_dataset.csv",
    timeout=7200,  # 2小时
    run_in_background=True
)

# 定期检查进度
while True:
    status = get_bash_task(task["task_id"])
    if status["status"] == "completed":
        print(status["output"])
        break
    elif status["status"] in ["timeout", "failed", "killed"]:
        print(f"任务失败: {status.get('error')}")
        break
    time.sleep(60)  # 每分钟检查一次
```

### 场景 3：模型训练

```python
# 启动训练（可能需要几小时）
training_task = run_bash(
    "python train.py --model bert --epochs 100 --batch-size 32",
    timeout=14400,  # 4小时
    run_in_background=True
)

# 用户可以继续对话，不会被阻塞
# 训练完成后，可以查询结果
result = get_bash_task(training_task["task_id"])
```

### 场景 4：并发任务管理

```python
# 启动多个独立任务
tasks = []
for i in range(5):
    task = run_bash(
        f"python worker.py --job {i}",
        timeout=1800,
        run_in_background=True
    )
    tasks.append(task["task_id"])

# 等待所有任务完成
all_done = False
while not all_done:
    statuses = [get_bash_task(tid) for tid in tasks]
    all_done = all(s["status"] in ["completed", "failed", "timeout"] for s in statuses)
    time.sleep(10)

# 汇总结果
for tid in tasks:
    status = get_bash_task(tid)
    print(f"{tid}: {status['status']}")
```

## 前端集成

### 1. WebSocket 事件类型

新增 `BackgroundTaskEvent` 事件类型，前端可接收：

```typescript
interface BackgroundTaskEvent {
  type: "BackgroundTaskEvent";
  task_id: string;
  command: string;
  status: "running" | "completed" | "timeout" | "killed" | "failed";
  content: string | object;
  pid?: number;
  pgid?: number;
  start_time?: string;
  end_time?: string;
  timeout?: number;
  send_time_stamp: number;
}
```

### 2. 前端显示示例

```typescript
// 监听后台任务事件
socket.on('message', (event) => {
  if (event.type === 'BackgroundTaskEvent') {
    const task = event as BackgroundTaskEvent;
    
    switch (task.status) {
      case 'running':
        showNotification(`任务 ${task.task_id} 已启动`);
        addTaskToUI(task);
        break;
      case 'completed':
        showNotification(`任务 ${task.task_id} 已完成`, 'success');
        updateTaskInUI(task);
        break;
      case 'timeout':
        showNotification(`任务 ${task.task_id} 超时`, 'warning');
        updateTaskInUI(task);
        break;
      case 'failed':
        showNotification(`任务 ${task.task_id} 失败`, 'error');
        updateTaskInUI(task);
        break;
    }
  }
});
```

### 3. 任务控制面板

前端可以提供任务管理面板：

```typescript
// 查询所有任务
async function listTasks() {
  return await callTool('list_bash_tasks');
}

// 查询特定任务
async function getTaskStatus(taskId: string) {
  return await callTool('get_bash_task', { task_id: taskId });
}

// 终止任务
async function killTask(taskId: string, force: boolean = false) {
  return await callTool('kill_bash_task', { 
    task_id: taskId, 
    force 
  });
}
```

## 安全性

### 1. 危险命令检测

以下命令模式会被阻止：
- `sudo`, `su` - 提权命令
- `rm -rf /`, `find -delete` - 危险删除
- `killall` - 已在危险模式列表中
- `shutdown`, `reboot` - 系统控制

### 2. 工作区隔离

所有命令只能在允许的工作目录内执行：
```python
only_in_workspace = True  # 默认开启
ALLOWED_DIRS = [WORKDIR] + extra_dirs
```

### 3. 超时限制

```python
# 超时被限制在 10-600 秒之间
timeout = min(max(10, timeout), 600)
```

## 最佳实践

### ✅ 推荐做法

1. **长时间服务使用后台模式**
   ```python
   run_bash("uvicorn main:app", run_in_background=True)
   ```

2. **设置合理的超时时间**
   ```python
   # 训练任务可能需要几小时
   run_bash("python train.py", timeout=14400, run_in_background=True)
   ```

3. **定期清理完成的任务**
   ```python
   tasks = list_bash_tasks()
   # 删除已完成的任务记录（如果需要）
   ```

4. **使用进度查询而非轮询**
   ```python
   # ✅ 好的做法
   task_id = run_bash("long_process", run_in_background=True)["task_id"]
   # 稍后查询
   status = get_bash_task(task_id)
   
   # ❌ 避免频繁轮询
   while get_bash_task(task_id)["status"] == "running":
       time.sleep(0.1)  # 太频繁
   ```

### ❌ 避免做法

1. **不要对短命令使用后台模式**
   ```python
   # ❌ 不必要
   run_bash("ls -la", run_in_background=True)
   
   # ✅ 直接执行
   run_bash("ls -la")
   ```

2. **不要忽略超时设置**
   ```python
   # ❌ 可能导致永久挂起
   run_bash("infinite_loop.sh", timeout=600)  # 仍会在600秒后终止
   ```

3. **不要手动管理后台进程**
   ```python
   # ❌ 会导致进程泄漏
   run_bash("nohup python app.py &")
   
   # ✅ 使用后台模式
   run_bash("python app.py", run_in_background=True)
   ```

## 故障排除

### 问题 1：任务超时但进程仍在运行

**原因**：可能是进程组管理失败

**解决**：
```python
# 手动终止
kill_bash_task(task_id, force=True)

# 或者使用系统命令查找并杀死
run_bash(f"ps aux | grep {pid}")
run_bash(f"kill -9 {pid}")
```

### 问题 2：端口已被占用

**原因**：之前的服务进程未正确终止

**解决**：
```python
# 查找占用端口的进程
run_bash("lsof -i :8000")

# 杀死进程
run_bash("kill -9 $(lsof -t -i :8000)")
```

### 问题 3：任务列表太长

**原因**：历史任务未清理

**解决**：需要在 `operater_funs.py` 中实现清理函数
```python
def clear_bash_tasks(status: str = None):
    """清理已完成的任务"""
    if status:
        to_remove = [tid for tid, info in _bash_tasks.items() 
                     if info["status"] == status]
    else:
        to_remove = [tid for tid, info in _bash_tasks.items() 
                     if info["status"] in ["completed", "failed", "timeout", "killed"]]
    
    for tid in to_remove:
        del _bash_tasks[tid]
    
    return f"Cleared {len(to_remove)} tasks"
```

## 未来改进方向

1. **任务持久化** - 将任务状态保存到数据库，重启后恢复
2. **任务日志流式传输** - 实时传输任务输出到前端
3. **任务依赖管理** - 支持任务间的依赖关系
4. **资源限制** - CPU、内存使用限制
5. **任务优先级** - 支持任务队列和优先级调度
6. **自动重试** - 失败任务自动重试
7. **任务通知** - 任务完成时的主动通知机制

## 总结

新的后台任务管理系统通过以下改进解决了原有问题：

1. ✅ **进程组管理** - 使用 `os.setsid()` 确保所有子进程被正确管理
2. ✅ **优雅终止** - SIGTERM → 等待 → SIGKILL 三步终止流程
3. ✅ **后台执行** - 支持长时间任务不阻塞对话
4. ✅ **任务查询** - 前端可实时查询任务状态
5. ✅ **任务控制** - 前端可主动终止失控任务
6. ✅ **事件通知** - 通过 WebSocket 通知前端任务状态变化

这些改进确保了系统的稳定性和用户体验。
