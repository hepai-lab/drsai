"""
RemoteScheduledTaskManager — 定时任务的远程代理
===============================================

当 CLI 使用本地 agent 进行日常对话，但定时任务需要委托给后台 worker 时，
用这个代理类替代本地的 ScheduledTaskManager。

它将所有操作翻译为 HTTP API 调用，发往 worker 的 /apiv2/scheduled_tasks 和 /apiv2/notifications 接口。

这样 CLI 不需要自己运行调度器，定时任务持久化在 worker 进程中，
CLI 关闭也不影响任务执行。
"""

import httpx
import json
from typing import Optional, List, Dict, Any
from pathlib import Path
from loguru import logger

from .scheduled_task_manager import (
    ScheduledTask,
    TaskResult,
    TaskNotification,
    ScheduleType,
    TaskStatus,
)


class RemoteScheduledTaskManager:
    """
    定时任务管理器的远程代理。

    将 ScheduledTaskManager 的操作翻译为对 worker HTTP API 的调用：
    - POST   /apiv2/scheduled_tasks         → create
    - GET    /apiv2/scheduled_tasks          → list
    - DELETE /apiv2/scheduled_tasks/{id}     → delete
    - PATCH  /apiv2/scheduled_tasks/{id}/toggle → toggle
    - GET    /apiv2/scheduled_tasks/{id}/results → get_results
    - GET    /apiv2/notifications?user_id=xxx → get_notifications

    本类不持有任何调度器、不执行任务——所有执行在 worker 进程中完成。
    """

    def __init__(
        self,
        worker_url: str,
        api_key: Optional[str] = None,
        timeout: float = 30.0,
    ):
        """
        Args:
            worker_url: worker 后端地址，如 "http://localhost:42858/apiv2"
            api_key: 可选的 HepAI API Key（用于认证）
            timeout: HTTP 请求超时时间（秒）
        """
        # 确保 URL 格式正确
        self.base_url = worker_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

        # HTTP 客户端（复用连接）
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        """获取或创建异步 HTTP 客户端"""
        if self._client is None or self._client.is_closed:
            headers = {}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                headers=headers,
                timeout=self.timeout,
            )
        return self._client

    async def close(self):
        """关闭 HTTP 客户端"""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    # ── 任务操作 ─────────────────────────────────────────────────────

    async def add_task(self, task: ScheduledTask) -> str:
        """
        创建定时任务（委托给 worker）

        Args:
            task: 任务配置

        Returns:
            task_id
        """
        client = await self._get_client()
        body = task.model_dump()
        try:
            resp = await client.post("/scheduled_tasks", json=body)
            resp.raise_for_status()
            data = resp.json()
            if data.get("status") == "ok":
                task_id = data.get("task_id", task.task_id)
                # 更新本地 task 对象的 next_run
                if data.get("next_run"):
                    task.next_run = data["next_run"]
                logger.info(f"Remote task created: {task_id}")
                return task_id
            else:
                raise ValueError(f"Worker error: {data}")
        except httpx.HTTPStatusError as e:
            logger.error(f"Failed to create remote task: {e.response.text}")
            raise
        except Exception as e:
            logger.error(f"Failed to create remote task: {e}")
            raise

    async def remove_task(self, task_id: str) -> bool:
        """
        删除定时任务（委托给 worker）

        Args:
            task_id: 任务ID

        Returns:
            是否成功
        """
        client = await self._get_client()
        try:
            resp = await client.delete(f"/scheduled_tasks/{task_id}")
            resp.raise_for_status()
            data = resp.json()
            return data.get("status") == "ok"
        except httpx.HTTPStatusError as e:
            logger.error(f"Failed to delete remote task {task_id}: {e.response.text}")
            return False
        except Exception as e:
            logger.error(f"Failed to delete remote task {task_id}: {e}")
            return False

    async def get_task(self, task_id: str) -> Optional[ScheduledTask]:
        """
        获取指定任务的详情（委托给 worker）

        Args:
            task_id: 任务ID

        Returns:
            ScheduledTask 或 None
        """
        client = await self._get_client()
        try:
            # Worker 的 list 接口支持按 user_id 过滤，但没有单独的 get 接口
            # 这里用 list + 过滤来模拟 get
            resp = await client.get(
                "/scheduled_tasks",
                params={"user_id": ""},  # 不过滤 user_id，获取全部
            )
            resp.raise_for_status()
            data = resp.json()
            tasks = data.get("tasks", [])
            for t in tasks:
                if t.get("task_id") == task_id:
                    return ScheduledTask(**t)
            return None
        except Exception as e:
            logger.error(f"Failed to get remote task {task_id}: {e}")
            return None

    async def list_tasks(
        self,
        user_id: Optional[str] = None,
        session_id: Optional[str] = None,
        status: Optional[TaskStatus] = None,
    ) -> List[ScheduledTask]:
        """
        列出定时任务（委托给 worker）

        Args:
            user_id: 过滤用户ID
            session_id: 过滤会话ID
            status: 过滤状态

        Returns:
            任务列表
        """
        client = await self._get_client()
        params = {}
        if user_id:
            params["user_id"] = user_id
        if session_id:
            params["session_id"] = session_id
        try:
            resp = await client.get("/scheduled_tasks", params=params)
            resp.raise_for_status()
            data = resp.json()
            tasks_raw = data.get("tasks", [])
            tasks = [ScheduledTask(**t) for t in tasks_raw]
            # 状态过滤（worker API 可能不支持）
            if status:
                tasks = [t for t in tasks if t.status == status]
            return tasks
        except Exception as e:
            logger.error(f"Failed to list remote tasks: {e}")
            return []

    async def update_task_status(self, task_id: str, status: TaskStatus):
        """
        更新任务状态（启用/禁用）

        Args:
            task_id: 任务ID
            status: 新状态
        """
        client = await self._get_client()
        enabled = status == TaskStatus.ENABLED
        try:
            resp = await client.patch(
                f"/scheduled_tasks/{task_id}/toggle",
                json={"enabled": enabled},
            )
            resp.raise_for_status()
        except Exception as e:
            logger.error(f"Failed to toggle remote task {task_id}: {e}")
            raise

    async def get_task_results(
        self,
        task_id: str,
        limit: int = 10,
        status: Optional[str] = None,
    ) -> List[TaskResult]:
        """
        获取任务执行历史（委托给 worker）

        Args:
            task_id: 任务ID
            limit: 返回数量
            status: 状态过滤

        Returns:
            结果列表
        """
        client = await self._get_client()
        try:
            resp = await client.get(
                f"/scheduled_tasks/{task_id}/results",
                params={"limit": limit},
            )
            resp.raise_for_status()
            data = resp.json()
            results_raw = data.get("results", [])
            results = [TaskResult(**r) for r in results_raw]
            if status:
                results = [r for r in results if r.status == status]
            return results
        except Exception as e:
            logger.error(f"Failed to get remote task results: {e}")
            return []

    # ── 通知轮询 ─────────────────────────────────────────────────────

    async def get_pending_notifications(self, user_id: str) -> List[TaskNotification]:
        """
        从 worker 获取并清除用户的未读通知。

        CLI 后台轮询定时调用此方法，有通知时打印到终端。

        Args:
            user_id: 用户ID

        Returns:
            未读通知列表（调用后通知会被清除）
        """
        client = await self._get_client()
        try:
            resp = await client.get("/notifications", params={"user_id": user_id})
            resp.raise_for_status()
            data = resp.json()
            notifications_raw = data.get("notifications", [])
            notifications = [TaskNotification(**n) for n in notifications_raw]
            return notifications
        except Exception as e:
            logger.error(f"Failed to get remote notifications: {e}")
            return []

    # ── 输出文件读取（远程不支持，返回提示） ──────────────────────────

    def get_task_outputs(self, task_id: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        远程模式下不支持直接读取输出文件。
        需要用户通过 worker 的 Web UI 或后续添加的输出文件 API 查看。
        """
        return [{"error": "Remote mode: output files are on the worker server. "
                         "Please check the worker's Web UI or use read_output via the agent."}]