from .base_sensor import BaseSensor, BaseSensorConfig
from drsai.modules.components.memory.ragflow_memory import RAGFlowMemoryManager
from typing import List, Dict,Sequence, Any
from typing_extensions import Self
from autogen_core._component_config import Component, ComponentBase
from autogen_core import CancellationToken
from autogen_core.model_context import ChatCompletionContext
from autogen_agentchat.messages import (
    BaseChatMessage,
    TextMessage,
    MultiModalMessage,
    )

class RAGFlowSensorConfig(BaseSensorConfig):
    rag_flow_url: str|None = None
    rag_flow_token: str|None = None
    dataset_id: str|None = None

class RAGFlowSensor(BaseSensor, Component[RAGFlowSensorConfig]):

    component_type = "sensor"
    component_provider_override = "drsai.RAGFlowSensor"
    component_config_schema = RAGFlowSensorConfig

    def __init__(
            self,
            rag_flow_url: str,
            rag_flow_token: str,
            dataset_id: str|None = None,
            ):
       
       self._rag_manager = RAGFlowMemoryManager(
            rag_flow_url=rag_flow_url,
            rag_flow_token=rag_flow_token
        )
       
       self._dataset_id = dataset_id
       
    async def upload_user_files(
            self, 
            messages: Sequence[BaseChatMessage],
            ):
        """
        messages: 
            为前端用户发送的消息列表，位于python/packages/drsai_ui/src/drsai_ui/ui_backend/backend/utils/utils.py，返回messages_return，包括
            [
            TextMessage(source="user", content=combined_text, metadata={"internal": "yes"}),
            MultiModalMessage(source="user",content=[query, *images],metadata={"attached_files": attached_files_json},),
            TextMessage(source="user",content=query,metadata={"attached_files": attached_files_json},)
            ]


        """

        for message in messages:
            if message.content.type == "file":
                await self._rag_manager.add_files_to_dataset_and_parse(
                    dataset_id=self._dataset_id,
                    files_path=message.content.file_path,
                )

    async def update_context(
        self,
        messages: Sequence[BaseChatMessage],
        model_context: ChatCompletionContext,
    ) -> Any:
        """
        Update the provided model context using retrieved data content.

        Args:
            messages: The messages to use for updating the model context.
            model_context: The context to update.

        Returns:
            Any: The updated model context.
        """
        pass
    
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
        pass

    async def clear(self) -> None:
       """Clear all entries from memory."""
       pass

    async def close(self) -> None:
        """Clean up any resources used by the memory implementation."""
        pass
