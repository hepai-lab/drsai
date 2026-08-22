from __future__ import annotations

from types import SimpleNamespace

import pytest

from drsai.modules.baseagent.drsaiagent import DrSaiAgent


class _Client:
    def __init__(self) -> None:
        self.close_calls = 0

    async def close(self) -> None:
        self.close_calls += 1


class _Context:
    def __init__(self, model_client: _Client) -> None:
        self._model_client = model_client

    async def update_model_client(self, model_client: _Client) -> None:
        self._model_client = model_client


@pytest.mark.asyncio
async def test_non_owning_agent_does_not_close_shared_model_client() -> None:
    client = _Client()
    agent = SimpleNamespace(
        name="child",
        _cancellation_token=None,
        _model_client=client,
        _owns_model_client=False,
    )

    await DrSaiAgent.close(agent)

    assert client.close_calls == 0


@pytest.mark.asyncio
async def test_switch_model_shares_one_reference_and_closes_old_once() -> None:
    old_client = _Client()
    new_client = _Client()
    context = _Context(old_client)

    async def sanitize() -> None:
        return None

    agent = SimpleNamespace(
        _owns_model_client=True,
        _model_client=old_client,
        _model_context=context,
        _sanitize_api_messages=sanitize,
    )

    await DrSaiAgent.switch_model(agent, new_client)

    assert agent._model_client is new_client
    assert context._model_client is new_client
    assert old_client.close_calls == 1
    assert new_client.close_calls == 0


@pytest.mark.asyncio
async def test_non_owner_cannot_replace_shared_model_client() -> None:
    old_client = _Client()
    agent = SimpleNamespace(
        _owns_model_client=False,
        _model_client=old_client,
        _model_context=_Context(old_client),
    )

    with pytest.raises(RuntimeError, match="non-owning agent"):
        await DrSaiAgent.switch_model(agent, _Client())

    assert old_client.close_calls == 0
