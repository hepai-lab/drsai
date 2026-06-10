"""
Bash Task Recovery Module

This module provides utilities for recovering and handling bash tasks after program restart.
"""

import os
import signal
from typing import Dict, Any, List, Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class BashTaskRecovery:
    """
    Handles recovery and validation of bash tasks after program restart.
    """

    @staticmethod
    def check_process_alive(pid: Optional[int], pgid: Optional[int] = None) -> bool:
        """
        Check if a process or process group is still alive.

        Args:
            pid: Process ID
            pgid: Process Group ID (optional, more reliable than PID)

        Returns:
            True if process/group is alive, False otherwise
        """
        if not pid:
            return False

        try:
            # Check if process group exists (preferred if available)
            if pgid:
                try:
                    os.killpg(pgid, 0)  # Signal 0 just checks existence
                    return True
                except ProcessLookupError:
                    return False
                except PermissionError:
                    # Process exists but we don't have permission
                    return True

            # Fall back to checking PID
            os.kill(pid, 0)  # Signal 0 just checks existence
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            # Process exists but we don't have permission
            return True
        except Exception as e:
            logger.warning(f"Error checking process {pid}: {e}")
            return False

    @staticmethod
    def categorize_restored_tasks(tasks: Dict[str, Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
        """
        Categorize restored tasks by their status and viability.

        Args:
            tasks: Dictionary of task_id -> task_info

        Returns:
            Dictionary with categorized tasks:
            {
                'completed': [...],      # Successfully completed tasks
                'failed': [...],         # Failed tasks
                'interrupted': [...],    # Tasks that were running when program stopped
                'orphaned': [...],       # Running tasks whose processes are dead
                'still_running': [...]   # Tasks with processes still alive (rare)
            }
        """
        categorized = {
            'completed': [],
            'failed': [],
            'timeout': [],
            'killed': [],
            'interrupted': [],
            'orphaned': [],
            'still_running': []
        }

        for task_id, task_info in tasks.items():
            status = task_info.get('status', 'unknown')

            if status == 'completed':
                categorized['completed'].append(task_info)
            elif status == 'failed':
                categorized['failed'].append(task_info)
            elif status == 'timeout':
                categorized['timeout'].append(task_info)
            elif status == 'killed':
                categorized['killed'].append(task_info)
            elif status == 'running':
                # Check if process is actually still alive
                pid = task_info.get('pid')
                pgid = task_info.get('pgid')

                if BashTaskRecovery.check_process_alive(pid, pgid):
                    categorized['still_running'].append(task_info)
                else:
                    categorized['orphaned'].append(task_info)
            elif status == 'interrupted':
                categorized['interrupted'].append(task_info)

        return categorized

    @staticmethod
    def update_interrupted_tasks(
        tasks: Dict[str, Dict[str, Any]],
        persistence_manager
    ) -> List[Dict[str, Any]]:
        """
        Update tasks that were interrupted by program restart.

        Args:
            tasks: Dictionary of task_id -> task_info
            persistence_manager: BashTaskPersistence instance

        Returns:
            List of task info for interrupted tasks
        """
        interrupted = []

        for task_id, task_info in tasks.items():
            if task_info.get('status') != 'running':
                continue

            # Check if process is still alive
            pid = task_info.get('pid')
            pgid = task_info.get('pgid')

            if not BashTaskRecovery.check_process_alive(pid, pgid):
                # Process is dead, mark as interrupted
                task_info['status'] = 'interrupted'
                task_info['error'] = 'Task interrupted by program restart (process not found)'
                task_info['interrupted_at'] = datetime.now().isoformat()

                # Update in persistent storage
                persistence_manager.update_task_status(
                    task_id,
                    'interrupted',
                    error=task_info['error']
                )

                interrupted.append(task_info)
                logger.info(f"Marked task {task_id} as interrupted (PID {pid} not found)")
            else:
                # Process still alive - this is unusual but possible
                logger.warning(
                    f"Task {task_id} has a running process (PID {pid}), "
                    f"but we've lost control of it"
                )
                task_info['status'] = 'orphaned'
                task_info['error'] = 'Process still running but orphaned from control'
                persistence_manager.update_task_status(
                    task_id,
                    'orphaned',
                    error=task_info['error']
                )
                interrupted.append(task_info)

        return interrupted

    @staticmethod
    def format_recovery_notification(categorized: Dict[str, List[Dict[str, Any]]]) -> str:
        """
        Format a user-friendly notification about recovered tasks.

        Args:
            categorized: Categorized tasks from categorize_restored_tasks()

        Returns:
            Formatted notification string
        """
        lines = []

        total_tasks = sum(len(tasks) for tasks in categorized.values())
        if total_tasks == 0:
            return ""

        lines.append("## 任务恢复报告")
        lines.append("")

        # Completed tasks
        if categorized['completed']:
            lines.append(f"✓ **已完成任务**: {len(categorized['completed'])} 个")
            for task in categorized['completed'][:3]:  # Show first 3
                cmd_preview = task['command'][:40] + "..." if len(task['command']) > 40 else task['command']
                lines.append(f"  - `{task['task_id']}`: {cmd_preview}")
            if len(categorized['completed']) > 3:
                lines.append(f"  - ... 以及其他 {len(categorized['completed']) - 3} 个任务")
            lines.append("")

        # Interrupted tasks
        if categorized['interrupted'] or categorized['orphaned']:
            total_interrupted = len(categorized['interrupted']) + len(categorized['orphaned'])
            lines.append(f"⚠ **中断任务**: {total_interrupted} 个")
            lines.append("  这些任务在上次会话中运行,但因程序重启而中断:")

            all_interrupted = categorized['interrupted'] + categorized['orphaned']
            for task in all_interrupted[:3]:  # Show first 3
                cmd_preview = task['command'][:40] + "..." if len(task['command']) > 40 else task['command']
                lines.append(f"  - `{task['task_id']}`: {cmd_preview}")
            if len(all_interrupted) > 3:
                lines.append(f"  - ... 以及其他 {len(all_interrupted) - 3} 个任务")
            lines.append("")

        # Still running tasks (unusual)
        if categorized['still_running']:
            lines.append(f"⚡ **仍在运行**: {len(categorized['still_running'])} 个")
            lines.append("  这些任务的进程仍在运行,但已失去控制:")
            for task in categorized['still_running']:
                cmd_preview = task['command'][:40] + "..." if len(task['command']) > 40 else task['command']
                lines.append(f"  - `{task['task_id']}` (PID: {task.get('pid')}): {cmd_preview}")
            lines.append("")

        # Failed tasks
        if categorized['failed'] or categorized['timeout'] or categorized['killed']:
            total_failed = len(categorized['failed']) + len(categorized['timeout']) + len(categorized['killed'])
            lines.append(f"✗ **失败任务**: {total_failed} 个")
            lines.append("")

        lines.append(f"使用 `list_bash_tasks()` 查看所有任务详情")

        return "\n".join(lines)

    @staticmethod
    def cleanup_completed_tasks(
        tasks: Dict[str, Dict[str, Any]],
        persistence_manager,
        keep_recent_hours: int = 24
    ) -> int:
        """
        Clean up old completed/failed tasks to reduce clutter.

        Args:
            tasks: Dictionary of task_id -> task_info
            persistence_manager: BashTaskPersistence instance
            keep_recent_hours: Keep tasks from the last N hours

        Returns:
            Number of tasks cleaned up
        """
        now = datetime.now()
        cleaned_count = 0

        tasks_to_remove = []
        for task_id, task_info in tasks.items():
            status = task_info.get('status')

            # Only clean up terminal states
            if status not in ['completed', 'failed', 'timeout', 'killed', 'interrupted']:
                continue

            # Check age
            end_time = task_info.get('end_time') or task_info.get('interrupted_at')
            if end_time:
                try:
                    end_dt = datetime.fromisoformat(end_time)
                    age_hours = (now - end_dt).total_seconds() / 3600

                    if age_hours > keep_recent_hours:
                        tasks_to_remove.append(task_id)
                except Exception as e:
                    logger.warning(f"Error parsing time for task {task_id}: {e}")

        # Remove old tasks
        for task_id in tasks_to_remove:
            if task_id in tasks:
                del tasks[task_id]
            persistence_manager.delete_task(task_id)
            cleaned_count += 1
            logger.info(f"Cleaned up old task {task_id}")

        return cleaned_count

    @staticmethod
    def get_task_summary_stats(tasks: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        """
        Get summary statistics about tasks.

        Args:
            tasks: Dictionary of task_id -> task_info

        Returns:
            Dictionary with statistics
        """
        stats = {
            'total': len(tasks),
            'running': 0,
            'completed': 0,
            'failed': 0,
            'interrupted': 0,
            'timeout': 0,
            'killed': 0,
            'orphaned': 0
        }

        for task_info in tasks.values():
            status = task_info.get('status', 'unknown')
            if status in stats:
                stats[status] += 1

        return stats
