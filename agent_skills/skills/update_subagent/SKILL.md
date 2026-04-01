---
name: update_subagent
description: 指导如何更新智能助手的子智能体(subagent)的列表。
---

# 智能助手的subagent列表更新指导

## Overview

智能助手的subagent列表配置文件一般在用户的工作目录下，文件名称为：`SUBAGENT_CONFIG.json`，包括`CodeExecutorAgent`、`DrSaiAgent`、`HepAIWorkerAgent`三种类型:

- CodeExecutorAgent：用于代码执行的子智能体使用docker或者局部的.venv环境进行代码块执行。用户可以自定义传入.venv环境地址配置进行创建。
- DrSaiAgent：普通的Autogen Assistant，可以使用工具。
- HepAIWorkerAgent：链接远程智能体的代理智能体。
- RemoteAgent：链接远程智能体OpenAI ChatCompletions格式的代理智能体，如OpenClaw等。

具体的格式为：
```json
{
    "agent_01": { // the name of the agent
        "type": "CodeExecutorAgent", // the type of the agent
        "description": "The descrpiption of the agent",
        "tools": [], 
        "prompt": "The system prompt for the agent.",
        "venv_path": "/path/to/workerspace" // the path of the venv environment
    },
    "agent_02": {
        "type": "DrSaiAgent",
        "description": "The descrpiption of the agent",
        "tools": ["run_bash", "run_read", "run_write", "run_edit"], // the tools name that the agent can use
        "prompt": "The system prompt for the agent.",
        "model": "openai/gpt-5.2", // the model name
        "model_type": "openai", // or anthropic
        "base_url": "https://aiapi.ihep.ac.cn/apiv2" // if model_type is anthropic, using "https://aiapi.ihep.ac.cn/apiv2/anthropic"
    },
    "agent_03": {
        "type": "HepAIWorkerAgent", // the type of the agent
        "description": "The descrpiption of the agent",
        "tools": [], 
        "prompt": "The system prompt for the agent.",
        "model_remote_configs": {
            "name": "remote_model_name",
            "url": "https://aiapi.ihep.ac.cn/apiv2" // or any other url
        }
    },
    "agent_04": {
        "type": "RemoteAgent", // the type of the agent
        "description": "The descrpiption of the agent",
        "tools": [], 
        "prompt": "The system prompt for the agent.",
        "model_remote_configs": {
            "model": "openclaw",
            "url": "http://127.0.0.1:18789/v1/chat/completions",
            "headers": {
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                        "x-openclaw-agent-id": "main"
                    }
        }
}
```
**注意：**

- 智能体名称必须符合python的变量命名规则。
- 用户需要添加新的工具时，请确保该工具名称在你的工具列表中存在，并且名称一定要正确，否则将无法使用。
- `DrSaiAgent`智能体可以不添加`model`、`model_type`、`base_url`，系统将使用默认的基座模型。但是如果添加基座模型是必须说明`model`和`model_type`。
- 在为`DrSaiAgent`智能体添加默认的基座模型或者为`HepAIWorkerAgent`智能体添加远程模型时，提醒用户模型与远程智能体名称是否在`https://aiapi.ihep.ac.cn/`中存在。
- 如果用户没有明确说明`base_url`或者`url`，默认为"https://aiapi.ihep.ac.cn/apiv2"，anthropic的模型默认为"https://aiapi.ihep.ac.cn/apiv2/anthropic"。
- 如果用户在添加`CodeExecutorAgent`类型的子智能体时未否指定venv环境路径，则系统将使用用户工作目录下的.venv环境进行代码块执行。
- 在用户提供的信息缺失，或者与上面的格式对比有明显问题，一定要向用户说明正确的格式和参数类型。

## 配置文件修改流程

1. 要求智能助手先使用run_read工具读取`SUBAGENT_CONFIG.json`。
2. 然后根据用户的修改需求，使用run_edit对需要替换的部分进行修改，如果需要全面的修改，则使用run_write工具。

## 案例

1. 例如用户需要添加一个名称类型为`CodeExecutorAgent`子智能体，名称为`code_executor_agent`，描述为`用于代码执行的子智能体`，系统提示为`The system prompt for the agent.`，venv的环境路径为`/home/xiongdb/work/synchrotron_agent/runs/abc`。

那么可以按照以下的格式添加：

```json
{
    "code_executor_agent": { 
        "type": "CodeExecutorAgent", 
        "description": "用于代码执行的子智能体",
        "tools": [], 
        "prompt": "The system prompt for the agent.",
        "venv_path": "/home/xiongdb/work/synchrotron_agent/runs/abc"
    }
}
```

2. 例如用户需要添加一个名称类型为`HepAIWorkerAgent`子智能体，名称为`remote_agent`，远程智能体的名称为`BOSS8Agent`，描述为`可执行BOSS作业提交的智能体。`，提示词为`The system prompt for the agent.`。

那么可以按照以下的格式添加：

```json
{
    "remote_agent": {
        "type": "HepAIWorkerAgent",
        "description": "可执行BOSS作业提交的智能体。",
        "tools": [], 
        "prompt": "The system prompt for the agent.",
        "model_remote_configs": {
            "name": "BOSS8Agent",
            "url": "https://aiapi.ihep.ac.cn/apiv2"
        }
    }
}
```

3. 例如用户需要添加一个名称类型为`DrSaiAgent`子智能体，名称为`test_agent`，描述为`用于PDF文件检索的智能体`，工具为["pdf_manual_search"]，提示词为`你是一个PDF文档检索智能体，你需要基于pdf_manual_search工具查询《spec - X-Ray Diffraction Software》等手册内容。`，基座模型为`openai/gpt-5.2`。

那么可以按照以下的格式添加：

```json
{
    "test_agent": {
        "type": "DrSaiAgent",
        "description": "用于PDF文件检索的智能体",
        "tools": ["pdf_manual_search"], 
        "prompt": "你是一个PDF文档检索智能体，你需要基于pdf_manual_search工具查询《spec - X-Ray Diffraction Software》等手册内容。",
        "model": "openai/gpt-5.2",
        "model_type": "openai", 
        "base_url": "https://aiapi.ihep.ac.cn/apiv2" 
    }
}
```

4. 例如用户需要添加一个名称类型为`RemoteAgent`，如openclaw的聊天接口，名称为`openclaw_agent`，描述为`A openclaw agent.`，提示词为`The system prompt for the agent.`，访问的配置为：
```
{
    "model": "openclaw",
    "url": "http://127.0.0.1:18789/v1/chat/completions",
    "headers": {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "x-openclaw-agent-id": "main"
            }
}
```

那么可以按照以下的格式添加：

```json
{
    "openclaw_agent": {
        "type": "RemoteAgent",
        "description": "A openclaw agent.",
        "tools": [], 
        "prompt": "The system prompt for the agent.",
        "model_remote_configs": {
            "model": "openclaw",
            "url": "http://127.0.0.1:18789/v1/chat/completions",
            "headers": {
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                        "x-openclaw-agent-id": "main"
                    }
        }
    }
}
```