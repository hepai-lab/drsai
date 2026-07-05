import asyncio
import json
from typing import (
    Any,
    Callable,
    Dict,
    List,
    Mapping,
    cast,
    AsyncGenerator,
    Sequence,
)
from loguru import logger
from autogen_core import (
    AgentId,
    AgentRuntime,
    Component,
    ComponentModel,
    DefaultTopicId,
    MessageContext,
    event,
    rpc,
    CancellationToken,
)
from pydantic import BaseModel
from typing_extensions import Self

from autogen_agentchat.base import ChatAgent, TerminationCondition, TaskResult
from autogen_agentchat.messages import (
    BaseAgentEvent,
    BaseChatMessage,
    MessageFactory,
    StopMessage,
    TextMessage,
    ModelClientStreamingChunkEvent,
)

from autogen_agentchat.state import BaseState, TeamState
# from autogen_agentchat.teams._group_chat._base_group_chat import BaseGroupChat
# from autogen_agentchat.teams._group_chat._base_group_chat_manager import (
#     BaseGroupChatManager,
# )
from autogen_agentchat.teams._group_chat._events import (
    GroupChatAgentResponse,
    GroupChatRequestPublish,
    GroupChatStart,
    GroupChatTermination,
)

# from autogen_agentchat.teams import BaseGroupChat
# from autogen_agentchat.teams._group_chat._base_group_chat_manager import BaseGroupChatManager
# from drsai.modules.groupchat.ag_base_group_chat import AGGroupChat, AGBaseGroupChatManager
from drsai.modules.groupchat.drsai_base_group_chat import DrSaiBaseGroupChat
from drsai.modules.groupchat.drsai_base_group_chat_manager import DrSaiBaseGroupChatManager
from drsai.modules.managers.database import DatabaseManager
from drsai.modules.managers.messages.agent_messages import DrSaiMessageFactory

class RoundRobinManagerState(BaseState):
    """The state of the RoundRobinGroupChatManager."""

    message_thread: List[Dict[str, Any]] = []
    current_turn: int = 0
    next_speaker_index: int = 0
    is_paused: bool = False


class RoundRobinGroupChatManager(DrSaiBaseGroupChatManager):
    """A group chat manager that selects the next speaker in a round-robin fashion."""

    def __init__(
        self,
        name: str,
        group_topic_type: str,
        output_topic_type: str,
        participant_topic_types: List[str],
        participant_names: List[str],
        participant_descriptions: List[str],
        output_message_queue: asyncio.Queue[
            BaseAgentEvent | BaseChatMessage | GroupChatTermination
        ],
        termination_condition: TerminationCondition | None,
        max_turns: int | None,
        message_factory: DrSaiMessageFactory,
        db_manager: DatabaseManager = None,
        **kwargs: Any
    ) -> None:
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
            db_manager=db_manager,
            **kwargs
        )
        self._next_speaker_index = 0
        self._is_paused = False

    async def validate_group_state(
        self, messages: List[BaseChatMessage] | None
    ) -> None:
        pass

    async def reset(self) -> None:
        self._current_turn = 0
        self._message_thread.clear()
        if self._termination_condition is not None:
            await self._termination_condition.reset()
        self._next_speaker_index = 0
        self._is_paused = False

    async def save_state(self) -> Mapping[str, Any]:
        state = RoundRobinManagerState(
            message_thread=[
                cast(Dict[str, Any], message.dump()) for message in self._message_thread
            ],
            current_turn=0,
            next_speaker_index=0,
            is_paused=False,
        )
        return state.model_dump()

    async def load_state(self, state: Mapping[str, Any]) -> None:
        round_robin_state = RoundRobinManagerState.model_validate(state)
        self._message_thread = [
            self._message_factory.create(message)
            for message in round_robin_state.message_thread
        ]
        self._current_turn = round_robin_state.current_turn
        self._next_speaker_index = round_robin_state.next_speaker_index
        self._is_paused = round_robin_state.is_paused

    async def pause(self) -> None:
        """Pause the group chat manager."""
        logger.info(f"Pausing RoundRobinGroupChatManager...")
        self._is_paused = True

    async def resume(self) -> None:
        """Resume the group chat manager."""
        self._is_paused = False

    async def close(self) -> None:
        """Close any resources."""
        self._is_paused = True
        logger.info(f"Closing RoundRobinGroupChatManager...")


    async def select_speaker(
        self, thread: List[BaseAgentEvent | BaseChatMessage]
    ) -> str:
        """Select a speaker from the participants in a round-robin fashion."""
        if self._is_paused:
            if self._next_speaker_index>=len(self._participant_names)-1:
                self._next_speaker_index = 0
            else:
                self._next_speaker_index += 1
            # If paused, let the user speak next
            for name in self._participant_names:
                if name == "user_proxy":
                    return name
            # If no user_proxy found, continue with round-robin

        current_speaker_index = self._next_speaker_index
        self._next_speaker_index = (current_speaker_index + 1) % len(
            self._participant_names
        )
        current_speaker = self._participant_names[current_speaker_index]
        return current_speaker

    @rpc
    async def handle_start(self, message: GroupChatStart, ctx: MessageContext) -> None:  # type: ignore
        """Handle the start of a group chat."""
        # Check if the conversation has already terminated.

        if self._is_paused:
            return
        
        if (
            self._termination_condition is not None
            and self._termination_condition.terminated
        ):
            early_stop_message = StopMessage(
                content="The group chat has already terminated.", source=self._name
            )
            await self._signal_termination(early_stop_message)
            return

        assert message is not None and message.messages is not None

        # Send message to all agents with initial user message
        await self.publish_message(
            GroupChatStart(messages=message.messages),
            topic_id=DefaultTopicId(type=self._group_topic_type),
            cancellation_token=ctx.cancellation_token,
        )

        # Add messages to thread
        for m in message.messages:
            self._message_thread.append(m)

        # Select next speaker
        next_speaker = await self.select_speaker(self._message_thread)
        await self.publish_message(
            GroupChatRequestPublish(),
            topic_id=DefaultTopicId(
                type=self._participant_name_to_topic_type[next_speaker]
            ),
            cancellation_token=ctx.cancellation_token,
        )

    @event
    async def handle_agent_response(
        self, message: GroupChatAgentResponse, ctx: MessageContext
    ) -> None:  # type: ignore
        """Handle an agent's response in the group chat."""
        # Add any inner messages to the thread

        if self._is_paused:
            return
        
        delta: List[BaseChatMessage] = []
        if message.agent_response.inner_messages is not None:
            for inner_message in message.agent_response.inner_messages:
                delta.append(inner_message)  # type: ignore
                self._message_thread.append(inner_message)  # type: ignore

        # Add the agent's response to the thread
        self._message_thread.append(message.agent_response.chat_message)
        delta.append(message.agent_response.chat_message)

        # Check termination condition
        if self._termination_condition is not None:
            stop_message = await self._termination_condition(delta)
            if stop_message is not None:
                await self._signal_termination(stop_message)
                await self._termination_condition.reset()
                return

        # Check max turns
        self._current_turn += 1
        if self._max_turns is not None and self._current_turn >= self._max_turns:
            stop_message = StopMessage(
                content=f"Maximum number of turns ({self._max_turns}) reached.",
                source=self._name,
            )
            await self._signal_termination(stop_message)
            return

        # Select and request next speaker
        next_speaker = await self.select_speaker(self._message_thread)
        await self.publish_message(
            GroupChatRequestPublish(),
            topic_id=DefaultTopicId(
                type=self._participant_name_to_topic_type[next_speaker]
            ),
            cancellation_token=ctx.cancellation_token,
        )


class RoundRobinGroupChatConfig(BaseModel):
    """The declarative configuration RoundRobinGroupChat."""

    participants: List[ComponentModel]
    termination_condition: ComponentModel | None = None
    max_turns: int | None = None


class RoundRobinGroupChat(DrSaiBaseGroupChat, Component[RoundRobinGroupChatConfig]):
    """A team that runs a group chat with participants taking turns in a round-robin fashion
    to publish a message to all.
    """

    component_config_schema = RoundRobinGroupChatConfig
    component_provider_override = "drsai.RoundRobinGroupChat"

    def __init__(
        self,
        participants: List[ChatAgent],
        termination_condition: TerminationCondition | None = None,
        max_turns: int | None = None,
        runtime: AgentRuntime | None = None,
        custom_message_types: List[type[BaseAgentEvent | BaseChatMessage]]
        | None = None,
        db_manager: DatabaseManager = None,
        **kwargs: Any
    ) -> None:
        super().__init__(
            participants=participants,
            group_chat_manager_name="RoundRobinGroupChatManager",
            group_chat_manager_class=RoundRobinGroupChatManager,
            termination_condition=termination_condition,
            max_turns=max_turns,
            runtime=runtime,
            custom_message_types=custom_message_types,
            db_manager=db_manager,
            **kwargs
        )

        self._is_paused = False

    def _create_group_chat_manager_factory(
        self,
        name: str,
        group_topic_type: str,
        output_topic_type: str,
        participant_topic_types: List[str],
        participant_names: List[str],
        participant_descriptions: List[str],
        output_message_queue: asyncio.Queue[
            BaseAgentEvent | BaseChatMessage | GroupChatTermination
        ],
        termination_condition: TerminationCondition | None,
        max_turns: int | None,
        message_factory: MessageFactory,
        **kwargs: Any
    ) -> Callable[[], RoundRobinGroupChatManager]:
        def _factory() -> RoundRobinGroupChatManager:
            return RoundRobinGroupChatManager(
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
                db_manager=self._db_manager,
                **kwargs
            )

        return _factory

    def _to_config(self) -> RoundRobinGroupChatConfig:
        participants = [
            participant.dump_component() for participant in self._participants
        ]
        termination_condition = (
            self._termination_condition.dump_component()
            if self._termination_condition
            else None
        )
        return RoundRobinGroupChatConfig(
            participants=participants,
            termination_condition=termination_condition,
            max_turns=self._max_turns,
        )

    @classmethod
    def _from_config(
        cls, 
        config: RoundRobinGroupChatConfig,
        db_manager: DatabaseManager = None,
        **kwargs: Any
        ) -> Self:
        participants = [
            ChatAgent.load_component(participant) for participant in config.participants
        ]
        termination_condition = (
            TerminationCondition.load_component(config.termination_condition)
            if config.termination_condition
            else None
        )
        return cls(
            participants,
            termination_condition=termination_condition,
            max_turns=config.max_turns,
            db_manager=db_manager,
            **kwargs
        )

    async def pause(self, cancellation_token: CancellationToken|None = None, **kwargs) -> None:
        """Pause the group chat."""
        orchestrator = await self._runtime.try_get_underlying_agent_instance(
            AgentId(type=self._group_chat_manager_topic_type, key=self._team_id),
            type=RoundRobinGroupChatManager,
        )
        await orchestrator.pause()
        for agent in self._participants:
            if hasattr(agent, "pause"):
                await agent.pause()  # type: ignore
        
        self._is_running = False
        self._is_paused = True

    async def resume(self, cancellation_token: CancellationToken|None = None, **kwargs) -> None:
        """Resume the group chat."""
        orchestrator = await self._runtime.try_get_underlying_agent_instance(
            AgentId(type=self._group_chat_manager_topic_type, key=self._team_id),
            type=RoundRobinGroupChatManager,
        )
        await orchestrator.resume()
        for agent in self._participants:
            if hasattr(agent, "resume"):
                await agent.resume()  # type: ignore
        
        self._is_paused = False

    async def lazy_init(self, cancellation_token: CancellationToken|None = None, **kwargs) -> None:
        """Initialize any lazy-loaded components."""
        if not self._initialized:
            await self._init(self._runtime)
            
        for agent in self._participants:
            if hasattr(agent, "lazy_init"):
                await agent.lazy_init()  # type: ignore

    async def close(self, cancellation_token: CancellationToken|None = None, **kwargs) -> None:
        """Close all resources."""
        # Prepare a list of closable agents
        closable_agents: List[RoundRobinGroupChatManager | ChatAgent] = [
            agent for agent in self._participants if hasattr(agent, "close")
        ]
        # Check if we can close the orchestrator
        orchestrator = await self._runtime.try_get_underlying_agent_instance(
            AgentId(type=self._group_chat_manager_topic_type, key=self._team_id),
            type=RoundRobinGroupChatManager,
        )
        if hasattr(orchestrator, "close"):
            closable_agents.append(orchestrator)

        # Close all closable agents concurrently
        await asyncio.gather(
            *(agent.close() for agent in closable_agents), return_exceptions=True
        )
