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
    ComponentBase,
)

from autogen_agentchat.base import (
    TaskRunner,
    )

from autogen_agentchat.state import BaseState

from autogen_agentchat.messages import (
    BaseAgentEvent,
    BaseChatMessage,)


class BaseGroupChatRunner(ABC, TaskRunner, ComponentBase[BaseModel]):
    """The base class for group chat runners."""

    component_type = "group_chat_runner"

    @abstractmethod
    async def reset(self) -> None:
        """Reset the team and all its participants to its initial state."""
        ...

    @abstractmethod
    async def pause(self) -> None:
        """Pause the team and all its participants. This is useful for
        pausing the :meth:`autogen_agentchat.base.TaskRunner.run` or
        :meth:`autogen_agentchat.base.TaskRunner.run_stream` methods from
        concurrently, while keeping them alive."""
        ...

    @abstractmethod
    async def resume(self) -> None:
        """Resume the team and all its participants from a pause after
        :meth:`pause` was called."""
        ...

    @abstractmethod
    async def save_state(self) -> Mapping[str, Any]:
        """Save the current state of the team."""
        ...

    @abstractmethod
    async def load_state(self, state: Mapping[str, Any]) -> None:
        """Load the state of the team."""
        ...

    @abstractmethod
    async def validate_group_state(self, messages: List[BaseChatMessage] | None) -> None:
        """Validate the state of the group chat given the start messages.
        This is executed when the group chat manager receives a GroupChatStart event.

        Args:
            messages: A list of chat messages to validate, or None if no messages are provided.
        """
        ...

    @abstractmethod
    async def select_speaker(self, thread: List[BaseAgentEvent | BaseChatMessage]) -> str:
        """Select a speaker from the participants and return the
        topic type of the selected speaker."""
        ...

    


