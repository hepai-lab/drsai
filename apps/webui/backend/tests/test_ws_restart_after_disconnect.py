import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from autogen_core import CancellationToken

from drsai_ui.ui_backend.backend.datamodel import RunStatus
from drsai_ui.ui_backend.backend.web.managers.connection import WebSocketManager


class FakeWebSocket:
    def __init__(self):
        self.sent: list[dict] = []

    async def accept(self):
        return None

    async def send_json(self, message):
        self.sent.append(message)


class FakeDB:
    def __init__(self, run):
        self.run = run

    def get(self, *args, **kwargs):
        filters = kwargs.get("filters") or {}
        if args and not isinstance(args[0], type) and "filters" not in kwargs:
            filters = args[0] if isinstance(args[0], dict) else filters
        if filters.get("id") == self.run.id or "id" in filters:
            return SimpleNamespace(status=True, data=[self.run])
        return SimpleNamespace(status=True, data=[])

    def upsert(self, _obj):
        return SimpleNamespace(status=True, data=[_obj])


def _manager(run) -> WebSocketManager:
    return WebSocketManager(
        db_manager=FakeDB(run),
        internal_workspace_root=Path("/tmp"),
        external_workspace_root=Path("/tmp"),
        inside_docker=False,
        config={},
    )


@pytest.mark.asyncio
async def test_tab_close_does_not_skip_disconnect_or_drop_run_tokens():
    run = SimpleNamespace(id=7, status=RunStatus.ACTIVE, user_id="u", input_request=None)
    manager = _manager(run)
    ws = FakeWebSocket()
    token = CancellationToken()
    team = AsyncMock()
    team.close = AsyncMock()

    assert await manager.connect(ws, run.id)
    manager._cancellation_tokens[run.id] = token
    manager._team_managers[run.id] = team
    conn_gen = manager._conn_gen[run.id]

    await manager.disconnect(run.id, conn_gen=conn_gen, stop_run=False)

    assert run.id not in manager._connections
    assert manager._cancellation_tokens[run.id] is token
    assert manager._team_managers[run.id] is team
    assert run.id not in manager._closed_connections
    team.close.assert_not_awaited()


@pytest.mark.asyncio
async def test_stale_disconnect_does_not_drop_newer_websocket():
    run = SimpleNamespace(id=8, status=RunStatus.ACTIVE, user_id="u", input_request=None)
    manager = _manager(run)
    old_ws = FakeWebSocket()
    new_ws = FakeWebSocket()

    assert await manager.connect(old_ws, run.id)
    old_gen = manager._conn_gen[run.id]
    assert await manager.connect(new_ws, run.id)

    await manager.disconnect(run.id, conn_gen=old_gen, stop_run=False)

    assert manager._connections[run.id] is new_ws


@pytest.mark.asyncio
async def test_internal_restart_does_not_emit_cancelled_completion():
    run = SimpleNamespace(id=9, status=RunStatus.ACTIVE, user_id="u", input_request=None)
    manager = _manager(run)
    ws = FakeWebSocket()
    token = CancellationToken()
    team = AsyncMock()
    team.close = AsyncMock()

    assert await manager.connect(ws, run.id)
    manager._cancellation_tokens[run.id] = token
    manager._team_managers[run.id] = team
    ws.sent.clear()

    await manager.stop_run(run.id, "Restarted by client", mark_closed=False)

    assert token.is_cancelled()
    assert run.id not in manager._closed_connections
    assert not any(
        msg.get("type") == "completion" and msg.get("status") == "cancelled"
        for msg in ws.sent
    )


@pytest.mark.asyncio
async def test_user_stop_still_emits_cancelled_completion():
    run = SimpleNamespace(id=10, status=RunStatus.ACTIVE, user_id="u", input_request=None)
    manager = _manager(run)
    ws = FakeWebSocket()
    token = CancellationToken()
    team = AsyncMock()
    team.close = AsyncMock()

    assert await manager.connect(ws, run.id)
    manager._cancellation_tokens[run.id] = token
    manager._team_managers[run.id] = team
    ws.sent.clear()

    await manager.stop_run(run.id, "Cancelled by user", mark_closed=True)

    cancelled = [
        msg
        for msg in ws.sent
        if msg.get("type") == "completion" and msg.get("status") == "cancelled"
    ]
    assert cancelled
    assert run.id in manager._closed_connections


@pytest.mark.asyncio
async def test_reconnect_then_internal_restart_keeps_new_socket_open():
    """Close tab → reopen same run → start again must not send cancelled."""
    run = SimpleNamespace(id=11, status=RunStatus.ACTIVE, user_id="u", input_request=None)
    manager = _manager(run)
    old_ws = FakeWebSocket()
    new_ws = FakeWebSocket()
    token = CancellationToken()
    team = AsyncMock()
    team.close = AsyncMock()

    assert await manager.connect(old_ws, run.id)
    manager._cancellation_tokens[run.id] = token
    manager._team_managers[run.id] = team
    old_gen = manager._conn_gen[run.id]

    await manager.disconnect(run.id, conn_gen=old_gen, stop_run=False)
    assert await manager.connect(new_ws, run.id)
    new_ws.sent.clear()

    await manager.stop_run(run.id, "Restarted by client", mark_closed=False)

    assert manager._connections[run.id] is new_ws
    assert not any(
        msg.get("type") == "completion" or msg.get("status") == "cancelled"
        for msg in new_ws.sent
    )
