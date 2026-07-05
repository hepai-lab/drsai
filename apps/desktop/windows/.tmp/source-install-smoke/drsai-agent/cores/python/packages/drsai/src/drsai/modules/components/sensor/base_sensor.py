from abc import ABC, abstractmethod


from pydantic import BaseModel
from typing import Sequence, Any
from typing_extensions import Self
from autogen_core._component_config import Component, ComponentBase
from autogen_core import CancellationToken
from autogen_core.model_context import ChatCompletionContext
from autogen_agentchat.messages import BaseChatMessage

class BaseSensorConfig(BaseModel):
    name: str | None = None
    data_url: str | None = None
    api_key: str | None = None


class BaseSensor(ABC, ComponentBase[BaseModel]):

    component_type = "sensor"

    @abstractmethod
    async def get_data(
        self,
        serson_config: BaseSensorConfig,
        cancellation_token: CancellationToken | None = None,
        **kwargs: Any,
    ) -> Any:
        """
        Retrieve data from the sensor.

        Args:
            serson_config: The configuration for the sensor.
            cancellation_token: A cancellation token to cancel the operation.

        Returns:
            Any: The retrieved data.
        """
        ...

    @abstractmethod
    async def update_context(
        self,
        messages: Sequence[BaseChatMessage],
        model_context: ChatCompletionContext,
    ) -> Any:
        """
        Update the provided model context using retrieved data content.

        Args:
            model_context: The context to update.

        Returns:
            Any: The updated model context.
        """
        ...
    
    @abstractmethod
    async def clear(self) -> None:
        """Clear all entries from memory."""
        ...

    @abstractmethod
    async def close(self) -> None:
        """Clean up any resources used by the memory implementation."""
        ...
