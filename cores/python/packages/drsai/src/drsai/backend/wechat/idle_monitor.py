"""
idle_monitor.py — 空闲 Agent 自动关闭监控
==========================================
后台任务：每隔 check_interval 秒扫描一次会话状态，
将超过 idle_seconds 无活动的 agent 实例关闭，以释放资源。

关闭后 agent 并不会被删除（session 记录仍在），
下次用户发消息时会通过 lazy_init 自动重建。
"""

import asyncio
import logging
from typing import TYPE_CHECKING

from .session_manager import SessionManager

if TYPE_CHECKING:
    from drsai.backend.run import DrSaiWorkerModel

logger = logging.getLogger(__name__)


async def idle_monitor(
    model: "DrSaiWorkerModel",
    session_manager: SessionManager,
    idle_seconds: int = 60*10,
    check_interval: int = 30,
) -> None:
    """
    持续运行的后台协程。

    参数：
        model          : DrSaiWorkerModel 实例（持有 drsai.agent_instance 字典）
        session_manager: 会话管理器（提供 get_idle 查询）
        idle_seconds   : 超过此秒数无活动则关闭 agent（默认 60s）
        check_interval : 每隔此秒数检查一次（默认 30s）
    """
    logger.info(
        "idle_monitor 已启动：idle_seconds=%ds, check_interval=%ds",
        idle_seconds,
        check_interval,
    )

    while True:
        try:
            await asyncio.sleep(check_interval)
        except asyncio.CancelledError:
            logger.info("idle_monitor 收到取消信号，退出。")
            break

        idle_ids = session_manager.get_idle(idle_seconds)
        if not idle_ids:
            continue

        for chat_id in idle_ids:
            if chat_id not in model.drsai.agent_instance:
                continue
            try:
                result = await model.close(chat_id)
                if result.get("status"):
                    logger.info("已关闭空闲 agent: %s（超过 %ds 无活动）", chat_id, idle_seconds)
                else:
                    logger.warning("关闭 agent %s 失败: %s", chat_id, result.get("message"))
            except Exception as e:
                logger.exception("关闭 agent %s 时出错: %s", chat_id, e)
