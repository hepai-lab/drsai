---
paths:
  - "cores/python/packages/drsai/src/**/*.py"
  - "python/**/*.py"
---

# Python Development Rules

<!-- 这些规则只在 DrSai 处理 Python 文件时加载 -->

## Code Style
- 使用 ruff 格式化，不要手动调整格式
- 使用 `import X` 而非 `from X import *`
- 类型注解：所有公开函数必须有完整类型注解
- 文档字符串用 Google style docstring

## Testing
- 测试文件放在 `tests/` 目录，与源码结构对应
- 测试函数命名：`test_<功能描述>`
- 使用 pytest fixtures 而非手动 setup/teardown
- 每个公开 API 至少有一个测试

## AutoGen 集成
- 智能体注册使用 `autogen_core` 的组件注册机制
- Model client 必须实现 `ChatCompletionClient` 接口
- 工具定义使用 `FunctionTool` 或 MCP tool
