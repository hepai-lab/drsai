"""HepAI worker proxy that does not destroy the remote chat on local close.

WebUI ``TeamManager.run_stream`` always ``team.close()`` when a stream ends.
``HepAIWorkerAgent.close`` RPCs remote ``close(chat_id)``, and the worker
default ``close_agent_on_finish=True`` drops ``agent_instance[chat_id]``.
The next ``continue`` then starts a brand-new empty remote session.

Keep the remote session keyed by chat_id; only release local resources here.
"""
from __future__ import annotations

from loguru import logger

from drsai.modules.agents import HepAIWorkerAgent


class SessionPersistentHepAIWorkerAgent(HepAIWorkerAgent):
    """Local proxy for a remote worker whose in-memory session must survive restarts."""

    async def close(self) -> None:
        logger.info(
            "Closing {} locally; keeping remote session chat_id={}",
            self.name,
            self._chat_id,
        )
        if self._model_client:
            try:
                await self._model_client.close()
            except Exception as exc:
                logger.warning(
                    "Error closing local model client for {}: {}",
                    self.name,
                    exc,
                )
