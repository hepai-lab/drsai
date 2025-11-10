from autogen_agentchat.messages import (
    BaseAgentEvent,
    BaseChatMessage,)

from typing import Any, Dict, Generic, List, Literal, Mapping, Optional, Type, TypeVar
from enum import Enum 
from pydantic import BaseModel, Field, computed_field
import time

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

    content: str
    content_type: str|None = None
    """A string chunk from the model client."""
    send_time_stamp: float = Field(default_factory=time.time)
    send_level: Send_level = Send_level.INFO
    type: Literal["AgentLogEvent"] = "AgentLogEvent"

    def to_text(self) -> str:
        return f"[{time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(self.send_time_stamp))}] [{self.send_level.value}] {self.content}"