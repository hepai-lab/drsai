import asyncio
import os, sys
from typing import List, Dict, Any, Union, Optional, Sequence, AsyncGenerator, Callable

from drsai import CancellationToken
from drsai.modules.baseagent import DrSaiAgent, Response
from drsai_ui.agent_factory.remote_agent import StatusAgent
from drsai.modules.managers.messages import HandoffMessage
from drsai.modules.components.model_client import (
    HepAIChatCompletionClient, 
    ModelFamily, 
    AssistantMessage,)
from drsai.modules.managers.messages import (
    BaseChatMessage,
    BaseAgentEvent,
    TextMessage,
    StopMessage,
    ModelClientStreamingChunkEvent
)
from drsai.modules.components.model_context import DrSaiChatCompletionContext
from drsai.modules.groupchat import AGSwarm, TextMentionTermination, HandoffTermination
from drsai.backend import run_worker, Console, DrSaiAPP
import json


class testAgent(DrSaiAgent):

    def __init__(self, *arg, **kwarg):
        super().__init__(*arg, **kwarg)

        self.plan = {}
        self.replan = True
    async def on_messages_stream(
        self, 
        messages: Sequence[BaseChatMessage], 
        cancellation_token: CancellationToken
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | Response, None]:
        """
        Process the incoming messages with the assistant agent and yield events/responses as they happen.
        """

        # monitor the pause event
        if self.is_paused:
            yield Response(
                chat_message=TextMessage(
                    content=f"The {self.name} is paused.",
                    source=self.name,
                    metadata={"internal": "yes"},
                )
            )
            return

        # Set up background task to monitor the pause event and cancel the task if paused.
        async def monitor_pause() -> None:
            await self._paused.wait()
            self.is_paused = True

        monitor_pause_task = asyncio.create_task(monitor_pause())
        inner_messages: List[BaseAgentEvent | BaseChatMessage] = []
        try:
            last_message = messages[-1]
            print(last_message)
            # 第一次刚开始做计划
            if last_message.source=="user":
                last_user_message = last_message.metadata.get("user_request")
                self.plan = {
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
                    content=json.dumps(self.plan),
                    source="Orchestrator",
                    metadata={"internal": "no", "type": "plan_message"},
                )

                yield Response(
                    chat_message=plan_message,
                    inner_messages=inner_messages,
                )
                return
            # 后续用户的反馈
            elif last_message.source=="user_proxy":
                try:
                    last_user_message = last_message.metadata.get("user_request")
                    if last_user_message:
                        user_feedback = json.loads(last_user_message)
                        is_accepted = user_feedback.get("accepted")
                        modify_plan = user_feedback.get("plan")
                        if modify_plan:
                            modify_plan = json.loads(modify_plan)
                            if modify_plan:
                                self.plan["steps"] = modify_plan
                        if is_accepted:
                            if self.is_paused:
                                raise asyncio.CancelledError()
                            for i, sub_task in enumerate(self.plan["steps"]):
                                await asyncio.sleep(3)
                                planning_format = {
                                    "title": sub_task["title"],
                                    "index": i,
                                    "details":  sub_task["details"],
                                    "agent_name": sub_task["agent_name"],
                                    "instruction": f"rephrase the title in one short sentence remaining details of step {i+1}",
                                    "progress_summary": f"rephrase the title in one short sentence remaining details of step {i+1}",
                                    "plan_length": len(self.plan["steps"])
                                }
                                planning_message = TextMessage(
                                    content=json.dumps(planning_format),
                                    source="Orchestrator",
                                    metadata={"internal": "no", "type": "step_execution"},
                                )
                                yield planning_message
                                yield ModelClientStreamingChunkEvent(source=f"Agent_{i+1}", content=f"Processing Task {i+1}...\n")
                                yield ModelClientStreamingChunkEvent(source=f"Agent_{i+1}", content=f"Doing something in Task {i+1}...\n")
                                yield ModelClientStreamingChunkEvent(source=f"Agent_{i+1}", content=f"```text\nDoing something now...\n```\n")

                                # replan 
                                if self.replan:
                                    self.plan["steps"].append({
                                            "title": "title of step n",
                                            "details": "rephrase the title in one short sentence remaining details of step n",
                                            "agent_name": "Agent_2n"
                                        })  
                                    plan_message = TextMessage(
                                        content=json.dumps(self.plan),
                                        source="Orchestrator",
                                        metadata={"internal": "no", "type": "plan_message"},
                                    )

                                    self.replan = False
                                    yield Response(
                                        chat_message=plan_message,
                                        inner_messages=inner_messages,
                                    )
                                    return
                            
                            final_answer = TextMessage(
                                content="All tasks have been finished!",
                                source="Orchestrator",
                                metadata={"internal": "no", "type": "final_answer"},
                            )
                            yield Response(
                                chat_message=final_answer,
                                inner_messages=inner_messages,
                            )
                            return
                        else:
                            yield Response(
                                chat_message=TextMessage(
                                    content="All tasks have been finished!",
                                    source="Orchestrator",
                                    metadata={"internal": "no", "type": "final_answer"},
                                ),
                                inner_messages=inner_messages,
                            )
                            return
                    else:
                        yield Response(
                            chat_message=TextMessage(
                                content="All tasks have been finished!",
                                source="Orchestrator",
                                metadata={"internal": "no", "type": "final_answer"},
                            ),
                            inner_messages=inner_messages,
                        )
                        return

                except Exception as e:
                    print(str(e))
                    yield Response(
                        chat_message=TextMessage(
                            content="All tasks have been finished!",
                            source="Orchestrator",
                            metadata={"internal": "no", "type": "final_answer"},
                        ),
                        inner_messages=inner_messages,
                    )
                    return
        except asyncio.CancelledError:
            # If the task is cancelled, we respond with a message.
            yield Response(
                chat_message=TextMessage(
                    content="The task was cancelled by the user.",
                    source=self.name,
                    metadata={"internal": "yes"},
                ),
                inner_messages=inner_messages,
            )
        except Exception as e:
            # add to chat history
            await self.model_context.add_message(
                AssistantMessage(
                    content=f"An error occurred while executing the task: {e}",
                    source=self.name
                )
            )
            yield Response(
                chat_message=TextMessage(
                    content=f"An error occurred while executing the task: {e}",
                    source=self.name,
                    metadata={"internal": "no"},
                ),
                inner_messages=inner_messages,
            )
        finally:
            # Cancel the monitor task.
            try:
                monitor_pause_task.cancel()
                await monitor_pause_task
            except asyncio.CancelledError:
                pass


# Create a factory function to ensure isolated Agent instances for concurrent access.
async def create_team() -> testAgent:

    return testAgent(
        name="DataAgent_Test"
    )


if __name__ == "__main__":
    
    # asyncio.run(
    #     run_console(
    #         agent_factory=create_agent, 
    #         task="我需要查看`/data/xiongdb/datasets/Experimental_data/nanoXCT_Absorption/data/raw_data/tomo_00097.h5`文件的信息"
    #     )
    # )

    asyncio.run(
        run_worker(
            # 智能体注册信息
            agent_name="Task_Test",
            author = "xiongdb@ihep.ac.cn",
            permission='groups: drsai, payg, ddf_free; users: admin, xiongdb@ihep.ac.cn, ddf_free; owner: xiongdb@ihep.ac.cn',
            description = "前后端任务测试智能体",
            version = "0.1.0",
            logo="https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview",
            # 智能体实体
            agent_factory=create_team, 
            # 后端服务配置
            port = 42610, 
            no_register=False,
            enable_openwebui_pipeline=True, 
            history_mode = "backend",
            # use_api_key_mode = "backend",
        )
    )