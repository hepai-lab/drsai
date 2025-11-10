from abc import ABC, abstractmethod
from enum import Enum
from typing import Any, Dict, List, Union, Optional
from uuid import uuid4
import time

from pydantic import (
    BaseModel, 
    ConfigDict, 
    field_serializer,
    Field,
    model_validator
    )

from autogen_core import CancellationToken, ComponentBase


class TaskStatus(str, Enum):
    """The status of a task in the task management system."""

    queued = "queued"
    in_progress = "in_progress"
    completed = "completed"
    paused = "paused"
    error = "error"

class TaskType(str, Enum):
    """The type of a task in the task management system."""

    add = "add"
    insert = "insert"
    delete = "delete"
    update = "update"
    select = "select"


class Task(BaseModel):
    """A task in the task management system."""

    content: str
    """The content of the task."""

    source: str
    """The source of the task."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    """The unique identifier of the task."""

    qid: Optional[str] = None
    """queue id in task management system."""

    execution_count: int = 0
    """execution count of the task."""

    discussion_round: int = 0
    """discussion count of the task."""

    task_type: TaskType|str = TaskType.add
    """The type of the task."""
    
    status: TaskStatus|str = TaskStatus.queued
    """The status of the task."""

    created_at: float = Field(default_factory=lambda: time.time())
    """The time when the task was created."""

    updated_at: Optional[float] = Field(default=None)
    """The time when the task was last updated."""

    parent_task_id: Optional[str] = None
    """The parent task id of the task."""

    child_task_ids: List[str] = []
    """The child task ids of the task."""

    child_tasks: List[Dict[str, Any]] = []

    metadata: Dict[str, Any] | None = None
    """Metadata associated with the memory item."""

    completed_at: Optional[float] = Field(default=None)
    """The time when the task was completed."""

    executor: Optional[str] = None
    """The executor of the task."""

    solution: Optional[str] = None
    """The solution of the task."""


    @model_validator(mode='after')
    def set_timestamps(self):
        if self.updated_at is None:
            self.updated_at = self.created_at
        return self

    def update(self, **kwargs):
        """Update task attributes and automatically update the updated_at timestamp."""
        for key, value in kwargs.items():
            if hasattr(self, key):
                setattr(self, key, value)
        # Update the updated_at timestamp
        self.updated_at = time.time()
        return self

    @field_serializer("status")
    def status_serializer(self, status: TaskStatus | str) -> str:
        if isinstance(status, TaskStatus):
            return status.value
        else:
            return status

class BaseTaskSystem(ABC, ComponentBase[BaseModel]):

    """The base class for task management systems in group chat teams.

    Basic methods for task management:
    - create_task: create a new task with the given task_id and task_data
    - get_task: get the task with the given task_id
    - update_task: update the task with the given task_id and task_data
    - delete_task: delete the task with the given task_id
    - list_tasks: list all tasks in the system
    """

    component_type = "task_system"

    @abstractmethod
    async def create_task(
        self, 
        task_content: str, 
        metadata: Dict[str, Any] | None = None, 
        cancellation_token: CancellationToken | None = None,
        **kwargs: Any,
        ) -> Task:
        """Create a new task with the given task_content and metadata."""
        ...
    
    @abstractmethod
    async def get_task(
        self, 
        task_id: str, 
        cancellation_token: CancellationToken | None = None,
        **kwargs: Any,
        ) -> Task:
        """Get the task with the given task_id."""
        ...
    
    @abstractmethod
    async def update_task(
        self, 
        task_id: str, 
        task_content: str | None = None, 
        metadata: Dict[str, Any] | None = None, 
        status: TaskStatus | str | None = None, 
        cancellation_token: CancellationToken | None = None,
        **kwargs: Any,
        ) -> Task:
        """Update the task with the given task_id and task_data."""
        ...
    
    @abstractmethod
    async def delete_task(
        self, 
        task_id: str, 
        cancellation_token: CancellationToken | None = None,
        **kwargs: Any,
        ) -> None:
        """Delete the task with the given task_id."""
        ...
    
    @abstractmethod
    async def list_tasks(
        self, 
        status: TaskStatus | str | None = None, 
        cancellation_token: CancellationToken | None = None,
        **kwargs: Any,
        ) -> List[Task]:
        """List all tasks in the system."""
        ...
    
    @abstractmethod
    async def reset(self, **kwargs: Any) -> None:
        """Reset the task management system."""
        ...