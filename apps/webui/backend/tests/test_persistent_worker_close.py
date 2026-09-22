from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from drsai_ui.agent_factory.remote_agent.persistent_worker import (
    SessionPersistentHepAIWorkerAgent,
)


@pytest.mark.asyncio
async def test_persistent_worker_close_skips_remote_rpc() -> None:
    remote_close = AsyncMock(side_effect=AssertionError("remote close must not be called"))
    agent = SimpleNamespace(
        name="RemoteAgent",
        _chat_id="run-uuid",
        _model_client=SimpleNamespace(close=AsyncMock()),
        _funcs_map={"close": remote_close},
    )
    await SessionPersistentHepAIWorkerAgent.close(agent)
    agent._model_client.close.assert_awaited_once()
    remote_close.assert_not_called()
