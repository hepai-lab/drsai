---
tags: OpenDrSai, 智能体文档
---

# OpenDrSai-前后端任务系统交互

具体案例见：[assistant_task_interaction.py](https://github.com/hepai-lab/drsai/blob/main/examples/agent_groupchat/assistant_task_interaction.py)

## 1.前端用户输入格式

前端输入分为两个阶段：

### 1.1.用户初始输入

数据格式为：

```python
TextMessage(
    content="User's Input",
    source="user",
    metadata={'attached_files': '[]', 'user_request': '{"content": "hi", "accepted": false, "plan": null}', 'internal': 'yes'},
)
```

`source`为`"user"`；`metadata["user_request"]`为前端发送的任务消息格式`accepted`确定用户是否批准任务，`plan`为用户在前端修改后的任务列表。

**以下展示了前端两种`source`为`"user"`的输入情况**：

- **用户首次输入**：

![](https://note.ihep.ac.cn/uploads/42564d6c-5799-41ff-a127-d4fa67ed5e81.png)

- **断连后重连**：

![](https://note.ihep.ac.cn/uploads/44c86727-5117-4833-a022-bbd61eb76772.png)

### 1.2.在运行过程中

所有出现`Waiting for your input`时，前端输入框user的角色名为：`source`=`"user_proxy"`。此时用户输入返回给后端的数据格式为：

```python
TextMessage(
    content="Plan Accepted",
    source="user_proxy",
    metadata={'attached_files': '[]', 'user_request': '{"content": "Plan Accepted", "accepted": true, "plan": "[]"}', 'internal': 'yes'},
)
```

注意，在前端新增或者修改计划后，这里的`"plan"`字段会储存最新的计划列表。

![](https://note.ihep.ac.cn/uploads/ecf22301-0aae-4886-a1e6-f5e372a18f54.png)


## 2.前后端数据格式约定

### 2.1.制定任务

智能体/多智能体系统后端通过`TextMessage`的消息类型向前端发送制定的具体任务内容。主要的注意事项有：

- 消息的`content`格式要符合以下`plan`所展示的Dict格式
- 消息的`metadata`格式必须包括`{"internal": "no", "type": "plan_message"}`

**一个完整的示例如下：**

```python
plan = {
    "response": "Test planning for drsai ui",
    # "response": "",
    "task": "Test planning for drsai ui",
    "plan_summary": "Test planning for drsai ui",
    "needs_plan": True,
    "steps":
        [
        {
            "title": "title of step 1",
            "details": "rephrase the title in one short sentence remaining details of step 1",
            "agent_name": "Agent_1"
        },
        {
            "title": "title of step 2",
            "details": "rephrase the title in one short sentence remaining details of step 2",
            "agent_name": "Agent_2"
        },
        ]
    }

plan_message = TextMessage(
    content=json.dumps(plan),
    source="Orchestrator",
    metadata={"internal": "no", "type": "plan_message"},
)
```

**前端的具体展示如下：**

![](https://note.ihep.ac.cn/uploads/c3a78eca-ede8-49d6-8801-58e7b8e93e61.png)

### 1.2.任务进度展示

智能体/多智能体系统后端通过`TextMessage`的消息类型向前端发送具体任务的进度。主要的注意事项有：

- 消息的`content`格式要符合以下`planning_format`所展示的Dict格式
- 消息的`metadata`格式必须包括`{"internal": "no", "type": "step_execution"}`
- 其他的智能体/多智能体系统消息可正常通过`ModelClientStreamingChunkEvent`进行流式输出，如下图每个任务Step所输出的内容。

**一个完整的示例如下：**

```python
planning_format = {
    "title": f"title of step {i+1}",
    "index": i,
    "details":  f"rephrase the title in one short sentence remaining details of step {i+1}",
    "agent_name": f"Agent_{i+1}",
    "instruction": f"rephrase the title in one short sentence remaining details of step {i+1}",
    "progress_summary": f"rephrase the title in one short sentence remaining details of step {i+1}",
    "plan_length": len(self.plan["steps"])
}
planning_message = TextMessage(
    content=json.dumps(planning_format),
    source="Orchestrator",
    metadata={"internal": "no", "type": "step_execution"},
)
```

**前端的具体展示如下：**

![](https://note.ihep.ac.cn/uploads/fa2b6b55-a4d8-4f36-844e-9a705fa6e408.png)

### 1.2.最终执行完成展示

智能体/多智能体系统后端通过`TextMessage`的消息类型向前端发送任务完成格式。主要的注意事项有：


- 消息的`metadata`格式必须包括`{"internal": "no", "type": "final_answer"}`

```python
final_answer = TextMessage(
    content="All tasks have been finished!",
    source="Orchestrator",
    metadata={"internal": "no", "type": "final_answer"},
)
```
![](https://note.ihep.ac.cn/uploads/4e1f17e4-1e89-445f-8d00-16ef048161cb.png)

