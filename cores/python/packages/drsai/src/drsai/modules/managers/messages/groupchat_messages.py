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
from autogen_agentchat.messages import (
    BaseAgentEvent,
    BaseChatMessage,
    )
from .agent_messages import AgentLongTaskMessage, LongTaskQueryMessage
from pydantic import BaseModel
from typing import (
    List,
    Mapping,
    Sequence,
    )

class GroupChatLazyInit(BaseModel):
    
    ...

class GroupChatClose(BaseModel):
    
    ...

class GroupChatAgentLongTask(BaseModel):
    
    message: AgentLongTaskMessage | LongTaskQueryMessage
    
    