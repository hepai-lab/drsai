"""A channel Session follows the Workspace its channel points at.

A channel binding is keyed by ``(provider, account_fingerprint,
provider_user_key)`` alone -- it has no Workspace column -- so the Session it
owns survives a change of Workspace.  A Session created while the channel
pointed somewhere else would otherwise keep producing Runs in the old
directory: a different working directory, a different project instruction file
and a different environment section than the Desktop user sees.  These tests pin
the two halves of the fix:

* ``RuntimeEngine.relocate_channel_session`` moves exactly one channel Session,
  gives both Workspaces a catalog event, and leaves history alone;
* ``WeChatRuntimeSessionBridge`` re-points a Session it finds in the wrong
  Workspace, on every path that hands a Session to the channel.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

import pytest
from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.wechat.channel_identity import ChannelIdentity
from drsai.backend.wechat.runtime_session_bridge import WeChatRuntimeSessionBridge

WORKSPACE_A = "workspace-a"
WORKSPACE_B = "workspace-b"

IDENTITY = ChannelIdentity(b"k" * 32)
ACCOUNT_ID = "account-1"
PROVIDER_USER_ID = "user-1"


def _engine(tmp_path: Path) -> RuntimeEngine:
    return RuntimeEngine(
        database=tmp_path / "engine.sqlite3",
        identity=RuntimeEngineIdentity(runtime_id="rt-channel", instance_id="inst-channel"),
        workspace_exists=lambda workspace_id: workspace_id in {WORKSPACE_A, WORKSPACE_B},
    )


def _channel_session(engine: RuntimeEngine, workspace_id: str = WORKSPACE_A) -> dict[str, Any]:
    session, _created = engine.resolve_or_create_channel_session(
        workspace_id,
        provider="wechat",
        account_fingerprint=IDENTITY.account_fingerprint(ACCOUNT_ID),
        provider_user_key=IDENTITY.provider_user_key(PROVIDER_USER_ID),
        title_prefix="微信会话",
    )
    return session


def test_relocating_a_channel_session_moves_its_next_run_only(tmp_path) -> None:
    engine = _engine(tmp_path)
    session = _channel_session(engine)
    session_id = str(session["session_id"])
    before, _ = engine.create_run(session_id, "agent-definition", "idem-before")
    # Attaching a Run advances the Session revision, so read it back rather than
    # reusing the snapshot taken before the Run existed.
    current = engine.get_session(session_id)

    relocated = engine.relocate_channel_session(session_id, workspace_id=WORKSPACE_B)

    assert relocated["workspace_id"] == WORKSPACE_B
    assert int(relocated["revision"]) == int(current["revision"]) + 1
    # A Run copies the Session's Workspace when it starts, so the move applies
    # to the next Run and to nothing that already happened.
    assert engine.get_run(str(before["run_id"]))["workspace_id"] == WORKSPACE_A
    after, _ = engine.create_run(session_id, "agent-definition", "idem-after")
    assert engine.get_run(str(after["run_id"]))["workspace_id"] == WORKSPACE_B
    assert engine.list_channel_sessions(str(session["origin"]["binding_id"]))[0]["workspace_id"] == WORKSPACE_B


def test_relocation_notifies_the_workspace_that_loses_the_session(tmp_path) -> None:
    engine = _engine(tmp_path)
    session = _channel_session(engine)
    session_id = str(session["session_id"])

    engine.relocate_channel_session(session_id, workspace_id=WORKSPACE_B)

    connection = sqlite3.connect(str(tmp_path / "engine.sqlite3"))
    try:
        rows = [
            str(row[0])
            for row in connection.execute(
                "SELECT workspace_id FROM runtime_session_journal WHERE session_id=? ORDER BY rowid",
                (session_id,),
            ).fetchall()
        ]
    finally:
        connection.close()
    # The Session-created event plus the event published while the Session still
    # pointed at the old Workspace, then the event that publishes it to the new
    # one: a catalog stream for either Workspace learns about the change.
    assert len(rows) == 3
    assert rows.count(WORKSPACE_A) == 2
    assert rows.count(WORKSPACE_B) == 1


def test_relocating_an_already_moved_session_changes_nothing(tmp_path) -> None:
    engine = _engine(tmp_path)
    session_id = str(_channel_session(engine)["session_id"])
    moved = engine.relocate_channel_session(session_id, workspace_id=WORKSPACE_B)

    again = engine.relocate_channel_session(session_id, workspace_id=WORKSPACE_B)

    assert int(again["revision"]) == int(moved["revision"])
    assert again["updated_at"] == moved["updated_at"]


def test_relocating_refuses_a_session_that_is_not_a_channel_session(tmp_path) -> None:
    engine = _engine(tmp_path)
    plain = engine.create_session(WORKSPACE_A, "plain session")

    with pytest.raises(ValueError, match="Only a channel Session"):
        engine.relocate_channel_session(str(plain["session_id"]), workspace_id=WORKSPACE_B)


def test_relocating_refuses_a_removed_session(tmp_path) -> None:
    engine = _engine(tmp_path)
    session_id = str(_channel_session(engine)["session_id"])
    engine.remove_session(session_id)

    with pytest.raises(ValueError, match="removed Session"):
        engine.relocate_channel_session(session_id, workspace_id=WORKSPACE_B)


def test_relocating_refuses_an_unknown_workspace(tmp_path) -> None:
    engine = _engine(tmp_path)
    session_id = str(_channel_session(engine)["session_id"])

    with pytest.raises(KeyError):
        engine.relocate_channel_session(session_id, workspace_id="workspace-missing")


class _StubChannelEngine:
    """Records the Session operations the bridge performs."""

    def __init__(
        self,
        *,
        session_workspace: str,
        activated_workspace: str | None = None,
        rotated_workspace: str | None = None,
    ) -> None:
        self.session_workspace = session_workspace
        self.activated_workspace = activated_workspace or session_workspace
        self.rotated_workspace = rotated_workspace or session_workspace
        self.relocated: list[tuple[str, str]] = []
        self.activated: list[tuple[str, str]] = []
        self.rotated: list[str] = []

    def resolve_or_create_channel_session(self, workspace_id: str, **kwargs: Any) -> tuple[dict[str, Any], bool]:
        assert kwargs["provider"] == "wechat"
        return self._session(self.session_workspace, "session-1"), True

    def relocate_channel_session(self, session_id: str, *, workspace_id: str) -> dict[str, Any]:
        self.relocated.append((session_id, workspace_id))
        self.session_workspace = workspace_id
        return self._session(workspace_id, session_id)

    def activate_channel_session(self, binding_id: str, session_id: str) -> dict[str, Any]:
        self.activated.append((binding_id, session_id))
        return self._session(self.activated_workspace, session_id)

    def rotate_channel_session(self, binding_id: str, *, title_prefix: str) -> dict[str, Any]:
        self.rotated.append(binding_id)
        assert title_prefix
        return self._session(self.rotated_workspace, "session-2")

    @staticmethod
    def _session(workspace_id: str, session_id: str) -> dict[str, Any]:
        return {
            "session_id": session_id,
            "workspace_id": workspace_id,
            "origin": {"kind": "channel", "provider": "wechat", "binding_id": "wcb-1"},
        }


def _bridge(engine: Any, *, workspace_id: str) -> WeChatRuntimeSessionBridge:
    return WeChatRuntimeSessionBridge(
        engine=engine,
        agent_service=None,
        workspace_id=lambda: workspace_id,
        identity=ChannelIdentity(b"k" * 32),
        account_id="account-1",
    )


def test_a_session_found_in_another_workspace_is_moved_before_its_turn() -> None:
    engine = _StubChannelEngine(session_workspace=WORKSPACE_A)
    bridge = _bridge(engine, workspace_id=WORKSPACE_B)

    session, created = bridge._resolve("user-1")

    assert engine.relocated == [("session-1", WORKSPACE_B)]
    assert session["workspace_id"] == WORKSPACE_B
    assert created is True
    assert bridge.provider_user_for_session("session-1") == "user-1"


def test_a_session_already_in_the_channel_workspace_is_left_alone() -> None:
    engine = _StubChannelEngine(session_workspace=WORKSPACE_B)
    bridge = _bridge(engine, workspace_id=WORKSPACE_B)

    session, _created = bridge._resolve("user-1")

    assert engine.relocated == []
    assert session["workspace_id"] == WORKSPACE_B


def test_switching_to_a_session_from_another_workspace_moves_it() -> None:
    engine = _StubChannelEngine(session_workspace=WORKSPACE_B, activated_workspace=WORKSPACE_A)
    bridge = _bridge(engine, workspace_id=WORKSPACE_B)

    selected = bridge.switch_session("user-1", "session-2")

    assert engine.activated == [("wcb-1", "session-2")]
    assert engine.relocated == [("session-2", WORKSPACE_B)]
    assert selected["workspace_id"] == WORKSPACE_B


def test_a_new_session_is_pinned_to_the_channel_workspace() -> None:
    # ``/new`` copies the Workspace of the Session it replaces, so a rotation is
    # normally already correct; the bridge must still not hand the channel a
    # Session living elsewhere.
    engine = _StubChannelEngine(session_workspace=WORKSPACE_B, rotated_workspace=WORKSPACE_A)
    bridge = _bridge(engine, workspace_id=WORKSPACE_B)

    rotated = bridge.new_session("user-1")

    assert engine.rotated == ["wcb-1"]
    assert engine.relocated == [("session-2", WORKSPACE_B)]
    assert rotated["workspace_id"] == WORKSPACE_B


def test_a_new_session_lands_in_the_channel_workspace(tmp_path) -> None:
    engine = _engine(tmp_path)
    bridge = _bridge(engine, workspace_id=WORKSPACE_B)
    # The channel used to resolve to Workspace A, so its Session lives there.
    stale_session_id = str(_channel_session(engine, WORKSPACE_A)["session_id"])

    rotated = bridge.new_session("user-1")

    assert rotated["workspace_id"] == WORKSPACE_B
    assert engine.get_session(stale_session_id)["workspace_id"] == WORKSPACE_B
    assert engine.get_session(str(rotated["session_id"]))["workspace_id"] == WORKSPACE_B
