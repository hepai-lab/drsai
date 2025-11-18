import asyncio
from abc import ABC, abstractmethod
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

from autogen_agentchat.state import BaseState, TeamState

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
from autogen_agentchat.teams._group_chat._sequential_routed_agent import SequentialRoutedAgent

from drsai.modules.managers.database import DatabaseManager
from .drsai_base_agent_container import DrSaiChatAgentContainer



class DrSaiBaseGroupChat(Team, ABC, ComponentBase[BaseModel]):

    component_type = "team"
    component_provider_override = "drsai.modules.groupchat.drsai_base_group_chat.DrSaiBaseGroupChat"

    def __init__(
        self,
        participants: List[ChatAgent],
        group_chat_manager_name: str,
        group_chat_manager_class: type[SequentialRoutedAgent],
        termination_condition: TerminationCondition | None = None,
        max_turns: int | None = None,
        runtime: AgentRuntime | None = None,
        custom_message_types: List[type[BaseAgentEvent | BaseChatMessage]] | None = None,
        emit_team_events: bool = False,
        db_manager: DatabaseManager = None,
        thread_id: str = None,
        user_id: str = None,
    ):
        if len(participants) == 0:
            raise ValueError("At least one participant is required.")
        if len(participants) != len(set(participant.name for participant in participants)):
            raise ValueError("The participant names must be unique.")
        self._participants = participants
        self._base_group_chat_manager_class = group_chat_manager_class
        self._termination_condition = termination_condition
        self._max_turns = max_turns
        self._message_factory = DrSaiMessageFactory()
        if custom_message_types is not None:
            for message_type in custom_message_types:
                self._message_factory.register(message_type)

        for agent in participants:
            for message_type in agent.produced_message_types:
                try:
                    is_registered = self._message_factory.is_registered(message_type)  # type: ignore[reportUnknownArgumentType]
                    if issubclass(message_type, StructuredMessage) and not is_registered:
                        self._message_factory.register(message_type)  # type: ignore[reportUnknownArgumentType]
                except TypeError:
                    # Not a class or not a valid subclassable type (skip)
                    pass

        # The team ID is a UUID that is used to identify the team and its participants
        # in the agent runtime. It is used to create unique topic types for each participant.
        # Currently, team ID is binded to an object instance of the group chat class.
        # So if you create two instances of group chat, there will be two teams with different IDs.
        self._team_id = str(uuid.uuid4())

        # Constants for the group chat team.
        # The names are used to identify the agents within the team.
        # The names may not be unique across different teams.
        self._group_chat_manager_name = group_chat_manager_name
        self._participant_names: List[str] = [participant.name for participant in participants]
        self._participant_descriptions: List[str] = [participant.description for participant in participants]
        # The group chat topic type is used for broadcast communication among all participants and the group chat manager.
        self._group_topic_type = f"group_topic_{self._team_id}"
        # The group chat manager topic type is used for direct communication with the group chat manager.
        self._group_chat_manager_topic_type = f"{self._group_chat_manager_name}_{self._team_id}"
        # The participant topic types are used for direct communication with each participant.
        self._participant_topic_types: List[str] = [
            f"{participant.name}_{self._team_id}" for participant in participants
        ]
        # The output topic type is used for emitting streaming messages from the group chat.
        # The group chat manager will relay the messages to the output message queue.
        self._output_topic_type = f"output_topic_{self._team_id}"
        # The long task topic type is used for long task communication between agents and manager.
        self._long_task_topic_type = f"long_task_topic_{self._team_id}"

        # The queue for collecting the output messages.
        self._output_message_queue: asyncio.Queue[BaseAgentEvent | BaseChatMessage | GroupChatTermination] = (
            asyncio.Queue()
        )

        # Create a runtime for the team.
        if runtime is not None:
            self._runtime = runtime
            self._embedded_runtime = False
        else:
            # Use a embedded single-threaded runtime for the group chat.
            # Background exceptions must not be ignored as it results in non-surfaced exceptions and early team termination.
            self._runtime = SingleThreadedAgentRuntime(ignore_unhandled_exceptions=False)
            self._embedded_runtime = True

        # Flag to track if the group chat has been initialized.
        self._initialized = False

        # Flag to track if the group chat is running.
        self._is_running = False

        # Flag to track if the team events should be emitted.
        self._emit_team_events = emit_team_events

        # For user's customization
        self._thread_id: str|None = thread_id
        self._user_id: str|None= user_id
        self._db_manager: DatabaseManager|None = db_manager

        # For cancellation
        self._cancellation_token: CancellationToken | None = None

    @property
    def participants(self) -> List[ChatAgent]:
        """
        Get the list of participants in the group chat.

        Returns:
            List[ChatAgent]: The list of participants.
        """
        return self._participants
    
    @abstractmethod
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
        emit_team_events: bool,
        db_manager: DatabaseManager,
        thread_id: str,
        user_id: str,
        long_task_topic_type: str,
    ) -> Callable[[], SequentialRoutedAgent]: ...

    def _create_participant_factory(
        self,
        parent_topic_type: str,
        output_topic_type: str,
        agent: ChatAgent,
        message_factory: DrSaiMessageFactory,
        long_task_topic_type: str,
    ) -> Callable[[], DrSaiChatAgentContainer]:
        def _factory() -> DrSaiChatAgentContainer:
            container = DrSaiChatAgentContainer(
                parent_topic_type,
                output_topic_type,
                agent,
                message_factory,
                long_task_topic_type,
            )
            return container

        return _factory
    
    async def _init(self, runtime: AgentRuntime) -> None:
        # Constants for the group chat manager.
        group_chat_manager_agent_type = AgentType(self._group_chat_manager_topic_type)

        # Register participants.
        # Use the participant topic type as the agent type.
        for participant, agent_type in zip(self._participants, self._participant_topic_types, strict=True):
            # Register the participant factory.
            await DrSaiChatAgentContainer.register(
                runtime,
                type=agent_type,
                factory=self._create_participant_factory(
                    self._group_topic_type,
                    self._output_topic_type,
                    participant,
                    self._message_factory,
                    self._long_task_topic_type,
                ),
            )
            # Add subscriptions for the participant.
            # The participant should be able to receive messages from its own topic.
            await runtime.add_subscription(TypeSubscription(topic_type=agent_type, agent_type=agent_type))
            # The participant should be able to receive messages from the group topic.
            await runtime.add_subscription(TypeSubscription(topic_type=self._group_topic_type, agent_type=agent_type))
            # The participant should be able to receive messages from the long task topic.
            await runtime.add_subscription(
                TypeSubscription(topic_type=self._long_task_topic_type, agent_type=agent_type)
            )

        # Register the group chat manager.
        await self._base_group_chat_manager_class.register(
            runtime,
            type=group_chat_manager_agent_type.type,
            factory=self._create_group_chat_manager_factory(
                name=self._group_chat_manager_name,
                group_topic_type=self._group_topic_type,
                output_topic_type=self._output_topic_type,
                participant_names=self._participant_names,
                participant_topic_types=self._participant_topic_types,
                participant_descriptions=self._participant_descriptions,
                output_message_queue=self._output_message_queue,
                termination_condition=self._termination_condition,
                max_turns=self._max_turns,
                message_factory=self._message_factory,
            ),
        )
        # Add subscriptions for the group chat manager.
        # The group chat manager should be able to receive messages from the its own topic.
        await runtime.add_subscription(
            TypeSubscription(
                topic_type=self._group_chat_manager_topic_type, agent_type=group_chat_manager_agent_type.type
            )
        )
        # The group chat manager should be able to receive messages from the group topic.
        await runtime.add_subscription(
            TypeSubscription(topic_type=self._group_topic_type, agent_type=group_chat_manager_agent_type.type)
        )
        # The group chat manager will relay the messages from output topic to the output message queue.
        await runtime.add_subscription(
            TypeSubscription(topic_type=self._output_topic_type, agent_type=group_chat_manager_agent_type.type)
        )
        # The group chat manager should be able to receive messages from the long task topic.
        await runtime.add_subscription(
            TypeSubscription(topic_type=self._long_task_topic_type, agent_type=group_chat_manager_agent_type.type)
        )

        self._initialized = True
    
    async def run(
        self,
        *,
        task: str | BaseChatMessage | Sequence[BaseChatMessage] | None = None,
        cancellation_token: CancellationToken | None = None,
    ) -> TaskResult:
        """Run the team and return the result. The base implementation uses
        :meth:`run_stream` to run the team and then returns the final result.
        Once the team is stopped, the termination condition is reset.

        Args:
            task (str | BaseChatMessage | Sequence[BaseChatMessage] | None): The task to run the team with. Can be a string, a single :class:`BaseChatMessage` , or a list of :class:`BaseChatMessage`.
            cancellation_token (CancellationToken | None): The cancellation token to kill the task immediately.
                Setting the cancellation token potentially put the team in an inconsistent state,
                and it may not reset the termination condition.
                To gracefully stop the team, use :class:`~autogen_agentchat.conditions.ExternalTermination` instead.

        Returns:
            result: The result of the task as :class:`~autogen_agentchat.base.TaskResult`. The result contains the messages produced by the team and the stop reason.
        """
        result: TaskResult | None = None
        async for message in self.run_stream(
            task=task,
            cancellation_token=cancellation_token,
        ):
            if isinstance(message, TaskResult):
                result = message
        if result is not None:
            return result
        raise AssertionError("The stream should have returned the final result.")
    
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
    
    async def lazy_init(self, cancellation_token: CancellationToken|None = None, **kwargs) -> None:
        """Initialize any lazy-loaded components."""
        
        # TODO:
        # if not self._initialized:
        #     await self._init(self._runtime)
        # if self._runtime._run_context is None:
        #     self._runtime.start()

        # # Send a lazy_init message to all participants.
        # for participant_topic_type in self._participant_topic_types:
        #     await self._runtime.send_message(
        #         GroupChatLazyInit(),
        #         recipient=AgentId(type=participant_topic_type, key=self._team_id),
        #     )
        # # Send a pause message to the group chat manager.
        # await self._runtime.send_message(
        #     GroupChatLazyInit(),
        #     recipient=AgentId(type=self._group_chat_manager_topic_type, key=self._team_id),
        # )
        pass
                
    async def reset(self, cancellation_token: CancellationToken|None = None, **kwargs) -> None:
        """Reset the team and its participants to their initial state.

        The team must be stopped before it can be reset.

        Raises:
            RuntimeError: If the team has not been initialized or is currently running.
        """

        if not self._initialized:
            await self._init(self._runtime)

        if self._is_running:
            raise RuntimeError("The group chat is currently running. It must be stopped before it can be reset.")
        self._is_running = True

        if self._embedded_runtime:
            # Start the runtime.
            assert isinstance(self._runtime, SingleThreadedAgentRuntime)
            self._runtime.start()

        try:
            # Send a reset messages to all participants.
            for participant_topic_type in self._participant_topic_types:
                await self._runtime.send_message(
                    GroupChatReset(),
                    recipient=AgentId(type=participant_topic_type, key=self._team_id),
                )
            # Send a reset message to the group chat manager.
            await self._runtime.send_message(
                GroupChatReset(),
                recipient=AgentId(type=self._group_chat_manager_topic_type, key=self._team_id),
            )
        finally:
            if self._embedded_runtime:
                # Stop the runtime.
                assert isinstance(self._runtime, SingleThreadedAgentRuntime)
                await self._runtime.stop_when_idle()

            # Reset the output message queue.
            while not self._output_message_queue.empty():
                self._output_message_queue.get_nowait()

            # Indicate that the team is no longer running.
            self._is_running = False

    async def pause(self, cancellation_token: CancellationToken|None = None, **kwargs) -> None:
        """Pause the group chat."""
        if not self._initialized:
            raise RuntimeError("The group chat has not been initialized. It must be run before it can be paused.")
        if self._cancellation_token is not None and not self._cancellation_token.is_cancelled():
            self._cancellation_token.cancel()
        # Send a pause message to all participants.
        for participant_topic_type in self._participant_topic_types:
            await self._runtime.send_message(
                GroupChatPause(),
                recipient=AgentId(type=participant_topic_type, key=self._team_id),
            )
        # Send a pause message to the group chat manager.
        await self._runtime.send_message(
            GroupChatPause(),
            recipient=AgentId(type=self._group_chat_manager_topic_type, key=self._team_id),
        )
        
        self._is_running = False

    async def resume(self, cancellation_token: CancellationToken|None = None, **kwargs) -> None:
        """Resume the group chat."""
        if not self._initialized:
            raise RuntimeError("The group chat has not been initialized. It must be run before it can be resumed.")

        # Send a resume message to all participants.
        for participant_topic_type in self._participant_topic_types:
            await self._runtime.send_message(
                GroupChatResume(),
                recipient=AgentId(type=participant_topic_type, key=self._team_id),
            )
        # Send a resume message to the group chat manager.
        await self._runtime.send_message(
            GroupChatResume(),
            recipient=AgentId(type=self._group_chat_manager_topic_type, key=self._team_id),
        )

    async def close(self, cancellation_token: CancellationToken|None = None, **kwargs) -> None:
        """Close all resources."""
        if self._cancellation_token is not None and not self._cancellation_token.is_cancelled():
            self._cancellation_token.cancel()
        # Send a pause message to all participants.
        for participant_topic_type in self._participant_topic_types:
            await self._runtime.send_message(
                GroupChatClose(),
                recipient=AgentId(type=participant_topic_type, key=self._team_id),
            )
        # Send a pause message to the group chat manager.
        await self._runtime.send_message(
            GroupChatClose(),
            recipient=AgentId(type=self._group_chat_manager_topic_type, key=self._team_id),
        )
        
        self._is_running = False

    async def save_state(self) -> Mapping[str, Any]:
        """Save the state of the group chat team."""
        if not self._initialized:
            await self._init(self._runtime)

        # Store state of each agent by their name.
        # NOTE: we don't use the agent ID as the key here because we need to be able to decouple
        # the state of the agents from their identities in the agent runtime.
        agent_states: Dict[str, Mapping[str, Any]] = {}
        # Save the state of all participants.
        for name, agent_type in zip(self._participant_names, self._participant_topic_types, strict=True):
            agent_id = AgentId(type=agent_type, key=self._team_id)
            # NOTE: We are using the runtime's save state method rather than the agent instance's
            # save_state method because we want to support saving state of remote agents.
            agent_states[name] = await self._runtime.agent_save_state(agent_id)
        # Save the state of the group chat manager.
        agent_id = AgentId(type=self._group_chat_manager_topic_type, key=self._team_id)
        agent_states[self._group_chat_manager_name] = await self._runtime.agent_save_state(agent_id)
        return TeamState(agent_states=agent_states).model_dump()

    async def load_state(self, state: Mapping[str, Any]) -> None:
        """Load an external state and overwrite the current state of the group chat team."""
        if not self._initialized:
            await self._init(self._runtime)

        if self._is_running:
            raise RuntimeError("The team cannot be loaded while it is running.")
        self._is_running = True

        try:
            team_state = TeamState.model_validate(state)
            # Load the state of all participants.
            for name, agent_type in zip(self._participant_names, self._participant_topic_types, strict=True):
                agent_id = AgentId(type=agent_type, key=self._team_id)
                if name not in team_state.agent_states:
                    raise ValueError(f"Agent state for {name} not found in the saved state.")
                await self._runtime.agent_load_state(agent_id, team_state.agent_states[name])
            # Load the state of the group chat manager.
            agent_id = AgentId(type=self._group_chat_manager_topic_type, key=self._team_id)
            if self._group_chat_manager_name not in team_state.agent_states:
                raise ValueError(f"Agent state for {self._group_chat_manager_name} not found in the saved state.")
            await self._runtime.agent_load_state(agent_id, team_state.agent_states[self._group_chat_manager_name])

        except ValidationError as e:
            raise ValueError(
                "Invalid state format. The expected state format has changed since v0.4.9. "
                "Please read the release note on GitHub."
            ) from e

        finally:
            # Indicate that the team is no longer running.
            self._is_running = False

    async def _get_partial_state(self) -> Mapping[str, Any]:
        """Save the state of the group chat team."""
        try:
            # Save the state of the runtime. This will save the state of the participants and the group chat manager.
            agent_states: Dict[str, Mapping[str, Any]] = {}
            # Save the state of all participants.
            for name, agent_type in zip(
                self._participant_names, self._participant_topic_types, strict=True
            ):
                agent_id = AgentId(type=agent_type, key=self._team_id)
                # NOTE: We are using the runtime's save state method rather than the agent instance's
                # save_state method because we want to support saving state of remote agents.
                agent_states[name] = await self._runtime.agent_save_state(agent_id)
            # Save the state of the group chat manager.
            agent_id = AgentId(
                type=self._group_chat_manager_topic_type, key=self._team_id
            )
            agent_states[
                self._group_chat_manager_name
            ] = await self._runtime.agent_save_state(agent_id)
            return TeamState(agent_states=agent_states).model_dump()
        finally:
            # Indicate that the team is no longer running.
            self._is_running = False