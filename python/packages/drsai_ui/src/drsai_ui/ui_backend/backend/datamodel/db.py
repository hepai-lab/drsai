# defines how core data types are serialized and stored in the database

from datetime import datetime
from enum import Enum
from typing import Any, List, Optional, Union
import uuid

from autogen_core import ComponentModel
from pydantic import field_serializer
from sqlalchemy import ForeignKey, Integer, UniqueConstraint, Text
from sqlmodel import JSON, Column, DateTime, Field, SQLModel, String, func

from .types import (
    GalleryConfig,
    MessageConfig,
    MessageMeta,
    SettingsConfig,
    TeamResult,
    GalleryComponents,
    GalleryMetadata,
    AgentModeSetting,

)


class Team(SQLModel, table=True):
    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String, unique=True, nullable=False)
    )
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


class Message(SQLModel, table=True):
    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String, unique=True, nullable=False)
    )
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )  # pylint: disable=not-callable
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )  # pylint: disable=not-callable
    user_id: Optional[str] = None
    version: Optional[str] = "0.0.1"
    config: Union[MessageConfig, dict[str, Any]] = Field(
        default_factory=lambda: MessageConfig(source="", content=""),
        sa_column=Column(JSON),
    )
    session_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("session.id", ondelete="CASCADE")),
    )
    run_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("run.id", ondelete="CASCADE")),
    )
    message_meta: Optional[Union[MessageMeta, dict[str, Any]]] = Field(
        default={}, sa_column=Column(JSON)
    )


class Session(SQLModel, table=True):
    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String, unique=True, nullable=False)
    )
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )  # pylint: disable=not-callable
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )  # pylint: disable=not-callable
    user_id: Optional[str] = None
    version: Optional[str] = "0.0.1"
    team_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("team.id", ondelete="CASCADE")),
    )
    name: Optional[str] = None
    agent_mode_config: Optional[dict[str, Any]] = Field(
        default=None, sa_column=Column(JSON)
    )

    # @field_serializer("created_at", "updated_at")
    # def serialize_datetime(cls, value: datetime) -> str:
    #     if isinstance(value, datetime):
    #         return value.isoformat()

class RunStatus(str, Enum):
    CREATED = "created"
    ACTIVE = "active"
    COMPLETE = "complete"
    ERROR = "error"
    STOPPED = "stopped"
    AWAITING_INPUT = "awaiting_input"
    PAUSED = "paused"


class InputType(str, Enum):
    TEXT_INPUT = "text_input"
    APPROVAL = "approval"


class Run(SQLModel, table=True):
    """Represents a single execution run within a session"""

    __table_args__ = {"sqlite_autoincrement": True}

    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String, unique=True, nullable=False)
    )
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )
    session_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("session.id", ondelete="CASCADE"), nullable=False
        ),
    )
    status: RunStatus = Field(default=RunStatus.CREATED)

    # Store the original user task
    task: Union[MessageConfig, dict[str, Any]] = Field(
        default_factory=lambda: MessageConfig(source="", content=""),
        sa_column=Column(JSON),
    )

    # Store TeamResult which contains TaskResult
    team_result: Union[TeamResult, dict[str, Any]] = Field(
        default=None, sa_column=Column(JSON)
    )

    error_message: Optional[str] = None
    version: Optional[str] = "0.0.1"
    messages: Union[List[Message], List[dict[str, Any]]] = Field(
        default_factory=list, sa_column=Column(JSON)
    )

    user_id: Optional[str] = None
    state: Optional[str] = None

    input_request: Optional[dict[str, Any]] = Field(
        default=None, sa_column=Column(JSON)
    )

    settings: Optional[dict[str, Any]] = Field(
        default=None, sa_column=Column(JSON)
    )

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(cls, value: datetime) -> str:
        if isinstance(value, datetime):
            return value.isoformat()


class Gallery(SQLModel, table=True):
    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String, unique=True, nullable=False)
    )
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )  # pylint: disable=not-callable
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )  # pylint: disable=not-callable
    user_id: Optional[str] = None
    version: Optional[str] = "0.0.1"
    config: Union[GalleryConfig, dict[str, Any]] = Field(
        default_factory=lambda: GalleryConfig(
            id="",
            name="",
            metadata=GalleryMetadata(author="", version=""),
            components=GalleryComponents(
                agents=[], models=[], tools=[], terminations=[], teams=[]
            ),
        ),
        sa_column=Column(JSON),
    )

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(cls, value: datetime) -> str:
        if isinstance(value, datetime):
            return value.isoformat()


class Settings(SQLModel, table=True):
    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String, unique=True, nullable=False)
    )
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )  # pylint: disable=not-callable
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )  # pylint: disable=not-callable
    user_id: Optional[str] = None
    version: Optional[str] = "0.0.1"
    config: Union[SettingsConfig, dict[str, Any]] = Field(
        default_factory=SettingsConfig, sa_column=Column(JSON)
    )


class Plan(SQLModel, table=True):
    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String, unique=True, nullable=False)
    )
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )  # pylint: disable=not-callable
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )  # pylint: disable=not-callable
    user_id: Optional[str] = None
    version: Optional[str] = "0.0.1"
    task: Optional[str] = None
    steps: Optional[List[dict[str, Any]]] = Field(
        default_factory=list, sa_column=Column(JSON)
    )
    session_id: Optional[int] = None

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(cls, value: datetime) -> str:
        if isinstance(value, datetime):
            return value.isoformat()


## 更新的部分

### agent mode setting
class AgentModeSettings(SQLModel, table=True):
    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String, unique=True, nullable=False)
    )
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )  # pylint: disable=not-callable
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )  # pylint: disable=not-callable
    user_id: Optional[str] = None
    version: Optional[str] = "0.0.1"
    agents_mode: Optional[list[dict[str, Any]]] = Field(
        default_factory=list, sa_column=Column(JSON)
    )
    default_agent_id: Optional[str] = Field(default=None)

class AgentModeConfig(SQLModel, table=True):
    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String, unique=True, nullable=False)
    )
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )  # pylint: disable=not-callable
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )  # pylint: disable=not-callable
    user_id: Optional[str] = None
    version: Optional[str] = "0.0.1"
    mode: Optional[str] = "drsai"
    config: Optional[dict[str, Any]] = Field(
        default_factory=dict, sa_column=Column(JSON)
    )

### user files

class UserFiles(SQLModel, table=True):
    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String, unique=True, nullable=False)
    )
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )  # pylint: disable=not-callable
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )  # pylint: disable=not-callable
    user_id: Optional[str] = None
    session_id: Optional[int] = None
    version: Optional[str] = "0.0.1"
    files: Optional[dict[str, Any]] = Field(
        default_factory=dict, sa_column=Column(JSON)
    )


### user remote agent

class UserAgents(SQLModel, table=True):
    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String, unique=True, nullable=False)
    )
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )  # pylint: disable=not-callable
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )  # pylint: disable=not-callable
    user_id: Optional[str] = None
    version: Optional[str] = "0.0.1"
    agents: Optional[list[dict[str, Any]]] = Field(
        default_factory=list, sa_column=Column(JSON)
    )

class UserRemoteAgents(SQLModel, table=True):
    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String, unique=True, nullable=False)
    )
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )  # pylint: disable=not-callable
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )  # pylint: disable=not-callable
    user_id: Optional[str] = None
    version: Optional[str] = "0.0.1"
    agents: Optional[list[dict[str, Any]]] = Field(
        default_factory=list, sa_column=Column(JSON)
    )

class UserDDFAgents(SQLModel, table=True):
    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String, unique=True, nullable=False)
    )
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )  # pylint: disable=not-callable
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )  # pylint: disable=not-callable
    user_id: Optional[str] = None
    version: Optional[str] = "0.0.1"
    agents: Optional[list[dict[str, Any]]] = Field(
        default_factory=list, sa_column=Column(JSON)
    )

### user info

class Userinfo(SQLModel, table=True):
    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String, unique=True, nullable=False)
    )
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )  # pylint: disable=not-callable
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )  # pylint: disable=not-callable
    user_id: Optional[str] = None
    version: Optional[str] = "0.0.1"
    password: Optional[str] = None
    meta: Optional[dict[str, Any]] = Field(
        default={}, sa_column=Column(JSON)
    )

class UserRole(SQLModel, table=True):
    """
    Minimal role table for user management UI.

    Note: This backend currently doesn't enforce auth; role changes are guarded by
    operator_user_id checks in the API routes.
    """
    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String, unique=True, nullable=False)
    )
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )  # pylint: disable=not-callable
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )  # pylint: disable=not-callable
    user_id: str = Field(index=True)
    version: Optional[str] = "0.0.1"
    is_admin: bool = False


class UserAgentUsage(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint("user_id", "agent_id", name="uq_user_agent_usage_user_agent"),
        {"sqlite_autoincrement": True},
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String, unique=True, nullable=False),
    )
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )  # pylint: disable=not-callable
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )  # pylint: disable=not-callable
    user_id: str = Field(index=True)
    agent_id: str = Field(index=True)
    last_used_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    use_count: int = Field(default=0)

    @field_serializer("created_at", "updated_at", "last_used_at")
    def serialize_datetime(cls, value: datetime) -> str:
        if isinstance(value, datetime):
            return value.isoformat()


class Organization(SQLModel, table=True):
    """Cooperation group (e.g. drsai, rongzai)."""

    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String, unique=True, nullable=False),
    )
    slug: str = Field(index=True, unique=True)
    display_name: str = Field(default="")
    default_agent_id: Optional[str] = None
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )
    meta: Optional[dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSON))


class OrganizationMember(SQLModel, table=True):
    """One row per user; user belongs to at most one organization."""

    __table_args__ = (
        UniqueConstraint("user_id", name="uq_organization_member_user_id"),
        {"sqlite_autoincrement": True},
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String, unique=True, nullable=False),
    )
    org_id: int = Field(sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE")))
    user_id: str = Field(index=True)
    role: str = Field(default="member")  # org_admin | member
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )


class OrganizationAgent(SQLModel, table=True):
    """Agent entries owned by an organization (whitelist + snapshot for plaza)."""

    __table_args__ = (
        UniqueConstraint("org_id", "agent_id", name="uq_org_agent_org_agent"),
        {"sqlite_autoincrement": True},
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String, unique=True, nullable=False),
    )
    org_id: int = Field(sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE")))
    agent_id: str = Field(index=True)
    snapshot: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )


class AgentAccessRequest(SQLModel, table=True):
    """Apply to use another org's agent; platform admin approves."""

    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String, unique=True, nullable=False),
    )
    applicant_user_id: str = Field(index=True)
    target_org_id: int = Field(sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE")))
    requested_agent_id: str = Field(index=True)
    status: str = Field(default="pending")  # pending | approved | rejected
    reviewer_user_id: Optional[str] = None
    reviewed_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    message: Optional[str] = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )


##

# DatabaseModel = Team | Message | Session | Run | Gallery | Settings | Plan | AgentModeSettings | AgentModeConfig | UserAgents | UserDDFAgents| Userinfo
DatabaseModel = (
    Team 
    | Message 
    | Session 
    | Run 
    | Gallery 
    | Settings 
    | Plan 
    | AgentModeSettings 
    | AgentModeConfig 
    | UserAgents 
    | UserRemoteAgents
    | UserDDFAgents
    | Userinfo
    | UserRole
    | UserAgentUsage
    | Organization
    | OrganizationMember
    | OrganizationAgent
    | AgentAccessRequest
)

