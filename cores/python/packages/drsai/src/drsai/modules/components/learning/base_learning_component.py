from abc import ABC, abstractmethod


from pydantic import BaseModel
from typing import List, Dict, Any
from typing_extensions import Self
from autogen_core._component_config import Component, ComponentBase
from autogen_core import (
    CancellationToken, 
    ComponentModel,
    Component
    )
from autogen_core.model_context import ChatCompletionContext

class BaseLearningConfig(BaseModel):
    learning_prompt: str
    model_client: ComponentModel
    db_manager: ComponentModel|None = None


class BaseLearning(ABC, ComponentBase[BaseModel]):

    component_type = "learning"

    @abstractmethod
    async def learn_from_context(
        self,
        model_context: ChatCompletionContext,
        learning_config: BaseLearningConfig,
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
        """Clear all entries from learning"""
        ...

    @abstractmethod
    async def close(self) -> None:
        """Clean up any resources used by the learning implementation."""
        ...
