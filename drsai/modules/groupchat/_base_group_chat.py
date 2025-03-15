
import asyncio
import logging

from typing import Any, AsyncGenerator, List, Sequence, Callable

from autogen_core import (
    AgentId,
    CancellationToken,
)

from autogen_agentchat.base import ChatAgent, TaskResult, TerminationCondition
from autogen_agentchat.messages import AgentEvent, BaseChatMessage, ChatMessage, ModelClientStreamingChunkEvent, TextMessage
from autogen_agentchat.teams._group_chat._events import GroupChatStart
from autogen_agentchat.teams._group_chat._sequential_routed_agent import SequentialRoutedAgent
from autogen_agentchat.teams._group_chat._base_group_chat_manager import BaseGroupChatManager
from autogen_agentchat.teams import BaseGroupChat

from drsai.modules.managers.base_thread import Thread
from drsai.modules.managers.threads_manager import ThreadsManager
from drsai.modules.managers.base_thread_message import ThreadMessage, Content, Text

event_logger = logging.getLogger(__name__)


class DrSaiGroupChatManager(BaseGroupChatManager):

    def __init__(
        self,
        group_topic_type: str,
        output_topic_type: str,
        participant_topic_types: List[str],
        participant_descriptions: List[str],
        termination_condition: TerminationCondition | None = None,
        max_turns: int | None = None,
        thread: Thread = None,
        thread_mgr: ThreadsManager = None,
    ):
        super().__init__(
            group_topic_type = group_topic_type,
            output_topic_type = output_topic_type,
            participant_topic_types = participant_topic_types,
            participant_descriptions = participant_descriptions,
            termination_condition = termination_condition,
            max_turns = max_turns
        )
        self._theard: Thread = thread
        self._thread_mgr: ThreadsManager = thread_mgr



class DrSaiGroupChat(BaseGroupChat):

    component_type = "team"

    def __init__(
        self,
        participants: List[ChatAgent],
        group_chat_manager_class: type[SequentialRoutedAgent],
        termination_condition: TerminationCondition | None = None,
        max_turns: int | None = None,
        thread: Thread = None,
        thread_mgr: ThreadsManager = None,
        **kwargs: Any
    ):
        super().__init__(
            participants = participants, 
            group_chat_manager_class = group_chat_manager_class, 
            termination_condition = termination_condition, 
            max_turns = max_turns
            )
        self._thread: Thread = thread
        self._thread_mgr: ThreadsManager = thread_mgr

    def _create_group_chat_manager_factory(
        self,
        group_topic_type: str,
        output_topic_type: str,
        participant_topic_types: List[str],
        participant_descriptions: List[str],
        termination_condition: TerminationCondition | None,
        max_turns: int | None,
    ) -> Callable[[], DrSaiGroupChatManager]:
        def _factory() -> DrSaiGroupChatManager:
            return DrSaiGroupChatManager(
                group_topic_type,
                output_topic_type,
                participant_topic_types,
                participant_descriptions,
                termination_condition,
                max_turns,
                thread=self._thread,
                thread_mgr=self._thread_mgr,
            )

        return _factory
    
    async def run_stream(
        self,
        *,
        task: str | ChatMessage | Sequence[ChatMessage] | None = None,
        cancellation_token: CancellationToken | None = None,
    ) -> AsyncGenerator[AgentEvent | ChatMessage | TaskResult, None]:
        """Run the team and produces a stream of messages and the final result
        of the type :class:`~autogen_agentchat.base.TaskResult` as the last item in the stream. Once the
        team is stopped, the termination condition is reset.

        .. note::

            If an agent produces :class:`~autogen_agentchat.messages.ModelClientStreamingChunkEvent`,
            the message will be yielded in the stream but it will not be included in the
            :attr:`~autogen_agentchat.base.TaskResult.messages`.

        Args:
            task (str | ChatMessage | Sequence[ChatMessage] | None): The task to run the team with. Can be a string, a single :class:`ChatMessage` , or a list of :class:`ChatMessage`.
            cancellation_token (CancellationToken | None): The cancellation token to kill the task immediately.
                Setting the cancellation token potentially put the team in an inconsistent state,
                and it may not reset the termination condition.
                To gracefully stop the team, use :class:`~autogen_agentchat.conditions.ExternalTermination` instead.

        Returns:
            stream: an :class:`~collections.abc.AsyncGenerator` that yields :class:`~autogen_agentchat.messages.AgentEvent`, :class:`~autogen_agentchat.messages.ChatMessage`, and the final result :class:`~autogen_agentchat.base.TaskResult` as the last item in the stream.

        Example using the :class:`~autogen_agentchat.teams.RoundRobinGroupChat` team:

        .. code-block:: python

            import asyncio
            from autogen_agentchat.agents import AssistantAgent
            from autogen_agentchat.conditions import MaxMessageTermination
            from autogen_agentchat.teams import RoundRobinGroupChat
            from autogen_ext.models.openai import OpenAIChatCompletionClient


            async def main() -> None:
                model_client = OpenAIChatCompletionClient(model="gpt-4o")

                agent1 = AssistantAgent("Assistant1", model_client=model_client)
                agent2 = AssistantAgent("Assistant2", model_client=model_client)
                termination = MaxMessageTermination(3)
                team = RoundRobinGroupChat([agent1, agent2], termination_condition=termination)

                stream = team.run_stream(task="Count from 1 to 10, respond one at a time.")
                async for message in stream:
                    print(message)

                # Run the team again without a task to continue the previous task.
                stream = team.run_stream()
                async for message in stream:
                    print(message)


            asyncio.run(main())


        Example using the :class:`~autogen_core.CancellationToken` to cancel the task:

        .. code-block:: python

            import asyncio
            from autogen_agentchat.agents import AssistantAgent
            from autogen_agentchat.conditions import MaxMessageTermination
            from autogen_agentchat.ui import Console
            from autogen_agentchat.teams import RoundRobinGroupChat
            from autogen_core import CancellationToken
            from autogen_ext.models.openai import OpenAIChatCompletionClient


            async def main() -> None:
                model_client = OpenAIChatCompletionClient(model="gpt-4o")

                agent1 = AssistantAgent("Assistant1", model_client=model_client)
                agent2 = AssistantAgent("Assistant2", model_client=model_client)
                termination = MaxMessageTermination(3)
                team = RoundRobinGroupChat([agent1, agent2], termination_condition=termination)

                cancellation_token = CancellationToken()

                # Create a task to run the team in the background.
                run_task = asyncio.create_task(
                    Console(
                        team.run_stream(
                            task="Count from 1 to 10, respond one at a time.",
                            cancellation_token=cancellation_token,
                        )
                    )
                )

                # Wait for 1 second and then cancel the task.
                await asyncio.sleep(1)
                cancellation_token.cancel()

                # This will raise a cancellation error.
                await run_task


            asyncio.run(main())

        """

        # Create the messages list if the task is a string or a chat message.
        messages: List[ChatMessage] | None = None

        # # TODO: 目前autogen不支持把历史消息加入到groupchat消息队列中，因此现在把加载历史消息和保存放到了每个Agent中
        # if self._thread is not None:
        #     history_thread_messages: List[ThreadMessage] = self._thread.messages
        #     for history_thread_message in history_thread_messages:
        #         messages.append(TextMessage(content=history_thread_message.content_str(), source=history_thread_message.sender))

        if task is None:
            pass
        elif isinstance(task, str):
            messages = [TextMessage(content=task, source="user")]
        elif isinstance(task, BaseChatMessage):
            messages = [task]
        else:
            if not task:
                raise ValueError("Task list cannot be empty.")
            messages = []
            for msg in task:
                if not isinstance(msg, BaseChatMessage):
                    raise ValueError("All messages in task list must be valid ChatMessage types")
                messages.append(msg)

        if self._is_running:
            raise ValueError("The team is already running, it cannot run again until it is stopped.")
        self._is_running = True
        
        yield messages[-1]
        # 储存第一条用户提问消息
        if self._thread is not None:
            self._thread_mgr.create_message(
                thread=self._thread,
                role = "user",
                content=[Content(type="text", text=Text(value=messages[-1].content,annotations=[]))],
                sender=messages[-1].source,
                metadata={},
                )

        # Start the runtime.
        # TODO: The runtime should be started by a managed context.
        self._runtime.start()

        if not self._initialized:
            await self._init(self._runtime)

        # Start a coroutine to stop the runtime and signal the output message queue is complete.
        async def stop_runtime() -> None:
            try:
                await self._runtime.stop_when_idle()
            finally:
                await self._output_message_queue.put(None)

        shutdown_task = asyncio.create_task(stop_runtime())

        try:
            # Run the team by sending the start message to the group chat manager.
            # The group chat manager will start the group chat by relaying the message to the participants
            # and the closure agent.
            await self._runtime.send_message(
                GroupChatStart(messages=messages),
                recipient=AgentId(type=self._group_chat_manager_topic_type, key=self._team_id),
                cancellation_token=cancellation_token,
            )
            # Collect the output messages in order.
            output_messages: List[AgentEvent | ChatMessage] = []
            # Yield the messsages until the queue is empty.
            while True:
                message_future = asyncio.ensure_future(self._output_message_queue.get())
                if cancellation_token is not None:
                    cancellation_token.link_future(message_future)
                # Wait for the next message, this will raise an exception if the task is cancelled.
                message = await message_future

                if message is None:
                    break
                if message == messages[-1]:
                    pass
                else:
                    yield message
                if isinstance(message, ModelClientStreamingChunkEvent):
                    # Skip the model client streaming chunk events.
                    continue
                output_messages.append(message)

                # # 使用thread储存完整的文本消息，以后可能有多模态消息
                # if self._thread is not None:
                #     self._thread_mgr.create_message(
                #         thread=self._thread,
                #         role = "assistant" if (message.source != "user" or message.source != "system") else message.source,
                #         content=[Content(type="text", text=Text(value=message.content,annotations=[]))],
                #         sender=message.source,
                #         metadata={},
                #         )

            # Yield the final result.
            yield TaskResult(messages=output_messages, stop_reason=self._stop_reason)

        finally:
            # Wait for the shutdown task to finish.
            try:
                # This will propagate any exceptions raised in the shutdown task.
                # We need to ensure we cleanup though.
                await shutdown_task
            finally:
                # Clear the output message queue.
                while not self._output_message_queue.empty():
                    self._output_message_queue.get_nowait()

                # Indicate that the team is no longer running.
                self._is_running = False