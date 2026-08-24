"""
HepAIWorkerAgent 流式调试脚本

参考 task_team.py L502-543 的 remote/ddf 模式 Agent 创建,
直接运行流式推理, 结果保存到 output 文件夹。

用法:
  python tests/agents/drsai_worker.py
"""

import os
import json
import asyncio
from datetime import datetime
from pathlib import Path

from drsai.modules.agents import HepAIWorkerAgent
from drsai.modules.components.model_client import ChatCompletionClient

# ════════════════════════════════════════════════════════════════
# 1. 配置 (参考 task_team.py L409-411, L502-543)
# ════════════════════════════════════════════════════════════════

API_KEY = "***"
# BASE_URL = "https://aiapi.ihep.ac.cn/apiv2"
BASE_URL = "http://**:***/apiv2"
MODEL_NAME = "DocMaster"          # 远程智能体名称, 按需修改
DEFULT_CONFIG_NAME = None                # 模型别名, 如 "deepseek-v3"
TASK = "你好，请用中文简单介绍一下你自己"

# model_client_config — 对应 task_team.py 的 model_config
model_config = {
    "provider": "drsai.HepAIChatCompletionClient",
    "config": {
        "model": "hepai/deepseek-v4-flash",
        "base_url": BASE_URL,
        "api_key": API_KEY,
        "max_retries": 10,
    },
}

# model_remote_configs — 对应 task_team.py L521-535 合并后的 agent_config
agent_config = {
    "api_key": API_KEY,
    "url": BASE_URL,
    "name": MODEL_NAME,
}
if DEFULT_CONFIG_NAME:
    agent_config["defult_config_name"] = DEFULT_CONFIG_NAME

chat_id = f"test_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
run_info = {"uuid": chat_id, "user_id": "juzy@ihep.ac.cn", "name": "juzy@ihep.ac.cn"}


# ════════════════════════════════════════════════════════════════
# 2. 创建 Agent & 流式运行
# ════════════════════════════════════════════════════════════════

async def main():
    # 创建 (参考 task_team.py L536-542)
    agent = HepAIWorkerAgent(
        name="RemoteAgent",
        model_client=ChatCompletionClient.load_component(model_config),
        model_remote_configs=agent_config,
        chat_id=chat_id,
        run_info=run_info,
    )

    # lazy_init 加载远程 worker 函数
    await agent.lazy_init()
    print(f"✅ Agent ready: model={agent.model_name}, url={agent.url}\n")

    # 准备输出目录
    out_dir = Path(f"tests/agents/output/{chat_id}")
    out_dir.mkdir(parents=True, exist_ok=True)
    chunks = []  # 收集所有流式事件

    # 流式推理 (参考 on_messages_stream / run_stream)
    print(f"{'='*50}\n📋 Task: {TASK}\n{'='*50}\n")
    async for msg in agent.run_stream(task=TASK):
        msg_type = type(msg).__name__
        content = getattr(msg, "content", "")
        source = getattr(msg, "source", "")

        # 收集
        chunks.append({
            "type": msg_type,
            "source": source,
            "content": content if isinstance(content, str) else str(content),
            "time": datetime.now().isoformat(),
        })

        # 实时打印
        if msg_type == "ModelClientStreamingChunkEvent":
            print(content, end="", flush=True)
        elif msg_type == "TextMessage" and source == "RemoteAgent":
            print(f"\n{'='*50}\n📝 {source}: {content}\n{'='*50}")
        elif msg_type == "ThoughtEvent":
            print(f"\n💭 Thought: {content[:80]}")
        elif msg_type == "ToolCallRequestEvent":
            print(f"\n🔧 Tool Call: {content}")
        elif msg_type == "TaskResult":
            print(f"\n🏁 Done — {len(chunks)} events")

    # 保存到文件
    with open(out_dir / "stream.json", "w", encoding="utf-8") as f:
        json.dump(chunks, f, ensure_ascii=False, indent=2)

    with open(out_dir / "final.txt", "w", encoding="utf-8") as f:
        # 提取最终文本
        final = ""
        for c in chunks:
            if c["type"] == "TextMessage" and c["source"] == "RemoteAgent":
                final = c["content"]
        f.write(final)

    print(f"\n📁 结果已保存到: {out_dir}/")

    # 清理
    if hasattr(agent, "close"):
        await agent.close()


if __name__ == "__main__":
    asyncio.run(main())
