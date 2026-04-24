# 智能助手的mcp、函数等工具列表修改指导

## Overview

智能助手的工具列表配置文件一般在用户的工作目录下，文件名称为：`TOOLS_CONFIG.json`，包括mcp-std、远程的mcp-sse、本地函数具体的格式为：
```json
[
    {
        "name": "mcp1",
        "type": "mcp-sse",
        "config": {
            "url": "https://example.com/sse",
            "token": "xxx",                   # 可选，若不需要鉴权可传空字符串 ""
            "headers": {...},                 # 可选，若提供则优先使用此 headers
            "timeout": 20,                    # 可选，默认 20
            "sse_read_timeout": 300           # 可选，默认 300
        }
    },
    {
        "name": "mcp2",
        "type": "mcp-std",
        "config": {
            "command":"conda",
            "args":[
                "run",
                "-n",
                "drsai",
                "--live-stream",
                "python",
                "/path/MCP_tools/mcp_std.py"
                ],
        }
    },
    {
        "name": "local_func",
        "type": "local_func",
        "config": {
            "description": "A local function about local function",
            "params": ["param1", "param2"],
            "path": "/path/to/local_func.py",
            "command": "python",
            "args": ["/path/to/local_func.py"],
            "env": {...}
        }
    }
]
```

## 配置文件修改流程

1. 要求智能助手先使用run_read工具读取`TOOLS_CONFIG.json`。
2. 然后根据用户的修改需求，使用run_edit对需要替换的部分进行修改，如果需要全面的修改，则使用run_write工具。

## 案例

1. 例如用户需要添加一个名称为tools的mcp-std工具，文件路径为`/home/xiongdb/drsai/examples/agent_groupchat/MCP_tools/mcp_server.py`，需要在conda环境为`drsai`下使用`--live-stream`执行，那么可以按照以下的格式添加：

```json
{
    "name": "tools",
    "type": "mcp-std",
    "config": {
        "command":"conda",
        "args":[
            "run",
            "-n",
            "drsai",
            "--live-stream",
            "python",
            "/home/xiongdb/drsai/examples/agent_groupchat/MCP_tools/mcp_server.py"
            ],
    }
}
```

2. 例如用户需要添加一个名称为sse_tools的mcp-see格式工具，url为`http://192.168.23.415:42998/sse`，那么可以按照以下的格式添加：
```json
{
    "name": "sse_tools",
    "type": "mcp-sse",
    "config": {
        "url": "https://example.com/sse",
        "timeout": 20,
        "sse_read_timeout": 300
    }
}
```

3. 例如用户需要添加一个文件路径为`/home/xiongdb/drsai/examples/agent_groupchat/assistant_skill/skills/pdf/scripts/convert_pdf_to_images.py`的本地函数工具，函数名称为convert，参数有pdf_path, output_dir, max_dim，作用是将pdf文件转化为png图片，conda环境为`drsai`下使用，那么可以按照以下的格式添加：
```json
{
    "name": "convert",
    "type": "local_func",
    "config": {
        "description": "作用是将pdf文件转化为png图片",
        "params": ["pdf_path", "output_dir", "max_dim"],
        "path": "/home/xiongdb/drsai/examples/agent_groupchat/assistant_skill/skills/pdf/scripts/convert_pdf_to_images.py",
        "command": "python",
        "args": ["/home/xiongdb/drsai/examples/agent_groupchat/assistant_skill/skills/pdf/scripts/convert_pdf_to_images.py"],
        "env": {"conda_env": "drsai"}
    }
}
```