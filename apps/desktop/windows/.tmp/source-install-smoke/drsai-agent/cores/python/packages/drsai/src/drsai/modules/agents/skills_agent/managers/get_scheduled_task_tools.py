"""
定时任务管理工具
为 DrSaiAssistant 提供定时任务的创建、查询、删除、修改等功能
"""

from typing import Optional, List, Dict, Any
from drsai.modules.components.tool import ToolSchema, ParametersSchema


def get_scheduled_task_tool() -> ToolSchema:
    """
    获取定时任务管理工具的 ToolSchema

    该工具用于管理用户的定时任务，包括创建、查询、删除和修改任务
    """
    return ToolSchema(
        name="ScheduledTaskManager",
        description="""管理用户的定时任务。支持以下操作：

1. **create** - 创建新的定时任务
   - task_name: 任务名称
   - prompt: 要执行的提示词/任务内容
   - schedule_type: 调度类型 (cron/interval/datetime)
   - schedule_config: 调度配置
     * cron: cron表达式，如 "0 9 * * *" (每天9点)
     * interval: 间隔秒数，如 "3600" (每小时)
     * datetime: ISO时间字符串，如 "2026-04-10T14:30:00" (一次性任务)
   - task_description: (可选) 任务描述
   - timeout: (可选) 超时时间(秒)，默认300
   - save_history: (可选) 是否保存历史，默认true

2. **list** - 列出当前用户的所有定时任务
   - session_id: (可选) 仅查询特定会话的任务
   - status: (可选) 过滤任务状态 (enabled/disabled/running/error)

3. **get** - 查询指定任务的详细信息
   - task_id: 任务ID

4. **delete** - 删除指定的定时任务
   - task_id: 任务ID

5. **toggle** - 启用/禁用任务
   - task_id: 任务ID
   - enabled: true(启用) 或 false(禁用)

6. **get_results** - 查询任务的执行历史
   - task_id: 任务ID
   - limit: (可选) 返回数量，默认10

7. **get_outputs** - 获取任务的输出文件列表
   - task_id: 任务ID
   - limit: (可选) 返回数量，默认10

8. **read_output** - 读取任务输出文件的内容
   - file_path: 输出文件路径

示例：
```json
// 创建每天9点的定时任务
{
  "operation": "create",
  "task_name": "每日数据汇总",
  "prompt": "请汇总昨天的数据分析结果",
  "schedule_type": "cron",
  "schedule_config": "0 9 * * *"
}

// 创建每小时执行的任务
{
  "operation": "create",
  "task_name": "监控服务状态",
  "prompt": "检查服务器状态并记录",
  "schedule_type": "interval",
  "schedule_config": "3600"
}

// 列出所有启用的任务
{
  "operation": "list",
  "status": "enabled"
}

// 删除任务
{
  "operation": "delete",
  "task_id": "task_abc123"
}
```
""",
        parameters=ParametersSchema(
            type="object",
            properties={
                "operation": {
                    "type": "string",
                    "enum": ["create", "list", "get", "delete", "toggle", "get_results", "get_outputs", "read_output"],
                    "description": "要执行的操作类型"
                },
                # create 参数
                "task_name": {
                    "type": "string",
                    "description": "任务名称 (create时必需)"
                },
                "prompt": {
                    "type": "string",
                    "description": "要执行的提示词/任务内容 (create时必需)"
                },
                "schedule_type": {
                    "type": "string",
                    "enum": ["cron", "interval", "datetime"],
                    "description": "调度类型 (create时必需)"
                },
                "schedule_config": {
                    "type": "string",
                    "description": "调度配置：cron表达式/间隔秒数/ISO时间字符串 (create时必需)"
                },
                "task_description": {
                    "type": "string",
                    "description": "任务描述 (可选)"
                },
                "timeout": {
                    "type": "integer",
                    "description": "超时时间(秒)，默认300"
                },
                "save_history": {
                    "type": "boolean",
                    "description": "是否保存执行历史，默认true"
                },
                # list/get/delete/toggle/get_results 参数
                "task_id": {
                    "type": "string",
                    "description": "任务ID (get/delete/toggle/get_results/get_outputs时必需)"
                },
                "session_id": {
                    "type": "string",
                    "description": "会话ID (list时可选，用于过滤)"
                },
                "status": {
                    "type": "string",
                    "enum": ["enabled", "disabled", "running", "error"],
                    "description": "任务状态 (list时可选，用于过滤)"
                },
                "enabled": {
                    "type": "boolean",
                    "description": "是否启用 (toggle时必需)"
                },
                "limit": {
                    "type": "integer",
                    "description": "返回数量限制 (get_results/get_outputs时可选，默认10)"
                },
                # read_output 参数
                "file_path": {
                    "type": "string",
                    "description": "输出文件路径 (read_output时必需)"
                },
            },
            required=["operation"]
        )
    )
