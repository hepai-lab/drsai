import asyncio
from typing import (
    List, 
    Optional, 
    Dict, 
    Any, 
    Union, 
    Tuple,
    Mapping,
    Sequence,
    AsyncGenerator,
    Callable,
    )

from pydantic import BaseModel, ValidationError
import uuid

from autogen_core import (
    AgentId,
    AgentRuntime,
    AgentType,
    CancellationToken,
    ComponentBase,
    SingleThreadedAgentRuntime,
    TypeSubscription,
)

from autogen_agentchat.base import (
    ChatAgent, 
    Team,
    TaskResult, 
    Response,
    TerminationCondition,
    TaskRunner,
    )
from typing import Any, Callable, List, Mapping
from loguru import logger

from autogen_core import AgentRuntime, Component, ComponentModel, CancellationToken
from pydantic import BaseModel

from autogen_agentchat.base import ChatAgent, TerminationCondition
# from autogen_agentchat.messages import BaseAgentEvent, BaseChatMessage, HandoffMessage, MessageFactory
from autogen_agentchat.state import SwarmManagerState
from autogen_agentchat.teams._group_chat._events import (
    GroupChatAgentResponse,
    GroupChatRequestPublish,
    GroupChatStart,
    GroupChatTermination,
)
from autogen_agentchat.messages import (
    BaseAgentEvent,
    BaseChatMessage,
    AgentEvent,
    ChatMessage,
    HandoffMessage,
    MemoryQueryEvent,
    ModelClientStreamingChunkEvent,
    TextMessage,
    ToolCallExecutionEvent,
    ToolCallRequestEvent,
    ToolCallSummaryMessage,
    UserInputRequestedEvent,
    ThoughtEvent,
    StructuredMessageFactory,
    MultiModalMessage,
    Image,
    # MessageFactory,
    StructuredMessage,
    StopMessage,
)
from drsai.modules.managers.messages.agent_messages import (
    AgentLongTaskMessage, 
    LongTaskQueryMessage,
    ToolLongTaskEvent,
    AgentLogEvent,
    DrSaiMessageFactory,
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
from drsai.modules.managers.messages.groupchat_messages import (
    GroupChatAgentLongTask,
    GroupChatLazyInit,
    GroupChatClose
    )

# from autogen_agentchat.teams import BaseGroupChat
# from autogen_agentchat.teams._group_chat._base_group_chat_manager import BaseGroupChatManager
# from drsai.modules.groupchat.ag_base_group_chat import AGGroupChat, AGBaseGroupChatManager
from drsai.modules.groupchat.drsai_base_group_chat import DrSaiBaseGroupChat
from drsai.modules.groupchat.drsai_base_group_chat_manager import DrSaiBaseGroupChatManager
from drsai.modules.managers.database import DatabaseManager

class AGSwarmGroupChatManager(DrSaiBaseGroupChatManager):
    """A group chat manager that selects the next speaker based on handoff message only."""

    def __init__(
        self,
        name: str,
        group_topic_type: str,
        output_topic_type: str,
        participant_topic_types: List[str],
        participant_names: List[str],
        participant_descriptions: List[str],
        output_message_queue: asyncio.Queue[BaseAgentEvent | BaseChatMessage | GroupChatTermination],
        termination_condition: TerminationCondition | None,
        max_turns: int | None,
        message_factory: DrSaiMessageFactory,
        emit_team_events: bool,
        db_manager: DatabaseManager = None,
        **kwargs: Any
    ) -> None:
        super().__init__(
            name,
            group_topic_type,
            output_topic_type,
            participant_topic_types,
            participant_names,
            participant_descriptions,
            output_message_queue,
            termination_condition,
            max_turns,
            message_factory,
            emit_team_events,
            db_manager=db_manager,
            **kwargs
        )
        self._current_speaker = self._participant_names[0]

    async def validate_group_state(self, messages: List[BaseChatMessage] | None) -> None:
        """Validate the start messages for the group chat."""
        # Check if any of the start messages is a handoff message.
        if messages:
            for message in messages:
                if isinstance(message, HandoffMessage):
                    if message.target not in self._participant_names:
                        raise ValueError(
                            f"The target {message.target} is not one of the participants {self._participant_names}. "
                            "If you are resuming Swarm with a new HandoffMessage make sure to set the target to a valid participant as the target."
                        )
                    return

        # Check if there is a handoff message in the thread that is not targeting a valid participant.
        for existing_message in reversed(self._message_thread):
            if isinstance(existing_message, HandoffMessage):
                if existing_message.target not in self._participant_names:
                    raise ValueError(
                        f"The existing handoff target {existing_message.target} is not one of the participants {self._participant_names}. "
                        "If you are resuming Swarm with a new task make sure to include in your task "
                        "a HandoffMessage with a valid participant as the target. For example, if you are "
                        "resuming from a HandoffTermination, make sure the new task is a HandoffMessage "
                        "with a valid participant as the target."
                    )
                # The latest handoff message should always target a valid participant.
                # Do not look past the latest handoff message.
                return

    async def reset(self) -> None:
        self._current_turn = 0
        self._message_thread.clear()
        if self._termination_condition is not None:
            await self._termination_condition.reset()
        self._current_speaker = self._participant_names[0]

    async def select_speaker(self, thread: List[BaseAgentEvent | BaseChatMessage]) -> str:
        """Select a speaker from the participants based on handoff message.
        Looks for the last handoff message in the thread to determine the next speaker."""
        if len(thread) == 0:
            return self._current_speaker
        for message in reversed(thread):
            if isinstance(message, HandoffMessage):
                self._current_speaker = message.target
                # The latest handoff message should always target a valid participant.
                assert self._current_speaker in self._participant_names
                return self._current_speaker
        return self._current_speaker

    async def save_state(self) -> Mapping[str, Any]:
        state = SwarmManagerState(
            message_thread=[msg.dump() for msg in self._message_thread],
            current_turn=self._current_turn,
            current_speaker=self._current_speaker,
        )
        return state.model_dump()

    async def load_state(self, state: Mapping[str, Any]) -> None:
        swarm_state = SwarmManagerState.model_validate(state)
        self._message_thread = [self._message_factory.create(message) for message in swarm_state.message_thread]
        self._current_turn = swarm_state.current_turn
        self._current_speaker = swarm_state.current_speaker
    
    async def pause(self, cancellation_token: CancellationToken|None = None, **kwargs) -> None:
        """Pause the group chat manager."""
        logger.info(f"Pausing DrSaiSwarmGroupChatManager...")
        self._is_paused = True

    async def resume(self, cancellation_token: CancellationToken|None = None, **kwargs) -> None:
        """Resume the group chat manager."""
        self._is_paused = False

    async def close(self, cancellation_token: CancellationToken|None = None, **kwargs) -> None:
        """Close any resources."""
        self._is_paused = True
        logger.info(f"Closing DrSaiSwarmGroupChatManager...")



class AGSwarmConfig(BaseModel):
    """The declarative configuration for Swarm."""

    participants: List[ComponentModel]
    termination_condition: ComponentModel | None = None
    max_turns: int | None = None
    emit_team_events: bool = False


class AGSwarm(DrSaiBaseGroupChat, Component[AGSwarmConfig]):
    """A group chat team that selects the next speaker based on handoff message only.

    The first participant in the list of participants is the initial speaker.
    The next speaker is selected based on the :class:`~autogen_agentchat.messages.HandoffMessage` message
    sent by the current speaker. If no handoff message is sent, the current speaker
    continues to be the speaker.

    Args:
        participants (List[ChatAgent]): The agents participating in the group chat. The first agent in the list is the initial speaker.
        termination_condition (TerminationCondition, optional): The termination condition for the group chat. Defaults to None.
            Without a termination condition, the group chat will run indefinitely.
        max_turns (int, optional): The maximum number of turns in the group chat before stopping. Defaults to None, meaning no limit.
        custom_message_types (List[type[BaseAgentEvent | BaseChatMessage]], optional): A list of custom message types that will be used in the group chat.
            If you are using custom message types or your agents produces custom message types, you need to specify them here.
            Make sure your custom message types are subclasses of :class:`~autogen_agentchat.messages.BaseAgentEvent` or :class:`~autogen_agentchat.messages.BaseChatMessage`.
        emit_team_events (bool, optional): Whether to emit team events through :meth:`BaseGroupChat.run_stream`. Defaults to False.

    Basic example:

        .. code-block:: python

            import asyncio
            from autogen_ext.models.openai import OpenAIChatCompletionClient
            from autogen_agentchat.agents import AssistantAgent
            from autogen_agentchat.teams import Swarm
            from autogen_agentchat.conditions import MaxMessageTermination


            async def main() -> None:
                model_client = OpenAIChatCompletionClient(model="gpt-4o")

                agent1 = AssistantAgent(
                    "Alice",
                    model_client=model_client,
                    handoffs=["Bob"],
                    system_message="You are Alice and you only answer questions about yourself.",
                )
                agent2 = AssistantAgent(
                    "Bob", model_client=model_client, system_message="You are Bob and your birthday is on 1st January."
                )

                termination = MaxMessageTermination(3)
                team = Swarm([agent1, agent2], termination_condition=termination)

                stream = team.run_stream(task="What is bob's birthday?")
                async for message in stream:
                    print(message)


            asyncio.run(main())


    Using the :class:`~autogen_agentchat.conditions.HandoffTermination` for human-in-the-loop handoff:

        .. code-block:: python

            import asyncio
            from autogen_ext.models.openai import OpenAIChatCompletionClient
            from autogen_agentchat.agents import AssistantAgent
            from autogen_agentchat.teams import Swarm
            from autogen_agentchat.conditions import HandoffTermination, MaxMessageTermination
            from autogen_agentchat.ui import Console
            from autogen_agentchat.messages import HandoffMessage


            async def main() -> None:
                model_client = OpenAIChatCompletionClient(model="gpt-4o")

                agent = AssistantAgent(
                    "Alice",
                    model_client=model_client,
                    handoffs=["user"],
                    system_message="You are Alice and you only answer questions about yourself, ask the user for help if needed.",
                )
                termination = HandoffTermination(target="user") | MaxMessageTermination(3)
                team = Swarm([agent], termination_condition=termination)

                # Start the conversation.
                await Console(team.run_stream(task="What is bob's birthday?"))

                # Resume with user feedback.
                await Console(
                    team.run_stream(
                        task=HandoffMessage(source="user", target="Alice", content="Bob's birthday is on 1st January.")
                    )
                )


            asyncio.run(main())
    """

    component_config_schema = AGSwarmConfig
    component_provider_override = "drsai.AGSwarm"

    # TODO: Add * to the constructor to separate the positional parameters from the kwargs.
    # This may be a breaking change so let's wait until a good time to do it.
    def __init__(
        self,
        participants: List[ChatAgent],
        termination_condition: TerminationCondition | None = None,
        max_turns: int | None = None,
        runtime: AgentRuntime | None = None,
        custom_message_types: List[type[BaseAgentEvent | BaseChatMessage]] | None = None,
        emit_team_events: bool = False,
        db_manager: DatabaseManager = None,
        **kwargs: Any
    ) -> None:
        super().__init__(
            participants,
            group_chat_manager_name="AGSwarmGroupChatManager",
            group_chat_manager_class=AGSwarmGroupChatManager,
            termination_condition=termination_condition,
            max_turns=max_turns,
            runtime=runtime,
            custom_message_types=custom_message_types,
            emit_team_events=emit_team_events,
            db_manager=db_manager,
            **kwargs
        )
        # The first participant must be able to produce handoff messages.
        first_participant = self._participants[0]
        if HandoffMessage not in first_participant.produced_message_types:
            raise ValueError("The first participant must be able to produce a handoff messages.")

    def _create_group_chat_manager_factory(
        self,
        name: str,
        group_topic_type: str,
        output_topic_type: str,
        participant_topic_types: List[str],
        participant_names: List[str],
        participant_descriptions: List[str],
        output_message_queue: asyncio.Queue[BaseAgentEvent | BaseChatMessage | GroupChatTermination],
        termination_condition: TerminationCondition | None,
        max_turns: int | None,
        message_factory: DrSaiMessageFactory,
        **kwargs: Any
    ) -> Callable[[], AGSwarmGroupChatManager]:
        def _factory() -> AGSwarmGroupChatManager:
            return AGSwarmGroupChatManager(
                name,
                group_topic_type,
                output_topic_type,
                participant_topic_types,
                participant_names,
                participant_descriptions,
                output_message_queue,
                termination_condition,
                max_turns,
                message_factory,
                self._emit_team_events,
                db_manager=self._db_manager,
                **kwargs, 
            )

        return _factory
    
    async def pause(self, cancellation_token: CancellationToken|None = None, **kwargs) -> None:
        """Pause the group chat."""
        orchestrator = await self._runtime.try_get_underlying_agent_instance(
            AgentId(type=self._group_chat_manager_topic_type, key=self._team_id),
            type=AGSwarmGroupChatManager,
        )
        await orchestrator.pause()
        for agent in self._participants:
            if hasattr(agent, "pause"):
                await agent.pause()  # type: ignore

    async def resume(self, cancellation_token: CancellationToken|None = None, **kwargs) -> None:
        """Resume the group chat."""
        orchestrator = await self._runtime.try_get_underlying_agent_instance(
            AgentId(type=self._group_chat_manager_topic_type, key=self._team_id),
            type=AGSwarmGroupChatManager,
        )
        await orchestrator.resume()
        for agent in self._participants:
            if hasattr(agent, "resume"):
                await agent.resume()  # type: ignore

    async def lazy_init(self, cancellation_token: CancellationToken|None = None, **kwargs) -> None:
        """Initialize any lazy-loaded components."""
        for agent in self._participants:
            if hasattr(agent, "lazy_init"):
                await agent.lazy_init()  # type: ignore

    async def close(self, cancellation_token: CancellationToken|None = None, **kwargs) -> None:
        """Close all resources."""
        # Prepare a list of closable agents
        closable_agents: List[AGSwarmGroupChatManager | ChatAgent] = [
            agent for agent in self._participants if hasattr(agent, "close")
        ]
        # Check if we can close the orchestrator
        orchestrator = await self._runtime.try_get_underlying_agent_instance(
            AgentId(type=self._group_chat_manager_topic_type, key=self._team_id),
            type=AGSwarmGroupChatManager,
        )
        if hasattr(orchestrator, "close"):
            closable_agents.append(orchestrator)

        # Close all closable agents concurrently
        await asyncio.gather(
            *(agent.close() for agent in closable_agents), return_exceptions=True
        )

    async def _get_history_messages(
        self,
    ) -> List[BaseChatMessage]:
        
        orchestrator = await self._runtime.try_get_underlying_agent_instance(
            AgentId(type=self._group_chat_manager_topic_type, key=self._team_id),
            type=AGSwarmGroupChatManager,
        )

        return orchestrator._message_thread
        
    async def run_stream(
        self,
        *,
        task: str | BaseChatMessage | Sequence[BaseChatMessage] | None = None,
        cancellation_token: CancellationToken | None = None,
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | TaskResult, None]:
        """Run the team and produces a stream of messages and the final result
        of the type :class:`~autogen_agentchat.base.TaskResult` as the last item in the stream. Once the
        team is stopped, the termination condition is reset.

        .. note::

            If an agent produces :class:`~autogen_agentchat.messages.ModelClientStreamingChunkEvent`,
            the message will be yielded in the stream but it will not be included in the
            :attr:`~autogen_agentchat.base.TaskResult.messages`.

        Args:
            task (str | BaseChatMessage | Sequence[BaseChatMessage] | None): The task to run the team with. Can be a string, a single :class:`BaseChatMessage` , or a list of :class:`BaseChatMessage`.
            cancellation_token (CancellationToken | None): The cancellation token to kill the task immediately.
                Setting the cancellation token potentially put the team in an inconsistent state,
                and it may not reset the termination condition.
                To gracefully stop the team, use :class:`~autogen_agentchat.conditions.ExternalTermination` instead.

        Returns:
            stream: an :class:`~collections.abc.AsyncGenerator` that yields :class:`~autogen_agentchat.messages.BaseAgentEvent`, :class:`~autogen_agentchat.messages.BaseChatMessage`, and the final result :class:`~autogen_agentchat.base.TaskResult` as the last item in the stream.
        """

        # Create the messages list if the task is a string or a chat message.
        messages: List[BaseChatMessage] | None = None
        if task is None:
            pass
        elif isinstance(task, str):
            messages = [TextMessage(content=task, source="user")]
        elif isinstance(task, BaseChatMessage):
            messages = [task]
        elif isinstance(task, list):
            if not task:
                raise ValueError("Task list cannot be empty.")
            messages = []
            for msg in task:
                if not isinstance(msg, BaseChatMessage):
                    raise ValueError("All messages in task list must be valid BaseChatMessage types")
                messages.append(msg)
        else:
            raise ValueError("Task must be a string, a BaseChatMessage, or a list of BaseChatMessage.")
        # Check if the messages types are registered with the message factory.
        if messages is not None:
            for msg in messages:
                if not self._message_factory.is_registered(msg.__class__):
                    raise ValueError(
                        f"Message type {msg.__class__} is not registered with the message factory. "
                        "Please register it with the message factory by adding it to the "
                        "custom_message_types list when creating the team."
                    )
        
        # Set the cancellation token.
        if cancellation_token is None:
            cancellation_token = CancellationToken()
        self._cancellation_token = cancellation_token

        if self._is_running:
            raise ValueError("The team is already running, it cannot run again until it is stopped.")
        self._is_running = True

        if self._embedded_runtime:
            # Start the embedded runtime.
            assert isinstance(self._runtime, SingleThreadedAgentRuntime)
            self._runtime.start()

        if not self._initialized:
            await self._init(self._runtime)

        shutdown_task: asyncio.Task[None] | None = None
        if self._embedded_runtime:

            async def stop_runtime() -> None:
                assert isinstance(self._runtime, SingleThreadedAgentRuntime)
                try:
                    # This will propagate any exceptions raised.
                    await self._runtime.stop_when_idle()
                    # Put a termination message in the queue to indicate that the group chat is stopped for whatever reason
                    # but not due to an exception.
                    await self._output_message_queue.put(
                        GroupChatTermination(
                            message=StopMessage(
                                content="The group chat is stopped.", source=self._group_chat_manager_name
                            )
                        )
                    )
                except Exception as e:
                    # Stop the consumption of messages and end the stream.
                    # NOTE: we also need to put a GroupChatTermination event here because when the runtime
                    # has an exception, the group chat manager may not be able to put a GroupChatTermination event in the queue.
                    # This may not be necessary if the group chat manager is able to handle the exception and put the event in the queue.
                    await self._output_message_queue.put(
                        GroupChatTermination(
                            message=StopMessage(
                                content="An exception occurred in the runtime.", source=self._group_chat_manager_name
                            ),
                            error=SerializableException.from_exception(e),
                        )
                    )

            # Create a background task to stop the runtime when the group chat
            # is stopped or has an exception.
            shutdown_task = asyncio.create_task(stop_runtime())

        try:
            history_messages = await self._get_history_messages()
            if history_messages:
                if isinstance(history_messages[-1], HandoffMessage):
                    messages[-1] = HandoffMessage(
                        source="user",
                        target=history_messages[-1].source,
                        content=messages[-1].content,
                    )
            # Run the team by sending the start message to the group chat manager.
            # The group chat manager will start the group chat by relaying the message to the participants
            # and the group chat manager.
            await self._runtime.send_message(
                GroupChatStart(messages=messages),
                recipient=AgentId(type=self._group_chat_manager_topic_type, key=self._team_id),
                cancellation_token=cancellation_token,
            )
            # Collect the output messages in order.
            output_messages: List[BaseAgentEvent | BaseChatMessage] = []
            stop_reason: str | None = None
            # Yield the messsages until the queue is empty.
            while True:
                message_future = asyncio.ensure_future(self._output_message_queue.get())
                if cancellation_token is not None:
                    cancellation_token.link_future(message_future)
                # Wait for the next message, this will raise an exception if the task is cancelled.
                message = await message_future
                if isinstance(message, GroupChatTermination):
                    # If the message contains an error, we need to raise it here.
                    # This will stop the team and propagate the error.
                    if message.error is not None:
                        raise RuntimeError(str(message.error))
                    stop_reason = message.message.content
                    break
                yield message
                if isinstance(message, HandoffMessage):
                    # Skip the model client streaming start events.
                    yield ModelClientStreamingChunkEvent(source=message.source, content=message.content)
                    if message.target == "user":
                        break
                if isinstance(message, ModelClientStreamingChunkEvent):
                    # Skip the model client streaming chunk events.
                    continue
                output_messages.append(message)

            # Yield the final result.
            yield TaskResult(messages=output_messages, stop_reason=stop_reason)

        finally:
            try:
                if shutdown_task is not None:
                    # Wait for the shutdown task to finish.
                    # This will propagate any exceptions raised.
                    await shutdown_task
            finally:
                # Clear the output message queue.
                while not self._output_message_queue.empty():
                    self._output_message_queue.get_nowait()

                # Indicate that the team is no longer running.
                self._is_running = False

    def _to_config(self) -> AGSwarmConfig:
        participants = [participant.dump_component() for participant in self._participants]
        termination_condition = self._termination_condition.dump_component() if self._termination_condition else None
        return AGSwarmConfig(
            participants=participants,
            termination_condition=termination_condition,
            max_turns=self._max_turns,
            emit_team_events=self._emit_team_events,
        )

    @classmethod
    def _from_config(cls, config: AGSwarmConfig) -> "AGSwarm":
        participants = [ChatAgent.load_component(participant) for participant in config.participants]
        termination_condition = (
            TerminationCondition.load_component(config.termination_condition) if config.termination_condition else None
        )
        return cls(
            participants,
            termination_condition=termination_condition,
            max_turns=config.max_turns,
            emit_team_events=config.emit_team_events,
        )
