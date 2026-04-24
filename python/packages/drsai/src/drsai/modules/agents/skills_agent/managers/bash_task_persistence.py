"""
Bash Task Persistence Manager

This module provides persistent storage for bash background tasks across program restarts.
It saves task information to disk associated with thread_id and worker_dir.
"""

import json
import os
from pathlib import Path
from typing import Dict, Any, Optional, List
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class BashTaskPersistence:
    """
    Manages persistent storage of bash background tasks.

    Tasks are stored per thread_id to maintain isolation between different conversation threads.
    """

    def __init__(self, worker_dir: Path, thread_id: str):
        """
        Initialize the persistence manager.

        Args:
            worker_dir: Base working directory for the user
            thread_id: Unique identifier for the current conversation thread
        """
        self.worker_dir = Path(worker_dir)
        self.thread_id = thread_id

        # Create tasks directory structure
        self.tasks_dir = self.worker_dir / "tool_tasks"
        self.tasks_dir.mkdir(exist_ok=True)

        # Thread-specific tasks file
        self.tasks_file = self.tasks_dir / f"{thread_id}_bash_tasks.json"

        # Global tasks index (for cross-thread visibility if needed)
        self.global_index_file = self.tasks_dir / "global_tasks_index.json"

    def save_task(self, task_id: str, task_info: Dict[str, Any]) -> bool:
        """
        Save a single task to persistent storage.

        Args:
            task_id: Unique task identifier
            task_info: Task information dictionary

        Returns:
            True if save succeeded, False otherwise
        """
        try:
            # Load existing tasks
            tasks = self.load_all_tasks()

            # Add metadata for persistence
            task_data = task_info.copy()
            task_data['thread_id'] = self.thread_id
            task_data['saved_at'] = datetime.now().isoformat()

            # Update tasks
            tasks[task_id] = task_data

            # Write to file
            with self.tasks_file.open('w', encoding='utf-8') as f:
                json.dump(tasks, f, indent=2, ensure_ascii=False)

            # Update global index
            self._update_global_index(task_id, task_data)

            logger.info(f"Saved task {task_id} to {self.tasks_file}")
            return True

        except Exception as e:
            logger.error(f"Failed to save task {task_id}: {e}")
            return False

    def save_tasks(self, tasks: Dict[str, Dict[str, Any]]) -> bool:
        """
        Save multiple tasks to persistent storage.

        Args:
            tasks: Dictionary of task_id -> task_info

        Returns:
            True if save succeeded, False otherwise
        """
        try:
            # Add metadata to each task
            tasks_data = {}
            for task_id, task_info in tasks.items():
                task_data = task_info.copy()
                task_data['thread_id'] = self.thread_id
                task_data['saved_at'] = datetime.now().isoformat()
                tasks_data[task_id] = task_data

            # Write to file
            with self.tasks_file.open('w', encoding='utf-8') as f:
                json.dump(tasks_data, f, indent=2, ensure_ascii=False)

            # Update global index
            for task_id, task_data in tasks_data.items():
                self._update_global_index(task_id, task_data)

            logger.info(f"Saved {len(tasks)} tasks to {self.tasks_file}")
            return True

        except Exception as e:
            logger.error(f"Failed to save tasks: {e}")
            return False

    def load_all_tasks(self) -> Dict[str, Dict[str, Any]]:
        """
        Load all tasks for the current thread from persistent storage.

        Returns:
            Dictionary of task_id -> task_info
        """
        if not self.tasks_file.exists():
            return {}

        try:
            with self.tasks_file.open('r', encoding='utf-8') as f:
                tasks = json.load(f)

            logger.info(f"Loaded {len(tasks)} tasks from {self.tasks_file}")
            return tasks

        except Exception as e:
            logger.error(f"Failed to load tasks: {e}")
            return {}

    def load_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """
        Load a specific task from persistent storage.

        Args:
            task_id: Task identifier

        Returns:
            Task information dictionary or None if not found
        """
        tasks = self.load_all_tasks()
        return tasks.get(task_id)

    def delete_task(self, task_id: str) -> bool:
        """
        Delete a task from persistent storage.

        Args:
            task_id: Task identifier

        Returns:
            True if deletion succeeded, False otherwise
        """
        try:
            tasks = self.load_all_tasks()

            if task_id in tasks:
                del tasks[task_id]

                # Write updated tasks back
                with self.tasks_file.open('w', encoding='utf-8') as f:
                    json.dump(tasks, f, indent=2, ensure_ascii=False)

                # Update global index
                self._remove_from_global_index(task_id)

                logger.info(f"Deleted task {task_id}")
                return True
            else:
                logger.warning(f"Task {task_id} not found for deletion")
                return False

        except Exception as e:
            logger.error(f"Failed to delete task {task_id}: {e}")
            return False

    def update_task_status(self, task_id: str, status: str,
                          output: Optional[str] = None,
                          error: Optional[str] = None) -> bool:
        """
        Update the status of a task in persistent storage.

        Args:
            task_id: Task identifier
            status: New status ('running', 'completed', 'failed', 'timeout', 'killed')
            output: Optional output data
            error: Optional error message

        Returns:
            True if update succeeded, False otherwise
        """
        try:
            tasks = self.load_all_tasks()

            if task_id not in tasks:
                logger.warning(f"Task {task_id} not found for status update")
                return False

            # Update task info
            tasks[task_id]['status'] = status
            tasks[task_id]['updated_at'] = datetime.now().isoformat()

            if output is not None:
                tasks[task_id]['output'] = output

            if error is not None:
                tasks[task_id]['error'] = error

            # Write back to file
            with self.tasks_file.open('w', encoding='utf-8') as f:
                json.dump(tasks, f, indent=2, ensure_ascii=False)

            # Update global index
            self._update_global_index(task_id, tasks[task_id])

            logger.info(f"Updated task {task_id} status to {status}")
            return True

        except Exception as e:
            logger.error(f"Failed to update task {task_id} status: {e}")
            return False

    def cleanup_old_tasks(self, max_age_days: int = 7) -> int:
        """
        Clean up old completed/failed tasks from persistent storage.

        Args:
            max_age_days: Maximum age in days for tasks to keep

        Returns:
            Number of tasks deleted
        """
        try:
            tasks = self.load_all_tasks()
            now = datetime.now()
            deleted_count = 0

            tasks_to_delete = []
            for task_id, task_info in tasks.items():
                # Only clean up completed/failed/timeout tasks
                if task_info.get('status') not in ['running']:
                    saved_at = task_info.get('saved_at')
                    if saved_at:
                        saved_time = datetime.fromisoformat(saved_at)
                        age_days = (now - saved_time).days

                        if age_days > max_age_days:
                            tasks_to_delete.append(task_id)

            # Delete old tasks
            for task_id in tasks_to_delete:
                if self.delete_task(task_id):
                    deleted_count += 1

            logger.info(f"Cleaned up {deleted_count} old tasks")
            return deleted_count

        except Exception as e:
            logger.error(f"Failed to cleanup old tasks: {e}")
            return 0

    def _update_global_index(self, task_id: str, task_data: Dict[str, Any]):
        """Update the global tasks index."""
        try:
            # Load existing index
            if self.global_index_file.exists():
                with self.global_index_file.open('r', encoding='utf-8') as f:
                    index = json.load(f)
            else:
                index = {}

            # Add task to index with minimal info
            index[task_id] = {
                'thread_id': task_data.get('thread_id'),
                'status': task_data.get('status'),
                'command': task_data.get('command', '')[:50],  # First 50 chars
                'start_time': task_data.get('start_time'),
                'updated_at': task_data.get('updated_at', task_data.get('saved_at'))
            }

            # Write back
            with self.global_index_file.open('w', encoding='utf-8') as f:
                json.dump(index, f, indent=2, ensure_ascii=False)

        except Exception as e:
            logger.error(f"Failed to update global index: {e}")

    def _remove_from_global_index(self, task_id: str):
        """Remove a task from the global index."""
        try:
            if not self.global_index_file.exists():
                return

            with self.global_index_file.open('r', encoding='utf-8') as f:
                index = json.load(f)

            if task_id in index:
                del index[task_id]

                with self.global_index_file.open('w', encoding='utf-8') as f:
                    json.dump(index, f, indent=2, ensure_ascii=False)

        except Exception as e:
            logger.error(f"Failed to remove from global index: {e}")

    def get_all_thread_tasks(self) -> List[str]:
        """
        Get all thread IDs that have tasks.

        Returns:
            List of thread IDs
        """
        try:
            thread_files = list(self.tasks_dir.glob("*_bash_tasks.json"))
            thread_ids = [f.stem.replace("_bash_tasks", "") for f in thread_files]
            return thread_ids
        except Exception as e:
            logger.error(f"Failed to get thread tasks: {e}")
            return []

    def get_global_tasks_summary(self) -> Dict[str, Any]:
        """
        Get a summary of all tasks across all threads.

        Returns:
            Summary dictionary with statistics
        """
        try:
            if not self.global_index_file.exists():
                return {
                    'total_tasks': 0,
                    'running_tasks': 0,
                    'completed_tasks': 0,
                    'failed_tasks': 0
                }

            with self.global_index_file.open('r', encoding='utf-8') as f:
                index = json.load(f)

            summary = {
                'total_tasks': len(index),
                'running_tasks': 0,
                'completed_tasks': 0,
                'failed_tasks': 0,
                'timeout_tasks': 0,
                'killed_tasks': 0
            }

            for task_data in index.values():
                status = task_data.get('status', 'unknown')
                if status == 'running':
                    summary['running_tasks'] += 1
                elif status == 'completed':
                    summary['completed_tasks'] += 1
                elif status == 'failed':
                    summary['failed_tasks'] += 1
                elif status == 'timeout':
                    summary['timeout_tasks'] += 1
                elif status == 'killed':
                    summary['killed_tasks'] += 1

            return summary

        except Exception as e:
            logger.error(f"Failed to get global tasks summary: {e}")
            return {}
