
from pydantic import BaseModel
from abc import ABC, abstractmethod
from dataclasses import dataclass
import asyncio
from typing import Any, Dict, List, Optional, Union, Callable
from autogen_core import (
    ComponentModel,
    ComponentBase,
    Component,
    CancellationToken,
    AgentRuntime,
    # MessageContext, 
    # event, 
    # rpc,
)
from autogen_agentchat.base import (
    ChatAgent, 
    )
from autogen_agentchat.teams._group_chat._events import (
    GroupChatAgentResponse,
    GroupChatError,
    GroupChatMessage,
    GroupChatPause,
    GroupChatRequestPublish,
    GroupChatReset,
    GroupChatResume,
    GroupChatStart,
    GroupChatTermination,
    SerializableException,
    )
GroupChatEvent = (GroupChatStart|
                  GroupChatAgentResponse|
                  GroupChatError|
                  GroupChatMessage|
                  GroupChatPause|
                  GroupChatRequestPublish|
                  GroupChatReset|
                  GroupChatResume|
                  GroupChatTermination|
                  SerializableException)

from drsai.modules.groupchat.base_group_chat_runner import BaseGroupChatRunner

def handle_group_chat_event(func: Callable[[GroupChatEvent], Any]) -> None:
    ...


class BaseRunTimeDeamon(ABC, ComponentBase[BaseModel]):
    """ 
    A runtime deamon to manage GroupChatRunner running tasks.
    """
    
    component_type = "run_time_deamon"

    @abstractmethod
    async def send_message(
        self,
        message: Any,
        sender_id: str,
        recipient_id: str,
        *,
        cancellation_token: CancellationToken | None = None,
        ) -> Any:
        """
        Send a message to the group chat.
        """
        ...
    
    async def publish_message(
        self,
        message: Any,
        sender_id: str,
        recipient_id: str,
        *,
        cancellation_token: CancellationToken | None = None,
        ) -> Any:
        """
        Publish a message to the group chat.
        """
        ...

    @abstractmethod
    async def get_GroupChatRunner_instance(
        self,
        group_chat_id: str,
        group_chat_runner_factory: Callable[[], BaseGroupChatRunner]|None = None,
        agent_factories: Dict[str, Callable[[], ChatAgent]]|None = None,
    ) -> Any:
        """
        Get a GroupChatRunner instance for the given group chat.
        """
        ...


# class RunContext:
#     def __init__(self, runtime: SingleThreadedAgentRuntime) -> None:
#         self._runtime = runtime
#         self._run_task = asyncio.create_task(self._run())
#         self._stopped = asyncio.Event()

#     async def _run(self) -> None:
#         while True:
#             if self._stopped.is_set():
#                 return

#             await self._runtime._process_next()  # type: ignore

#     async def stop(self) -> None:
#         self._stopped.set()
#         self._runtime._message_queue.shutdown(immediate=True)  # type: ignore
#         await self._run_task

#     async def stop_when_idle(self) -> None:
#         await self._runtime._message_queue.join()  # type: ignore
#         self._stopped.set()
#         self._runtime._message_queue.shutdown(immediate=True)  # type: ignore
#         await self._run_task

#     async def stop_when(self, condition: Callable[[], bool], check_period: float = 1.0) -> None:
#         async def check_condition() -> None:
#             while not condition():
#                 await asyncio.sleep(check_period)
#             await self.stop()

#         await asyncio.create_task(check_condition())