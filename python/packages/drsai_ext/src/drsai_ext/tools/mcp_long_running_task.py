import asyncio
import multiprocessing
import threading
import time
from enum import Enum
from uuid import uuid4
from typing import Callable, Any, Dict, Optional, Union, List
import functools

class TaskStatus(str, Enum):
    """The status of a task in the task management system."""
    TODO = "TODO"
    IN_PROGRESS = "IN_PROGRESS"
    DONE = "DONE"
    CANCELED = "CANCELED"
    ERROR = "ERROR"

class LongTaskManager:
    """A task management system for long-running tasks using multiprocessing queues and threads."""

    def __init__(self, time_limit: int = 10, task_limit: int = 2):
        """Initialize the task manager.
        
        Args:
            time_limit: Time limit in seconds for async operations to wait before returning IN_PROGRESS status
        """
        self.task_queue = multiprocessing.Queue()
        self.result_queue = multiprocessing.Queue()
        self.time_limit = time_limit
        self.thread = threading.Thread(target=self.queue_monitor_worker, daemon=True)
        self.thread.start()

        self.task_id_to_task = {}
        self.task_id_to_result = {}

        self._task_limit = task_limit  # Maximum number of tasks to track
    
    def queue_monitor_worker(self) -> None:
        """
        Background thread to monitor the result queue and update task_id_to_result.
        """
        while True:
            try:
                # Non-blocking check for queue items
                if not self.result_queue.empty():
                    result_json = self.result_queue.get_nowait()
                    task_id = result_json.get('id')
                    if task_id:
                        self.task_id_to_result[task_id] = result_json
                        print(f"[Queue Monitor] Updated result for task {task_id}: {result_json['status']}")
            except Exception as e:
                print(f"[Queue Monitor] Error: {e}")
            time.sleep(0.5)  # Check every 0.5 seconds
    
    def cleanup_task(self, task_id: str) -> None:
        """
        Clean up task resources after completion or failure.
        """
        if task_id in self.task_id_to_task:
            process_info = self.task_id_to_task[task_id]
            process: multiprocessing.Process = process_info.get('process')

            # Terminate process if still running
            if process and process.is_alive():
                process.terminate()
                process.join(timeout=5)
                if process.is_alive():
                    process.kill()

            # Remove from task dictionary
            del self.task_id_to_task[task_id]
            print(f"[Cleanup] Task {task_id} cleaned up")

    def run_sync_task(self, func: Callable, task_id: Optional[str] = None, *args, **kwargs) -> Dict[str, Any]:
        """
        Run a synchronous function as a long-running task.
        
        Args:
            func: The synchronous function to run
            task_id: Optional task ID, will be generated if not provided
            *args: Positional arguments to pass to the function
            **kwargs: Keyword arguments to pass to the function
            
        Returns:
            Dict containing task status information
        """
        # Generate or use existing task_id
        if task_id is None:
            task_id = str(uuid4())

        # Check if task already exists
        if task_id in self.task_id_to_result:
            # Return existing result
            result = self.task_id_to_result[task_id]

            # Cleanup if task is done or failed
            if result['status'] in [TaskStatus.DONE.value, TaskStatus.ERROR.value]:
                self.cleanup_task(task_id)

            return result
        if len(self.task_id_to_task) >= self._task_limit:
            return {
                "id": task_id,
                'status': TaskStatus.TODO.value,
                'result': "Task has reached maximum limit, please try again later",
                'message': "Task has reached maximum limit, please try again later",
                'elapsed_time': time.time()
            }
        # Check if task is currently running
        if task_id in self.task_id_to_task:
            task_info = self.task_id_to_task[task_id]
            start_time = task_info['start_time']
            elapsed_time = time.time() - start_time

            # Return IN_PROGRESS status
            result_json = {
                "id": task_id,
                'status': TaskStatus.IN_PROGRESS.value,
                'result': "Task is still running",
                'message': f'Task is still running. Elapsed time: {elapsed_time:.1f}s',
                'elapsed_time': elapsed_time
            }
            return result_json

        # Wrapper function to run the task and put result in queue
        def task_wrapper(func, task_id, result_queue, *args, **kwargs):
            try:
                result = func(*args, **kwargs)
                result_json = {"id": task_id, 'status': TaskStatus.DONE.value, 'result': result}
                result_queue.put(result_json)
            except Exception as e:
                result_json = {"id": task_id, 'status': TaskStatus.ERROR.value, 'result': str(e)}
                result_queue.put(result_json)

        # Create new task
        process = multiprocessing.Process(
            target=task_wrapper,
            args=(func, task_id, self.result_queue) + args,
            kwargs=kwargs
        )

        # Store task information
        self.task_id_to_task[task_id] = {
            'process': process,
            'start_time': time.time(),
        }

        # Start the process
        process.start()
        print(f"[Task] Started sync task {task_id}")

        # Wait for time_limit
        time.sleep(self.time_limit)

        # Check if result is ready
        if task_id in self.task_id_to_result:
            result = self.task_id_to_result[task_id]

            # Cleanup if done or failed
            if result['status'] in [TaskStatus.DONE.value, TaskStatus.ERROR.value]:
                self.cleanup_task(task_id)

            return result
        else:
            # Task still running
            result_json = {
                "id": task_id,
                'status': TaskStatus.IN_PROGRESS.value,
                'result': "Task is still running",
                'message': f'Task is still running after {self.time_limit}s. Use the same task_id to check status.',
                'elapsed_time': self.time_limit
            }
            return result_json

    async def run_async_task(self, func: Callable, task_id: Optional[str] = None, *args, **kwargs) -> Dict[str, Any]:
        """
        Run a function as a long-running async task.
        
        Args:
            func: The function to run (can be sync or async)
            task_id: Optional task ID, will be generated if not provided
            *args: Positional arguments to pass to the function
            **kwargs: Keyword arguments to pass to the function
            
        Returns:
            Dict containing task status information
        """
        # Generate or use existing task_id
        if task_id is None:
            task_id = str(uuid4())

        # Check if task already exists
        if task_id in self.task_id_to_result:
            # Return existing result
            result = self.task_id_to_result[task_id]

            # Cleanup if task is done or failed
            if result['status'] in [TaskStatus.DONE.value, TaskStatus.ERROR.value]:
                self.cleanup_task(task_id)

            return result
        
        if len(self.task_id_to_task) >= self._task_limit:
            return {
                "id": task_id,
                'status': TaskStatus.TODO.value,
                'result': "Task has reached maximum limit, please try again later",
                'message': "Task has reached maximum limit, please try again later",
                'elapsed_time': time.time()
            }
        
        # Check if task is currently running
        if task_id in self.task_id_to_task:
            task_info = self.task_id_to_task[task_id]
            start_time = task_info['start_time']
            elapsed_time = time.time() - start_time

            # Return IN_PROGRESS status
            result_json = {
                "id": task_id,
                'status': TaskStatus.IN_PROGRESS.value,
                'result': "Task is still running",
                'message': f'Task is still running. Elapsed time: {elapsed_time:.1f}s',
                'elapsed_time': elapsed_time
            }
            return result_json

        # Wrapper function to run the task and put result in queue
        def task_wrapper(func, task_id, result_queue, *args, **kwargs):
            try:
                if asyncio.iscoroutinefunction(func):
                    # For async functions, we need to run in a new event loop
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    result = loop.run_until_complete(func(*args, **kwargs))
                else:
                    result = func(*args, **kwargs)
                result_json = {"id": task_id, 'status': TaskStatus.DONE.value, 'result': result}
                result_queue.put(result_json)
            except Exception as e:
                result_json = {"id": task_id, 'status': TaskStatus.ERROR.value, 'result': str(e)}
                result_queue.put(result_json)

        # Create new task
        process = multiprocessing.Process(
            target=task_wrapper,
            args=(func, task_id, self.result_queue) + args,
            kwargs=kwargs
        )

        # Store task information
        self.task_id_to_task[task_id] = {
            'process': process,
            'start_time': time.time(),
        }

        # Start the process
        process.start()
        print(f"[Task] Started async task {task_id}")

        # Wait for time_limit
        await asyncio.sleep(self.time_limit)

        # Check if result is ready
        if task_id in self.task_id_to_result:
            result = self.task_id_to_result[task_id]

            # Cleanup if done or failed
            if result['status'] in [TaskStatus.DONE.value, TaskStatus.ERROR.value]:
                self.cleanup_task(task_id)

            return result
        else:
            # Task still running
            result_json = {
                "id": task_id,
                'status': TaskStatus.IN_PROGRESS.value,
                'result': "Task is still running",
                'message': f'Task is still running after {self.time_limit}s. Use the same task_id to check status.',
                'elapsed_time': self.time_limit
            }
            return result_json

    def get_task_status(self, task_id: str) -> Dict[str, Any]:
        """
        Get the current status of a task.
        
        Args:
            task_id: The task ID to check
            
        Returns:
            Dict containing task status information
        """
        # Check if task already exists in results
        if task_id in self.task_id_to_result:
            # Return existing result
            result = self.task_id_to_result[task_id]

            # Cleanup if task is done or failed
            if result['status'] in [TaskStatus.DONE.value, TaskStatus.ERROR.value]:
                self.cleanup_task(task_id)

            return result

        # Check if task is currently running
        if task_id in self.task_id_to_task:
            task_info = self.task_id_to_task[task_id]
            start_time = task_info['start_time']
            elapsed_time = time.time() - start_time

            # Return IN_PROGRESS status
            result_json = {
                "id": task_id,
                'status': TaskStatus.IN_PROGRESS.value,
                'result': "Task is still running",
                'message': f'Task is still running. Elapsed time: {elapsed_time:.1f}s',
                'elapsed_time': elapsed_time
            }
            return result_json
        
        # Task not found
        return {
            "id": task_id,
            'status': TaskStatus.ERROR.value,
            'result': "Task not found",
            'message': f'No task found with ID {task_id}'
        }