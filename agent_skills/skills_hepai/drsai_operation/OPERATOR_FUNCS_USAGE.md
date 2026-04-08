# Operator Functions 使用说明

本文档说明了 `get_operator_funcs` 函数返回的所有操作函数及其使用方法。

## 概述

`get_operator_funcs` 现在返回6个工具函数：

```python
from drsai.modules.agents.skills_agent.managers.operater_funs import get_operator_funcs

funcs = get_operator_funcs(worker_dir="/path/to/workspace")
run_bash, run_read, run_write, run_edit, run_grep, run_glob = funcs
```

---

## 1. run_bash - 执行Shell命令

执行shell命令，工作目录在调用之间保持持久。

### 参数
- `cmd: str` - 要执行的shell命令

### 示例
```python
# 列出当前目录
result = run_bash("ls -la")

# cd命令会持久化
run_bash("cd src")
result = run_bash("pwd")  # 仍在 src 目录中
```

### 安全限制
- 阻止危险命令（sudo, rm -rf, shutdown等）
- 只能访问允许的工作区目录
- 超时限制：300秒

---

## 2. run_read - 读取文件

读取文件内容。

### 参数
- `path: str` - 文件路径
- `minilimit: int` - 起始行号（可选）
- `maxlimit: int` - 结束行号（可选，-1表示到末尾）

### 示例
```python
# 读取整个文件
content = run_read("README.md")

# 读取第10-50行
content = run_read("large_file.txt", minilimit=10, maxlimit=50)
```

### 限制
- 输出限制在50,000字符
- 路径必须在工作区内

---

## 3. run_write - 写入文件

写入内容到文件。

### 参数
- `path: str` - 文件路径
- `content: str` - 要写入的内容

### 示例
```python
# 创建新文件
result = run_write("output.txt", "Hello, World!")

# 覆盖现有文件
result = run_write("config.json", '{"debug": true}')
```

### 特性
- 自动创建父目录
- 覆盖现有文件

---

## 4. run_edit - 编辑文件

在文件中替换文本。

### 参数
- `path: str` - 文件路径
- `old_text: str` - 要查找的原始文本
- `new_text: str` - 要替换成的新文本

### 示例
```python
# 替换文本（只替换第一个匹配）
result = run_edit(
    "config.py",
    old_text="DEBUG = False",
    new_text="DEBUG = True"
)
```

### 注意事项
- 只替换第一个匹配项
- 如果找不到文本会返回错误
- 必须精确匹配（包括空格）

---

## 5. run_grep - 搜索文件内容 (新增)

使用正则表达式在文件内容中搜索。优先使用 ripgrep (rg)，回退到 grep。

### 参数
- `pattern: str` - 正则表达式搜索模式（必需）
- `path: str` - 搜索路径（文件或目录，默认为工作区根目录）
- `glob: str` - 文件过滤模式（如 "*.py", "*.{js,ts}"）
- `output_mode: str` - 输出模式（默认 "files_with_matches"）
  - `"content"` - 显示匹配的行内容
  - `"files_with_matches"` - 只显示包含匹配的文件路径
  - `"count"` - 显示每个文件的匹配次数
- `context_before: int` - 显示匹配行之前的行数（默认0）
- `context_after: int` - 显示匹配行之后的行数（默认0）
- `show_line_numbers: bool` - 显示行号（默认True）
- `case_insensitive: bool` - 忽略大小写（默认False）
- `file_type: str` - 文件类型过滤（如 "py", "js"）
- `max_results: int` - 最大结果数（默认250）

### 示例

```python
# 查找所有包含 "TODO" 的文件
files = run_grep(pattern="TODO")

# 在Python文件中搜索函数定义
content = run_grep(
    pattern="def.*test_.*:",
    glob="*.py",
    output_mode="content",
    show_line_numbers=True
)

# 搜索带上下文
result = run_grep(
    pattern="class.*Agent",
    output_mode="content",
    context_before=2,
    context_after=2
)

# 忽略大小写搜索
result = run_grep(
    pattern="error",
    case_insensitive=True,
    file_type="py"
)

# 只在特定目录搜索
result = run_grep(
    pattern="import.*numpy",
    path="src/models",
    glob="*.py"
)

# 统计匹配次数
counts = run_grep(
    pattern="TODO|FIXME",
    output_mode="count"
)
```

### 输出格式

**files_with_matches 模式**:
```
src/main.py
src/utils.py
tests/test_main.py
```

**content 模式**:
```
src/main.py:10:    def main():
src/main.py:15:        print("Hello")
```

**count 模式**:
```
src/main.py:5
src/utils.py:12
```

### 性能和限制
- 优先使用 ripgrep (更快)
- 超时限制：30秒
- 结果限制在 max_results 条
- 输出限制在50,000字符

---

## 6. run_glob - 文件名模式匹配 (新增)

使用 glob 模式查找文件。

### 参数
- `pattern: str` - glob模式（必需）
  - `"*.py"` - 当前目录的Python文件
  - `"**/*.py"` - 递归查找所有Python文件
  - `"src/**/*.{js,ts}"` - src目录下的JavaScript和TypeScript文件
- `search_path: str` - 搜索目录（默认为工作区根目录）
- `max_results: int` - 最大结果数（默认100）

### 示例

```python
# 查找所有Python文件
py_files = run_glob("**/*.py")

# 查找特定目录的配置文件
configs = run_glob("*.{json,yaml,yml}", search_path="config")

# 查找测试文件
tests = run_glob("**/test_*.py")

# 查找TypeScript组件
components = run_glob("src/components/**/*.tsx")

# 查找所有Markdown文档
docs = run_glob("**/*.md")
```

### 输出格式

```
src/main.py
src/utils.py
tests/test_main.py

[Results truncated. Showing 100 of 234 files]
```

### 特性
- 结果按修改时间排序（最新的在前）
- 自动转换为相对路径
- 支持递归搜索（`**`）
- 截断提示（超过max_results时）

---

## 功能对比表

| 功能 | run_bash | run_grep | run_glob |
|-----|----------|----------|----------|
| 搜索文件内容 | ✓ (通过grep命令) | ✓✓✓ | ✗ |
| 查找文件名 | ✓ (通过find命令) | ✗ | ✓✓✓ |
| 正则表达式 | ✓ | ✓ | ✗ (仅glob模式) |
| 上下文显示 | 手动 | ✓ | N/A |
| 性能 | 中等 | 快 (ripgrep) | 快 |
| 易用性 | 需要shell知识 | 简单参数 | 简单模式 |

---

## 工作区安全机制

所有函数都受到以下安全限制：

1. **路径沙箱**: 只能访问工作区内的文件
2. **危险命令阻止**: run_bash 阻止危险操作
3. **超时保护**: 长时间运行的命令会超时
4. **输出限制**: 防止过大的输出占用内存

---

## 高级用例

### 代码审查工作流
```python
# 1. 查找所有待审查的Python文件
files = run_glob("**/*.py", search_path="src")

# 2. 搜索潜在问题
todos = run_grep(pattern="TODO|FIXME|XXX", output_mode="content")

# 3. 查找未使用的导入
unused = run_grep(
    pattern="^import.*",
    glob="*.py",
    output_mode="content"
)
```

### 日志分析
```python
# 查找错误日志
errors = run_grep(
    pattern="ERROR|CRITICAL",
    path="logs",
    glob="*.log",
    output_mode="content",
    context_after=3
)

# 统计错误类型
error_counts = run_grep(
    pattern="ERROR",
    output_mode="count",
    path="logs"
)
```

### 依赖分析
```python
# 查找所有导入语句
imports = run_grep(
    pattern="^(import|from).*",
    glob="*.py",
    output_mode="content"
)

# 查找特定库的使用
pandas_usage = run_grep(
    pattern="pandas|pd\.",
    file_type="py"
)
```

---

## 实现细节

### 基于 Claude Code 的实现

这些函数的实现参考了 Claude Code 的工具设计：

1. **GrepTool** → `run_grep`
   - 使用 ripgrep 实现高性能搜索
   - 支持多种输出模式
   - 智能回退到标准 grep

2. **GlobTool** → `run_glob`
   - 使用 Python pathlib.glob
   - 按修改时间排序结果
   - 相对路径优化

3. **PowerShellTool** → `run_bash`
   - 工作目录持久化
   - 安全命令检查
   - 超时保护

### 依赖检测

- `run_grep` 会自动检测 ripgrep (rg) 是否可用
- 如果没有 rg，自动回退到标准 grep
- 确保在任何 Unix/Linux 环境都能工作

---

## 常见问题

**Q: run_grep 和 run_bash("grep ...") 有什么区别？**
A: run_grep 提供更安全、更易用的接口，自动处理路径验证、结果限制和错误处理。

**Q: 为什么 run_glob 限制100个结果？**
A: 防止返回过多文件导致内存问题。可以通过 max_results 参数调整。

**Q: run_edit 可以一次替换多个地方吗？**
A: 不行，它只替换第一个匹配。如果需要全局替换，使用 run_bash("sed ...") 或读取-修改-写入模式。

**Q: 如何安装 ripgrep？**
A:
```bash
# Ubuntu/Debian
sudo apt install ripgrep

# macOS
brew install ripgrep

# 或从源码: https://github.com/BurntSushi/ripgrep
```

---

## 最佳实践

1. **优先使用专用工具**: 用 run_grep 而不是 run_bash("grep")
2. **限制搜索范围**: 使用 path 和 glob 参数缩小搜索范围
3. **选择合适的输出模式**: 只需要文件名时用 files_with_matches
4. **处理大文件**: 使用 max_results 和 context 参数控制输出大小
5. **错误处理**: 检查返回值是否包含 "Error:"

---

## 版本信息

- 基础功能 (run_bash, run_read, run_write, run_edit): v1.0
- 搜索功能 (run_grep, run_glob): v2.0 (新增)
- 参考实现: Claude Code (claude-sonnet-4-5)
