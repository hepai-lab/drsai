from autogen_agentchat.messages import (
    BaseAgentEvent,
    BaseChatMessage,
    StructuredMessageFactory,
    MessageFactory,
    )
from autogen_core import FunctionCall
from autogen_core.models import (
    UserMessage, 
    SystemMessage, 
    AssistantMessage, 
    FunctionExecutionResultMessage,
    FunctionExecutionResult,
    )
from typing import Any, Dict, Generic, List, Literal, Mapping, Optional, Type, TypeVar, Sequence
from enum import Enum 
from pydantic import BaseModel, Field, computed_field
import time
from drsai.modules.components.task_manager.base_task_system import TaskStatus

# StructuredContentType = TypeVar("StructuredContentType", bound=BaseModel, covariant=True)
# class TaskEvent(BaseAgentEvent, Generic[StructuredContentType]):
#     """An event signaling a text output chunk from a model client in streaming mode."""

#     content: StructuredContentType
#     """A string chunk from the model client."""
#     format_string: Optional[str] = None

#     type: Literal["TaskEvent"] = "TaskEvent"

#     def to_text(self) -> str:
#         if self.format_string is not None:
#             return self.format_string.format(**self.content.model_dump())
#         else:
#             return self.content.model_dump_json()

#     def to_model_text(self) -> str:
#         if self.format_string is not None:
#             return self.format_string.format(**self.content.model_dump())
#         else:
#             return self.content.model_dump_json()


class TaskEvent(BaseAgentEvent):
    content: str|Dict[str, Any]
    type: Literal["TaskEvent"] = "TaskEvent"
    def to_text(self) -> str:
        if isinstance(self.content, str):
            return self.content
        else:
            return self.content.model_dump_json()

class Send_level(str, Enum):
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    DEBUG = "DEBUG"
    TRACE = "TRACE"
    FATAL = "FATAL"
    
class AgentLogEvent(BaseAgentEvent):
    """An event signaling a text output chunk from a model client in streaming mode."""

    content: str|List[FunctionCall|FunctionExecutionResult]
    content_type: str|None = None
    """The type of content, such as web search results, etc."""
    send_time_stamp: float = Field(default_factory=time.time)
    send_level: Send_level = Send_level.INFO
    type: Literal["AgentLogEvent"] = "AgentLogEvent"

    def to_text(self) -> str:
        return f"[{time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(self.send_time_stamp))}] [{self.send_level.value}] {self.content}"

class ToolLongTaskEvent(BaseAgentEvent):
    """An event signaling a text output chunk from a model client in streaming mode."""

    content: str|Dict[str, Any]
    tool_name: str|None = None
    task_status: TaskStatus|str = TaskStatus.queued.value
    """The name of the tool being used."""
    send_time_stamp: float = Field(default_factory=time.time)
    type: Literal["ToolLongTaskEvent"] = "ToolLongTaskEvent"
    def to_text(self) -> str:
        return f"[{time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(self.send_time_stamp))}] [{self.tool_name}] [{self.task_status}] {self.content}"

class LongTaskQueryMessage(BaseChatMessage):
    """An Agent level message that can be used to send long task messages to the user"""

    content: str|Dict[str, Any]
    """The content of the message."""
    query_arguments: Dict[str, Any]|None = None
    """The query arguments for the long task."""
    tool_name: str|None = None
    """The name of the tool being used."""
    
    def to_text(self) -> str:
        if isinstance(self.content, str):
            return self.content
        else:
            return self.content.model_dump_json()

    def to_model_text(self) -> str:
        if isinstance(self.content, str):
            return self.content
        else:
            return self.content.model_dump_json()

    def to_model_message(self) -> UserMessage:
        content = self.to_text()
        return UserMessage(content=content, source=self.source)
    
    type: Literal["LongTaskQueryMessage"] = "LongTaskQueryMessage"

class AgentLongTaskMessage(BaseChatMessage):
    """An Agent level message that can be used to send long task messages to the user"""

    content: str|Dict[str, Any]
    """The content of the message."""
    task_status: TaskStatus|str = TaskStatus.queued.value
    """The status of the task."""
    query_arguments: Dict[str, Any]|None = None
    """The query arguments for the long task."""
    tool_name: str|None = None
    """The name of the tool being used."""
    
    def to_text(self) -> str:
        if isinstance(self.content, str):
            return self.content
        else:
            return self.content.model_dump_json()

    def to_model_text(self) -> str:
        if isinstance(self.content, str):
            return self.content
        else:
            return self.content.model_dump_json()

    def to_model_message(self) -> UserMessage:
        content = self.to_text()
        return UserMessage(content=content, source=self.source)
    
    type: Literal["AgentLongTaskMessage"] = "AgentLongTaskMessage"

class DrSaiMessageFactory(MessageFactory):

    def __init__(self, custom_message_types: Sequence[BaseAgentEvent|BaseChatMessage]|None = None):
        super().__init__()

        self.register(TaskEvent)
        self.register(AgentLogEvent)
        self.register(ToolLongTaskEvent)
        self.register(AgentLongTaskMessage)
        self.register(LongTaskQueryMessage)

        for message_type in custom_message_types or []:
            self.register(message_type)
