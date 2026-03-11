---
tags: OpenDrSai, 智能体开发实践
---

# OpenDrSai智能体开发实践-MCP工具的接入

案例具体链接见：https://github.com/hepai-lab/drsai/blob/main/examples/agent_groupchat/assistant_tool_mcp_sse.py

这里展示了SSE格式的MCP工具接入OpenDrSai智能体框架的过程

## 1.构建一个简单的MCP-SSE应用

![](https://note.ihep.ac.cn/uploads/7c46d80b-9c5a-4d1a-bfb2-d069ecc51580.PNG)

MCP SSE的代码见：https://github.com/hepai-lab/drsai/blob/main/examples/agent_groupchat/mcp_sse_server.py

## 2.将MCP-SSE格式的工具接入OpenDrSai智能体框架

- 将MCP-SSE接入OpenDrSai智能体中

![](https://note.ihep.ac.cn/uploads/4de539e8-b5c1-4822-96c2-da4416922a3d.PNG)

- 本地测试智能体、部署为HepAI和OpenAI格式的后端应用

![](https://note.ihep.ac.cn/uploads/d63a257d-346d-4c99-9ba8-f2b84e1427a5.PNG)

- 在Dr.Sai UI中与后端智能体进行交互

![](https://note.ihep.ac.cn/uploads/c66e5fab-2e60-490c-99d0-e0f99b83817d.PNG)

更多的案例见：https://github.com/hepai-lab/drsai/tree/main/examples/agent_groupchat