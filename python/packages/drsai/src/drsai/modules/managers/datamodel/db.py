# defines how core data types are serialized and stored in the database

from datetime import datetime
from enum import Enum
from typing import Any, List, Optional, Union, Dict

from autogen_core import ComponentModel
from pydantic import field_serializer
from sqlalchemy import ForeignKey, Integer
from sqlmodel import JSON, Column, DateTime, Field, SQLModel, func

from .types import (
    GalleryConfig,
    MessageConfig,
    MessageMeta,
    SettingsConfig,
    TeamResult,
    GalleryComponents,
    GalleryMetadata,
)

class RunStatus(str, Enum):
    CREATED = "created"
    ACTIVE = "active"
    COMPLETE = "complete"
    ERROR = "error"
    STOPPED = "stopped"
    AWAITING_INPUT = "awaiting_input"
    PAUSED = "paused"

class AutoGenMessage(SQLModel, table=True):
    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )  # pylint: disable=not-callable
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )  # pylint: disable=not-callable
    version: Optional[str] = "0.0.1"
    # task info
    user_id: Optional[str] = None # email or other unique identifier
    thread_id: Optional[str] = None # unique identifier for the conversation thread
    # message content
    config: Union[MessageConfig, dict[str, Any]] = Field(
        default_factory=lambda: MessageConfig(source="", content=""),
        sa_column=Column(JSON),
    )
    message_meta: Optional[Union[MessageMeta, dict[str, Any]]] = Field(
        default={}, sa_column=Column(JSON)
    )

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(cls, value: datetime) -> str:
        if isinstance(value, datetime):
            return value.isoformat()

class UserInput(SQLModel, table=True):
    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )  # pylint: disable=not-callable
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )  # pylint: disable=not-callable
    version: Optional[str] = "0.0.1"
    # task info
    user_id: Optional[str] = None # email or other unique identifier
    thread_id: Optional[str] = None # unique identifier for the conversation thread
    # user input
    user_messages: Union[List[AutoGenMessage], List[dict[str, Any]]] = Field(
        default_factory=list, sa_column=Column(JSON)
    )
    user_last_message: Optional[Dict[str, Any]] = Field(
        default_factory=dict, sa_column=Column(JSON)
    )
    api_key: Optional[str] = None # user API key for authentication
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    top_p: Optional[float] = None
    cache_seed: Optional[int] = None
    n: Optional[int] = None
    stream: Optional[bool] = True
    extra_requests: Optional[Dict[str, Any]] = Field(
        default_factory=dict, sa_column=Column(JSON)
    )

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(cls, value: datetime) -> str:
        if isinstance(value, datetime):
            return value.isoformat()
        
class SingleTask(SQLModel, table=True):
    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )  # pylint: disable=not-callable
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )  # pylint: disable=not-callable
    version: Optional[str] = "0.0.1"
    # user info
    user_id: Optional[str] = None
    thread_id: Optional[str] = None 
    # task info
    task_id: Optional[str] = None
    is_node_task: bool = False
    node_task_id: Optional[str] = None
    previous_id: Optional[str] = None
    next_id: Optional[str] = None
    # task content
    content: Optional[str] = None # for dict input, please json.dumps
    files: Optional[dict[str, Any]] = Field(
        default_factory=dict, sa_column=Column(JSON)
    )
    task_messages: Union[List[AutoGenMessage], List[dict[str, Any]]] = Field(
        default_factory=list, sa_column=Column(JSON)
    )
    meta: Optional[Dict[str, Any]] =  Field(
        default_factory=dict, sa_column=Column(JSON)
    )

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(cls, value: datetime) -> str:
        if isinstance(value, datetime):
            return value.isoformat()

class Tasks(SQLModel, table=True):
    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )  # pylint: disable=not-callable
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )  # pylint: disable=not-callable
    version: Optional[str] = "0.0.1"
    # user info
    user_id: Optional[str] = None
    thread_id: Optional[str] = None 
    # task info
    tasks_id: Optional[str] = None
    # task content
    content: Optional[str] = None # for dict input, please json.dumps
    files: Optional[dict[str, Any]] = Field(
        default_factory=dict, sa_column=Column(JSON)
    )
    # sub tasks
    tasks: Optional[str] = None # for dict input, please json.dumps(SingleTask)

    meta: Optional[Dict[str, Any]] =  Field(
        default_factory=dict, sa_column=Column(JSON)
    )

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(cls, value: datetime) -> str:
        if isinstance(value, datetime):
            return value.isoformat()
        
class PlanCheck(SQLModel, table=True):
    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )  # pylint: disable=not-callable
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )  # pylint: disable=not-callable
    version: Optional[str] = "0.0.1"
    # user info
    user_id: Optional[str] = None
    thread_id: Optional[str] = None 
    # task info
    task: Optional[str] = None
    steps: Optional[List[dict[str, Any]]] = Field(
        default_factory=list, sa_column=Column(JSON)
    )
    session_id: Optional[int] = None

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(cls, value: datetime) -> str:
        if isinstance(value, datetime):
            return value.isoformat()
        
class Thread(SQLModel, table=True):
    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )  # pylint: disable=not-callable
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )  # pylint: disable=not-callable
    version: Optional[str] = "0.0.1"

    # uesr info
    user_id: Optional[str] = None # email or other unique identifier
    thread_id: Optional[str] = None # unique identifier for the conversation thread
    user_input: Optional[dict[str, Any]] = Field(
        default=None, sa_column=Column(JSON)
    )
    
    # run info
    status: RunStatus = Field(default=RunStatus.CREATED)

    # messages
    messages: Union[List[AutoGenMessage], List[dict[str, Any]]] = Field(
        default_factory=list, sa_column=Column(JSON)
    )
    error_message: Optional[str] = None

    # Store the userproxy input for the current task
    input_request: Optional[dict[str, Any]] = Field(
        default=None, sa_column=Column(JSON)
    )

    # task info
    tasks: Union[Tasks, List[dict[str, Any]]] = Field(
        default_factory=list, sa_column=Column(JSON)
    )

    # Store TeamResult which contains TaskResult
    team_result: Union[TeamResult, dict[str, Any]] = Field(
        default=None, sa_column=Column(JSON)
    )

    # save state of Agent/Group system by base64 encoded string
    state: Optional[str] = None

    meta: Optional[Dict[str, Any]] =  Field(
        default_factory=dict, sa_column=Column(JSON)
    )

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(cls, value: datetime) -> str:
        if isinstance(value, datetime):
            return value.isoformat()

class AgentJson(SQLModel, table=True):
    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )  # pylint: disable=not-callable
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )  # pylint: disable=not-callable
    user_id: Optional[str] = None
    version: Optional[str] = "0.0.1"
    component: Union[ComponentModel, dict[str, Any]] = Field(sa_column=Column(JSON))

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(cls, value: datetime) -> str:
        if isinstance(value, datetime):
            return value.isoformat()


class InputType(str, Enum):
    TEXT_INPUT = "text_input"
    APPROVAL = "approval"


# class Run(SQLModel, table=True):
#     """Represents a single execution run within a session"""

#     __table_args__ = {"sqlite_autoincrement": True}

#     id: Optional[int] = Field(default=None, primary_key=True)
#     created_at: datetime = Field(
#         sa_column=Column(DateTime(timezone=True), server_default=func.now()),
#     )
#     updated_at: datetime = Field(
#         default_factory=datetime.now,
#         sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
#     )
#     session_id: Optional[int] = Field(
#         default=None,
#         sa_column=Column(
#             Integer, ForeignKey("session.id", ondelete="CASCADE"), nullable=False
#         ),
#     )
#     status: RunStatus = Field(default=RunStatus.CREATED)

#     # Store the original user task
#     task: Union[MessageConfig, dict[str, Any]] = Field(
#         default_factory=lambda: MessageConfig(source="", content=""),
#         sa_column=Column(JSON),
#     )

#     # Store TeamResult which contains TaskResult
#     team_result: Union[TeamResult, dict[str, Any]] = Field(
#         default=None, sa_column=Column(JSON)
#     )

#     error_message: Optional[str] = None
#     version: Optional[str] = "0.0.1"
#     messages: Union[List[Message], List[dict[str, Any]]] = Field(
#         default_factory=list, sa_column=Column(JSON)
#     )

#     user_id: Optional[str] = None
#     state: Optional[str] = None

#     input_request: Optional[dict[str, Any]] = Field(
#         default=None, sa_column=Column(JSON)
#     )

#     @field_serializer("created_at", "updated_at")
#     def serialize_datetime(cls, value: datetime) -> str:
#         if isinstance(value, datetime):
#             return value.isoformat()



# class Plan(SQLModel, table=True):
#     __table_args__ = {"sqlite_autoincrement": True}
#     id: Optional[int] = Field(default=None, primary_key=True)
#     created_at: datetime = Field(
#         sa_column=Column(DateTime(timezone=True), server_default=func.now()),
#     )  # pylint: disable=not-callable
#     updated_at: datetime = Field(
#         default_factory=datetime.now,
#         sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
#     )  # pylint: disable=not-callable
#     user_id: Optional[str] = None
#     version: Optional[str] = "0.0.1"
#     task: Optional[str] = None
#     steps: Optional[List[dict[str, Any]]] = Field(
#         default_factory=list, sa_column=Column(JSON)
#     )
#     session_id: Optional[int] = None

#     @field_serializer("created_at", "updated_at")
#     def serialize_datetime(cls, value: datetime) -> str:
#         if isinstance(value, datetime):
#             return value.isoformat()



class SessionMessage(SQLModel, table=True):
    """存储 LLMMessage 的专用表，按 thread_id 隔离。
    
    每个 thread 的消息存储为独立的行，支持：
    - 完整的 LLMMessage JSON 序列化
    - 按 thread_id 高效查询
    - FTS5 全文搜索（通过关联的 FTS 表）
    """
    __table_args__ = {"sqlite_autoincrement": True}
    
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )
    
    # 关联标识
    thread_id: str = Field(index=True)  # 索引加速查询
    user_id: Optional[str] = Field(default=None, index=True)
    
    # LLMMessage 序列化存储
    message_type: str = Field(default="user")  # system/user/assistant/tool
    source: Optional[str] = None  # 消息来源标识
    
    # 原始 LLMMessage JSON（完整保留）
    raw_message: Dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSON)
    )
    
    # 用于 FTS5 搜索的字段（冗余存储以便建立索引）
    content: Optional[str] = Field(default=None)  # 消息内容文本
    tool_name: Optional[str] = None  # 工具名（如果有）
    tool_call_id: Optional[str] = None  # 工具调用 ID（如果有）
    
    # 额外元信息
    version: Optional[str] = "1.0.0"
    
    @field_serializer("created_at", "updated_at")
    def serialize_datetime(cls, value: datetime) -> str:
        if isinstance(value, datetime):
            return value.isoformat()

class SessionSummary(SQLModel, table=True):
    """存储会话摘要，用于长期记忆检索。"""
    __table_args__ = {"sqlite_autoincrement": True}
    
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )
    
    # 关联标识
    thread_id: str = Field(index=True)
    user_id: Optional[str] = Field(default=None, index=True)
    
    # 摘要内容
    summary: str = Field(default="")
    keywords: Optional[str] = None  # 逗号分隔的关键词
    
    # 版本
    version: Optional[str] = "1.0.0"


##

DatabaseModel = AutoGenMessage | UserInput | SingleTask | Tasks | PlanCheck | Thread | AgentJson | SessionMessage | SessionSummary
