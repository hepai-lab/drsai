"""A channel Session cannot outlive the binding that points at it.

The Desktop removes a Session by writing ``lifecycle='removed'`` -- a terminal
state, never revived -- while a channel binding keeps naming whatever Session it
last handed the channel.  Nothing else re-points that binding: the polling task
resolves through it on every turn, so a removed (or missing) target used to fail
every later message with ``RuntimeError`` and leave the channel permanently
broken for an account the user still had linked.

These tests pin the three halves of the fix:

* ``resolve_or_create_channel_session`` rebuilds the Session a binding can no
  longer use, instead of raising;
* ``update_session(lifecycle="removed")`` replaces the Session of every binding
  that named it, so a removal never creates the broken state in the first place;
* ``archive_stale_channel_sessions`` retires the Sessions of a WeChat account a
  newer login replaced, so the Desktop list stops showing a second
  "微信会话 N" -- while keeping the binding, so that account can resume it.

A rebuilt Session keeps the name and the Workspace of the one it stands in for,
and the binding keeps its display slot: from WeChat and from the Desktop list
the deletion looks like a replacement, not a second conversation.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.wechat.channel_identity import ChannelIdentity
from drsai.backend.wechat.runtime_session_bridge import WeChatRuntimeSessionBridge

WORKSPACE_A = "workspace-a"
WORKSPACE_B = "workspace-b"

IDENTITY = ChannelIdentity(b"k" * 32)
ACCOUNT_ID = "account-1"
REPLACED_ACCOUNT_ID = "account-0"
PROVIDER_USER_ID = "user-1"
TITLE_PREFIX = "微信会话"


def _engine(tmp_path: Path) -> RuntimeEngine:
    return RuntimeEngine(
        database=tmp_path / "engine.sqlite3",
        identity=RuntimeEngineIdentity(runtime_id="rt-channel", instance_id="inst-channel"),
        workspace_exists=lambda workspace_id: workspace_id in {WORKSPACE_A, WORKSPACE_B},
    )


def _resolve(
    engine: RuntimeEngine,
    *,
    account_id: str = ACCOUNT_ID,
    user_id: str = PROVIDER_USER_ID,
    workspace_id: str = WORKSPACE_A,
) -> tuple[dict[str, Any], bool]:
    return engine.resolve_or_create_channel_session(
        workspace_id,
        provider="wechat",
        account_fingerprint=IDENTITY.account_fingerprint(account_id),
        provider_user_key=IDENTITY.provider_user_key(user_id),
        title_prefix=TITLE_PREFIX,
    )


def _session(engine: RuntimeEngine, *, account_id: str = ACCOUNT_ID) -> dict[str, Any]:
    return _resolve(engine, account_id=account_id)[0]


def _database(tmp_path: Path) -> Path:
    return tmp_path / "engine.sqlite3"


def _binding_row(tmp_path: Path, binding_id: str) -> sqlite3.Row:
    connection = sqlite3.connect(str(_database(tmp_path)))
    connection.row_factory = sqlite3.Row
    try:
        return connection.execute(
            "SELECT * FROM runtime_channel_bindings WHERE binding_id=?", (binding_id,)
        ).fetchone()
    finally:
        connection.close()


def _binding_count(tmp_path: Path) -> int:
    connection = sqlite3.connect(str(_database(tmp_path)))
    try:
        return int(connection.execute("SELECT COUNT(*) FROM runtime_channel_bindings").fetchone()[0])
    finally:
        connection.close()


def _event_kinds(tmp_path: Path, session_id: str) -> list[str]:
    connection = sqlite3.connect(str(_database(tmp_path)))
    try:
        return [
            str(row[0])
            for row in connection.execute(
                "SELECT event_kind FROM runtime_session_journal WHERE session_id=? "
                "ORDER BY session_sequence",
                (session_id,),
            ).fetchall()
        ]
    finally:
        connection.close()


def _point_binding_at(tmp_path: Path, binding_id: str, session_id: str) -> None:
    """Reproduce a binding whose Session can no longer be used.

    Written directly because the fix exists to make the Runtime itself refuse to
    leave this state behind.  Foreign keys are off on a plain ``sqlite3``
    connection, which is what lets the target be missing entirely.
    """
    connection = sqlite3.connect(str(_database(tmp_path)))
    try:
        connection.execute(
            "UPDATE runtime_channel_bindings SET active_session_id=? WHERE binding_id=?",
            (session_id, binding_id),
        )
        connection.commit()
    finally:
        connection.close()


# ── Removal replaces the Session instead of stranding the binding ────────────

def test_removing_a_channel_session_replaces_it_in_the_same_slot(tmp_path) -> None:
    engine = _engine(tmp_path)
    original = _session(engine)
    session_id = str(original["session_id"])
    binding_id = str(original["origin"]["binding_id"])

    engine.remove_session(session_id)

    removed = engine.get_session(session_id)
    assert removed["lifecycle"] == "removed"
    assert removed["removed_at"]
    assert _event_kinds(tmp_path, session_id)[-1] == "session.removed"

    binding = _binding_row(tmp_path, binding_id)
    replacement_id = str(binding["active_session_id"])
    assert replacement_id != session_id
    # One binding, one Session: the channel is not handed a second conversation.
    assert _binding_count(tmp_path) == 1
    assert int(binding["display_index"]) == 1
    replacement = engine.get_session(replacement_id)
    assert replacement["lifecycle"] == "active"
    assert replacement["title"] == original["title"]
    assert replacement["workspace_id"] == original["workspace_id"]
    assert str(replacement["origin"]["binding_id"]) == binding_id
    assert _event_kinds(tmp_path, replacement_id) == ["session.updated"]
    # The channel's own count follows the replacement, not the removed Session.
    assert engine.channel_session_count("wechat") == 1


def test_a_turn_after_a_removal_continues_on_the_replacement(tmp_path) -> None:
    engine = _engine(tmp_path)
    first = _session(engine)
    engine.remove_session(str(first["session_id"]))

    session, created = _resolve(engine)

    assert created is False
    assert session["session_id"] != first["session_id"]
    assert session["lifecycle"] == "active"
    run, _ = engine.create_run(str(session["session_id"]), "opendrsai@1", "idem-after-removal")
    assert engine.get_run(str(run["run_id"]))["session_id"] == session["session_id"]


# ── A binding the Runtime cannot serve is rebuilt ────────────────────────────

def test_a_binding_left_on_a_removed_session_is_rebuilt(tmp_path) -> None:
    """The state the incident left: a binding on a terminal Session."""
    engine = _engine(tmp_path)
    original = _session(engine)
    session_id = str(original["session_id"])
    binding_id = str(original["origin"]["binding_id"])
    engine.remove_session(session_id)
    replacement_id = str(_binding_row(tmp_path, binding_id)["active_session_id"])
    _point_binding_at(tmp_path, binding_id, session_id)

    rebuilt, created = _resolve(engine)

    assert created is True
    assert rebuilt["session_id"] not in {session_id, replacement_id}
    assert rebuilt["lifecycle"] == "active"
    assert rebuilt["title"] == original["title"]
    assert rebuilt["workspace_id"] == original["workspace_id"]
    assert str(rebuilt["origin"]["binding_id"]) == binding_id
    assert str(_binding_row(tmp_path, binding_id)["active_session_id"]) == rebuilt["session_id"]
    assert _binding_count(tmp_path) == 1


def test_a_binding_pointing_at_a_missing_session_is_rebuilt(tmp_path) -> None:
    """A Workspace that goes away can take its channel Session with it."""
    engine = _engine(tmp_path)
    original = _session(engine)
    binding_id = str(original["origin"]["binding_id"])
    _point_binding_at(tmp_path, binding_id, "session-purged")

    rebuilt, created = _resolve(engine)

    assert created is True
    assert rebuilt["session_id"] != original["session_id"]
    assert rebuilt["lifecycle"] == "active"
    assert rebuilt["title"] == original["title"]
    assert rebuilt["workspace_id"] == WORKSPACE_A
    assert str(rebuilt["origin"]["binding_id"]) == binding_id
    assert str(_binding_row(tmp_path, binding_id)["active_session_id"]) == rebuilt["session_id"]


def test_a_rebuilt_session_lands_in_the_workspace_the_channel_points_at(tmp_path) -> None:
    # The rebuilt Session inherits the Workspace of the Session it replaces, so a
    # channel that moved must still pin its Session -- that is the bridge's half
    # of the contract, exercised here against the real engine.
    engine = _engine(tmp_path)
    original = _session(engine, )
    engine.relocate_channel_session(str(original["session_id"]), workspace_id=WORKSPACE_B)
    binding_id = str(original["origin"]["binding_id"])
    engine.remove_session(str(original["session_id"]))
    replacement_id = str(_binding_row(tmp_path, binding_id)["active_session_id"])

    assert engine.get_session(replacement_id)["workspace_id"] == WORKSPACE_B


# ── The account a login replaced is retired, not deleted ─────────────────────

def test_archiving_stale_channel_sessions_retires_the_replaced_account(tmp_path) -> None:
    engine = _engine(tmp_path)
    stale = _session(engine, account_id=REPLACED_ACCOUNT_ID)
    current = _session(engine)

    archived = engine.archive_stale_channel_sessions(
        provider="wechat", account_fingerprint=IDENTITY.account_fingerprint(ACCOUNT_ID)
    )

    assert archived == 1
    assert engine.get_session(str(stale["session_id"]))["lifecycle"] == "archived"
    assert engine.get_session(str(current["session_id"]))["lifecycle"] == "active"
    # Only the Session leaves the Desktop list; the binding stays behind, which is
    # what lets that account resume its own conversation later.
    assert _binding_row(tmp_path, str(stale["origin"]["binding_id"])) is not None
    titles = [item["title"] for item in engine.list_sessions(WORKSPACE_A)["data"]]
    assert titles == [current["title"]]
    archived_titles = [item["title"] for item in engine.list_sessions(WORKSPACE_A, archived=True)["data"]]
    assert archived_titles == [stale["title"]]


def test_a_retired_account_resumes_its_session_when_it_logs_back_in(tmp_path) -> None:
    engine = _engine(tmp_path)
    stale = _session(engine, account_id=REPLACED_ACCOUNT_ID)
    _session(engine)
    engine.archive_stale_channel_sessions(
        provider="wechat", account_fingerprint=IDENTITY.account_fingerprint(ACCOUNT_ID)
    )

    resumed, created = _resolve(engine, account_id=REPLACED_ACCOUNT_ID)

    assert created is False
    assert resumed["session_id"] == stale["session_id"]
    assert resumed["lifecycle"] == "active"
    assert _event_kinds(tmp_path, str(stale["session_id"]))[-1] == "session.updated"


def test_archiving_stale_channel_sessions_leaves_other_providers_alone(tmp_path) -> None:
    engine = _engine(tmp_path)
    other = engine.resolve_or_create_channel_session(
        WORKSPACE_A,
        provider="telegram",
        account_fingerprint="telegram-account",
        provider_user_key="telegram-user",
        title_prefix="Telegram",
    )[0]
    _session(engine, account_id=REPLACED_ACCOUNT_ID)
    _session(engine)

    archived = engine.archive_stale_channel_sessions(
        provider="wechat", account_fingerprint=IDENTITY.account_fingerprint(ACCOUNT_ID)
    )

    assert archived == 1
    assert engine.get_session(str(other["session_id"]))["lifecycle"] == "active"


def test_archiving_stale_channel_sessions_ignores_sessions_already_put_away(tmp_path) -> None:
    engine = _engine(tmp_path)
    stale = _session(engine, account_id=REPLACED_ACCOUNT_ID)
    engine.update_session(str(stale["session_id"]), lifecycle="archived")
    revision = int(engine.get_session(str(stale["session_id"]))["revision"])
    _session(engine)

    archived = engine.archive_stale_channel_sessions(
        provider="wechat", account_fingerprint=IDENTITY.account_fingerprint(ACCOUNT_ID)
    )

    assert archived == 0
    settled = engine.get_session(str(stale["session_id"]))
    assert settled["lifecycle"] == "archived"
    assert int(settled["revision"]) == revision


def test_archiving_stale_channel_sessions_requires_an_account_identity(tmp_path) -> None:
    engine = _engine(tmp_path)
    try:
        engine.archive_stale_channel_sessions(provider="wechat", account_fingerprint="")
    except ValueError as error:
        assert "Account identity" in str(error)
    else:  # pragma: no cover - the guard is the point of the test
        raise AssertionError("An empty account fingerprint must be rejected")


class _RecordingEngine:
    """Records the retirement call the bridge makes on behalf of its account."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def archive_stale_channel_sessions(self, *, provider: str, account_fingerprint: str) -> int:
        self.calls.append((provider, account_fingerprint))
        return 1


def test_the_bridge_retires_the_account_its_credentials_replaced() -> None:
    engine = _RecordingEngine()
    bridge = WeChatRuntimeSessionBridge(
        engine=engine,
        agent_service=None,
        workspace_id=lambda: WORKSPACE_A,
        identity=IDENTITY,
        account_id=ACCOUNT_ID,
    )

    assert bridge.retire_stale_account_sessions() == 1
    assert engine.calls == [("wechat", IDENTITY.account_fingerprint(ACCOUNT_ID))]
