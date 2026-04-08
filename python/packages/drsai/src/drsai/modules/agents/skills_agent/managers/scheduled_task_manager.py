"""
Scheduled Task Manager Module
定时任务管理模块

管理用户的定时任务配置、执行和结果存储
"""

import asyncio
import json
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Any, Callable, Awaitable
from datetime import datetime, timedelta
from loguru import logger
from pydantic import BaseModel, Field
from enum import Enum


class ScheduleType(str, Enum):
    """调度类型"""
    CRON = "cron"  # Cron表达式
    INTERVAL = "interval"  # 固定间隔(秒)
    DATETIME = "datetime"  # 一次性任务


class TaskStatus(str, Enum):
    """任务状态"""
    ENABLED = "enabled"  # 启用
    DISABLED = "disabled"  # 禁用
    RUNNING = "running"  # 执行中
    ERROR = "error"  # 错误


class ScheduledTask(BaseModel):
    """定时任务配置"""
    task_id: str = Field(default_factory=lambda: f"task_{uuid.uuid4().hex[:8]}")
    user_id: str
    session_id: str  # thread_id

    # 任务描述
    task_name: str
    task_description: Optional[str] = None
    prompt: str  # 执行的提示词

    # 调度配置
    schedule_type: ScheduleType
    schedule_config: str  # cron表达式 或 间隔秒数 或 datetime字符串

    # 状态信息
    status: TaskStatus = TaskStatus.ENABLED
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    last_run: Optional[str] = None
    next_run: Optional[str] = None
    run_count: int = 0
    error_count: int = 0
    last_error: Optional[str] = None

    # 执行配置
    max_retries: int = 3  # 最大重试次数
    timeout: int = 300  # 超时时间(秒)
    save_history: bool = True  # 是否保存历史结果


class TaskResult(BaseModel):
    """任务执行结果"""
    result_id: str = Field(default_factory=lambda: f"result_{uuid.uuid4().hex[:8]}")
    task_id: str
    user_id: str
    session_id: str

    # 执行信息
    start_time: str
    end_time: Optional[str] = None
    duration: Optional[float] = None  # 执行时长(秒)

    # 结果
    status: str  # success | error | timeout
    result_content: Optional[str] = None
    error_message: Optional[str] = None

    # 元数据
    retry_count: int = 0


class ScheduledTaskManager:
    """
    定时任务管理器
    负责定时任务的注册、调度、执行和结果存储
    """

    def __init__(
        self,
        work_dir: Path,
        agent_executor: Optional[Callable[[str, str, str], Awaitable[str]]] = None,
    ):
        """
        Args:
            work_dir: 工作目录 (通常是用户的work_dir根目录)
            agent_executor: Agent执行器函数 (user_id, session_id, prompt) -> result
        """
        self.work_dir = Path(work_dir)
        self.tasks_dir = self.work_dir / "scheduled_tasks"
        self.tasks_dir.mkdir(exist_ok=True, parents=True)

        self.results_dir = self.work_dir / "task_results"
        self.results_dir.mkdir(exist_ok=True, parents=True)

        self.config_file = self.tasks_dir / "tasks_config.json"

        # 运行时状态
        self.tasks: Dict[str, ScheduledTask] = {}
        self.running_tasks: Dict[str, asyncio.Task] = {}
        self.scheduler_task: Optional[asyncio.Task] = None
        self.is_running = False

        # Agent执行器
        self.agent_executor = agent_executor

        # 加载任务配置
        self._load_tasks()

    def _load_tasks(self):
        """从配置文件加载任务"""
        if not self.config_file.exists():
            return

        try:
            with open(self.config_file, 'r', encoding='utf-8') as f:
                data = json.load(f)

            for task_id, task_data in data.items():
                try:
                    task = ScheduledTask(**task_data)
                    self.tasks[task_id] = task
                except Exception as e:
                    logger.error(f"Failed to load task {task_id}: {e}")
        except Exception as e:
            logger.error(f"Failed to load tasks config: {e}")

    def _save_tasks(self):
        """保存任务配置到文件"""
        try:
            data = {
                task_id: task.model_dump()
                for task_id, task in self.tasks.items()
            }
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Failed to save tasks config: {e}")

    def add_task(self, task: ScheduledTask) -> str:
        """
        添加新的定时任务

        Args:
            task: 任务配置

        Returns:
            task_id: 任务ID
        """
        # 计算下次执行时间
        task.next_run = self._calculate_next_run(task)

        self.tasks[task.task_id] = task
        self._save_tasks()

        logger.info(f"Added scheduled task: {task.task_id} ({task.task_name})")
        return task.task_id

    def remove_task(self, task_id: str) -> bool:
        """
        删除定时任务

        Args:
            task_id: 任务ID

        Returns:
            是否删除成功
        """
        if task_id in self.tasks:
            # 取消正在运行的任务
            if task_id in self.running_tasks:
                self.running_tasks[task_id].cancel()
                del self.running_tasks[task_id]

            del self.tasks[task_id]
            self._save_tasks()
            logger.info(f"Removed scheduled task: {task_id}")
            return True
        return False

    def get_task(self, task_id: str) -> Optional[ScheduledTask]:
        """获取任务配置"""
        return self.tasks.get(task_id)

    def list_tasks(
        self,
        user_id: Optional[str] = None,
        session_id: Optional[str] = None,
        status: Optional[TaskStatus] = None
    ) -> List[ScheduledTask]:
        """
        列出任务

        Args:
            user_id: 过滤用户ID
            session_id: 过滤会话ID
            status: 过滤任务状态

        Returns:
            任务列表
        """
        tasks = list(self.tasks.values())

        if user_id:
            tasks = [t for t in tasks if t.user_id == user_id]
        if session_id:
            tasks = [t for t in tasks if t.session_id == session_id]
        if status:
            tasks = [t for t in tasks if t.status == status]

        return tasks

    def update_task_status(self, task_id: str, status: TaskStatus):
        """更新任务状态"""
        if task_id in self.tasks:
            self.tasks[task_id].status = status
            self._save_tasks()

    def _calculate_next_run(self, task: ScheduledTask) -> Optional[str]:
        """
        计算下次执行时间

        Args:
            task: 任务配置

        Returns:
            ISO格式的时间字符串
        """
        now = datetime.now()

        if task.schedule_type == ScheduleType.INTERVAL:
            # 固定间隔
            try:
                interval_seconds = int(task.schedule_config)
                next_run = now + timedelta(seconds=interval_seconds)
                return next_run.isoformat()
            except ValueError:
                logger.error(f"Invalid interval config: {task.schedule_config}")
                return None

        elif task.schedule_type == ScheduleType.DATETIME:
            # 一次性任务
            try:
                target_time = datetime.fromisoformat(task.schedule_config)
                if target_time > now:
                    return target_time.isoformat()
                else:
                    # 已过期
                    return None
            except ValueError:
                logger.error(f"Invalid datetime config: {task.schedule_config}")
                return None

        elif task.schedule_type == ScheduleType.CRON:
            # Cron表达式 (需要croniter库)
            try:
                from croniter import croniter
                cron = croniter(task.schedule_config, now)
                next_run = cron.get_next(datetime)
                return next_run.isoformat()
            except ImportError:
                logger.error("croniter library not installed, cron schedule not supported")
                return None
            except Exception as e:
                logger.error(f"Invalid cron config: {task.schedule_config}, error: {e}")
                return None

        return None

    async def start(self):
        """启动定时任务调度器"""
        if self.is_running:
            logger.warning("Scheduler already running")
            return

        self.is_running = True
        self.scheduler_task = asyncio.create_task(self._scheduler_loop())
        logger.info("Scheduled task manager started")

    async def stop(self):
        """停止定时任务调度器"""
        if not self.is_running:
            return

        self.is_running = False

        # 取消调度器循环
        if self.scheduler_task:
            self.scheduler_task.cancel()
            try:
                await self.scheduler_task
            except asyncio.CancelledError:
                pass

        # 等待所有运行中的任务完成
        if self.running_tasks:
            await asyncio.gather(*self.running_tasks.values(), return_exceptions=True)

        logger.info("Scheduled task manager stopped")

    async def _scheduler_loop(self):
        """调度器主循环"""
        while self.is_running:
            try:
                await self._check_and_execute_tasks()
                await asyncio.sleep(10)  # 每10秒检查一次
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Scheduler loop error: {e}")
                await asyncio.sleep(10)

    async def _check_and_execute_tasks(self):
        """检查并执行到期的任务"""
        now = datetime.now()

        for task_id, task in list(self.tasks.items()):
            # 跳过禁用或正在运行的任务
            if task.status != TaskStatus.ENABLED:
                continue
            if task_id in self.running_tasks:
                continue

            # 检查是否到执行时间
            if task.next_run:
                next_run_time = datetime.fromisoformat(task.next_run)
                if now >= next_run_time:
                    # 创建执行任务
                    execution_task = asyncio.create_task(
                        self._execute_task(task)
                    )
                    self.running_tasks[task_id] = execution_task

    async def _execute_task(self, task: ScheduledTask):
        """
        执行单个定时任务

        Args:
            task: 任务配置
        """
        task_id = task.task_id
        start_time = datetime.now()

        logger.info(f"Executing scheduled task: {task_id} ({task.task_name})")

        # 更新任务状态
        task.status = TaskStatus.RUNNING
        self._save_tasks()

        result_data = TaskResult(
            task_id=task_id,
            user_id=task.user_id,
            session_id=task.session_id,
            start_time=start_time.isoformat(),
        )

        try:
            # 执行任务
            if self.agent_executor:
                result_content = await asyncio.wait_for(
                    self.agent_executor(
                        task.user_id,
                        task.session_id,
                        task.prompt
                    ),
                    timeout=task.timeout
                )
                result_data.result_content = result_content
                result_data.status = "success"
            else:
                result_data.status = "error"
                result_data.error_message = "No agent executor configured"

        except asyncio.TimeoutError:
            result_data.status = "timeout"
            result_data.error_message = f"Task execution timeout ({task.timeout}s)"
            task.error_count += 1
            task.last_error = result_data.error_message
            logger.warning(f"Task {task_id} timeout")

        except Exception as e:
            result_data.status = "error"
            result_data.error_message = str(e)
            task.error_count += 1
            task.last_error = str(e)
            logger.error(f"Task {task_id} execution error: {e}")

        finally:
            # 更新时间信息
            end_time = datetime.now()
            result_data.end_time = end_time.isoformat()
            result_data.duration = (end_time - start_time).total_seconds()

            # 保存结果
            if task.save_history:
                self._save_result(result_data)

            # 更新任务信息
            task.last_run = start_time.isoformat()
            task.run_count += 1

            # 计算下次执行时间
            task.next_run = self._calculate_next_run(task)

            # 恢复状态
            if task.next_run:
                task.status = TaskStatus.ENABLED
            else:
                # 一次性任务或无法计算下次时间,禁用
                task.status = TaskStatus.DISABLED

            self._save_tasks()

            # 从运行列表移除
            if task_id in self.running_tasks:
                del self.running_tasks[task_id]

            logger.info(f"Task {task_id} completed: {result_data.status}")

    def _save_result(self, result: TaskResult):
        """保存任务执行结果"""
        try:
            # 按task_id创建目录
            task_results_dir = self.results_dir / result.task_id
            task_results_dir.mkdir(exist_ok=True, parents=True)

            # 保存结果文件
            result_file = task_results_dir / f"{result.result_id}.json"
            with open(result_file, 'w', encoding='utf-8') as f:
                json.dump(result.model_dump(), f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Failed to save task result: {e}")

    def get_task_results(
        self,
        task_id: str,
        limit: int = 10,
        status: Optional[str] = None
    ) -> List[TaskResult]:
        """
        获取任务历史结果

        Args:
            task_id: 任务ID
            limit: 返回数量限制
            status: 过滤状态 (success/error/timeout)

        Returns:
            结果列表 (按时间倒序)
        """
        task_results_dir = self.results_dir / task_id
        if not task_results_dir.exists():
            return []

        results = []
        for result_file in sorted(task_results_dir.glob("*.json"), reverse=True):
            try:
                with open(result_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                result = TaskResult(**data)

                # 状态过滤
                if status and result.status != status:
                    continue

                results.append(result)

                if len(results) >= limit:
                    break
            except Exception as e:
                logger.error(f"Failed to load result file {result_file}: {e}")

        return results

    def get_pending_results(
        self,
        user_id: str,
        session_id: Optional[str] = None,
        since: Optional[datetime] = None
    ) -> List[TaskResult]:
        """
        获取待查看的任务结果

        Args:
            user_id: 用户ID
            session_id: 会话ID (可选)
            since: 起始时间 (可选)

        Returns:
            待查看的结果列表
        """
        results = []

        # 遍历所有任务的结果
        for task_results_dir in self.results_dir.iterdir():
            if not task_results_dir.is_dir():
                continue

            for result_file in sorted(task_results_dir.glob("*.json"), reverse=True):
                try:
                    with open(result_file, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    result = TaskResult(**data)

                    # 过滤条件
                    if result.user_id != user_id:
                        continue
                    if session_id and result.session_id != session_id:
                        continue
                    if since:
                        result_time = datetime.fromisoformat(result.start_time)
                        if result_time < since:
                            continue

                    results.append(result)
                except Exception as e:
                    logger.error(f"Failed to load result file {result_file}: {e}")

        # 按时间倒序排列
        results.sort(key=lambda x: x.start_time, reverse=True)
        return results
