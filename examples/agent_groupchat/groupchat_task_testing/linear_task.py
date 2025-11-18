from drsai import BaseTaskSystem, Task, TaskStatus
from drsai import DatabaseManager

from autogen_core import CancellationToken, ComponentBase, Component

from pydantic import (
    BaseModel, 
)

from typing import (
    Dict,
    Any,
    List,
    Optional,
    Union,
    Callable,
    TypeVar,
    Type,
    Tuple,
    cast,
)
import threading
import time
import uuid

class ListTasksConfig(BaseModel):
    """"
    Configuration for list_tasks method.
    """
    
    name: str = "list_task_system"
    task_list: List[Task] = []

class ListTaskSystem(BaseTaskSystem, Component[ListTasksConfig]):
    """
    A task system that lists all tasks in the task database.
    """
    component_type = "task_system"
    component_provider_override = "drsai.ListTaskSystem"
    component_config_schema = ListTasksConfig
    component_description = "A task system that lists all tasks in the task database."


    def __init__(self, config: ListTasksConfig):
        self.name = config.name
        self._task_list = config.task_list
        self._task_list_dict = {task.task_id: task for task in self._task_list}
        self._task_list_lock = threading.Lock()
    
    async def create_task(
        self, 
        task_content: str, 
        metadata: Dict[str, Any] | None = None, 
        cancellation_token: CancellationToken | None = None,
        **kwargs: Any,
        ) -> Task:
        """Create a new task with the given task_content and metadata."""
        new_task = Task(task_content=task_content, metadata=metadata)
        async with self._task_list_lock:
            self._task_list.append(new_task)
            self._task_list_dict[new_task.task_id] = new_task
        return new_task
    
    async def get_task(
        self, 
        task_id: str, 
        cancellation_token: CancellationToken | None = None,
        **kwargs: Any,
        ) -> Task:
        """Get the task with the given task_id."""
        async with self._task_list_lock:
            return self._task_list_dict[task_id]

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
        async with self._task_list_lock:
            task = self._task_list_dict[task_id]
            if task_content is not None:
                task.task_content = task_content
            if metadata is not None:
                task.metadata = metadata
            if status is not None:
                task.status = status
            return task

    async def delete_task(
        self, 
        task_id: str, 
        cancellation_token: CancellationToken | None = None,
        **kwargs: Any,
        ) -> None:
        """Delete the task with the given task_id."""
        async with self._task_list_lock:
            task = self._task_list_dict[task_id]
            self._task_list.remove(task)
            del self._task_list_dict[task_id]
    
    async def list_tasks(
        self, 
        status: TaskStatus | str | None = None, 
        cancellation_token: CancellationToken | None = None,
        **kwargs: Any,
        ) -> List[Task]:
        """List all tasks in the system."""
        async with self._task_list_lock:
            if status is None:
                return self._task_list
            else:
                return [task for task in self._task_list if task.status == status]

    async def reset(self, **kwargs: Any) -> None:
        """Reset the task system to its initial state."""
        async with self._task_list_lock:
            self._task_list = []
            self._task_list_dict = {}


