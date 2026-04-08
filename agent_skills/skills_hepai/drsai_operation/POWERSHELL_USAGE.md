# PowerShell 功能使用说明

## 新增的 PowerShell 工具函数

基于 Claude Code 的 PowerShellTool 实现，新增了3个 PowerShell 相关函数：

1. `run_powershell` - 执行 PowerShell 命令
2. `get_powershell_task` - 获取后台任务状态
3. `list_powershell_tasks` - 列出所有后台任务

---

## 1. run_powershell - 执行 PowerShell 命令

执行 PowerShell 命令，支持前台和后台运行。

### 函数签名

```python
def run_powershell(
    command: str,
    timeout: int = 300,
    run_in_background: bool = False,
    dangerous_allowed: bool = False
) -> Union[str, Dict[str, Any]]
```

### 参数说明

- **command** (str, 必需): 要执行的 PowerShell 命令
- **timeout** (int, 默认300): 超时时间（秒），范围 1-600
- **run_in_background** (bool, 默认False): 是否后台运行
  - `False`: 前台运行，等待完成后返回输出
  - `True`: 后台运行，立即返回任务ID
- **dangerous_allowed** (bool, 默认False): 是否允许危险命令

### 返回值

**前台运行** (`run_in_background=False`)：
```python
# 返回字符串 - 命令输出
"file1.txt\nfile2.txt\nfile3.txt"
```

**后台运行** (`run_in_background=True`)：
```python
# 返回字典 - 任务信息
{
    "task_id": "ps_task_0",
    "status": "running",
    "message": "Task ps_task_0 started in background"
}
```

### 基本使用示例

```python
# 1. 简单命令执行
result = run_powershell("Get-Date")
print(result)
# 输出: 2024-01-15 10:30:45

# 2. 列出文件
files = run_powershell("Get-ChildItem -Name")
print(files)
# 输出: file1.txt
#       file2.txt

# 3. 获取系统信息
info = run_powershell("$PSVersionTable.PSVersion")
print(info)
# 输出: Major  Minor  Build  Revision
#       7      4      0      -1

# 4. 执行多行脚本
script = """
$files = Get-ChildItem -Filter *.py
Write-Output "Found $($files.Count) Python files"
"""
result = run_powershell(script)
print(result)
```

### 工作目录持久化

PowerShell 的工作目录在调用之间保持持久：

```python
# cd 命令会影响后续调用
run_powershell("Set-Location src")

# 当前目录已经是 src
result = run_powershell("Get-Location")
print(result)  # 输出: /path/to/workspace/src

# 后续命令都在 src 目录执行
files = run_powershell("Get-ChildItem -Name")
```

### 超时控制

```python
# 快速命令 - 10秒超时
result = run_powershell("Get-Process", timeout=10)

# 长时间运行 - 10分钟超时
result = run_powershell("Start-Job -ScriptBlock {...}", timeout=600)

# 超时会返回错误信息
result = run_powershell("Start-Sleep -Seconds 100", timeout=5)
print(result)  # Error: Command timeout after 5s
```

### 后台运行

长时间运行的任务可以在后台执行：

```python
# 启动后台任务
task = run_powershell(
    "Start-Sleep -Seconds 30; Write-Output 'Done'",
    run_in_background=True
)
print(task)
# {'task_id': 'ps_task_0', 'status': 'running', 'message': '...'}

# 继续执行其他工作...
other_result = run_bash("ls -la")

# 稍后检查任务状态
status = get_powershell_task(task['task_id'])
print(status)
```

---

## 2. get_powershell_task - 获取后台任务状态

查询后台 PowerShell 任务的状态和输出。

### 函数签名

```python
def get_powershell_task(task_id: str) -> Dict[str, Any]
```

### 参数说明

- **task_id** (str): 任务ID（由 `run_powershell` 返回）

### 返回值格式

任务状态字典：

```python
# 运行中
{
    "task_id": "ps_task_0",
    "status": "running"
}

# 成功完成
{
    "task_id": "ps_task_0",
    "status": "completed",
    "output": "命令输出内容..."
}

# 失败
{
    "task_id": "ps_task_0",
    "status": "failed",
    "error": "错误信息..."
}

# 任务不存在
{
    "task_id": "ps_task_999",
    "status": "not_found",
    "error": "Task ps_task_999 not found"
}
```

### 使用示例

```python
# 启动长时间运行的任务
task = run_powershell(
    """
    Write-Output "Starting analysis..."
    Start-Sleep -Seconds 10
    Get-Process | Measure-Object
    Write-Output "Analysis complete"
    """,
    run_in_background=True
)

task_id = task['task_id']

# 轮询检查状态
import time
while True:
    status = get_powershell_task(task_id)
    print(f"Status: {status['status']}")

    if status['status'] == 'completed':
        print("Output:", status['output'])
        break
    elif status['status'] == 'failed':
        print("Error:", status['error'])
        break

    time.sleep(2)
```

---

## 3. list_powershell_tasks - 列出所有后台任务

列出所有 PowerShell 后台任务及其状态。

### 函数签名

```python
def list_powershell_tasks() -> str
```

### 返回值

格式化的任务列表字符串：

```python
"""
PowerShell Background Tasks:
  ps_task_0: completed
  ps_task_1: running
  ps_task_2: failed
"""
```

如果没有任务：

```python
"No background PowerShell tasks"
```

### 使用示例

```python
# 启动多个后台任务
task1 = run_powershell("Start-Sleep 10", run_in_background=True)
task2 = run_powershell("Get-Process", run_in_background=True)
task3 = run_powershell("Get-Service", run_in_background=True)

# 列出所有任务
tasks_list = list_powershell_tasks()
print(tasks_list)
# PowerShell Background Tasks:
#   ps_task_0: running
#   ps_task_1: completed
#   ps_task_2: completed
```

---

## PowerShell vs Bash 对比

| 特性 | run_powershell | run_bash |
|-----|----------------|----------|
| 跨平台支持 | ✅ Windows, Linux, macOS | ✅ Linux, macOS, (WSL) |
| 命令语法 | PowerShell (cmdlets) | Bash/sh |
| 后台运行 | ✅ 支持 | ❌ 不支持 |
| 工作目录持久化 | ✅ | ✅ |
| 超时控制 | ✅ (1-600秒) | ✅ (300秒) |
| 危险命令检查 | ✅ | ✅ |
| 路径沙箱 | ✅ | ✅ |
| 对象管道 | ✅ (PowerShell原生) | ❌ (文本流) |

---

## 实际应用场景

### 1. 跨平台脚本执行

```python
# 相同的 PowerShell 命令在 Windows 和 Linux 上都能运行
result = run_powershell("""
Get-ChildItem -Recurse -Filter *.py |
    Measure-Object -Property Length -Sum |
    Select-Object Count, @{Name='TotalMB';Expression={$_.Sum/1MB}}
""")
print(result)
# 输出: Count : 150
#       TotalMB : 12.45
```

### 2. 系统管理任务

```python
# 获取系统进程信息
processes = run_powershell("""
Get-Process | Where-Object {$_.CPU -gt 10} |
    Sort-Object CPU -Descending |
    Select-Object -First 5 Name, CPU, WorkingSet
""")
print(processes)

# 检查服务状态
services = run_powershell("""
Get-Service | Where-Object {$_.Status -eq 'Running'} |
    Select-Object Name, DisplayName
""")
```

### 3. 文件批处理

```python
# 批量重命名文件
result = run_powershell("""
Get-ChildItem *.txt |
    Rename-Item -NewName {$_.Name -replace '.txt', '.backup.txt'}
Write-Output "Renamed files"
""")

# 查找并统计文件
stats = run_powershell("""
$files = Get-ChildItem -Recurse -File
$byExt = $files | Group-Object Extension
$byExt | ForEach-Object {
    "$($_.Name): $($_.Count) files"
}
""")
```

### 4. 并行后台任务

```python
# 启动多个分析任务
tasks = []

# 任务1: 代码分析
task1 = run_powershell("""
Get-ChildItem -Recurse *.py |
    Select-String -Pattern 'TODO|FIXME' |
    Group-Object Filename |
    Sort-Object Count -Descending
""", run_in_background=True)
tasks.append(task1['task_id'])

# 任务2: 依赖检查
task2 = run_powershell("""
Get-Content requirements.txt |
    ForEach-Object { pip show $_ }
""", run_in_background=True, timeout=120)
tasks.append(task2['task_id'])

# 任务3: 测试覆盖率
task3 = run_powershell("""
pytest --cov=. --cov-report=term
""", run_in_background=True, timeout=300)
tasks.append(task3['task_id'])

# 等待所有任务完成
import time
while True:
    all_done = True
    for task_id in tasks:
        status = get_powershell_task(task_id)
        if status['status'] == 'running':
            all_done = False
            break

    if all_done:
        break

    time.sleep(5)
    print(list_powershell_tasks())

# 收集结果
for task_id in tasks:
    result = get_powershell_task(task_id)
    if result['status'] == 'completed':
        print(f"\n{task_id} output:")
        print(result['output'])
```

### 5. 日志分析

```python
# 分析日志文件
log_analysis = run_powershell("""
$logs = Get-Content app.log
$errors = $logs | Select-String -Pattern 'ERROR|CRITICAL'
$warnings = $logs | Select-String -Pattern 'WARNING'

Write-Output "Total lines: $($logs.Count)"
Write-Output "Errors: $($errors.Count)"
Write-Output "Warnings: $($warnings.Count)"
Write-Output ""
Write-Output "Recent errors:"
$errors | Select-Object -Last 5
""")
print(log_analysis)
```

---

## PowerShell 环境检测

函数会自动检测并使用可用的 PowerShell：

1. **优先**: PowerShell Core (`pwsh`) - 跨平台版本
2. **回退**: Windows PowerShell (`powershell.exe`) - 仅Windows

如果没有找到 PowerShell：

```python
result = run_powershell("Get-Date")
print(result)
# Error: PowerShell not found. Please install PowerShell Core (pwsh) or use run_bash for Unix commands.
```

### 安装 PowerShell Core

**Ubuntu/Debian:**
```bash
# 下载微软仓库 GPG 密钥
wget -q https://packages.microsoft.com/config/ubuntu/$(lsb_release -rs)/packages-microsoft-prod.deb

# 注册微软仓库
sudo dpkg -i packages-microsoft-prod.deb

# 更新并安装
sudo apt-get update
sudo apt-get install -y powershell
```

**macOS:**
```bash
brew install --cask powershell
```

**Windows:**
PowerShell 通常预装。要安装最新的 PowerShell Core：
```powershell
winget install Microsoft.PowerShell
```

**验证安装:**
```bash
pwsh --version
# PowerShell 7.4.0
```

---

## 安全特性

### 1. 危险命令检测

默认阻止危险操作（除非 `dangerous_allowed=True`）：

```python
# 这些命令会被阻止
run_powershell("Remove-Item -Recurse -Force C:\\")  # Error: Dangerous command detected
run_powershell("Stop-Computer")                      # Error: Dangerous command detected
run_powershell("Restart-Computer")                   # Error: Dangerous command detected

# 显式允许（谨慎使用！）
run_powershell(
    "Remove-Item temp.txt",
    dangerous_allowed=True
)
```

### 2. 路径沙箱

只能访问工作区内的路径：

```python
# 允许 - 工作区内
run_powershell("Get-Content ./data/file.txt")

# 阻止 - 工作区外
run_powershell("Get-Content C:\\Windows\\System32\\config")
# Error: Path 'C:\Windows\System32\config' is outside the allowed workspace
```

### 3. 超时保护

防止命令无限运行：

```python
# 超时自动终止
result = run_powershell("Start-Sleep -Seconds 1000", timeout=5)
print(result)
# Error: Command timeout after 5s
```

---

## 常见问题 (FAQ)

### Q1: PowerShell Core 和 Windows PowerShell 有什么区别？

**PowerShell Core (pwsh)**:
- 跨平台（Windows, Linux, macOS）
- 开源
- 最新特性
- 推荐使用 ✅

**Windows PowerShell (powershell.exe)**:
- 仅 Windows
- 预装在 Windows 系统
- 版本较老（5.1）
- 兼容性考虑时使用

### Q2: 如何在 PowerShell 和 Bash 之间选择？

使用 PowerShell 当:
- ✅ 需要跨平台脚本
- ✅ 使用 Windows 特定功能
- ✅ 需要后台任务管理
- ✅ 喜欢对象管道

使用 Bash 当:
- ✅ 纯 Linux/Unix 环境
- ✅ 使用传统 Unix 工具
- ✅ 脚本简单且无需后台运行

### Q3: 后台任务会在程序退出后继续运行吗？

**不会**。后台任务是线程级别的，程序退出时会被清理。如果需要真正的后台进程，使用：

```python
# PowerShell 后台作业（进程级别）
run_powershell("""
Start-Job -ScriptBlock {
    # 你的长时间运行的代码
}
""")
```

### Q4: 如何处理 PowerShell 错误？

PowerShell 的错误会包含在输出中：

```python
result = run_powershell("Get-Item NonExistentFile.txt")
if "Error" in result or "cannot find" in result.lower():
    print("Command failed:", result)
else:
    print("Success:", result)
```

### Q5: 可以执行 PowerShell 脚本文件吗？

可以：

```python
# 方法1: 直接调用脚本
result = run_powershell("./scripts/my-script.ps1")

# 方法2: 传递参数
result = run_powershell("./scripts/deploy.ps1 -Environment prod")

# 方法3: 点运行（在当前作用域执行）
result = run_powershell(". ./scripts/functions.ps1; Invoke-MyFunction")
```

---

## 性能考虑

### 启动开销

PowerShell 有一定的启动开销（~100-300ms）：

```python
import time

# 单次调用 - 快速
start = time.time()
run_powershell("Write-Output 'Hello'")
print(f"Time: {time.time() - start:.2f}s")  # ~0.2-0.3s

# 多次调用 - 开销累积
start = time.time()
for i in range(10):
    run_powershell(f"Write-Output '{i}'")
print(f"Total: {time.time() - start:.2f}s")  # ~2-3s
```

### 优化建议

1. **批处理命令**: 一次执行多个命令

```python
# ❌ 慢 - 多次调用
files = []
for ext in ['*.py', '*.js', '*.ts']:
    files.extend(run_powershell(f"Get-ChildItem {ext}").split('\n'))

# ✅ 快 - 一次调用
files = run_powershell("""
Get-ChildItem -Include *.py,*.js,*.ts
""").split('\n')
```

2. **使用后台任务**: 并行执行独立任务

```python
# ❌ 慢 - 串行执行
result1 = run_powershell("Long-Running-Task1")
result2 = run_powershell("Long-Running-Task2")

# ✅ 快 - 并行执行
task1 = run_powershell("Long-Running-Task1", run_in_background=True)
task2 = run_powershell("Long-Running-Task2", run_in_background=True)
# 等待完成...
```

3. **选择合适的工具**: 简单命令用 bash

```python
# ❌ 不必要的 PowerShell
run_powershell("Get-ChildItem")  # ~0.2s

# ✅ 更快的 bash
run_bash("ls")  # ~0.01s
```

---

## 完整示例：项目健康检查

```python
def project_health_check(project_dir):
    """执行完整的项目健康检查"""

    # 确保在项目目录
    run_powershell(f"Set-Location '{project_dir}'")

    # 启动多个检查任务（并行）
    tasks = {}

    # 1. 代码质量检查
    tasks['code_quality'] = run_powershell("""
    Write-Output "=== Code Quality ==="
    $py_files = Get-ChildItem -Recurse -Filter *.py
    Write-Output "Total Python files: $($py_files.Count)"

    $todos = Select-String -Path *.py -Pattern 'TODO|FIXME' -Recurse
    Write-Output "TODOs/FIXMEs: $($todos.Count)"
    """, run_in_background=True)['task_id']

    # 2. 依赖检查
    tasks['dependencies'] = run_powershell("""
    Write-Output "=== Dependencies ==="
    if (Test-Path requirements.txt) {
        $deps = Get-Content requirements.txt | Measure-Object -Line
        Write-Output "Total dependencies: $($deps.Lines)"
    }
    """, run_in_background=True)['task_id']

    # 3. 测试覆盖率
    tasks['test_coverage'] = run_powershell("""
    Write-Output "=== Test Coverage ==="
    pytest --cov=. --cov-report=term-missing --quiet
    """, run_in_background=True, timeout=180)['task_id']

    # 4. Git 状态
    tasks['git_status'] = run_powershell("""
    Write-Output "=== Git Status ==="
    git status --short
    git log -1 --pretty=format:'Last commit: %h - %s (%ar)'
    """, run_in_background=True)['task_id']

    # 等待所有任务完成
    print("Running health checks...")
    import time
    while True:
        statuses = {k: get_powershell_task(v) for k, v in tasks.items()}

        if all(s['status'] in ['completed', 'failed'] for s in statuses.values()):
            break

        print(".", end="", flush=True)
        time.sleep(2)

    print("\n\n" + "="*60)
    print("PROJECT HEALTH CHECK RESULTS")
    print("="*60)

    # 输出所有结果
    for name, task_id in tasks.items():
        result = get_powershell_task(task_id)
        print(f"\n{name.upper().replace('_', ' ')}:")
        print("-" * 60)
        if result['status'] == 'completed':
            print(result['output'])
        else:
            print(f"❌ FAILED: {result.get('error', 'Unknown error')}")

    print("\n" + "="*60)

# 使用
project_health_check("/path/to/project")
```

---

## 总结

`run_powershell` 提供了强大的跨平台脚本执行能力：

✅ **优点**:
- 跨平台支持（Windows, Linux, macOS）
- 后台任务管理
- 对象管道（更强大的数据处理）
- 一致的命令语法
- 内置安全检查

⚠️ **注意事项**:
- 需要安装 PowerShell Core
- 有启动开销（~200ms）
- 对象管道在文本输出时会序列化

📚 **最佳实践**:
- 批处理命令以减少调用次数
- 使用后台任务实现并行处理
- 为简单任务选择合适的工具（bash vs PowerShell）
- 始终设置合理的超时时间
- 检查返回值中的错误信息
