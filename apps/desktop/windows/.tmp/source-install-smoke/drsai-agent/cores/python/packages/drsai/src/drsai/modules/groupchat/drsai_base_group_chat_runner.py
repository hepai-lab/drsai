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
    AsyncGenerator,)

from pydantic import BaseModel

from autogen_core import (
    ComponentModel,
    ComponentBase,
    Component,
    CancellationToken,
    AgentRuntime,
    MessageContext, 
    # event, 
    # rpc,
)

from autogen_agentchat.base import (
    ChatAgent, 
    Team,
    TaskResult, 
    Response,
    TerminationCondition,
    TaskRunner,
    )

from autogen_agentchat.state import BaseState

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
    MessageFactory,
    StopMessage,
    StructuredMessage,
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
from drsai.modules.components.groupchat_running.base_running_deamon import(
    BaseRunTimeDeamon,
    GroupChatEvent,
    handle_group_chat_event,
    )
from drsai.modules.managers.database import DatabaseManager, DatabaseManagerConfig
from drsai import HepAIChatCompletionClient
from .base_group_chat_runner import BaseGroupChatRunner

class DrSaiBaseGroupChatRunnerConfig(BaseModel):
    """The configuration for the base group chat runner."""
    name: str
    max_turns: int
    model_client_config: Mapping[str, Any]
    crrent_turn: int = 0
    current_speaker: str = ""
    message_thread: List[BaseAgentEvent | BaseChatMessage] = []
    message_history: List[BaseChatMessage] = []
    database_manager: DatabaseManagerConfig|None = None
    team_config: Mapping[str, Any] = {}



class DrSaiBaseGroupChatRunner(BaseGroupChatRunner, Component[DrSaiBaseGroupChatRunnerConfig]):

    component_type = "group_chat_runner"
    component_config_schema = DrSaiBaseGroupChatRunnerConfig
    component_provider_override = "drsai.DrSaiBaseGroupChatRunner"

    def __init__(
        self, 
        name: str,
        self_id: str,
        max_turns: int,
        participant_instances: Dict[str, ChatAgent],
        output_message_queue: asyncio.Queue[BaseAgentEvent | BaseChatMessage | GroupChatTermination],
        termination_condition: TerminationCondition,
        model_client: HepAIChatCompletionClient = None,
        messages_history: List[BaseChatMessage] = [],
        sequential_message_types: List[GroupChatEvent] = [
            GroupChatStart, # handle start messages
            GroupChatAgentResponse, # handle agent responses
            GroupChatMessage, # handle GroupChat system messages
            GroupChatPause, # handle pause messages
            GroupChatResume, # handle resume messages
            GroupChatTermination, # handle termination messages
            GroupChatError, # handle error messages
            GroupChatReset, # handle reset messages
            GroupChatRequestPublish, # handle request publish messages
        ],
        emit_team_events: bool = False,
    ):
        
        self._name = name
        self._self_id = self_id
        if max_turns is not None and max_turns <= 0:
            raise ValueError("The maximum number of turns must be greater than 0.")
        self._max_turns = max_turns
        self._current_turn = 0
        self._participant_name_to_descriptions = {
            name: agent.description for name, agent in participant_instances.items()
        }
        self._output_message_queue = output_message_queue
        self._termination_condition = termination_condition
        self._model_client = model_client
        self._emit_team_events = emit_team_events
        self._messages_history = messages_history

        self._message_thread: List[BaseAgentEvent | BaseChatMessage] = []
        self._sequential_message_types = sequential_message_types

        self._current_speaker = ""
    
    @handle_group_chat_event
    async def handle_start(self, message: GroupChatStart, cancellation_token: CancellationToken | None = None) -> None:
        pass
    
    @handle_group_chat_event
    async def handle_agent_response(self, message: GroupChatAgentResponse, cancellation_token: CancellationToken | None = None) -> None:
        pass
    
    @handle_group_chat_event
    async def handle_group_chat_message(self, message: GroupChatMessage, cancellation_token: CancellationToken | None = None) -> None:
        """Handle a group chat message by appending the content to its output message queue."""
        await self._output_message_queue.put(message.message)
    
    @handle_group_chat_event
    async def handle_group_chat_error(self, message: GroupChatError, cancellation_token: CancellationToken | None = None) -> None:
        """Handle a group chat error by logging the error and signaling termination."""
        error = message.error
        termination_event = GroupChatTermination(
            message=StopMessage(content="An error occurred in the group chat.", source=self._name), error=error
        )
        await self._output_message_queue.put(termination_event)

    @handle_group_chat_event
    async def handle_reset(self, message: GroupChatReset, cancellation_token: CancellationToken | None = None) -> None:
        """Reset the group chat manager. Calling :meth:`reset` to reset the group chat manager
        and clear the message thread."""
        await self.reset()

    @handle_group_chat_event
    async def handle_pause(self, message: GroupChatPause, cancellation_token: CancellationToken | None = None) -> None:
        """Pause the group chat manager. This is a no-op in the base class."""
        pass

    @handle_group_chat_event
    async def handle_resume(self, message: GroupChatResume, cancellation_token: CancellationToken | None = None) -> None:
        """Resume the group chat manager. This is a no-op in the base class."""
        pass

    async def select_speaker(self, thread: List[BaseAgentEvent | BaseChatMessage]) -> str:
        """Select a speaker from the participants and return the
        topic type of the selected speaker."""
        pass
    
    async def publish_messages_to_participants(
            self, 
            messages: List[BaseChatMessage], 
            speaker_name: str, 
            cancellation_token: CancellationToken | None = None) -> None:
        """Select a speaker from the participants and return the
        topic type of the selected speaker."""
        pass

    async def reset(self) -> None:
        """Reset the team and all its participants to its initial state."""
        pass

    async def pause(self) -> None:
        """Pause the team and all its participants. This is useful for
        pausing the :meth:`autogen_agentchat.base.TaskRunner.run` or
        :meth:`autogen_agentchat.base.TaskRunner.run_stream` methods from
        concurrently, while keeping them alive."""
        pass

    async def resume(self) -> None:
        """Resume the team and all its participants from a pause after
        :meth:`pause` was called."""
        pass

    async def save_state(self) -> Mapping[str, Any]:
        """Save the current state of the team."""
        pass

    async def load_state(self, state: Mapping[str, Any]) -> None:
        """Load the state of the team."""
        pass

    async def validate_group_state(self, messages: List[BaseChatMessage] | None) -> None:
        """Validate the state of the group chat given the start messages.
        This is executed when the group chat manager receives a GroupChatStart event.

        Args:
            messages: A list of chat messages to validate, or None if no messages are provided.
        """
        pass

    def _to_config(self):
        pass

