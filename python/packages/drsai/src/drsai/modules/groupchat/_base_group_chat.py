
import asyncio

from typing import (
    Any, 
    List, 
    Callable, 
    Mapping,
    Dict,
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

from drsai.modules.managers.base_thread import Thread
from drsai.modules.managers.threads_manager import ThreadsManager
from drsai.modules.managers.base_thread_message import ThreadMessage, Content, Text



class BaseManagerState(BaseState):
    """The state of the RoundRobinGroupChatManager."""

    message_thread: List[Dict[str, Any]] = []
    current_turn: int = 0
    is_paused: bool = False

class DrSaiGroupChatManager(BaseGroupChatManager):

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
        thread: Thread = None,
        thread_mgr: ThreadsManager = None,
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
        self._thread: Thread = thread
        self._thread_mgr: ThreadsManager = thread_mgr
        
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

class DrSaiGroupChat(BaseGroupChat):

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
        thread: Thread = None,
        thread_mgr: ThreadsManager = None,
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
        self._thread: Thread = thread
        self._thread_mgr: ThreadsManager = thread_mgr

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
    ) -> Callable[[], DrSaiGroupChatManager]:
        def _factory() -> DrSaiGroupChatManager:
            return DrSaiGroupChatManager(
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
                thread = self._thread,
                thread_mgr = self._thread_mgr,
                **kwargs, 
            )

        return _factory
    
    async def pause(self) -> None:
        """Pause the group chat."""
        orchestrator = await self._runtime.try_get_underlying_agent_instance(
            AgentId(type=self._group_chat_manager_topic_type, key=self._team_id),
            type=DrSaiGroupChatManager,
        )
        await orchestrator.pause()
        for agent in self._participants:
            if hasattr(agent, "pause"):
                await agent.pause()  # type: ignore

    async def resume(self) -> None:
        """Resume the group chat."""
        orchestrator = await self._runtime.try_get_underlying_agent_instance(
            AgentId(type=self._group_chat_manager_topic_type, key=self._team_id),
            type=DrSaiGroupChatManager,
        )
        await orchestrator.resume()
        for agent in self._participants:
            if hasattr(agent, "resume"):
                await agent.resume()  # type: ignore

    async def lazy_init(self) -> None:
        """Initialize any lazy-loaded components."""
        for agent in self._participants:
            if hasattr(agent, "lazy_init"):
                await agent.lazy_init()  # type: ignore

    async def close(self) -> None:
        """Close all resources."""
        # Prepare a list of closable agents
        closable_agents: List[DrSaiGroupChatManager | ChatAgent] = [
            agent for agent in self._participants if hasattr(agent, "close")
        ]
        # Check if we can close the orchestrator
        orchestrator = await self._runtime.try_get_underlying_agent_instance(
            AgentId(type=self._group_chat_manager_topic_type, key=self._team_id),
            type=DrSaiGroupChatManager,
        )
        if hasattr(orchestrator, "close"):
            closable_agents.append(orchestrator)

        # Close all closable agents concurrently
        await asyncio.gather(
            *(agent.close() for agent in closable_agents), return_exceptions=True
        )