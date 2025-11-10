
import asyncio

from typing import (
    Any, 
    List, 
    Callable, 
    Mapping,
    Dict,
    AsyncGenerator,
    Sequence,
    cast,
    )

from autogen_core import (
    AgentId,
    CancellationToken,
    SingleThreadedAgentRuntime,
    AgentRuntime
)

from autogen_agentchat.base import ChatAgent, TaskResult, TerminationCondition
from autogen_agentchat.messages import (
    BaseAgentEvent, 
    AgentEvent, 
    BaseChatMessage, 
    ChatMessage, 
    MessageFactory,
    ModelClientStreamingChunkEvent, 
    StopMessage,
    TextMessage)
from autogen_agentchat.teams._group_chat._events import (
    GroupChatStart, 
    GroupChatTermination,
    SerializableException,
    )
from autogen_agentchat.teams._group_chat._sequential_routed_agent import SequentialRoutedAgent
from autogen_agentchat.teams._group_chat._base_group_chat_manager import BaseGroupChatManager
from autogen_agentchat.teams import BaseGroupChat
from autogen_agentchat.state import BaseState, TeamState

from drsai.modules.managers.database import DatabaseManager



class BaseManagerState(BaseState):
    """The state of the RoundRobinGroupChatManager."""

    message_thread: List[Dict[str, Any]] = []
    current_turn: int = 0
    is_paused: bool = False

class AGBaseGroupChatManager(BaseGroupChatManager):

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
        message_factory: MessageFactory,
        emit_team_events: bool = False,
        db_manager: DatabaseManager = None,
        **kwargs: Any
    ):
        
        super().__init__(
            name=name,
            group_topic_type=group_topic_type,
            output_topic_type=output_topic_type,
            participant_topic_types=participant_topic_types,
            participant_names=participant_names,
            participant_descriptions=participant_descriptions,
            output_message_queue=output_message_queue,
            termination_condition=termination_condition,
            max_turns=max_turns,
            message_factory=message_factory,
            emit_team_events=emit_team_events,
        )
        self._db_manager: DatabaseManager = db_manager
        
        self._is_paused = False

    async def pause(self) -> None:
        """Pause the group chat manager."""
        self._is_paused = True

    async def resume(self) -> None:
        """Resume the group chat manager."""
        self._is_paused = False

    async def close(self) -> None:
        """Close any resources."""
        pass

    async def reset(self) -> None:
        self._current_turn = 0
        self._message_thread.clear()
        if self._termination_condition is not None:
            await self._termination_condition.reset()
        self._is_paused = False

    async def save_state(self) -> Mapping[str, Any]:
        state = BaseManagerState(
            message_thread=[
                cast(Dict[str, Any], message.dump()) for message in self._message_thread
            ],
            current_turn=0,
            is_paused=False,
        )
        return state.model_dump()
    
    async def load_state(self, state: Mapping[str, Any]) -> None:
        base_state = BaseManagerState.model_validate(state)
        self._message_thread = [
            self._message_factory.create(message)
            for message in base_state.message_thread
        ]
        self._current_turn = base_state.current_turn
        self._is_paused = base_state.is_paused
    
    async def validate_group_state(
        self, messages: List[BaseChatMessage] | None
    ) -> None:
        pass

class AGGroupChat(BaseGroupChat):

    component_type = "team"

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
        **kwargs: Any
    ):
        super().__init__(
            participants=participants,
            group_chat_manager_name=group_chat_manager_name,
            group_chat_manager_class=group_chat_manager_class,
            termination_condition=termination_condition,
            max_turns=max_turns,
            runtime=runtime,
            custom_message_types=custom_message_types,
            emit_team_events=emit_team_events,
            )
        self._db_manager: DatabaseManager = db_manager
        self._is_paused = False

    @property
    def participants(self) -> List[ChatAgent]:
        """
        Get the list of participants in the group chat.

        Returns:
            List[ChatAgent]: The list of participants.
        """
        return self._participants
    
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
        message_factory: MessageFactory,
        **kwargs: Any
    ) -> Callable[[], AGBaseGroupChatManager]:
        def _factory() -> AGBaseGroupChatManager:
            return AGBaseGroupChatManager(
                name = name,
                group_topic_type = group_topic_type,
                output_topic_type = output_topic_type,
                participant_topic_types = participant_topic_types,
                participant_names = participant_names,
                participant_descriptions = participant_descriptions,
                output_message_queue = output_message_queue,
                termination_condition = termination_condition,
                max_turns = max_turns,
                message_factory = message_factory,
                db_manager = self._db_manager,
                **kwargs, 
            )

        return _factory
    
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
        
        if self._is_running:
            yield ModelClientStreamingChunkEvent(content="The team is already running, it cannot run again until it is stopped.", source="Manager")
            textmessage=TextMessage(content="The team is already running, it cannot run again until it is stopped.", source="Manager")
            yield textmessage
            yield TaskResult(messages = [textmessage], stop_reason="stop")
            return
        
        if self._is_paused:
            yield ModelClientStreamingChunkEvent(content="The team is paused, please resume it before running again.", source="Manager")
            textmessage=TextMessage(content="The team is paused, please resume it before running again.", source="Manager")
            yield textmessage
            yield TaskResult(messages = [textmessage], stop_reason="stop")
            return

        # Create the messages list if the task is a string or a chat message.
        messages: List[BaseChatMessage] | None = None
        if task is None:
            pass
        elif isinstance(task, str):
            messages = [TextMessage(content=task, source="user", metadata={"internal": "yes"})]
        elif isinstance(task, BaseChatMessage):
            task.metadata["internal"] = "yes"
            messages = [task]
        elif isinstance(task, list):
            if not task:
                raise ValueError("Task list cannot be empty.")
            messages = []
            for msg in task:
                msg.metadata["internal"] = "yes"
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
    
    async def pause(self) -> None:
        """Pause the group chat."""
        orchestrator = await self._runtime.try_get_underlying_agent_instance(
            AgentId(type=self._group_chat_manager_topic_type, key=self._team_id),
            type=AGBaseGroupChatManager,
        )
        await orchestrator.pause()
        for agent in self._participants:
            if hasattr(agent, "pause"):
                await agent.pause()  # type: ignore
        
        self._is_running = False
        self._is_paused = True

    async def resume(self) -> None:
        """Resume the group chat."""
        orchestrator = await self._runtime.try_get_underlying_agent_instance(
            AgentId(type=self._group_chat_manager_topic_type, key=self._team_id),
            type=AGBaseGroupChatManager,
        )
        await orchestrator.resume()
        for agent in self._participants:
            if hasattr(agent, "resume"):
                await agent.resume()  # type: ignore
        
        self._is_paused = False

    async def lazy_init(self) -> None:
        """Initialize any lazy-loaded components."""
        for agent in self._participants:
            if hasattr(agent, "lazy_init"):
                await agent.lazy_init()  # type: ignore

    async def close(self) -> None:
        """Close all resources."""
        # Prepare a list of closable agents
        closable_agents: List[AGBaseGroupChatManager | ChatAgent] = [
            agent for agent in self._participants if hasattr(agent, "close")
        ]
        # Check if we can close the orchestrator
        orchestrator = await self._runtime.try_get_underlying_agent_instance(
            AgentId(type=self._group_chat_manager_topic_type, key=self._team_id),
            type=AGBaseGroupChatManager,
        )
        if hasattr(orchestrator, "close"):
            closable_agents.append(orchestrator)

        # Close all closable agents concurrently
        await asyncio.gather(
            *(agent.close() for agent in closable_agents), return_exceptions=True
        )

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